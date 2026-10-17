import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const h = vi.hoisted(() => ({
  token: 'test-token' as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/token', () => ({ getToken: () => h.token }));

vi.mock('sonner', () => ({
  toast: {
    success: (message?: string) => h.toastSuccess(message),
    error: (message?: string) => h.toastError(message),
  },
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange?: (value: string) => void; children?: React.ReactNode }) => (
    <select data-testid="partner-type" value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <option value="" disabled>{placeholder}</option>,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import PartnerRegister from '@/pages/partner-register';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/partner/register']}>
      <Routes>
        <Route path="/partner/register" element={<PartnerRegister />} />
        <Route path="/partner/dashboard" element={<div>DASHBOARD</div>} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillName(value: string) {
  fireEvent.change(screen.getByTestId('partner-name'), { target: { value } });
}

function fillForm() {
  fillName('ООО «Ромашка»');
  fireEvent.change(screen.getByTestId('partner-description'), { target: { value: 'Цветы и подарки' } });
  fireEvent.change(screen.getByTestId('partner-email'), { target: { value: 'info@romashka.ru' } });
  fireEvent.change(screen.getByTestId('partner-phone'), { target: { value: '+7 900 123-45-67' } });
}

describe('Страница partner-register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
  });

  it('рисует заголовок, описание и все поля формы; пустое имя держит кнопку выключенной', () => {
    renderPage();

    expect(screen.getByText('partner.register_title')).toBeInTheDocument();
    expect(screen.getByText('partner.register_desc')).toBeInTheDocument();
    expect(screen.getByTestId('partner-name')).toBeInTheDocument();
    expect(screen.getByTestId('partner-type')).toBeInTheDocument();
    expect(screen.getByTestId('partner-description')).toBeInTheDocument();
    expect(screen.getByTestId('partner-email')).toBeInTheDocument();
    expect(screen.getByTestId('partner-phone')).toBeInTheDocument();
    expect(screen.getByTestId('submit-partner-register')).toBeDisabled();
  });

  it('граница имени: один символ — кнопка выключена, два — включена', () => {
    renderPage();

    fillName('A');
    expect(screen.getByTestId('submit-partner-register')).toBeDisabled();

    fillName('AB');
    expect(screen.getByTestId('submit-partner-register')).toBeEnabled();

    fillName('  A  ');
    expect(screen.getByTestId('submit-partner-register')).toBeDisabled();
  });

  it('успех: POST с обрезанным именем и полями формы, тост и переход на дашборд', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ partner: { id: 1 } }));
    renderPage();

    fillForm();
    fireEvent.click(screen.getByTestId('submit-partner-register'));

    await waitFor(() => expect(screen.getByText('DASHBOARD')).toBeInTheDocument());

    expect(mockFetch).toHaveBeenCalledWith('/api/partner/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({
        name: 'ООО «Ромашка»',
        type: 'deeplink',
        description: 'Цветы и подарки',
        contact_email: 'info@romashka.ru',
        contact_phone: '+7 900 123-45-67',
      }),
    });
    expect(h.toastSuccess).toHaveBeenCalledWith('partner.register_success');
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('без токена запрос уходит без заголовка Authorization', async () => {
    h.token = null;
    mockFetch.mockImplementation(() => jsonResponse({ ok: true }));
    renderPage();

    fillName('Ромашка');
    fireEvent.click(screen.getByTestId('submit-partner-register'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(mockFetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('смена типа партнёра уходит в тело запроса', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ ok: true }));
    renderPage();

    fillName('Ромашка');
    fireEvent.change(screen.getByTestId('partner-type'), { target: { value: 'api' } });
    fireEvent.click(screen.getByTestId('submit-partner-register'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.type).toBe('api');
  });

  it('на время запроса кнопка заблокирована', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    mockFetch.mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    renderPage();

    fillName('Ромашка');
    fireEvent.click(screen.getByTestId('submit-partner-register'));

    expect(screen.getByTestId('submit-partner-register')).toBeDisabled();

    resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
    await waitFor(() => expect(screen.getByText('DASHBOARD')).toBeInTheDocument());
  });

  it('отказ с message показывает именно message и не уводит с формы', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'Партнёр уже зарегистрирован' }, 409));
    renderPage();

    fillName('Ромашка');
    fireEvent.click(screen.getByTestId('submit-partner-register'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Партнёр уже зарегистрирован'));

    expect(screen.queryByText('DASHBOARD')).toBeNull();
    expect(screen.getByTestId('submit-partner-register')).toBeEnabled();
  });

  it('отказ без message даёт общий ключ ошибки', async () => {
    mockFetch.mockImplementation(() => jsonResponse({}, 500));
    renderPage();

    fillName('Ромашка');
    fireEvent.click(screen.getByTestId('submit-partner-register'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('partner.register_error'));

    expect(screen.queryByText('DASHBOARD')).toBeNull();
  });

  it('сетевой сбой даёт общий ключ ошибки и не уводит с формы', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('boom')));
    renderPage();

    fillName('Ромашка');
    fireEvent.click(screen.getByTestId('submit-partner-register'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('partner.register_error'));

    expect(screen.queryByText('DASHBOARD')).toBeNull();
    expect(screen.getByTestId('submit-partner-register')).toBeEnabled();
  });

  it('кнопка «назад» уводит на главную без запроса', () => {
    renderPage();

    fireEvent.click(screen.getByText('partner.register_back'));

    expect(screen.getByText('HOME')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
