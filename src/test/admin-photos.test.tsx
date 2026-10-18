import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
  const t = (key: string, options?: Record<string, unknown>) =>
    options && 'count' in options ? `${key}:${String(options.count)}` : key;
  return { useLanguage: () => ({ t, language: 'RU', setLanguage: () => {} }) };
});

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange?: (value: string) => void; children?: React.ReactNode }) => (
    <select data-testid="reject-reason" value={value} onChange={(event) => onValueChange?.(event.target.value)}>
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

import AdminPhotosPage from '@/pages/admin-photos';

const photo = {
  id: 7,
  url: 'https://cdn.example/photo-7.jpg',
  user_id: 42,
  created_at: '2026-10-01T10:00:00.000Z',
  display_name: 'Аня',
  avatar_url: '',
  moderation_status: 'pending',
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

async function renderLoaded(count = 1) {
  const view = render(<AdminPhotosPage />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(count));
  return view;
}

describe('Страница admin-photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
  });

  it('пока грузится — спиннер, затем GET /api/admin/photos с Bearer, счётчик и карточка фото', async () => {
    mockFetch.mockImplementation(() => jsonResponse([photo]));

    const { container } = render(<AdminPhotosPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('Аня');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/photos');
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
    expect(screen.getByText('admin.photos.count:1')).toBeInTheDocument();
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('по умолчанию фильтр «все»: модерация доступна и в нём, фильтр «на модерации» уходит на свой эндпоинт', async () => {
    mockFetch.mockImplementation((url: string) =>
      jsonResponse([{ ...photo, moderation_status: url.endsWith('/pending') ? 'pending' : 'approved' }]),
    );
    await renderLoaded();

    expect(screen.getByText('admin.photos.approve')).toBeInTheDocument();
    expect(screen.getByText('admin.photos.reject')).toBeInTheDocument();

    await userEvent.click(screen.getByText('admin.photos.pending'));

    await waitFor(() => expect(mockFetch.mock.calls[1][0]).toBe('/api/admin/photos/pending'));
    expect(screen.getByText('admin.photos.approve')).toBeInTheDocument();
    expect(screen.getByText('admin.photos.reject')).toBeInTheDocument();
  });

  it('200 с объектом вместо массива — заглушка, а не падение на photos.map', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'unexpected shape' }));
    await renderLoaded();

    expect(screen.getByText('admin.photos.empty')).toBeInTheDocument();
    expect(screen.getByText('admin.photos.count:0')).toBeInTheDocument();
  });

  it('отказ списка (500) — заглушка «нет фото», без тоста', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'boom' }, 500));
    await renderLoaded();

    expect(screen.getByText('admin.photos.empty')).toBeInTheDocument();
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('сетевой сбой списка — заглушка, исключение не пробивается наружу', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
    await renderLoaded();

    expect(screen.getByText('admin.photos.empty')).toBeInTheDocument();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('одобрение: POST без тела, тост и исчезновение фото из списка', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ ok: true }) : jsonResponse([photo]),
    );
    await renderLoaded();
    await userEvent.click(screen.getByText('admin.photos.pending'));
    await screen.findByText('Аня');

    await userEvent.click(screen.getByText('admin.photos.approve'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.photos.approved'));
    const approve = mockFetch.mock.calls.find((call) => String(call[0]).endsWith('/approve'));
    expect(approve?.[0]).toBe('/api/admin/photos/7/approve');
    expect(approve?.[1].method).toBe('POST');
    expect(approve?.[1].body).toBeUndefined();
    expect(approve?.[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' });
    await waitFor(() => expect(screen.queryByText('Аня')).toBeNull());
  });

  it('отклонение: POST с причиной и тост rejected', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ ok: true }) : jsonResponse([photo]),
    );
    await renderLoaded();
    await userEvent.click(screen.getByText('admin.photos.pending'));
    await screen.findByText('Аня');

    await userEvent.click(screen.getByText('admin.photos.reject'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.photos.rejected'));
    const reject = mockFetch.mock.calls.find((call) => String(call[0]).endsWith('/reject'));
    expect(reject?.[0]).toBe('/api/admin/photos/7/reject');
    expect(reject?.[1].method).toBe('POST');
    expect(JSON.parse(String(reject?.[1].body))).toEqual({ reason: 'admin.photos.reason.inappropriate' });
  });

  it('отклонение: причина выбирается модератором и уходит на сервер', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ ok: true }) : jsonResponse([photo]),
    );
    await renderLoaded();
    await userEvent.click(screen.getByText('admin.photos.pending'));
    await screen.findByText('Аня');

    await userEvent.selectOptions(screen.getByTestId('reject-reason'), 'admin.photos.reason.spam');
    await userEvent.click(screen.getByText('admin.photos.reject'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.photos.rejected'));
    const reject = mockFetch.mock.calls.find((call) => String(call[0]).endsWith('/reject'));
    expect(JSON.parse(String(reject?.[1].body))).toEqual({ reason: 'admin.photos.reason.spam' });
  });

  it('отказ модерации (500): фото остаётся, показывается тост ошибки', async () => {
    mockFetch.mockImplementation((url: string) =>
      url === '/api/admin/photos/pending' ? jsonResponse([photo]) : jsonResponse({ message: 'boom' }, 500),
    );
    await renderLoaded();
    await userEvent.click(screen.getByText('admin.photos.pending'));
    await screen.findByText('Аня');

    await userEvent.click(screen.getByText('admin.photos.approve'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.photos.error'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Аня')).toBeInTheDocument();
  });

  it('пока идёт запрос, кнопки выключены, а фото не исчезает до ответа', async () => {
    let resolveAction: ((value: Response) => void) | undefined;
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveAction = resolve;
        });
      }
      return jsonResponse([photo]);
    });
    await renderLoaded();
    await userEvent.click(screen.getByText('admin.photos.pending'));
    await screen.findByText('Аня');

    await userEvent.click(screen.getByText('admin.photos.approve'));

    const approveButton = screen.getByText('admin.photos.approve').closest('button');
    expect(approveButton).toBeDisabled();
    expect(screen.getByText('Аня')).toBeInTheDocument();

    resolveAction?.({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response);
    await waitFor(() => expect(screen.queryByText('Аня')).toBeNull());
  });
});
