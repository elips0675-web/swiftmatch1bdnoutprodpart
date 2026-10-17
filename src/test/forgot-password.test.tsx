import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const toastSpy = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy, toasts: [] }),
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

import ForgotPasswordPage from '@/pages/forgot-password';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

describe('Страница forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('рисует форму и ссылку возврата на вход', () => {
    renderPage();

    expect(screen.getByText('auth.forgot_title')).toBeInTheDocument();
    expect(screen.getByText('auth.forgot_desc')).toBeInTheDocument();
    expect(screen.getByText('auth.email')).toBeInTheDocument();
    expect(screen.getByTestId('submit-forgot-password')).toHaveTextContent('auth.send_reset');
    expect(screen.getByRole('link', { name: 'auth.back_to_login' })).toHaveAttribute('href', '/login');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('отправка идёт на /api/auth/forgot-password с введённым email', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'Письмо отправлено' }));

    renderPage();
    fireEvent.change(screen.getByTestId('email'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('submit-forgot-password'));

    await waitFor(() => expect(screen.getByText('auth.forgot_sent')).toBeInTheDocument());

    expect(mockFetch).toHaveBeenCalledWith('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });
    expect(screen.getByText('auth.forgot_sent_desc')).toBeInTheDocument();
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Письмо отправлено' });
  });

  it('успешный ответ прячет форму', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'ok' }));

    renderPage();
    fireEvent.click(screen.getByTestId('submit-forgot-password'));

    await waitFor(() => expect(screen.getByText('auth.forgot_sent')).toBeInTheDocument());
    expect(screen.queryByTestId('submit-forgot-password')).toBeNull();
  });

  it('сетевой сбой показывает destructive-тост и оставляет форму', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

    renderPage();
    fireEvent.change(screen.getByTestId('email'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByTestId('submit-forgot-password'));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ variant: 'destructive', title: 'common.error' }));
    expect(screen.getByTestId('submit-forgot-password')).toBeInTheDocument();
    expect(screen.queryByText('auth.forgot_sent')).toBeNull();
  });

  it('на время запроса кнопка заблокирована', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    renderPage();
    fireEvent.click(screen.getByTestId('submit-forgot-password'));

    expect(screen.getByTestId('submit-forgot-password')).toBeDisabled();
  });
});
