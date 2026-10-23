import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const h = vi.hoisted(() => {
  const router = { push: vi.fn(), back: vi.fn(), replace: vi.fn() };
  return {
    t: (key: string) => key,
    toast: vi.fn(),
    router,
    userId: '2' as string | null,
  };
});

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/shims/next-navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? h.userId : null) }),
  useRouter: () => h.router,
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: h.toast,
  useToast: () => ({ toast: h.toast, toasts: [] }),
}));

vi.mock('@/components/watch-button', () => ({
  WatchButton: ({ userId }: { userId: number }) => <div data-testid="watch-button">{userId}</div>,
}));

import UserProfilePage from '@/pages/user';
import { clearToken, setToken } from '@/lib/token';

const PROFILE = {
  id: 2,
  display_name: 'Анна',
  age: 24,
  city: 'Москва',
  bio: 'Люблю закаты, хороший кофе и интересные разговоры.',
  gender: 'female',
  dating_goal: 'goal.serious_relationship',
  height: 172,
  looking_for: 'male',
  zodiac: 'common.zodiac.leo',
  avatar_url: '/anna.jpg',
  photos: [
    { url: '/anna.jpg' },
    { url: '/anna-2.jpg' },
    { url: '/anna-3.jpg' },
    { url: '/anna-4.jpg' },
    { url: '/anna-5.jpg' },
  ],
  interests: [
    { name_ru: 'Спорт' },
    { name_ru: 'Музыка' },
    { name_ru: 'Фотография' },
    { name_ru: 'Путешествия' },
    { name_ru: 'Кофе' },
  ],
};

function jsonResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => data } as Response);
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | undefined;

function stubFetch(handler: FetchHandler = () => undefined) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = await handler(String(url), init);
    if (custom) return custom;
    const u = String(url);
    if (u === '/api/profile/2') return jsonResponse(PROFILE);
    if (u === '/api/profile/2/view') return jsonResponse({ viewed: true });
    if (u === '/api/likes') return jsonResponse({ message: 'Like sent', matched: false }, true, 201);
    if (u === '/api/reports' || u === '/api/block') return jsonResponse({ ok: true });
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <UserProfilePage />
    </MemoryRouter>,
  );

const renderLoaded = async () => {
  const view = renderPage();
  await screen.findByText(/Анна/);
  return view;
};

