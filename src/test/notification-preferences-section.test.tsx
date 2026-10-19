import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationPreferencesSection } from '@/components/settings/notification-preferences-section';

const KEYS: Record<string, string> = {
  'notif.section': 'Уведомления по событиям',
  'notif.title': 'Что присылать',
  'notif.subtitle': 'sub',
  'notif.loading': 'Загрузка…',
  'notif.saved': 'Сохранено',
  'notif.save_failed': 'Ошибка',
  'notif.save_failed_desc': 'desc',
  'notif.event_column': 'Событие',
  'notif.channel_inapp': 'В приложении',
  'notif.channel_push': 'Push',
  'notif.all': 'Все события',
  'notif.all_on': 'Все вкл',
  'notif.event.like': 'Лайки',
  'notif.event.invite': 'Приглашения',
  'notif.event.chat_message': 'Сообщения',
  'notif.quiet.title': 'Тихие часы (DND)',
  'notif.quiet.desc': 'desc',
  'notif.quiet.enable': 'Не беспокоить',
  'notif.quiet.from': 'С',
  'notif.quiet.until': 'До',
  'notif.quiet.timezone': 'Часовой пояс',
  'notif.quiet.invalid_time': 'Некорректное время',
};

const flags = vi.hoisted(() => ({ value: { quietHoursEnabled: false } }));

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => flags.value,
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) => KEYS[key] ?? key,
    language: 'RU',
    setLanguage: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/token', () => ({
  getToken: () => 'test-token',
}));

const pushMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => pushMock(...args),
}));

const EVENTS = [
  { key: 'like', channels: ['inApp', 'push'] },
  { key: 'invite', channels: ['inApp'] },
  { key: 'chat_message', channels: ['push'] },
];

const PREFS = {
  like: { inApp: true, push: true },
  invite: { inApp: true },
  chat_message: { push: true },
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function lastPutBody(): Record<string, Record<string, boolean>> | null {
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const [url, init] = calls[i] as [string, { method?: string; body?: string }];
    if (init?.method === 'PUT') return JSON.parse(init.body as string).prefs;
  }
  return null;
}

function renderSection() {
  return render(<NotificationPreferencesSection />);
}

function quietFetch(quiet: Record<string, unknown>, putStatus = 200) {
  return vi.fn().mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/api/notifications/quiet-hours' && init?.method === 'PUT') {
      return jsonResponse({ quiet: JSON.parse(init.body as string).quiet }, putStatus);
    }
    if (url === '/api/notifications/quiet-hours') {
      return jsonResponse({ quiet });
    }
    if (url === '/api/notifications/preferences' && init?.method === 'PUT') {
      return jsonResponse({ prefs: PREFS });
    }
    if (url === '/api/notifications/preferences') {
      return jsonResponse({ prefs: PREFS, events: EVENTS, channels: ['inApp', 'push'] });
    }
    return jsonResponse({}, 404);
  });
}

function lastQuietPutBody(): Record<string, unknown> | null {
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const [url, init] = calls[i] as [string, { method?: string; body?: string }];
    if (url === '/api/notifications/quiet-hours' && init?.method === 'PUT') {
      return JSON.parse(init.body as string).quiet;
    }
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.value.quietHoursEnabled = false;
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url === '/api/notifications/preferences' && init?.method === 'PUT') {
      return jsonResponse({ prefs: PREFS });
    }
    if (url === '/api/notifications/preferences') {
      return jsonResponse({ prefs: PREFS, events: EVENTS, channels: ['inApp', 'push'] });
    }
    return jsonResponse({}, 404);
  });
});

describe('NotificationPreferencesSection', () => {
  it('показывает загрузку до ответа сервера', () => {
    renderSection();
    expect(screen.getByTestId('notif-prefs-loading')).toBeInTheDocument();
  });

  it('рисует все события из ответа сервера, а не из хардкода', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-prefs')).toBeInTheDocument());
    expect(screen.getByText('Приглашения')).toBeInTheDocument();
    expect(screen.getByText('Сообщения')).toBeInTheDocument();
  });

  it('отправляет Authorization-заголовок с токеном', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-prefs')).toBeInTheDocument());
    const [url, init] = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('/api/notifications/preferences');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('отрисовывает переключатель только для реально существующего канала события', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-prefs')).toBeInTheDocument());
    expect(screen.getByTestId('notif-invite-inApp')).toBeInTheDocument();
    expect(screen.queryByTestId('notif-invite-push')).toBeNull();
    expect(screen.getByTestId('notif-chat_message-push')).toBeInTheDocument();
    expect(screen.queryByTestId('notif-chat_message-inApp')).toBeNull();
  });

  it('выключение одной ячейки шлёт PUT с полной матрицей', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-like-inApp')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notif-like-inApp'));
    await waitFor(() => expect(lastPutBody()).not.toBeNull());
    expect(lastPutBody()?.like.inApp).toBe(false);
    expect(lastPutBody()?.like.push).toBe(true);
  });

  it('выключение не трогает соседние события', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-like-push')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notif-like-push'));
    await waitFor(() => expect(lastPutBody()).not.toBeNull());
    expect(lastPutBody()?.invite.inApp).toBe(true);
    expect(lastPutBody()?.chat_message.push).toBe(true);
  });

  it('мастер-кнопка выключает все события своего канала', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-all-push')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notif-all-push'));
    await waitFor(() => expect(lastPutBody()).not.toBeNull());
    const body = lastPutBody()!;
    expect(body.like.push).toBe(false);
    expect(body.chat_message.push).toBe(false);
    expect(body.invite.inApp).toBe(true);
  });

  it('мастер-кнопка inApp не трогает push-only событие', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-all-inApp')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notif-all-inApp'));
    await waitFor(() => expect(lastPutBody()).not.toBeNull());
    const body = lastPutBody()!;
    expect(body.like.inApp).toBe(false);
    expect(body.invite.inApp).toBe(false);
    expect(body.chat_message.push).toBe(true);
  });

  it('успешный ответ → тост об успехе', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-like-inApp')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notif-like-inApp'));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock.mock.calls[0][0]).toMatchObject({ title: 'Сохранено' });
  });

  it('ответ 500 → тост об ошибке, а не ложное «сохранено»', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return jsonResponse({}, 500);
      return jsonResponse({ prefs: PREFS, events: EVENTS });
    });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-like-inApp')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notif-like-inApp'));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock.mock.calls[0][0]).toMatchObject({
      variant: 'destructive',
      title: 'Ошибка',
    });
  });

  it('ошибка загрузки не оставляет вечный спиннер', async () => {
    global.fetch = vi.fn().mockImplementation(async () => jsonResponse({}, 500));
    renderSection();
    await waitFor(() => expect(screen.queryByTestId('notif-prefs-loading')).toBeNull());
    expect(screen.getByTestId('notif-prefs')).toBeInTheDocument();
  });

  it('выключенная настройка из ответа отражена в переключателе', async () => {
    global.fetch = vi.fn().mockImplementation(async () =>
      jsonResponse({
        prefs: { like: { inApp: false, push: true }, invite: { inApp: true }, chat_message: { push: true } },
        events: EVENTS,
      })
    );
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-like-inApp')).toBeInTheDocument());
    const sw = screen.getByTestId('notif-like-inApp');
    expect(sw.getAttribute('data-state')).toBe('unchecked');
  });
});

