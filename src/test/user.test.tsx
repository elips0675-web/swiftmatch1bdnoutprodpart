import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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
import { POLL_QUESTIONS } from '@/lib/demo-data';

const renderPage = () =>
  render(
    <MemoryRouter>
      <UserProfilePage />
    </MemoryRouter>,
  );

const POLL_ANSWERS_USER_2: Record<string, number> = {
  coffee_tea: 2,
  cat_dog: 0,
  morning_night: 0,
  pizza_sushi: 2,
  sea_mountains: 0,
  movies_series: 1,
  book_film: 2,
  marvel_dc: 0,
};

describe('Страница user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.userId = '2';
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('показывает профиль запрошенного пользователя, его данные и заработанный титул', () => {
    renderPage();

    expect(screen.getByText('Анна, 24')).toBeInTheDocument();
    expect(screen.getByText('Москва • 2 units.km user.from_you')).toBeInTheDocument();
    expect(screen.getByText('87% user.match_score')).toBeInTheDocument();
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

  it('для неизвестного id откатывается ко второму пользователю демо-данных', () => {
    h.userId = '9999';
    renderPage();

    expect(screen.getByText('Александр, 26')).toBeInTheDocument();
    expect(screen.getByText('95% user.match_score')).toBeInTheDocument();
    expect(screen.getByText('Король сердец')).toBeInTheDocument();
  });

  it('во вкладке «Галерея» показывает пять фото и открывает просмотрщик без ошибок Radix', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const user = userEvent.setup();
    renderPage();

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

  it('жалоба без причины не отправляется, с причиной уходит на сервер и закрывает диалог', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('report-user'));
    expect(screen.getByText('report.title')).toBeInTheDocument();

    await user.click(screen.getByText('report.button.send'));

    expect(h.toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'report.toast.no_reason_title',
      description: 'report.toast.no_reason_desc',
    });
    expect(fetchMock).not.toHaveBeenCalled();
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const user = userEvent.setup();
    renderPage();

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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

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
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('block-user'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByTestId('block-user'));

    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ variant: 'destructive', title: 'user.block_error' }));
    expect(h.router.back).not.toHaveBeenCalled();
  });

  it('лайк показывает тост, а без совпадения не открывает диалог матча', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('button.like'));

    expect(h.toast).toHaveBeenCalledWith({ title: 'toast.you_liked' });
    expect(screen.queryByText('match.title')).toBeNull();
  });

  it('при совпадении открывает диалог матча и ведёт в чат', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('button.like'));

    expect(await screen.findByText('match.title')).toBeInTheDocument();

    await user.click(screen.getByText('button.write_first'));
    expect(h.router.push).toHaveBeenCalledWith('/chats?matchId=2');
  });

  it('приглашение «кофе» сохраняется в sentInvites и подтверждается тостом', async () => {
    const user = userEvent.setup();
    renderPage();

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
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('invite-user'));
    await user.click(screen.getByText('invite.option.custom'));

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

  it('викторина считает верные ответы, доходит до результата и начинается заново', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('profile.tab.polls'));
    expect(screen.getByText('polls.coffee_tea')).toBeInTheDocument();

    vi.useFakeTimers();
    for (const q of POLL_QUESTIONS) {
      fireEvent.click(screen.getByText(`polls.${q.id}.${POLL_ANSWERS_USER_2[q.id]}`));
      expect(screen.getByText('polls.match')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      fireEvent.click(screen.getByText('polls.next'));
    }
    vi.useRealTimers();

    expect(screen.getByText('polls.result_title_good')).toBeInTheDocument();
    expect(screen.getByText('8/8')).toBeInTheDocument();

    fireEvent.click(screen.getByText('polls.play_again'));

    expect(screen.getByText('polls.coffee_tea')).toBeInTheDocument();
    expect(screen.queryByText('8/8')).toBeNull();
  });

  it('неверный ответ подсвечивает верный вариант и не даёт очко', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('profile.tab.polls'));
    fireEvent.click(screen.getByText('polls.coffee_tea.1'));

    expect(screen.getByText('polls.no_match — polls.coffee_tea.2')).toBeInTheDocument();
  });
});
