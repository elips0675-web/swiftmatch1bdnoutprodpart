import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Socket } from 'socket.io-client'
import { useWebRTC } from '@/hooks/use-webrtc'

type Handler = (data?: unknown) => void | Promise<void>

class MockSocket {
  handlers = new Map<string, Handler[]>()
  emit = vi.fn()
  on = vi.fn((event: string, handler: Handler) => {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  })
  off = vi.fn((event: string, handler: Handler) => {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler))
  })
  trigger(event: string, data?: unknown) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(data)
  }
}

class MockTrack {
  kind = 'video'
  stopped = false
  stop = vi.fn(() => {
    this.stopped = true
  })
}

class MockStream {
  tracks: MockTrack[]
  constructor(tracks: MockTrack[]) {
    this.tracks = tracks
  }
  getTracks() {
    return this.tracks
  }
}

class MockPeerConnection {
  static instances: MockPeerConnection[] = []
  config: unknown
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null
  onicecandidate: ((event: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  iceConnectionState = 'new'
  addTrack = vi.fn()
  createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'offer-sdp' }))
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer-sdp' }))
  setLocalDescription = vi.fn(async () => undefined)
  setRemoteDescription = vi.fn(async () => undefined)
  addIceCandidate = vi.fn(async () => undefined)
  close = vi.fn()

  constructor(config: unknown) {
    this.config = config
    MockPeerConnection.instances.push(this)
  }
}

class MockSessionDescription {
  init: { type: string; sdp: string }
  constructor(init: { type: string; sdp: string }) {
    this.init = init
  }
}

class MockIceCandidate {
  init: RTCIceCandidateInit
  constructor(init: RTCIceCandidateInit) {
    this.init = init
  }
}

function makeStream() {
  const tracks = [new MockTrack(), new MockTrack()]
  const raw = new MockStream(tracks)
  return { stream: raw as unknown as MediaStream, tracks }
}

function makeSocket() {
  return new MockSocket() as unknown as Socket & MockSocket
}

function lastPeer() {
  return MockPeerConnection.instances[MockPeerConnection.instances.length - 1]
}

const getUserMedia = vi.fn()

