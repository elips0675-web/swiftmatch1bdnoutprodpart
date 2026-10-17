import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const nav = vi.hoisted(() => ({ token: 'tok-1', push: vi.fn() }));

const toastSpy = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy, toasts: [] }),
}));

vi.mock('@/shims/next-navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.token ? `token=${nav.token}` : ''),
  useRouter: () => ({ push: nav.push, back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

import ResetPasswordPage from '@/pages/reset-password';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

function fillPasswords(password: string, confirm: string) {
  const inputs = document.querySelectorAll('input[type="password"]');
  fireEvent.change(inputs[0], { target: { value: password } });
  fireEvent.change(inputs[1], { target: { value: confirm } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'auth.reset_button' }));
}

describe('Страница reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    nav.token = 'tok-1';
  });

  it('без токена показывает неверную ссылку и не стучит в API', () => {
    nav.token = '';

    renderPage();

    expect(screen.getByText('auth.invalid_reset_link')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'auth.back_to_login' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('auth.reset_title')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('с токеном рисует форму нового пароля', () => {
    renderPage();

    expect(screen.getByText('auth.reset_title')).toBeInTheDocument();
    expect(screen.getByText('auth.new_password')).toBeInTheDocument();
    expect(screen.getByText('auth.confirm_password')).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('несовпадение паролей не уходит в API и даёт destructive-тост', () => {
    renderPage();
    fillPasswords('secret123', 'secret124');
    submit();

    expect(toastSpy).toHaveBeenCalledWith({ variant: 'destructive', title: 'auth.passwords_mismatch' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('короткий пароль не уходит в API и даёт destructive-тост', () => {
    renderPage();
    fillPasswords('123', '123');
    submit();

    expect(toastSpy).toHaveBeenCalledWith({ variant: 'destructive', title: 'auth.password_too_short' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('успешная смена пароля: POST с токеном и телом, экран успеха и возврат на вход', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ ok: true }));

    renderPage();
    fillPasswords('secret123', 'secret123');
    submit();

    await waitFor(() => expect(screen.getByText('auth.password_reset_success')).toBeInTheDocument());

    expect(mockFetch).toHaveBeenCalledWith('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'tok-1', password: 'secret123' }),
    });
    expect(toastSpy).toHaveBeenCalledWith({ title: 'auth.password_reset_done' });

    fireEvent.click(screen.getByRole('button', { name: 'auth.back_to_login' }));
    expect(nav.push).toHaveBeenCalledWith('/login');
  });

  it('отказ сервера с message показывает его текст и оставляет форму', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'Ссылка устарела' }, 400));

    renderPage();
    fillPasswords('secret123', 'secret123');
    submit();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ variant: 'destructive', title: 'Ссылка устарела' }));
    expect(screen.getByText('auth.reset_title')).toBeInTheDocument();
    expect(screen.queryByText('auth.password_reset_success')).toBeNull();
  });

  it('сетевой сбой даёт общий destructive-тост', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

    renderPage();
    fillPasswords('secret123', 'secret123');
    submit();

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ variant: 'destructive', title: 'common.error' }));
    expect(screen.queryByText('auth.password_reset_success')).toBeNull();
  });
});
