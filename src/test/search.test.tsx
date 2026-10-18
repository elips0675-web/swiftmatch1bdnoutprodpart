import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const h = vi.hoisted(() => {
  const state = { mode: null as string | null };
  return {
    state,
    params: { get: (key: string) => (key === 'mode' ? state.mode : null) },
    t: (key: string) => key,
    push: vi.fn(),
    back: vi.fn(),
    toast: vi.fn(),
    track: vi.fn(),
  };
});

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/shims/next-navigation', () => ({
  useSearchParams: () => h.params,
  useRouter: () => ({ push: h.push, back: h.back, replace: vi.fn() }),
}));

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => null,
}));

vi.mock('@/components/navigation/bottom-nav', () => ({
  BottomNav: () => null,
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: h.toast,
  useToast: () => ({ toast: h.toast, toasts: [] }),
}));

vi.mock('@/hooks/useExperiment', () => ({
  useTrackEvent: () => h.track,
}));

vi.mock('@/components/dialogs/match-dialog', () => ({
  MatchDialog: () => <div data-testid="match-dialog" />,
}));

vi.mock('@/components/dialogs/filters-dialog', () => ({
  FiltersDialog: () => <div data-testid="filters-dialog" />,
}));

import SearchPage from '@/pages/search';

const anna = {
  id: 2,
  name: 'Анна',
  age: 24,
  img: '/demo/people/anna.png',
  photoURL: '/demo/people/anna.png',
  city: 'Москва',
  interests: ['interest.photography', 'interest.travel', 'interest.coffee', 'interest.music', 'interest.sport'],
  goal: 'goal.serious_relationship',
  gender: 'female',
  lookingFor: 'male',
  superLikes: 5,
  circadian: 'lark',
  attachmentStyle: 'secure',
};

function setProfile(extra: Record<string, unknown> = {}) {
  localStorage.setItem('userProfile', JSON.stringify({ ...anna, ...extra }));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>,
  );
}

async function firstCard() {
  return screen.findByText('Александр, 26');
}

function autosearchFilters(overrides: Record<string, unknown> = {}) {
  sessionStorage.setItem('autosearchFilters', JSON.stringify({
    ageRange: [20, 40],
    selectedCity: 'all',
    selectedCountry: '',
    distance: [50],
    selectedDatingGoal: 'all',
    selectedInterests: ['interest.travel'],
    ...overrides,
  }));
}

