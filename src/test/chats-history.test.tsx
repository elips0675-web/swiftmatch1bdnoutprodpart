import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock('@/lib/token', () => ({ getToken: () => 'test-token' }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}))

vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: { id: 7 }, isLoading: false }),
}))

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => ({ partnerOffersEnabled: false }),
}))

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() }, connected: true }),
}))

vi.mock('@/hooks/use-webrtc', () => ({
  useWebRTC: () => ({ startCall: vi.fn(), acceptCall: vi.fn(), endCall: vi.fn(), isInCall: false }),
}))

vi.mock('@/hooks/useExperiment', () => ({ useTrackEvent: () => vi.fn() }))

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

vi.mock('@/hooks/useAntiScreenshot', () => ({
  useAntiScreenshot: () => ({ current: null }),
}))

vi.mock('@/components/chat/chat-partner-actions', () => ({
  ChatPartnerActions: () => <div data-testid="partner-actions" />,
}))

vi.mock('@/components/video-call', () => ({ VideoCallDialog: () => null }))
vi.mock('@/components/voice-call', () => ({ VoiceCallDialog: () => null }))

import ChatPage from '@/pages/chats-chatId'

const CHAT_ID = '7'

const partner = { id: 7, user_id: 8, name: 'Аня', avatar: '/a.png' }

function msg(id: number, text: string) {
  return {
    id,
    sender_id: 8,
    text,
    image_url: null,
    reply_to: null,
    ttl_seconds: null,
    created_at: `2026-10-04T10:${String(id).padStart(2, '0')}:00.000Z`,
    sender_name: 'Аня',
    seen: true,
    reactions: [],
  }
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

// Ответ сервера на страницу истории: `before` отсутствует — новая страница,
// `before=50` — порция строго старше 50.
const FIRST_PAGE = { messages: [msg(50, 'свежее-1'), msg(51, 'свежее-2')], has_more: true, next_before: 50 }
const OLDER_PAGE = { messages: [msg(48, 'старое-1'), msg(49, 'старое-2')], has_more: false, next_before: 48 }

let firstPage = FIRST_PAGE
let olderPage = OLDER_PAGE

function installFetch() {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url)
    if (u.startsWith(`/api/chats/${CHAT_ID}/messages`)) {
      return Promise.resolve(jsonResponse(jsonBefore(u) ? olderPage : firstPage))
    }
    if (u === `/api/chats/${CHAT_ID}`) return Promise.resolve(jsonResponse(partner))
    if (u.includes('/api/hangouts/by-chat/')) return Promise.resolve(jsonResponse({}, 404))
    if (u.includes('/read')) return Promise.resolve(jsonResponse({}))
    return Promise.resolve(jsonResponse({}, 404))
  })
}

function jsonBefore(url: string) {
  return /[?&]before=/.test(url)
}

function requestedMessageUrls() {
  return mockFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith(`/api/chats/${CHAT_ID}/messages`))
}

function renderChat() {
  return render(
    <MemoryRouter>
      <ChatPage params={{ chatId: CHAT_ID }} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom не реализует scrollIntoView — страница дёргает его после загрузки.
  Element.prototype.scrollIntoView = vi.fn()
  firstPage = FIRST_PAGE
  olderPage = OLDER_PAGE
  installFetch()
})

