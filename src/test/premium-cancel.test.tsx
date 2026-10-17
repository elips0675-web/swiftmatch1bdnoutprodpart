import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const h = vi.hoisted(() => ({
  router: { push: vi.fn(), back: vi.fn(), replace: vi.fn() },
}));

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => h.router,
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

import PremiumCancel from '@/pages/premium-cancel';

function renderPage() {
  return render(<PremiumCancel />);
}

describe('Страница premium-cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('рисует заголовок, описание и обе кнопки из ключей', () => {
    renderPage();

    expect(screen.getByText('premium.cancel_title')).toBeInTheDocument();
    expect(screen.getByText('premium.cancel_desc')).toBeInTheDocument();
    expect(screen.getByText('premium.back_home')).toBeInTheDocument();
    expect(screen.getByText('premium.try_again')).toBeInTheDocument();
  });

  it('«вернуться на главную» уводит на /', () => {
    renderPage();

    fireEvent.click(screen.getByText('premium.back_home'));

    expect(h.router.push).toHaveBeenCalledWith('/');
    expect(h.router.back).not.toHaveBeenCalled();
  });

  it('«попробовать снова» возвращает назад по истории', () => {
    renderPage();

    fireEvent.click(screen.getByText('premium.try_again'));

    expect(h.router.back).toHaveBeenCalledTimes(1);
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it('страница статична: запросов не делает', () => {
    renderPage();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
