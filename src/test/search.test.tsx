import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { AttachmentStyle } from '@/lib/attachment-styles';

const h = vi.hoisted(() => {
  const state = { mode: null as string | null, filters: null as Record<string, unknown> | null };
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
  MatchDialog: (props: {
    onOpenChange: (open: boolean) => void;
    currentUser?: { img?: string; photoURL?: string };
    matchUser?: { id?: number };
  }) => (
    <div
      data-testid="match-dialog"
      data-img={props.currentUser?.img}
      data-photo={props.currentUser?.photoURL}
      data-match={props.matchUser?.id}
    >
      <button data-testid="match-close" onClick={() => props.onOpenChange(false)}>x</button>
    </div>
  ),
}));

vi.mock('@/components/dialogs/filters-dialog', () => ({
  FiltersDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApplyFilters: (filters: Record<string, unknown>) => void;
  }) =>
    props.open ? (
      <div data-testid="filters-dialog">
        <button
          data-testid="filters-apply"
          onClick={() =>
            props.onApplyFilters(h.state.filters ?? {
              ageRange: [30, 35],
              selectedCity: 'all',
              selectedCountry: '',
              distance: [50],
              selectedDatingGoal: 'all',
              selectedInterests: ['interest.travel'],
            })
          }
        >
          apply
        </button>
        <button data-testid="filters-close" onClick={() => props.onOpenChange(false)}>x</button>
      </div>
    ) : null,
}));

