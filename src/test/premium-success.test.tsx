import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const h = vi.hoisted(() => ({
  router: { push: vi.fn(), back: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams('session_id=cs_test_123'),
}));

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => h.router,
  useSearchParams: () => h.params,
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

import PremiumSuccess from '@/pages/premium-success';

function renderPage() {
  return render(<PremiumSuccess />);
}

describe('Страница premium-success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('рисует заголовок, описание и кнопку возврата из ключей', () => {
    renderPage();

    expect(screen.getByText('premium.success_title')).toBeInTheDocument();
    expect(screen.getByText('premium.success_desc')).toBeInTheDocument();
    expect(screen.getByTestId('back-home-button')).toHaveTextContent('premium.back_home');
  });

  it('кнопка возврата уводит на главную, history не трогает', () => {
    renderPage();

    fireEvent.click(screen.getByTestId('back-home-button'));

    expect(h.router.push).toHaveBeenCalledWith('/');
    expect(h.router.back).not.toHaveBeenCalled();
    expect(h.router.replace).not.toHaveBeenCalled();
  });

  it('страница статична: ни одного запроса ни при монтировании, ни по клику', () => {
    renderPage();

    expect(mockFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('back-home-button'));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