describe('История чата: страницы вместо «первых 100 навсегда»', () => {
  it('первая страница приходит с limit, а не «вся история»', async () => {
    renderChat()
    await screen.findByText('свежее-2')
    expect(requestedMessageUrls()).toEqual([`/api/chats/${CHAT_ID}/messages?limit=50`])
  })

  it('прокрутка вверх подгружает порцию строго старше курсора и ставит её В НАЧАЛО списка', async () => {
    renderChat()
    await screen.findByText('свежее-2')

    fireEvent.scroll(screen.getByTestId('message-list'))

    await screen.findByText('старое-1')
    expect(requestedMessageUrls()).toContain(`/api/chats/${CHAT_ID}/messages?limit=50&before=50`)
    // Порядок в DOM: старые выше новых. Если бы порция вставлялась в конец,
    // история выглядела бы как случайный набор сообщений.
    const older = screen.getByText('старое-1')
    const newer = screen.getByText('свежее-2')
    const follows = older.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(follows).toBeTruthy()
  })

  it('курсор берётся из ответа страницы, а не из первого сообщения в DOM', async () => {
    // next_before = 48 — id старше первого сообщения страницы. Если бы клиент
    // брал курсор из данных первого сообщения (48), второй запрос ушёл бы с
    // before=48 и вернул бы ту же страницу — бесконечное повторение.
    olderPage = { messages: [msg(46, 'еще-старее')], has_more: false, next_before: 46 }
    renderChat()
    await screen.findByText('свежее-2')

    fireEvent.scroll(screen.getByTestId('message-list'))
    await screen.findByText('еще-старее')
    expect(requestedMessageUrls()).toContain(`/api/chats/${CHAT_ID}/messages?limit=50&before=50`)
  })

  it('второй скролл идёт с курсором последней принятой страницы, а не повторяет первый запрос', async () => {
    // Регрессия: если брать `before` из ответа первой страницы всегда, второй
    // скролл запросил бы ту же порцию второй раз и сообщения продублировались.
    const midPage = { messages: [msg(48, 'старое-1'), msg(49, 'старое-2')], has_more: true, next_before: 48 }
    const deepPage = { messages: [msg(46, 'глубже-1')], has_more: false, next_before: 46 }
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.startsWith(`/api/chats/${CHAT_ID}/messages`)) {
        const page = u.includes('before=50') ? midPage : u.includes('before=48') ? deepPage : FIRST_PAGE
        return Promise.resolve(jsonResponse(page))
      }
      if (u === `/api/chats/${CHAT_ID}`) return Promise.resolve(jsonResponse(partner))
      if (u.includes('/api/hangouts/by-chat/')) return Promise.resolve(jsonResponse({}, 404))
      if (u.includes('/read')) return Promise.resolve(jsonResponse({}))
      return Promise.resolve(jsonResponse({}, 404))
    })

    renderChat()
    await screen.findByText('свежее-2')

    fireEvent.scroll(screen.getByTestId('message-list'))
    await screen.findByText('старое-1')
    fireEvent.scroll(screen.getByTestId('message-list'))
    await screen.findByText('глубже-1')

    expect(requestedMessageUrls()).toEqual([
      `/api/chats/${CHAT_ID}/messages?limit=50`,
      `/api/chats/${CHAT_ID}/messages?limit=50&before=50`,
      `/api/chats/${CHAT_ID}/messages?limit=50&before=48`,
    ])
  })

  it('история кончилась — повторный скролл не шлёт запрос (нет бесконечной перезагрузки)', async () => {
    renderChat()
    await screen.findByText('свежее-2')

    fireEvent.scroll(screen.getByTestId('message-list'))
    await screen.findByText('старое-1')
    expect(requestedMessageUrls()).toHaveLength(2)

    fireEvent.scroll(screen.getByTestId('message-list'))
    fireEvent.scroll(screen.getByTestId('message-list'))
    await new Promise((r) => setTimeout(r, 20))
    expect(requestedMessageUrls()).toHaveLength(2)
  })

  it('первая страница без has_more — скролл вверх не запрашивает историю', async () => {
    firstPage = { messages: [msg(1, 'одно')], has_more: false, next_before: 1 }
    renderChat()
    await screen.findByText('одно')

    fireEvent.scroll(screen.getByTestId('message-list'))
    await new Promise((r) => setTimeout(r, 20))
    expect(requestedMessageUrls()).toHaveLength(1)
  })

  it('упавший запрос истории не теряет уже загруженные сообщения', async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url)
      if (u.startsWith(`/api/chats/${CHAT_ID}/messages`)) {
        return jsonBefore(u) ? Promise.resolve(jsonResponse({}, 500)) : Promise.resolve(jsonResponse(FIRST_PAGE))
      }
      if (u === `/api/chats/${CHAT_ID}`) return Promise.resolve(jsonResponse(partner))
      if (u.includes('/api/hangouts/by-chat/')) return Promise.resolve(jsonResponse({}, 404))
      if (u.includes('/read')) return Promise.resolve(jsonResponse({}))
      return Promise.resolve(jsonResponse({}, 404))
    })

    renderChat()
    await screen.findByText('свежее-2')
    fireEvent.scroll(screen.getByTestId('message-list'))
    await new Promise((r) => setTimeout(r, 30))

    expect(screen.getByText('свежее-2')).toBeTruthy()
    expect(screen.getByText('свежее-1')).toBeTruthy()
  })
})