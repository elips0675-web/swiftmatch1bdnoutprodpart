import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const h = vi.hoisted(() => {
  const router = { push: vi.fn(), back: vi.fn(), replace: vi.fn() };
  const config = {
    interests: ['interest.music', 'interest.sport'],
    dating_goals: ['goal.serious_relationship', 'goal.friendship'],
    education: [] as string[],
    banned_words: [] as string[],
    cities: [] as string[],
  };
  return {
    t: (key: string) => key,
    toast: vi.fn(),
    router,
    config,
    supabase: null as unknown,
    generateBio: vi.fn(),
  };
});

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => h.router,
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: h.toast,
  useToast: () => ({ toast: h.toast, toasts: [] }),
}));

vi.mock('@/lib/useContentConfig', () => ({
  useContentConfig: () => h.config,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => h.supabase,
}));

vi.mock('@/shims/ai-flows', () => ({
  generateProfileBio: h.generateBio,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange?: (value: string) => void; children?: React.ReactNode }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value="" disabled>
      {placeholder}
    </option>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import OnboardingPage from '@/pages/onboarding';

const renderPage = () => render(<OnboardingPage />);

const advanceToStep = async (user: ReturnType<typeof userEvent.setup>, step: number) => {
  await user.click(screen.getByText('onboarding.step1.male'));
  for (let current = 1; current < step; current++) {
    await user.click(screen.getByText('button.continue'));
  }
};

describe('Страница onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.supabase = null;
    h.generateBio.mockResolvedValue({ bio: '' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window.navigator, 'geolocation');
  });

  it('первый шаг требует пол, после выбора ведёт ко второму шагу', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('onboarding.step1.title')).toBeInTheDocument();
    expect(screen.getByText('button.continue')).toBeDisabled();

    await user.click(screen.getByText('onboarding.step1.male'));

    expect(screen.getByText('button.continue')).toBeEnabled();

    await user.click(screen.getByText('button.continue'));

    expect(screen.getByText('onboarding.step2.title')).toBeInTheDocument();
    expect(screen.queryByText('onboarding.step1.title')).toBeNull();
  });

  it('кнопка «назад» выключена на первом шаге и возвращает на предыдущий', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    const bar = container.querySelector<HTMLElement>('.gradient-bg[style]');
    expect(bar?.style.width).toBe('20%');

    const back = container.querySelector('header button') as HTMLButtonElement;
    expect(back).toBeDisabled();

    await advanceToStep(user, 3);

    expect(bar?.style.width).toBe('60%');
    expect(back).toBeEnabled();

    await user.click(back);

    expect(screen.getByText('onboarding.step2.title')).toBeInTheDocument();
    expect(bar?.style.width).toBe('40%');
  });

  it('второй шаг без geolocation сообщает об ошибке определения города', async () => {
    const user = userEvent.setup();
    renderPage();

    await advanceToStep(user, 2);

    const city = screen.getByPlaceholderText('onboarding.step2.city_placeholder');
    await user.click(city.parentElement?.querySelector('button') as HTMLButtonElement);

    expect(h.toast).toHaveBeenCalledWith({ title: 'onboarding.loc.fail', variant: 'destructive' });
  });

  it('второй шаг подставляет найденный город в поле и подтверждает тостом', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 55.75, longitude: 37.61 } } as GeolocationPosition),
    );
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ address: { city: 'Химки' } }) });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderPage();

    await advanceToStep(user, 2);

    const city = screen.getByPlaceholderText('onboarding.step2.city_placeholder');
    await user.click(city.parentElement?.querySelector('button') as HTMLButtonElement);

    expect(getCurrentPosition).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/reverse?format=json'),
      expect.objectContaining({ headers: { 'User-Agent': 'SwiftMatch/1.0' } }),
    );
    await waitFor(() => expect(city).toHaveValue('Химки'));
    expect(h.toast).toHaveBeenCalledWith({ title: 'onboarding.loc.successХимки' });
  });

  it('второй шаг переключает выбранный режим сна', async () => {
    const user = userEvent.setup();
    renderPage();

    await advanceToStep(user, 2);

    const badge = screen.getByText('circadian.early_bird');
    expect(badge).not.toHaveClass('gradient-bg');

    await user.click(badge);

    expect(screen.getByText('circadian.early_bird')).toHaveClass('gradient-bg');
    expect(screen.getByText('circadian.night_owl')).not.toHaveClass('gradient-bg');
  });

  it('третий шаг показывает цели из конфига и позволяет выбрать их', async () => {
    const user = userEvent.setup();
    renderPage();

    await advanceToStep(user, 3);

    expect(screen.getByText('onboarding.step3.title')).toBeInTheDocument();

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'goal.serious_relationship' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'goal.friendship' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gender.men' })).toBeInTheDocument();

    fireEvent.change(selects[0], { target: { value: 'goal.friendship' } });
    fireEvent.change(selects[1], { target: { value: 'male' } });

    expect(selects[0].value).toBe('goal.friendship');
    expect(selects[1].value).toBe('male');
  });

  it('четвёртый шаг добавляет и убирает интерес по клику', async () => {
    const user = userEvent.setup();
    renderPage();

    await advanceToStep(user, 4);

    expect(screen.getByText('onboarding.step4.title')).toBeInTheDocument();

    const music = screen.getByText('interest.music');
    expect(music).not.toHaveClass('gradient-bg');

    await user.click(music);
    expect(screen.getByText('interest.music')).toHaveClass('gradient-bg');

    await user.click(screen.getByText('interest.music'));
    expect(screen.getByText('interest.music')).not.toHaveClass('gradient-bg');
  });

  it('AI-био без выбранных интересов не вызывает генератор и объясняет почему', async () => {
    const user = userEvent.setup();
    renderPage();

    await advanceToStep(user, 5);
    await user.click(screen.getByText('AI button.save'));

    expect(h.generateBio).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith({ title: 'onboarding.step4.desc' });
  });

  it('AI-био с интересами подставляет сгенерированный текст', async () => {
    h.generateBio.mockResolvedValue({ bio: 'Люблю музыку и спорт' });
    const user = userEvent.setup();
    renderPage();

    await advanceToStep(user, 4);
    await user.click(screen.getByText('interest.music'));
    await user.click(screen.getByText('button.continue'));
    await user.click(screen.getByText('AI button.save'));

    expect(h.generateBio).toHaveBeenCalledWith({ keywords: ['interest.music'] });
    await waitFor(() =>
      expect(screen.getByPlaceholderText('onboarding.step5.bio_placeholder')).toHaveValue('Люблю музыку и спорт'),
    );
    expect(h.toast).toHaveBeenCalledWith({ title: 'onboarding.toast.bio_ai' });
  });

  it('кнопка «домой» и «пропустить» без Supabase ведут на главную и на логин', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('button.go_home'));
    expect(h.router.push).toHaveBeenCalledWith('/');

    await user.click(screen.getByText('button.skip'));
    expect(h.router.push).toHaveBeenCalledWith('/login');
  });

  it('сохраняет профиль в Supabase с введёнными данными и уводит на главную', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    h.supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn(() => ({ upsert })),
    };

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('onboarding.step1.male'));
    await user.type(screen.getByPlaceholderText('onboarding.step1.placeholder'), 'Алиса');
    await user.click(screen.getByText('button.continue'));

    await user.type(screen.getByPlaceholderText('25'), '30');
    await user.type(screen.getByPlaceholderText('175'), '175');
    await user.type(screen.getByPlaceholderText('onboarding.step2.city_placeholder'), 'Москва');
    await user.click(screen.getByText('button.continue'));

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'goal.friendship' } });
    await user.click(screen.getByText('button.continue'));

    await user.click(screen.getByText('interest.music'));
    await user.click(screen.getByText('button.continue'));

    await user.type(screen.getByPlaceholderText('onboarding.step5.bio_placeholder'), 'Привет');
    await user.click(screen.getByText('button.start'));

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert).toHaveBeenCalledWith({
      id: 'u1',
      name: 'Алиса',
      age: 30,
      city: 'Москва',
      height: 175,
      goal: 'goal.friendship',
      zodiac: '',
      gender: 'male',
      looking_for: 'all',
      circadian: '',
      bio: 'Привет',
      avatar_url: '/demo/people/me.png',
    });
    expect(h.toast).toHaveBeenCalledWith({
      title: 'onboarding.toast.finish_title',
      description: 'onboarding.toast.finish_desc',
    });
    expect(h.router.push).toHaveBeenCalledWith('/');
  });

  it('ошибка сохранения профиля показывает ошибку и не уводит со страницы', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    h.supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn(() => ({ upsert })),
    };

    const user = userEvent.setup();
    renderPage();

    await advanceToStep(user, 5);
    await user.click(screen.getByText('button.start'));

    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'onboarding.save_error', variant: 'destructive' }));
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it('загруженное фото подставляется в превью как data-url', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    await advanceToStep(user, 5);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['photo-bytes'], 'avatar.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const preview = container.querySelector('img');
      expect(preview?.getAttribute('src')).toMatch(/^data:image\/png/);
    });
    expect(user).toBeDefined();
  });
});
