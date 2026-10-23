import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const h = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) =>
    options
      ? `${key}[${Object.entries(options).map(([k, v]) => `${k}=${v}`).join(';')}]`
      : key,
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: vi.fn() }),
}));

import { VideoCallDialog } from '@/components/video-call';
import { VoiceCallDialog } from '@/components/voice-call';

const USER = { name: 'Анна', img: '/anna.jpg' };

function stream(id: string) {
  return { id } as unknown as MediaStream;
}

function renderVideo(overrides: Partial<React.ComponentProps<typeof VideoCallDialog>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    user: USER,
    localStream: null,
    remoteStream: null,
    callState: 'calling' as const,
    endCall: vi.fn(),
    isMuted: false,
    isVideoOff: false,
    onToggleMute: vi.fn(),
    onToggleVideo: vi.fn(),
    ...overrides,
  };
  const view = render(<VideoCallDialog {...props} />);
  return { ...props, ...view };
}

function renderVoice(overrides: Partial<React.ComponentProps<typeof VoiceCallDialog>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    user: USER,
    callState: 'calling' as const,
    endCall: vi.fn(),
    isMuted: false,
    onToggleMute: vi.fn(),
    ...overrides,
  };
  const view = render(<VoiceCallDialog {...props} />);
  return { ...props, ...view };
}

describe('VideoCallDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('в закрытом состоянии ничего не рендерит', () => {
    renderVideo({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('во время вызова показывает имя собеседника из перевода', () => {
    renderVideo();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('call.calling_name[name=Анна]')).toBeInTheDocument();
  });

  it('во входящем звонке показывает «входящий» с именем', () => {
    renderVideo({ callState: 'ringing' });
    expect(screen.getByText('call.incoming_name[name=Анна]')).toBeInTheDocument();
  });

  it('без удалённого потока показывает первую букву имени', () => {
    renderVideo({ callState: 'connected' });
    expect(screen.getByText('А')).toBeInTheDocument();
    expect(document.querySelectorAll('video')).toHaveLength(0);
  });

  it('с удалённым потоком рендерит видео', () => {
    const remote = stream('remote');
    renderVideo({ callState: 'connected', remoteStream: remote });
    const videos = document.querySelectorAll('video');
    expect(videos).toHaveLength(1);
    expect(videos[0]).toHaveAttribute('playsinline');
  });

  it('локальный поток показывает PiP, а при выключенной камере прячет', () => {
    const local = stream('local');
    const first = renderVideo({ remoteStream: stream('remote'), localStream: local });
    expect(document.querySelectorAll('video')).toHaveLength(2);
    first.unmount();

    renderVideo({ remoteStream: stream('remote'), localStream: local, isVideoOff: true });
    expect(document.querySelectorAll('video')).toHaveLength(1);
  });

  it('локализует кнопки и переключает микрофон, камеру и звонок', async () => {
    const user = userEvent.setup();
    const props = renderVideo();

    const mute = screen.getByRole('button', { name: 'call.mute' });
    await user.click(mute);
    expect(props.onToggleMute).toHaveBeenCalledTimes(1);

    const camera = screen.getByRole('button', { name: 'call.video_off' });
    await user.click(camera);
    expect(props.onToggleVideo).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'call.end' }));
    expect(props.endCall).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('при выключенном микрофоне и камере подписи меняются на обратные', () => {
    renderVideo({ isMuted: true, isVideoOff: true, localStream: stream('local') });
    expect(screen.getByRole('button', { name: 'call.unmute' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'call.video_on' })).toBeInTheDocument();
  });

  it('переключает полноэкранный режим подписью и иконкой', async () => {
    const user = userEvent.setup();
    renderVideo();

    await user.click(screen.getByRole('button', { name: 'call.fullscreen' }));
    expect(screen.getByRole('button', { name: 'call.exit_fullscreen' })).toBeInTheDocument();
  });

  it('в соединённом состоянии считает длительность звонка', () => {
    vi.useFakeTimers();
    renderVideo({ callState: 'connected' });
    expect(screen.getByText('00:00')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(65000);
    });

    expect(screen.getByText('01:05')).toBeInTheDocument();
  });

  it('Escape закрывает диалог и завершает звонок', async () => {
    const user = userEvent.setup();
    const props = renderVideo({ callState: 'connected' });
    await user.keyboard('{Escape}');
    expect(props.endCall).toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('VoiceCallDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('в закрытом состоянии ничего не рендерит', () => {
    renderVoice({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('показывает имя, аватар и состояние вызова', () => {
    renderVoice();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('call.calling')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Анна' })).toBeInTheDocument();
    expect(screen.getAllByRole('img').every((img) => img.getAttribute('src') === '/anna.jpg')).toBe(true);
  });

  it('без аватара подставляет placeholder вместо пустого src', () => {
    renderVoice({ user: { name: 'Без фото' } });
    expect(screen.getAllByRole('img').every((img) => img.getAttribute('src') === '/placeholder.svg')).toBe(true);
  });

  it('берёт avatar, если отдельного img нет', () => {
    renderVoice({ user: { name: 'С аватаром', avatar: '/avatar.jpg' } });
    expect(screen.getAllByRole('img').every((img) => img.getAttribute('src') === '/avatar.jpg')).toBe(true);
  });

  it('во входящем звонке показывает «входящий»', () => {
    renderVoice({ callState: 'ringing' });
    expect(screen.getByText('call.incoming')).toBeInTheDocument();
  });

  it('в соединённом состоянии считает длительность', () => {
    vi.useFakeTimers();
    renderVoice({ callState: 'connected' });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('00:02')).toBeInTheDocument();
  });

  it('переключает динамик и микрофон подписями', async () => {
    const user = userEvent.setup();
    const props = renderVoice();

    await user.click(screen.getByRole('button', { name: 'call.speaker_off' }));
    expect(screen.getByRole('button', { name: 'call.speaker_on' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'call.mute' }));
    expect(props.onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('при выключенном микрофоне подпись кнопки меняется', () => {
    renderVoice({ isMuted: true });
    expect(screen.getByRole('button', { name: 'call.unmute' })).toBeInTheDocument();
  });

  it('завершает звонок и закрывает диалог по красной кнопке', async () => {
    const user = userEvent.setup();
    const props = renderVoice({ isMuted: true });

    await user.click(screen.getByRole('button', { name: 'call.end' }));

    expect(props.endCall).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('таймер не идёт, пока звонок не соединён', () => {
    vi.useFakeTimers();
    renderVoice({ callState: 'calling' });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('00:00')).toBeInTheDocument();
  });
});