describe('NotificationPreferencesSection — тихие часы (DND)', () => {
  it('флаг выключен: блока нет и quiet-hours не запрашивается', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId('notif-prefs')).toBeInTheDocument());
    expect(screen.queryByTestId('quiet-hours')).toBeNull();
    const urls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0]);
    expect(urls).not.toContain('/api/notifications/quiet-hours');
  });

  it('флаг включён: блок отрисован и настройки загружены с Bearer', async () => {
    flags.value.quietHoursEnabled = true;
    global.fetch = quietFetch({ enabled: true, start: '23:30', end: '07:00', timezone: 'Europe/Moscow' });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('quiet-hours')).toBeInTheDocument());
    expect(screen.getByText('Тихие часы (DND)')).toBeInTheDocument();
    expect(screen.getByTestId('quiet-start')).toHaveProperty('value', '23:30');
    expect(screen.getByTestId('quiet-end')).toHaveProperty('value', '07:00');
    expect(screen.getByTestId('quiet-enabled').getAttribute('data-state')).toBe('checked');
    const quietCall = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
      (c) => c[0] === '/api/notifications/quiet-hours'
    );
    expect((quietCall?.[1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer test-token');
  });

  it('переключатель шлёт PUT с полным объектом quiet и тостит об успехе', async () => {
    flags.value.quietHoursEnabled = true;
    global.fetch = quietFetch({ enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('quiet-enabled')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('quiet-enabled'));
    await waitFor(() => expect(lastQuietPutBody()).not.toBeNull());
    const body = lastQuietPutBody()!;
    expect(body.enabled).toBe(true);
    expect(body.start).toBe('22:00');
    expect(body.end).toBe('08:00');
    expect(typeof body.timezone).toBe('string');
    expect(pushMock.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'Сохранено' });
  });

  it('правка времени сохраняется по blur с новым значением', async () => {
    flags.value.quietHoursEnabled = true;
    global.fetch = quietFetch({ enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('quiet-start')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quiet-start'), { target: { value: '23:30' } });
    fireEvent.blur(screen.getByTestId('quiet-start'));
    await waitFor(() => expect(lastQuietPutBody()).not.toBeNull());
    expect(lastQuietPutBody()!.start).toBe('23:30');
  });

  it('blur без изменений не шлёт лишний PUT', async () => {
    flags.value.quietHoursEnabled = true;
    global.fetch = quietFetch({ enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('quiet-start')).toBeInTheDocument());
    fireEvent.blur(screen.getByTestId('quiet-start'));
    await new Promise((r) => setTimeout(r, 0));
    expect(lastQuietPutBody()).toBeNull();
  });

  it('некорректное время → тост invalid_time и никакой записи', async () => {
    flags.value.quietHoursEnabled = true;
    global.fetch = quietFetch({ enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' });
    renderSection();
    await waitFor(() => expect(screen.getByTestId('quiet-start')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quiet-start'), { target: { value: '' } });
    fireEvent.blur(screen.getByTestId('quiet-start'));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock.mock.calls.at(-1)?.[0]).toMatchObject({
      variant: 'destructive',
      title: 'Некорректное время',
    });
    expect(lastQuietPutBody()).toBeNull();
  });

  it('отказ сервера → destructive тост и откат переключателя, а не ложное «Сохранено»', async () => {
    flags.value.quietHoursEnabled = true;
    global.fetch = quietFetch({ enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' }, 500);
    renderSection();
    await waitFor(() => expect(screen.getByTestId('quiet-enabled')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('quiet-enabled'));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock.mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'destructive', title: 'Ошибка' });
    expect(screen.getByTestId('quiet-enabled').getAttribute('data-state')).toBe('unchecked');
  });
});
