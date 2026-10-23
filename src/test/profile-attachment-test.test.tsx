import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => {
  const router = { push: vi.fn(), back: vi.fn(), replace: vi.fn() };
  return {
    t: vi.fn((key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    ),
    toast: vi.fn(),
    router,
    supabase: null as unknown,
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
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => h.supabase,
}));

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => <div data-testid="app-header" />,
}));

vi.mock('framer-motion', () => {
  const animationProps = new Set(['whileHover', 'whileTap', 'initial', 'animate', 'exit', 'transition']);
  const domProps = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !animationProps.has(key)));
  return {
    motion: {
      div: (props: Record<string, unknown>) => (
        <div {...(domProps(props) as React.HTMLAttributes<HTMLDivElement>)}>{props.children as React.ReactNode}</div>
      ),
      button: (props: Record<string, unknown>) => (
        <button {...(domProps(props) as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
          {props.children as React.ReactNode}
        </button>
      ),
    },
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

import AttachmentStyleTestPage from '@/pages/profile-attachment-test';

const QUESTIONS = ['q1', 'q2', 'q3', 'q4'];

function answerQuestion(question: string, option: string) {
  fireEvent.click(screen.getByText(`attach.${question}.${option}`));
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

async function answerAll(option = 'a') {
  for (const question of QUESTIONS) {
    answerQuestion(question, option);
  }
  await act(async () => {
    await Promise.resolve();
  });
}

function optionButton(question: string, option: string) {
  return screen.getByText(`attach.${question}.${option}`).closest('button') as HTMLButtonElement;
}

function makeSupabase(options: { user?: { id: string } | null; fail?: boolean } = {}) {
  const eq = vi.fn(async () => {
    if (options.fail) throw new Error('db down');
    return { error: null };
  });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const getUser = vi.fn(async () => ({ data: { user: options.user ?? null } }));
  return { client: { auth: { getUser }, from }, from, update, eq, getUser };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  h.toast.mockReset();
  h.t.mockClear();
  h.router.push.mockReset();
  h.router.back.mockReset();
  h.supabase = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AttachmentStyleTestPage', () => {
  it('показывает первый вопрос, прогресс и три варианта ответа', () => {
    render(<AttachmentStyleTestPage />);

    expect(screen.getByTestId('app-header')).toBeInTheDocument();
    expect(screen.getByText('attach.test.title')).toBeInTheDocument();
    expect(screen.getByText('attach.test.subtitle')).toBeInTheDocument();
    expect(screen.getByText('attach.q1.text')).toBeInTheDocument();
    expect(screen.getByText('attach.q1.a')).toBeInTheDocument();
    expect(screen.getByText('attach.q1.b')).toBeInTheDocument();
    expect(screen.getByText('attach.q1.c')).toBeInTheDocument();
    expect(h.t).toHaveBeenCalledWith('attach.question_of', { current: 1, total: 4 });
    expect(screen.queryByText('attach.style.secure.label')).not.toBeInTheDocument();
  });

  it('выбор ответа подсвечивает вариант и через 300 мс открывает следующий вопрос', () => {
    render(<AttachmentStyleTestPage />);

    fireEvent.click(screen.getByText('attach.q1.a'));
    expect(optionButton('q1', 'a').className).toContain('bg-primary/5');
    expect(optionButton('q1', 'b').className).toContain('border-transparent');
    expect(screen.getByText('attach.q1.text')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText('attach.q2.text')).toBeInTheDocument();
    expect(h.t).toHaveBeenCalledWith('attach.question_of', { current: 2, total: 4 });
  });

  it('после четырёх ответов показывает результат и сохраняет стиль в localStorage', async () => {
    localStorage.setItem('userProfile', JSON.stringify({ name: 'Аня' }));
    render(<AttachmentStyleTestPage />);

    await answerAll('a');

    expect(screen.getByText('attach.style.secure.label')).toBeInTheDocument();
    expect(screen.getByText('attach.style.secure.desc')).toBeInTheDocument();
    expect(screen.getByText('✅')).toBeInTheDocument();
    expect(h.toast).toHaveBeenCalledWith({
      title: 'attach.toast.done',
      description: 'attach.toast.your_style attach.style.secure.label',
    });
    expect(JSON.parse(localStorage.getItem('userProfile') ?? '{}')).toMatchObject({
      name: 'Аня',
      attachmentStyle: 'secure',
    });
  });

  it('битый JSON профиля не мешает показать результат', async () => {
    localStorage.setItem('userProfile', '{не json');
    render(<AttachmentStyleTestPage />);

    await answerAll('b');

    expect(screen.getByText('attach.style.anxious.label')).toBeInTheDocument();
    expect(h.toast).toHaveBeenCalledWith({
      title: 'attach.toast.done',
      description: 'attach.toast.your_style attach.style.anxious.label',
    });
    expect(localStorage.getItem('userProfile')).toBe('{не json');
  });

  it('без профиля в localStorage результат всё равно показывается', async () => {
    render(<AttachmentStyleTestPage />);

    await answerAll('c');

    expect(screen.getByText('attach.style.avoidant.label')).toBeInTheDocument();
    expect(localStorage.getItem('userProfile')).toBeNull();
    expect(h.toast).toHaveBeenCalledWith({
      title: 'attach.toast.done',
      description: 'attach.toast.your_style attach.style.avoidant.label',
    });
  });

  it('supabase: сохраняет attachment_style в profiles и показывает тост «сохранено»', async () => {
    const supabase = makeSupabase({ user: { id: 'user-1' } });
    h.supabase = supabase.client;
    render(<AttachmentStyleTestPage />);

    await answerAll('a');

    expect(supabase.getUser).toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(supabase.update).toHaveBeenCalledWith({ attachment_style: 'secure' });
    expect(supabase.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(h.toast).toHaveBeenCalledWith({
      title: 'attach.toast.saved',
      description: 'attach.toast.your_style attach.style.secure.label',
    });
  });

  it('supabase без авторизованного пользователя не пишет в profiles', async () => {
    const supabase = makeSupabase({ user: null });
    h.supabase = supabase.client;
    render(<AttachmentStyleTestPage />);

    await answerAll('a');

    expect(supabase.getUser).toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith({
      title: 'attach.toast.saved',
      description: 'attach.toast.your_style attach.style.secure.label',
    });
  });

  it('ошибка supabase даёт destructive-тост и пишется в console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase({ user: { id: 'user-1' }, fail: true });
    h.supabase = supabase.client;
    render(<AttachmentStyleTestPage />);

    await answerAll('a');

    expect(errorSpy).toHaveBeenCalledWith(
      'Error saving attachment style:',
      expect.objectContaining({ message: 'db down' }),
    );
    expect(h.toast).toHaveBeenCalledWith({ title: 'attach.toast.save_error', variant: 'destructive' });
  });

  it('retake возвращает к первому вопросу и сбрасывает выбранный ответ', async () => {
    render(<AttachmentStyleTestPage />);

    await answerAll('a');
    fireEvent.click(screen.getByText('attach.retake'));

    expect(screen.getByText('attach.q1.text')).toBeInTheDocument();
    expect(h.t).toHaveBeenCalledWith('attach.question_of', { current: 1, total: 4 });
    expect(optionButton('q1', 'a').className).toContain('border-transparent');
  });

  it('кнопки ведут в профиль и назад', async () => {
    render(<AttachmentStyleTestPage />);

    fireEvent.click(screen.getByText('attach.back'));
    expect(h.router.back).toHaveBeenCalledTimes(1);

    await answerAll('a');
    fireEvent.click(screen.getByText('attach.to_profile'));
    expect(h.router.push).toHaveBeenCalledWith('/profile');
  });
});
