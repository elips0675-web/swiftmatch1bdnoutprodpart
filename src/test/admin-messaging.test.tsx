import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  token: 'test-token' as string | null,
}));

vi.mock('sonner', () => ({
  toast: {
    success: (message?: string) => h.toastSuccess(message),
    error: (message?: string) => h.toastError(message),
  },
}));

vi.mock('@/lib/token', () => ({ getToken: () => h.token }));

vi.mock('@/context/language-context', () => {
  const t = (key: string) => key;
  return { useLanguage: () => ({ t, language: 'RU', setLanguage: () => {} }) };
});

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children?: React.ReactNode }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import AdminMessagingPage from '@/pages/admin-messaging';

const mockCreateObjectURL = vi.fn(() => 'blob:csv');
const mockRevokeObjectURL = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const campaigns = [
  {
    id: 1,
    title: 'Летняя акция',
    body: 'Скидки на подписку',
    target: 'premium',
    channel: 'push',
    status: 'sent',
    sentAt: '2026-10-01T10:00:00.000Z',
    delivered: 42,
    opened: 7,
    clicked: 3,
  },
  {
    id: 2,
    title: 'Черновик письма',
    body: 'Ещё не отправлено',
    target: 'new',
    channel: 'email',
    status: 'draft',
    sentAt: '2026-10-02T10:00:00.000Z',
    delivered: null,
    opened: null,
    clicked: null,
  },
];

describe('Страница admin-messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
    vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });
    mockCreateObjectURL.mockClear();
    mockRevokeObjectURL.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('пока грузится — спиннер, затем GET с Bearer и история рассылок', async () => {
    mockFetch.mockImplementation(() => jsonResponse(campaigns));

    const { container } = render(<AdminMessagingPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('Летняя акция');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/campaigns');
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
    expect(screen.getByText('push')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('premium')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
    expect(screen.getByText('sent')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('пустой список — только шапка таблицы', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]));
    render(<AdminMessagingPage />);

    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(1));
  });

  it('200 с объектом вместо массива — шапка без падения на campaigns.map', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'unexpected shape' }));
    render(<AdminMessagingPage />);

    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(1));
  });

  it('сетевой сбой списка — пустая история без тоста', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
    render(<AdminMessagingPage />);

    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(1));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('кнопка отправки заблокирована, пока не заполнены тема и текст', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]));
    render(<AdminMessagingPage />);
    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(1));

    const send = screen.getByTestId('send-campaign');
    expect(send).toBeDisabled();

    await userEvent.type(screen.getByTestId('messaging-title'), 'Тема');
    expect(send).toBeDisabled();

    await userEvent.type(screen.getByTestId('messaging-body'), 'Текст');
    expect(send).not.toBeDisabled();
  });

  it('отправка — POST с телом, тост, очистка полей и перезагрузка истории', async () => {
    const sent = { ...campaigns[0], id: 5, title: 'Новая рассылка' };
    let posted = false;
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted = true;
        return jsonResponse({}, 201);
      }
      return jsonResponse(posted ? [sent, ...campaigns] : campaigns);
    });
    render(<AdminMessagingPage />);
    await screen.findByText('Летняя акция');

    await userEvent.type(screen.getByTestId('messaging-title'), 'Новая рассылка');
    await userEvent.type(screen.getByTestId('messaging-body'), 'Текст письма');
    await userEvent.click(screen.getByTestId('send-campaign'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.messaging.sent'));
    const post = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[0]).toBe('/api/admin/campaigns');
    expect(post?.[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' });
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      title: 'Новая рассылка',
      body: 'Текст письма',
      target: 'all',
      channel: 'push',
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('messaging-title')).toHaveValue('');
    expect(screen.getByTestId('messaging-body')).toHaveValue('');
    expect(screen.getByText('Новая рассылка')).toBeInTheDocument();
  });

  it('отказ отправки (500) — тост ошибки, поля не очищаются', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ message: 'smtp down' }, 500) : jsonResponse(campaigns));
    render(<AdminMessagingPage />);
    await screen.findByText('Летняя акция');

    await userEvent.type(screen.getByTestId('messaging-title'), 'Тема');
    await userEvent.type(screen.getByTestId('messaging-body'), 'Текст');
    await userEvent.click(screen.getByTestId('send-campaign'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('messaging-title')).toHaveValue('Тема');
    expect(screen.getByTestId('send-campaign')).not.toBeDisabled();
  });

  it('смена канала и аудитории уезжает в тело POST', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({}, 201) : jsonResponse(campaigns));
    render(<AdminMessagingPage />);
    await screen.findByText('Летняя акция');

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'email' } });
    fireEvent.change(selects[1], { target: { value: 'premium' } });
    await userEvent.type(screen.getByTestId('messaging-title'), 'Тема');
    await userEvent.type(screen.getByTestId('messaging-body'), 'Текст');
    await userEvent.click(screen.getByTestId('send-campaign'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.messaging.sent'));
    const post = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      title: 'Тема',
      body: 'Текст',
      target: 'premium',
      channel: 'email',
    });
  });

  it('экспорт CSV — blob, скачивание и отзыв ссылки', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockFetch.mockImplementation(() => jsonResponse(campaigns));
    render(<AdminMessagingPage />);
    await screen.findByText('Летняя акция');

    await userEvent.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalledTimes(1));
    const blob = mockCreateObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8;');
    expect(clickSpy).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:csv');
    clickSpy.mockRestore();
  });

  it('экспорт при пустой истории ничего не скачивает', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockFetch.mockImplementation(() => jsonResponse([]));
    render(<AdminMessagingPage />);
    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'CSV' }));

    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('без токена запрос уходит без Authorization', async () => {
    h.token = null;
    mockFetch.mockImplementation(() => jsonResponse([]));
    render(<AdminMessagingPage />);

    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(1));
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: {} });
  });
});