import SearchPage, {
  calculateAttachmentCompatibility,
  fromSavedSearchFilters,
  performAutosearch,
  type AutoSearchFilters,
  type SearchUser,
} from '@/pages/search';

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
    h.state.filters = null;
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
    expect(screen.getByText('interest.travel').className).toContain('bg-primary');
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

  it('сохранённые фильтры с интересами подсвечивают общий интерес на карточке', async () => {
    localStorage.setItem('searchFilters', JSON.stringify({
      ageRange: [30, 35],
      distance: [50],
      selectedCity: 'all',
      selectedInterests: ['interest.travel'],
    }));
    renderPage();

    expect(await screen.findByText('Дмитрий, 32')).toBeInTheDocument();
    expect(screen.getByText('interest.travel').className).toContain('bg-primary');
    expect(screen.getByText('interest.sport').className).not.toContain('bg-primary');
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

    await waitFor(() => expect(screen.queryByText('report.title')).toBeNull());
    fireEvent.click(screen.getByTestId('report-profile'));
    expect(screen.getByPlaceholderText('report.details_placeholder')).toHaveValue('');
    expect(screen.getAllByRole('radio').some((radio) => radio.getAttribute('aria-checked') === 'true')).toBe(false);
  });

  it('битый профиль в localStorage не ломает страницу — берётся демо-пользователь', async () => {
    localStorage.setItem('userProfile', '{битый json');
    renderPage();

    expect(await firstCard()).toBeInTheDocument();
    expect(screen.getByText('home.nearby')).toBeInTheDocument();
  });

  it('без сохранённого профиля страница тоже открывается на демо-пользователе', async () => {
    localStorage.clear();
    renderPage();

    expect(await firstCard()).toBeInTheDocument();
    expect(screen.getByText('1 / 10')).toBeInTheDocument();
  });

  it('профиль без фото получает демо-фото совпавшего по имени пользователя', async () => {
    localStorage.setItem('userProfile', JSON.stringify({
      id: 2, name: 'Анна', age: 24, gender: 'female', lookingFor: 'male', superLikes: 5, interests: [], distance: 2,
    }));
    renderPage();
    await screen.findByTestId('super-like-button');

    fireEvent.click(screen.getByTestId('super-like-button'));

    const dialog = await screen.findByTestId('match-dialog');
    expect(dialog.getAttribute('data-img')).toBe('/demo/people/anna.png');
    expect(dialog.getAttribute('data-photo')).toBe('/demo/people/anna.png');
  });

  it('профиль без фото с неизвестным именем получает фото первого пользователя своего пола', async () => {
    localStorage.setItem('userProfile', JSON.stringify({
      id: 77, name: 'Неизвестный', age: 30, gender: 'male', lookingFor: 'female', superLikes: 5, interests: [], distance: 2,
    }));
    renderPage();
    await screen.findByTestId('super-like-button');

    fireEvent.click(screen.getByTestId('super-like-button'));

    expect((await screen.findByTestId('match-dialog')).getAttribute('data-img')).toBe('/demo/people/maxim.png');
  });

  it('профиль без фото и без совпадения по полу получает фото первого демо-пользователя', async () => {
    localStorage.setItem('userProfile', JSON.stringify({
      id: 78, name: 'Никто', age: 30, gender: 'other', lookingFor: 'female', superLikes: 5, interests: [], distance: 2,
    }));
    renderPage();
    await screen.findByTestId('super-like-button');

    fireEvent.click(screen.getByTestId('super-like-button'));

    expect((await screen.findByTestId('match-dialog')).getAttribute('data-img')).toBe('/demo/people/anna.png');
  });

  it('имеющееся фото не перетирается, а недостающее подставляется отдельно', async () => {
    localStorage.setItem('userProfile', JSON.stringify({
      id: 2, name: 'Анна', age: 24, gender: 'female', lookingFor: 'male', superLikes: 5, img: '/keep.png', interests: [], distance: 2,
    }));
    renderPage();
    await screen.findByTestId('super-like-button');

    fireEvent.click(screen.getByTestId('super-like-button'));

    const dialog = await screen.findByTestId('match-dialog');
    expect(dialog.getAttribute('data-img')).toBe('/keep.png');
    expect(dialog.getAttribute('data-photo')).toBe('/demo/people/anna.png');
  });

  it('автопоиск без сохранённых фильтров показывает первые десять профилей', async () => {
    h.state.mode = 'autosearch';
    renderPage();

    expect(await screen.findByText('Александр, 26')).toBeInTheDocument();
    expect(screen.getByText('1 / 10')).toBeInTheDocument();
    expect(screen.getByText('button.autosearch')).toBeInTheDocument();
  });

  it('автопоиск с фильтрами без интересов не сужает выдачу', async () => {
    h.state.mode = 'autosearch';
    sessionStorage.setItem('autosearchFilters', JSON.stringify({
      ageRange: [20, 40],
      selectedCity: 'all',
      selectedCountry: '',
      distance: [50],
      selectedDatingGoal: 'all',
    }));
    renderPage();

    expect(await screen.findByText('Егор, 25')).toBeInTheDocument();
    expect(screen.getByText('1 / 15')).toBeInTheDocument();
  });

  it('пустая выдача через восемь секунд показывает экран ошибки с рабочей навигацией', () => {
    Object.defineProperty(window.history, 'length', { value: 5, configurable: true });
    localStorage.setItem('searchFilters', JSON.stringify({
      ageRange: [99, 99],
      distance: [50],
      selectedCity: 'all',
      selectedInterests: [],
    }));
    vi.useFakeTimers();
    try {
      renderPage();
      expect(screen.getByText('search.no_profiles')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(7999); });
      expect(screen.queryByText('button.back')).not.toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(1); });

      expect(screen.getByText('nav.home')).toBeInTheDocument();
      fireEvent.click(screen.getByText('nav.home'));
      expect(h.push).toHaveBeenCalledWith('/');
      fireEvent.click(screen.getByText('nav.login'));
      expect(h.push).toHaveBeenCalledWith('/login');
      fireEvent.click(screen.getByText('button.back'));
      expect(h.back).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      delete (window.history as unknown as { length?: number }).length;
    }
  });

  it('на экране ошибки кнопка «назад» выключена, если истории нет', () => {
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true });
    localStorage.setItem('searchFilters', JSON.stringify({
      ageRange: [99, 99],
      distance: [50],
      selectedCity: 'all',
      selectedInterests: [],
    }));
    vi.useFakeTimers();
    try {
      renderPage();
      act(() => { vi.advanceTimersByTime(8000); });

      expect(screen.getByText('button.back').closest('button')).toBeDisabled();
    } finally {
      vi.useRealTimers();
      delete (window.history as unknown as { length?: number }).length;
    }
  });

  it('применение фильтров из диалога пересобирает ленту, сохраняет фильтры и закрывает диалог', async () => {
    h.state.mode = 'autosearch';
    autosearchFilters();
    renderPage();
    await screen.findByText('Егор, 25');

    fireEvent.click(screen.getByTestId('open-filters'));
    fireEvent.click(await screen.findByTestId('filters-apply'));

    expect(await screen.findByText('Дмитрий, 32')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('interest.travel').className).toContain('bg-primary');
    expect(JSON.parse(sessionStorage.getItem('autosearchFilters') || '{}').ageRange).toEqual([30, 35]);
    expect(h.toast).toHaveBeenCalledWith({
      title: 'toast.filters_applied',
      description: 'toast.filters_applied_desc',
    });
    expect(screen.queryByTestId('filters-dialog')).toBeNull();
  });

  it('применение фильтров без интересов не сужает выдачу', async () => {
    h.state.mode = 'autosearch';
    autosearchFilters();
    renderPage();
    await screen.findByText('Егор, 25');
    h.state.filters = {
      ageRange: [30, 35],
      selectedCity: 'all',
      selectedCountry: '',
      distance: [50],
      selectedDatingGoal: 'all',
    };

    fireEvent.click(screen.getByTestId('open-filters'));
    fireEvent.click(await screen.findByTestId('filters-apply'));

    expect(await screen.findByText('Дмитрий, 32')).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
  });

  it('лайк на последнем кандидате уводит в пустое состояние, а не зацикливает ленту', async () => {
    localStorage.setItem('searchFilters', JSON.stringify({
      ageRange: [35, 35],
      distance: [50],
      selectedCity: 'all',
      selectedInterests: [],
    }));
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    renderPage();

    expect(await screen.findByText('Виктор, 35')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.getByTestId('next-profile')).toBeDisabled();

    fireEvent.click(screen.getByTestId('like-button'));

    expect(await screen.findByText('search.no_profiles')).toBeInTheDocument();
  });

  it('повторный клик по голосованию за того же кандидата не дублирует тост', async () => {
    renderPage();
    await firstCard();

    const voteButton = screen.getByText('button.vote').closest('button') as HTMLButtonElement;
    fireEvent.click(voteButton);
    fireEvent.click(voteButton);

    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith({
      title: 'toast.vote_accepted',
      description: 'toast.vote_accepted_desc',
    });
  });

  it('клик по карточке открывает профиль кандидата', async () => {
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByAltText('Александр'));

    expect(h.push).toHaveBeenCalledWith('/user?id=3');
  });

  it('кнопка профиля ведёт ссылкой, не вызывая переход карточки', async () => {
    renderPage();
    await firstCard();

    const profileButton = screen.getByTestId('search-profile-btn-3');
    expect(profileButton.tagName).toBe('A');
    expect(profileButton.getAttribute('href')).toBe('/user?id=3');

    fireEvent.click(profileButton);

    expect(h.push).not.toHaveBeenCalled();
  });

  it('закрытие диалога мэтча сбрасывает кандидата', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByTestId('like-button'));
    expect(await screen.findByTestId('match-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('match-close'));

    await waitFor(() => expect(screen.queryByTestId('match-dialog')).toBeNull());
  });

  it('отказ сервера на жалобу показывает общую ошибку, описание уходит обрезанным, отмена закрывает диалог', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await firstCard();

    fireEvent.click(screen.getByTestId('report-profile'));
    fireEvent.change(screen.getByPlaceholderText('report.details_placeholder'), {
      target: { value: '  подробности  ' },
    });
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByText('report.button.send'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports',
      expect.objectContaining({
        body: JSON.stringify({ reported_id: 3, reason: 'harassment', description: 'подробности' }),
      }),
    ));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'error.generic_title',
    }));
    expect(screen.getByText('report.title')).toBeInTheDocument();

    fireEvent.click(screen.getByText('report.button.cancel'));

    await waitFor(() => expect(screen.queryByText('report.title')).toBeNull());
  });
});