describe('Страница search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    h.state.mode = null;
    setProfile();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('в обычном режиме рисует первого кандидата, счётчик и заголовок «рядом»', async () => {
    renderPage();

    expect(await firstCard()).toBeInTheDocument();
    expect(screen.getByText('1 / 10')).toBeInTheDocument();
    expect(screen.getByText('home.nearby')).toBeInTheDocument();
    expect(screen.getByText('3 units.km')).toBeInTheDocument();
    expect(screen.getByTestId('prev-profile')).toBeDisabled();
    expect(screen.getByTestId('next-profile')).not.toBeDisabled();
  });

  it('листает карточки вперёд и назад, не выходя за границы списка', async () => {
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByTestId('next-profile'));
    expect(await screen.findByText('Михаил, 28')).toBeInTheDocument();
    expect(screen.getByTestId('prev-profile')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('prev-profile'));
    expect(await screen.findByText('Александр, 26')).toBeInTheDocument();
    expect(screen.getByTestId('prev-profile')).toBeDisabled();
  });

  it('голосование принимается один раз и помечает карточку', async () => {
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByText('button.vote'));

    expect(h.toast).toHaveBeenCalledWith({
      title: 'toast.vote_accepted',
      description: 'toast.vote_accepted_desc',
    });
    expect(screen.queryByText('button.vote')).toBeNull();
  });

  it('суперлайк с балансом списывает единицу и показывает мэтч', async () => {
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByTestId('super-like-button'));

    expect(await screen.findByTestId('match-dialog')).toBeInTheDocument();
    expect(h.toast).toHaveBeenCalledWith({
      title: 'toast.super_like',
      description: 'toast.super_like_desc',
    });
    expect(h.track).toHaveBeenCalledWith('swipe_super_like', { target_user_id: 3 });
    expect(JSON.parse(localStorage.getItem('userProfile') || '{}').superLikes).toBe(4);
  });

  it('суперлайк без баланса выключен и не тратит запросы', async () => {
    setProfile({ superLikes: 0 });
    renderPage();
    await firstCard();

    expect(screen.getByTestId('super-like-button')).toBeDisabled();
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
  });

  it('лайк с мэтчем открывает диалог и логирует событие', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByTestId('like-button'));

    expect(await screen.findByTestId('match-dialog')).toBeInTheDocument();
    expect(h.toast).toHaveBeenCalledWith({
      title: 'toast.like',
      description: 'toast.you_liked_desc',
    });
    expect(h.track).toHaveBeenCalledWith('swipe_like', { target_user_id: 3 });
  });

  it('лайк без мэтча листает к следующему кандидату', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByTestId('like-button'));

    expect(await screen.findByText('Михаил, 28')).toBeInTheDocument();
    expect(screen.queryByTestId('match-dialog')).toBeNull();
  });

  it('автопоиск применяет сохранённые фильтры и поднимает буст вперёд', async () => {
    h.state.mode = 'autosearch';
    autosearchFilters();
    renderPage();

    expect(await screen.findByText('Егор, 25')).toBeInTheDocument();
    expect(screen.getByText('button.autosearch')).toBeInTheDocument();
  });

  it('автопоиск без совпадений показывает пустой экран, а «сменить фильтры» открывает диалог', async () => {
    h.state.mode = 'autosearch';
    autosearchFilters({ ageRange: [99, 99] });
    renderPage();

    expect(await screen.findByText('search.no_profiles')).toBeInTheDocument();
    expect(screen.getByText('search.no_profiles_desc')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('change-filters'));

    expect(await screen.findByTestId('filters-dialog')).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
  });

  it('кнопка слайдеров в автопоиске открывает диалог фильтров', async () => {
    h.state.mode = 'autosearch';
    autosearchFilters();
    renderPage();
    await screen.findByText('Егор, 25');

    fireEvent.click(screen.getByTestId('open-filters'));

    expect(await screen.findByTestId('filters-dialog')).toBeInTheDocument();
  });

  it('обычный режим применяет фильтры, сохранённые на странице /search-filters', async () => {
    localStorage.setItem('searchFilters', JSON.stringify({
      ageRange: [30, 35],
      distance: [50],
      selectedCity: 'all',
      selectedInterests: [],
    }));
    renderPage();

    expect(await screen.findByText('Дмитрий, 32')).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    expect(screen.getByText('home.nearby')).toBeInTheDocument();
    expect(screen.queryByText('Александр, 26')).toBeNull();
  });

  it('фильтры без интересов не превращают ленту в «нет профилей»', async () => {
    h.state.mode = 'autosearch';
    autosearchFilters({ selectedInterests: [], selectedDatingGoal: 'all' });
    renderPage();

    expect(await screen.findByText('Егор, 25')).toBeInTheDocument();
    expect(screen.queryByText('search.no_profiles')).toBeNull();
  });

  it('в обычном режиме кнопка фильтров уводит на /search-filters, а не открывает диалог', async () => {
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByTestId('open-filters'));

    expect(h.push).toHaveBeenCalledWith('/search-filters');
    expect(screen.queryByTestId('filters-dialog')).toBeNull();
  });

  it('в обычном режиме пустой экран ведёт на страницу фильтров', async () => {
    localStorage.setItem('searchFilters', JSON.stringify({
      ageRange: [99, 99],
      distance: [50],
      selectedCity: 'all',
      selectedInterests: [],
    }));
    renderPage();

    expect(await screen.findByText('search.no_profiles')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('change-filters'));

    expect(h.push).toHaveBeenCalledWith('/search-filters');
    expect(screen.queryByTestId('filters-dialog')).toBeNull();
  });

  it('жалоба на кандидата уходит на сервер через POST /api/reports', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByTestId('report-profile'));
    expect(screen.getByText('report.title')).toBeInTheDocument();

    fireEvent.click(screen.getByText('report.button.send'));
    expect(h.toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'report.toast.no_reason_title',
      description: 'report.toast.no_reason_desc',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByText('report.button.send'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/reports',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reported_id: 3, reason: 'spam' }),
        }),
      ),
    );
    expect(h.toast).toHaveBeenCalledWith({
      title: 'report.toast.success_title',
      description: 'report.toast.success_desc Александр.',
    });
  });
});