describe('Страница user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.userId = '2';
    localStorage.clear();
    sessionStorage.clear();
    clearToken();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('загружает профиль из API и показывает его данные, интересы и титул', async () => {
    stubFetch();
    await renderLoaded();

    expect(screen.getByText(/Анна, 24/)).toBeInTheDocument();
    expect(screen.getByText('Москва')).toBeInTheDocument();
    expect(screen.getByText('"Люблю закаты, хороший кофе и интересные разговоры."')).toBeInTheDocument();
    expect(screen.getByText('profile.rank')).toBeInTheDocument();
    expect(screen.getByText('Душа компании')).toBeInTheDocument();
    for (const key of [
      'interest.coffee',
      'interest.music',
      'interest.photography',
      'interest.sport',
      'interest.travel',
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    expect(screen.getByTestId('watch-button')).toHaveTextContent('2');
  });

  it('не показывает процент совпадения: у реального профиля его нет', async () => {
    stubFetch();
    await renderLoaded();

    expect(screen.queryByText(/user\.match_score/)).toBeNull();
  });

  it('404 от API показывает «профиль недоступен», а не демо-человека', async () => {
    stubFetch((url) => (url === '/api/profile/2' ? jsonResponse({}, false, 404) : undefined));
    renderPage();

    expect(await screen.findByText('user.not_found')).toBeInTheDocument();
    expect(screen.getByText('user.not_found_desc')).toBeInTheDocument();
    expect(screen.queryByText(/Анна/)).toBeNull();
  });

  it('нечисловой id не ходит в API и показывает недоступность', async () => {
    h.userId = 'abc';
    const fetchMock = stubFetch();
    renderPage();

    expect(await screen.findByText('user.not_found')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('без id не ходит в API и показывает недоступность', async () => {
    h.userId = null;
    const fetchMock = stubFetch();
    renderPage();

    expect(await screen.findByText('user.not_found')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('с токеном пишет визит профиля после загрузки', async () => {
    setToken('jwt');
    const fetchMock = stubFetch();
    await renderLoaded();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/profile/2/view',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('без токена визит не пишется', async () => {
    const fetchMock = stubFetch();
    await renderLoaded();

    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/profile/2/view');
  });

  it('во вкладке «Галерея» показывает фото из API и открывает просмотрщик', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch();
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByText('profile.tab.gallery'));

    const photos = screen.getAllByAltText('Gallery photo');
    expect(photos).toHaveLength(5);
    expect(screen.queryByAltText('Photo view')).toBeNull();

    await user.click(photos[1]);

    expect(screen.getByText('gallery.viewer')).toBeInTheDocument();
    expect(screen.getAllByAltText('Photo view')).toHaveLength(5);

    const messages = consoleWarn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((message) => message.includes('Missing `Description`'))).toEqual([]);
  });

  it('вкладки викторины нет: ответы о реальном человеке взять неоткуда', async () => {
    stubFetch();
    await renderLoaded();

    expect(screen.queryByText('profile.tab.polls')).toBeNull();
    expect(screen.getByText('profile.tab.data')).toBeInTheDocument();
    expect(screen.getByText('profile.tab.gallery')).toBeInTheDocument();
  });

  it('жалоба без причины не отправляется, с причиной уходит на сервер и закрывает диалог', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByTestId('report-user'));
    expect(screen.getByText('report.title')).toBeInTheDocument();

    await user.click(screen.getByText('report.button.send'));

    expect(h.toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'report.toast.no_reason_title',
      description: 'report.toast.no_reason_desc',
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/reports')).toHaveLength(0);
    expect(screen.getByText('report.title')).toBeInTheDocument();

    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByText('report.button.send'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/reports',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reported_id: 2, reason: 'spam' }),
        }),
      ),
    );
    expect(h.toast).toHaveBeenCalledWith({
      title: 'report.toast.success_title',
      description: 'report.toast.success_desc Анна.',
    });
    await waitFor(() => expect(screen.queryByText('report.title')).toBeNull());
  });

  it('отказ сервера на жалобу показывает ошибку, а не ложный успех', async () => {
    stubFetch((url) => (url === '/api/reports' ? jsonResponse({}, false, 500) : undefined));
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByTestId('report-user'));
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByText('report.button.send'));

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith({ variant: 'destructive', title: 'error.generic_title' }),
    );
    expect(h.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'report.toast.success_title' }),
    );
    expect(screen.getByText('report.title')).toBeInTheDocument();
  });

  it('блокировка после подтверждения шлёт POST и уводит назад', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByTestId('block-user'));

    expect(confirmSpy).toHaveBeenCalledWith('user.block_confirm');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/block',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ blocked_id: '2' }) }),
    );
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'user.blocked' }));
    expect(h.router.back).toHaveBeenCalledTimes(1);
  });

  it('отказ от подтверждения и ошибка API не уводят со страницы', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = stubFetch((url) => (url === '/api/block' ? jsonResponse({}, false, 500) : undefined));
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByTestId('block-user'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/block')).toHaveLength(0);
    expect(h.toast).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByTestId('block-user'));

    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ variant: 'destructive', title: 'user.block_error' }));
    expect(h.router.back).not.toHaveBeenCalled();
  });

  it('лайк уходит в POST /api/likes, тост показывается, без мэтча диалог не открывается', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByText('button.like'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/likes',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ liked_user_id: 2 }),
        }),
      ),
    );
    expect(h.toast).toHaveBeenCalledWith({ title: 'toast.you_liked' });
    expect(screen.queryByText('match.title')).toBeNull();
  });

  it('взаимный лайк открывает диалог матча и ведёт в чат', async () => {
    stubFetch((url) =>
      url === '/api/likes' ? jsonResponse({ message: "It's a match!", matched: true }, true, 201) : undefined,
    );
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByText('button.like'));

    expect(await screen.findByText('match.title')).toBeInTheDocument();

    await user.click(screen.getByText('button.write_first'));
    expect(h.router.push).toHaveBeenCalledWith('/chats?matchId=2');
  });

  it('дневной лимит лайков показывает подсказку о Premium, а не общую ошибку', async () => {
    stubFetch((url) =>
      url === '/api/likes' ? jsonResponse({ message: 'limit', code: 'LIKE_LIMIT' }, false, 403) : undefined,
    );
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByText('button.like'));

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith({ variant: 'destructive', title: 'user.like_limit' }),
    );
  });

  it('сетевая ошибка лайка показывает user.like_error', async () => {
    stubFetch((url) => {
      if (url !== '/api/likes') return undefined;
      return Promise.reject(new Error('offline'));
    });
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByText('button.like'));

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith({ variant: 'destructive', title: 'user.like_error' }),
    );
  });

  it('приглашение «кофе» сохраняется в sentInvites и подтверждается тостом', async () => {
    stubFetch();
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByTestId('invite-user'));
    expect(screen.getByText('invite.option.coffee')).toBeInTheDocument();

    await user.click(screen.getByText('invite.option.coffee'));

    expect(JSON.parse(localStorage.getItem('sentInvites') || '[]')).toEqual([
      expect.objectContaining({ toUserId: 2, type: 'coffee', userName: 'Анна' }),
    ]);
    expect(h.toast).toHaveBeenCalledWith({ title: 'invite.sent_title', description: 'invite.sent_desc' });
    await waitFor(() => expect(screen.queryByText('invite.option.coffee')).toBeNull());
  });

  it('своё приглашение отправляется только с текстом и сохраняется как custom', async () => {
    stubFetch();
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByTestId('invite-user'));
    await user.click(screen.getByText('invite.option.custom'));

    await waitFor(() => expect(screen.queryByText('invite.option.coffee')).toBeNull());
    expect(screen.getByText('invite.custom_title')).toBeInTheDocument();
    expect(screen.getByText('button.send')).toBeDisabled();

    await user.type(screen.getByPlaceholderText('invite.custom_placeholder'), 'Пойдём в кино');
    expect(screen.getByText('button.send')).toBeEnabled();

    await user.click(screen.getByText('button.send'));

    expect(JSON.parse(localStorage.getItem('sentInvites') || '[]')).toEqual([
      expect.objectContaining({ toUserId: 2, type: 'custom', message: 'Пойдём в кино' }),
    ]);
    expect(h.toast).toHaveBeenCalledWith({ title: 'invite.sent_title', description: 'invite.sent_desc' });
    await waitFor(() => expect(screen.queryByPlaceholderText('invite.custom_placeholder')).toBeNull());
  });
});