describe('search: чистые правила фильтрации и ранжирования', () => {
  const user = (overrides: Partial<SearchUser> = {}): SearchUser => ({
    id: 100,
    gender: 'male',
    lookingFor: 'female',
    age: 30,
    city: 'Москва',
    distance: 5,
    interests: [],
    ...overrides,
  });

  const filters = (overrides: Partial<AutoSearchFilters> = {}): AutoSearchFilters => ({
    ageRange: [18, 99],
    selectedCity: 'all',
    selectedCountry: '',
    distance: [100],
    selectedDatingGoal: 'all',
    selectedInterests: [],
    ...overrides,
  });

  const viewer = user({ id: 1, gender: 'female', lookingFor: 'male' });
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  it('совместимость стилей привязанности: без данных ноль, совместимая пара два', () => {
    expect(calculateAttachmentCompatibility(undefined, 'secure')).toBe(0);
    expect(calculateAttachmentCompatibility('secure', undefined)).toBe(0);
    expect(calculateAttachmentCompatibility('unknown' as AttachmentStyle, 'secure')).toBe(0);
    expect(calculateAttachmentCompatibility('secure', 'secure')).toBe(2);
    expect(calculateAttachmentCompatibility('secure', 'anxious')).toBe(2);
    expect(calculateAttachmentCompatibility('anxious', 'anxious')).toBe(1);
    expect(calculateAttachmentCompatibility('anxious', 'avoidant')).toBe(0);
  });

  it('сохранённые фильтры: мусор отбрасывается, город раскрывается в страну', () => {
    expect(fromSavedSearchFilters(null)).toBeNull();
    expect(fromSavedSearchFilters('')).toBeNull();
    expect(fromSavedSearchFilters('{oops')).toBeNull();
    expect(fromSavedSearchFilters('null')).toBeNull();
    expect(fromSavedSearchFilters(JSON.stringify({ selectedCity: 'all' }))).toBeNull();
    expect(fromSavedSearchFilters(JSON.stringify({ ageRange: [20] }))).toBeNull();

    expect(fromSavedSearchFilters(JSON.stringify({ ageRange: [20, 40], selectedCity: 'Acheng' }))).toEqual({
      ageRange: [20, 40],
      selectedCity: 'Acheng',
      selectedCountry: 'Китай',
      distance: [50],
      selectedDatingGoal: 'all',
      selectedInterests: [],
    });

    expect(fromSavedSearchFilters(JSON.stringify({
      ageRange: [20, 40],
      distance: [10],
      selectedCity: 'Москва',
      selectedInterests: ['interest.travel'],
    }))).toEqual({
      ageRange: [20, 40],
      selectedCity: 'Москва',
      selectedCountry: '',
      distance: [10],
      selectedDatingGoal: 'all',
      selectedInterests: ['interest.travel'],
    });

    expect(fromSavedSearchFilters(JSON.stringify({ ageRange: [20, 40], selectedCity: 'all' })))
      .toMatchObject({ selectedCity: 'all', selectedCountry: '', distance: [50] });
    expect(fromSavedSearchFilters(JSON.stringify({ ageRange: [20, 40] })))
      .toMatchObject({ selectedCity: 'all', selectedCountry: '' });
  });

  it('автопоиск отсекает себя, несовпадение пола, возраста и города', () => {
    const candidates = [
      user({ id: 1 }),
      user({ id: 2, gender: 'female' }),
      user({ id: 3, age: 17 }),
      user({ id: 4, city: 'Acheng' }),
      user({ id: 6, lookingFor: 'male' }),
      user({ id: 5 }),
    ];

    expect(performAutosearch(filters({ selectedCity: 'Москва' }), candidates, viewer).map((u) => u.id))
      .toEqual([5]);
  });

  it('автопоиск пропускает всех, когда оба ищут «всех»', () => {
    const openViewer = user({ id: 1, gender: 'female', lookingFor: 'all' });
    const openCandidate = user({ id: 7, lookingFor: 'all' });

    expect(performAutosearch(filters(), [openCandidate], openViewer).map((u) => u.id)).toEqual([7]);
  });

  it('автопоиск фильтрует по известной стране и игнорирует неизвестную', () => {
    const candidates = [user({ id: 10, city: 'Acheng' }), user({ id: 11, city: 'Москва' })];

    expect(performAutosearch(filters({ selectedCountry: 'Китай' }), candidates, viewer).map((u) => u.id))
      .toEqual([10]);
    expect(performAutosearch(filters({ selectedCountry: 'Атлантида' }), candidates, viewer).map((u) => u.id))
      .toEqual([10, 11]);
  });

  it('автопоиск отсекает кандидатов дальше выбранного радиуса и держит границу возраста', () => {
    const candidates = [user({ id: 12, distance: 4 }), user({ id: 14, distance: 10 }), user({ id: 13, distance: 40 })];

    expect(performAutosearch(filters({ distance: [10] }), candidates, viewer).map((u) => u.id))
      .toEqual([12, 14]);

    const ages = [user({ id: 15, age: 29 }), user({ id: 16, age: 30 }), user({ id: 17, age: 31 })];
    expect(performAutosearch(filters({ ageRange: [30, 30] }), ages, viewer).map((u) => u.id)).toEqual([16]);
  });

  it('интересы сужают выдачу, префикс interest. нормализуется с обеих сторон', () => {
    const candidates = [
      user({ id: 20, interests: ['interest.travel'] }),
      user({ id: 21, interests: ['interest.sport'] }),
      user({ id: 22, interests: [], goal: 'goal.dating' }),
      user({ id: 23, interests: [], goal: 'goal.serious_relationship' }),
    ];

    expect(performAutosearch(filters({ selectedInterests: ['travel'] }), candidates, viewer).map((u) => u.id))
      .toEqual([20]);
    expect(performAutosearch(filters({ selectedInterests: ['interest.travel'] }), [user({ id: 24, interests: ['travel'] })], viewer)
      .map((u) => u.id)).toEqual([24]);
    expect(performAutosearch(filters({ selectedDatingGoal: 'goal.dating' }), candidates, viewer).map((u) => u.id))
      .toEqual([22]);
    expect(performAutosearch(filters(), candidates, viewer).map((u) => u.id)).toEqual([20, 21, 22, 23]);
  });

  it('некорректные входные данные автопоиска дают пустую выдачу', () => {
    expect(performAutosearch(null as unknown as AutoSearchFilters, [], viewer)).toEqual([]);
    expect(performAutosearch(filters(), [], null as unknown as SearchUser)).toEqual([]);
  });

  it('ранжирование: активный буст выше, просроченный не считается', () => {
    const boosted = user({ id: 30, distance: 9, boost: { boostedUntil: future } });
    const expired = user({ id: 31, distance: 1, boost: { boostedUntil: '2000-01-01T00:00:00.000Z' } });
    const plain = user({ id: 32, distance: 2 });

    expect(performAutosearch(filters(), [plain, expired, boosted], viewer).map((u) => u.id))
      .toEqual([30, 31, 32]);
  });

  it('ранжирование: совпадение цели выше, чем совпадение по интересам', () => {
    const matchGoal = user({ id: 33, goal: 'goal.dating', distance: 9 });
    const viaInterest = user({ id: 34, interests: ['interest.travel'], distance: 1 });

    expect(performAutosearch(
      filters({ selectedDatingGoal: 'goal.dating', selectedInterests: ['travel'] }),
      [viaInterest, matchGoal],
      viewer,
    ).map((u) => u.id)).toEqual([33, 34]);
    expect(performAutosearch(
      filters({ selectedDatingGoal: 'goal.dating', selectedInterests: ['travel'] }),
      [matchGoal, viaInterest],
      viewer,
    ).map((u) => u.id)).toEqual([33, 34]);
  });

  it('ранжирование: совместимый стиль привязанности выше', () => {
    const anxiousViewer = user({ id: 1, gender: 'female', lookingFor: 'male', attachmentStyle: 'anxious' });
    const avoidant = user({ id: 35, attachmentStyle: 'avoidant', distance: 1 });
    const secure = user({ id: 36, attachmentStyle: 'secure', distance: 5 });

    expect(performAutosearch(filters(), [avoidant, secure], anxiousViewer).map((u) => u.id))
      .toEqual([36, 35]);
  });

  it('ранжирование: ближний выше, больше общих интересов выше, свой ритм выше', () => {
    expect(performAutosearch(filters(), [
      user({ id: 37, distance: 8 }),
      user({ id: 38, distance: 2 }),
    ], viewer).map((u) => u.id)).toEqual([38, 37]);

    expect(performAutosearch(filters({ selectedInterests: ['travel', 'sport'] }), [
      user({ id: 39, interests: ['interest.travel'] }),
      user({ id: 40, interests: ['interest.travel', 'interest.sport'] }),
    ], viewer).map((u) => u.id)).toEqual([40, 39]);

    expect(performAutosearch(filters(), [
      user({ id: 41, circadian: 'owl' }),
      user({ id: 42, circadian: 'lark' }),
      user({ id: 43 }),
    ], user({ id: 1, gender: 'female', lookingFor: 'male', circadian: 'lark' })).map((u) => u.id)).toEqual([42, 41, 43]);
  });
});
