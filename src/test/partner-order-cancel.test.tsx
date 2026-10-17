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

import PartnerOrderCancel from '@/pages/partner-order-cancel';

function renderPage() {
  return render(<PartnerOrderCancel />);
}

describe('Страница partner-order-cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('рисует партнёрские заголовок и описание, кнопка берёт общий ключ возврата', () => {
    renderPage();

    expect(screen.getByText('partner.order.cancel_title')).toBeInTheDocument();
    expect(screen.getByText('partner.order.cancel_desc')).toBeInTheDocument();
    expect(screen.getByTestId('back-home-button')).toHaveTextContent('premium.back_home');
  });

  it('кнопка возврата уводит на главную, history не трогает', () => {
    renderPage();

    fireEvent.click(screen.getByTestId('back-home-button'));

    expect(h.router.push).toHaveBeenCalledWith('/');
    expect(h.router.back).not.toHaveBeenCalled();
  });

  it('страница статична: ни одного запроса ни при монтировании, ни по клику', () => {
    renderPage();

    expect(mockFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('back-home-button'));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