beforeEach(() => {
  MockPeerConnection.instances = []
  getUserMedia.mockReset()
  vi.useFakeTimers()
  vi.stubGlobal('RTCPeerConnection', MockPeerConnection)
  vi.stubGlobal('RTCSessionDescription', MockSessionDescription)
  vi.stubGlobal('RTCIceCandidate', MockIceCandidate)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useWebRTC', () => {
  it('startCall без socket или без userId не трогает камеру и не создаёт соединение', async () => {
    const withoutSocket = renderHook(() => useWebRTC(null, 1))
    await act(async () => {
      await withoutSocket.result.current.startCall(2, 'video')
    })

    const withoutUser = renderHook(() => useWebRTC(makeSocket(), null))
    await act(async () => {
      await withoutUser.result.current.startCall(2, 'video')
    })

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(MockPeerConnection.instances).toHaveLength(0)
    expect(withoutSocket.result.current.callState).toBe('idle')
  })

  it('startCall запрашивает камеру, добавляет треки и отправляет offer', async () => {
    const socket = makeSocket()
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const callbacks = { onStateChange: vi.fn(), onError: vi.fn(), onStream: vi.fn() }

    const { result } = renderHook(() => useWebRTC(socket, 1, callbacks))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })

    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true })
    expect(result.current.callState).toBe('calling')
    expect(callbacks.onStateChange).toHaveBeenCalledWith('calling')
    expect(result.current.localStream).toBe(stream)
    const pc = lastPeer()
    expect(pc.config).toEqual({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })
    expect(pc.addTrack).toHaveBeenCalledTimes(tracks.length)
    expect(pc.addTrack).toHaveBeenCalledWith(tracks[0], stream)
    expect(pc.createOffer).toHaveBeenCalled()
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
    expect(socket.emit).toHaveBeenCalledWith('webrtc:call-user', {
      targetUserId: 2,
      sdp: 'offer-sdp',
      type: 'offer',
    })
  })

  it('startCall с готовым потоком не зовёт getUserMedia, audio даёт video:false', async () => {
    const socket = makeSocket()
    const { stream } = makeStream()

    const { result } = renderHook(() => useWebRTC(socket, 1))
    await act(async () => {
      await result.current.startCall(3, 'audio', stream)
    })

    expect(getUserMedia).not.toHaveBeenCalled()
    const pc = lastPeer()
    expect(pc.createOffer).toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('webrtc:call-user', {
      targetUserId: 3,
      sdp: 'offer-sdp',
      type: 'offer',
    })
  })

  it('startCall при отказе камеры отдаёт ошибку и остаётся idle', async () => {
    const socket = makeSocket()
    getUserMedia.mockRejectedValue(new Error('denied'))
    const callbacks = { onError: vi.fn(), onStateChange: vi.fn() }

    const { result } = renderHook(() => useWebRTC(socket, 1, callbacks))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })

    expect(callbacks.onError).toHaveBeenCalledWith('Could not access camera/microphone')
    expect(result.current.callState).toBe('idle')
    expect(MockPeerConnection.instances).toHaveLength(0)
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('acceptCall без socket ничего не делает', async () => {
    const { result } = renderHook(() => useWebRTC(null, 1))
    await act(async () => {
      await result.current.acceptCall(5, 'remote-sdp', 'offer', 'video')
    })
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(MockPeerConnection.instances).toHaveLength(0)
  })

  it('acceptCall ставит remote description, создаёт answer и отправляет его', async () => {
    const socket = makeSocket()
    const { stream } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const callbacks = { onStateChange: vi.fn(), onError: vi.fn() }

    const { result } = renderHook(() => useWebRTC(socket, 1, callbacks))
    await act(async () => {
      await result.current.acceptCall(5, 'remote-sdp', 'offer', 'video')
    })

    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true })
    expect(result.current.callState).toBe('connected')
    expect(callbacks.onStateChange).toHaveBeenCalledWith('connected')
    const pc = lastPeer()
    expect(pc.setRemoteDescription).toHaveBeenCalledWith(
      expect.objectContaining({ init: { type: 'offer', sdp: 'remote-sdp' } }),
    )
    expect(pc.createAnswer).toHaveBeenCalled()
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' })
    expect(socket.emit).toHaveBeenCalledWith('webrtc:call-accepted', {
      targetUserId: 5,
      sdp: 'answer-sdp',
      type: 'answer',
    })
  })

  it('acceptCall при отказе камеры отдаёт ошибку и не создаёт соединение', async () => {
    const socket = makeSocket()
    getUserMedia.mockRejectedValue(new Error('denied'))
    const callbacks = { onError: vi.fn() }

    const { result } = renderHook(() => useWebRTC(socket, 1, callbacks))
    await act(async () => {
      await result.current.acceptCall(5, 'remote-sdp', 'offer', 'audio')
    })

    expect(getUserMedia).toHaveBeenCalledWith({ video: false, audio: true })
    expect(callbacks.onError).toHaveBeenCalledWith('Could not access camera/microphone')
    expect(MockPeerConnection.instances).toHaveLength(0)
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('rejectCall шлёт отказ и возвращает idle', () => {
    const socket = makeSocket()
    const { result } = renderHook(() => useWebRTC(socket, 1))
    act(() => {
      result.current.rejectCall(7)
    })
    expect(socket.emit).toHaveBeenCalledWith('webrtc:call-rejected', { targetUserId: 7 })
    expect(result.current.callState).toBe('idle')
  })

  it('rejectCall без socket не эмитит, но состояние сбрасывает', () => {
    const { result } = renderHook(() => useWebRTC(null, 1))
    act(() => {
      result.current.rejectCall(7)
    })
    expect(result.current.callState).toBe('idle')
  })

  it('endCall без партнёра просто завершает звонок и через секунду возвращает idle', () => {
    const socket = makeSocket()
    const { result } = renderHook(() => useWebRTC(socket, 1))
    act(() => {
      result.current.endCall()
    })
    expect(socket.emit).not.toHaveBeenCalled()
    expect(result.current.callState).toBe('ended')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.callState).toBe('idle')
  })

  it('endCall с партнёром эмитит end-call и освобождает поток и соединение', async () => {
    const socket = makeSocket()
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)

    const { result } = renderHook(() => useWebRTC(socket, 1))
    await act(async () => {
      await result.current.startCall(9, 'video')
    })
    const pc = lastPeer()
    act(() => {
      result.current.endCall()
    })

    expect(socket.emit).toHaveBeenCalledWith('webrtc:end-call', { targetUserId: 9 })
    expect(tracks.every((t) => t.stopped)).toBe(true)
    expect(pc.close).toHaveBeenCalled()
    expect(result.current.localStream).toBeNull()
    expect(result.current.callState).toBe('ended')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.callState).toBe('idle')
  })

  it('cleanup без ресурсов не падает', () => {
    const { result } = renderHook(() => useWebRTC(null, 1))
    act(() => {
      result.current.cleanup()
    })
    expect(result.current.remoteStream).toBeNull()
  })

  it('ontrack кладёт удалённый поток в состояние и зовёт onStream', async () => {
    const socket = makeSocket()
    const { stream } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const callbacks = { onStream: vi.fn() }

    const { result } = renderHook(() => useWebRTC(socket, 1, callbacks))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const pc = lastPeer()
    act(() => {
      pc.ontrack?.({ streams: [stream] })
    })

    expect(callbacks.onStream).toHaveBeenCalledWith(stream)
    expect(result.current.remoteStream).toBe(stream)
  })

  it('onicecandidate эмитит кандидата только при наличии candidate и socket', async () => {
    const socket = makeSocket()
    const { stream } = makeStream()
    getUserMedia.mockResolvedValue(stream)

    const { result } = renderHook(() => useWebRTC(socket, 1))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const pc = lastPeer()
    const candidate = { toJSON: () => ({ candidate: 'ice', sdpMid: '0' }) }

    act(() => {
      pc.onicecandidate?.({ candidate })
    })
    expect(socket.emit).toHaveBeenCalledWith('webrtc:ice-candidate', {
      targetUserId: 2,
      candidate: { candidate: 'ice', sdpMid: '0' },
    })

    socket.emit.mockClear()
    act(() => {
      pc.onicecandidate?.({ candidate: null })
    })
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('onicecandidate без socket не эмитит', async () => {
    const socket = makeSocket()
    const { stream } = makeStream()
    getUserMedia.mockResolvedValue(stream)

    const { result } = renderHook(() => useWebRTC(socket, 1))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const pc = lastPeer()

    const silent = renderHook(() => useWebRTC(null, 1))
    act(() => {
      silent.result.current.cleanup()
    })
    act(() => {
      pc.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'ice' }) } })
    })
    expect(pc.close).not.toHaveBeenCalled()
  })

  it('disconnected и failed рвут звонок, а connected — нет', async () => {
    const socket = makeSocket()
    const { stream } = makeStream()
    getUserMedia.mockResolvedValue(stream)

    const { result } = renderHook(() => useWebRTC(socket, 1))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const pc = lastPeer()

    act(() => {
      pc.iceConnectionState = 'connected'
      pc.oniceconnectionstatechange?.()
    })
    expect(result.current.callState).toBe('calling')

    act(() => {
      pc.iceConnectionState = 'disconnected'
      pc.oniceconnectionstatechange?.()
    })
    expect(result.current.callState).toBe('ended')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.callState).toBe('idle')

    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const failedPeer = lastPeer()
    act(() => {
      failedPeer.iceConnectionState = 'failed'
      failedPeer.oniceconnectionstatechange?.()
    })
    expect(result.current.callState).toBe('ended')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
  })

  it('входящий звонок переводит в ringing и запоминает партнёра', () => {
    const socket = makeSocket()
    const { result } = renderHook(() => useWebRTC(socket, 1))

    act(() => {
      socket.trigger('webrtc:incoming-call', { from: 42, sdp: 'sdp', type: 'offer' })
    })
    expect(result.current.callState).toBe('ringing')
  })

  it('call-accepted без соединения игнорируется, с соединением ставит remote и connected', async () => {
    const socket = makeSocket()
    const { result } = renderHook(() => useWebRTC(socket, 1))

    await act(async () => {
      socket.trigger('webrtc:call-accepted', { from: 2, sdp: 'answer', type: 'answer' })
    })
    expect(result.current.callState).toBe('idle')

    const { stream } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const pc = lastPeer()

    await act(async () => {
      socket.trigger('webrtc:call-accepted', { from: 2, sdp: 'answer', type: 'answer' })
    })
    expect(pc.setRemoteDescription).toHaveBeenCalledWith(
      expect.objectContaining({ init: { type: 'answer', sdp: 'answer' } }),
    )
    expect(result.current.callState).toBe('connected')
  })

  it('call-rejected отдаёт ошибку, чистит ресурсы и возвращает idle', async () => {
    const socket = makeSocket()
    const { stream } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    const callbacks = { onError: vi.fn() }

    const { result } = renderHook(() => useWebRTC(socket, 1, callbacks))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const pc = lastPeer()

    act(() => {
      socket.trigger('webrtc:call-rejected')
    })
    expect(callbacks.onError).toHaveBeenCalledWith('Call rejected')
    expect(pc.close).toHaveBeenCalled()
    expect(result.current.callState).toBe('idle')
  })

  it('ice-candidate: без соединения игнор, с соединением добавляется, ошибка проглатывается', async () => {
    const socket = makeSocket()
    const { result } = renderHook(() => useWebRTC(socket, 1))

    await act(async () => {
      socket.trigger('webrtc:ice-candidate', { from: 2, candidate: { candidate: 'early' } })
    })
    expect(MockPeerConnection.instances).toHaveLength(0)

    const { stream } = makeStream()
    getUserMedia.mockResolvedValue(stream)
    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const pc = lastPeer()

    await act(async () => {
      socket.trigger('webrtc:ice-candidate', { from: 2, candidate: { candidate: 'ice' } })
    })
    expect(pc.addIceCandidate).toHaveBeenCalledWith(expect.objectContaining({ init: { candidate: 'ice' } }))

    pc.addIceCandidate.mockRejectedValueOnce(new Error('bad candidate'))
    await act(async () => {
      socket.trigger('webrtc:ice-candidate', { from: 2, candidate: { candidate: 'wrong' } })
    })
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(2)
    expect(result.current.callState).toBe('calling')
  })

  it('call-ended чистит ресурсы и через секунду возвращает idle', async () => {
    const socket = makeSocket()
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)

    const { result } = renderHook(() => useWebRTC(socket, 1))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })
    const pc = lastPeer()

    act(() => {
      socket.trigger('webrtc:call-ended')
    })
    expect(tracks.every((t) => t.stopped)).toBe(true)
    expect(pc.close).toHaveBeenCalled()
    expect(result.current.callState).toBe('ended')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.callState).toBe('idle')
  })

  it('user-unavailable отдаёт ошибку и сбрасывает состояние', async () => {
    const socket = makeSocket()
    const callbacks = { onError: vi.fn() }
    const { result } = renderHook(() => useWebRTC(socket, 1, callbacks))

    act(() => {
      socket.trigger('webrtc:user-unavailable')
    })
    expect(callbacks.onError).toHaveBeenCalledWith('User is offline')
    expect(result.current.callState).toBe('idle')
  })

  it('unmount снимает все шесть обработчиков и освобождает поток', async () => {
    const socket = makeSocket()
    const { stream, tracks } = makeStream()
    getUserMedia.mockResolvedValue(stream)

    const { result, unmount } = renderHook(() => useWebRTC(socket, 1))
    await act(async () => {
      await result.current.startCall(2, 'video')
    })

    unmount()

    expect(socket.off).toHaveBeenCalledTimes(6)
    for (const event of [
      'webrtc:incoming-call',
      'webrtc:call-accepted',
      'webrtc:call-rejected',
      'webrtc:ice-candidate',
      'webrtc:call-ended',
      'webrtc:user-unavailable',
    ]) {
      expect(socket.off).toHaveBeenCalledWith(event, expect.any(Function))
    }
    expect(tracks.every((t) => t.stopped)).toBe(true)
  })

  it('без socket эффект подписок не создаётся', () => {
    renderHook(() => useWebRTC(null, 1))
    expect(MockPeerConnection.instances).toHaveLength(0)
  })
})
