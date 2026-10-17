import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  const t = (key: string) => key;
  return { useLanguage: () => ({ t, language: 'RU', setLanguage: () => {} }) };
});

import AdminBackupPage from '@/pages/admin-backup';

const mockCreateObjectURL = vi.fn(() => 'blob:backup');
const mockRevokeObjectURL = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob(['dump'])),
  } as Response);
}

async function renderLoaded(calls = 1) {
  render(<AdminBackupPage />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(calls));
}

describe('Страница admin-backup', () => {
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

  it('пока грузится — спиннер, затем GET /api/admin/backup с Bearer и список с размером и метками', async () => {
    mockFetch.mockImplementation(() => jsonResponse([
      { name: 'backup-1.sql', size: 1572864, createdAt: '2026-10-01T10:00:00.000Z' },
      { name: 'files-1.zip', size: 524288, createdAt: '2026-10-02T10:00:00.000Z' },
    ]));

    const { container } = render(<AdminBackupPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('backup-1.sql');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/backup');
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
    expect(screen.getByText('1.50 MB')).toBeInTheDocument();
    expect(screen.getByText('0.50 MB')).toBeInTheDocument();
    expect(screen.getByText('admin.backup.db_label')).toBeInTheDocument();
    expect(screen.getByText('admin.backup.file_label')).toBeInTheDocument();
  });

  it('пустой список — заглушка без тоста', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]));
    render(<AdminBackupPage />);

    await screen.findByText('admin.backup.empty');
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('200 с объектом вместо массива — заглушка, а не падение на backups.map', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'unexpected shape' }));
    render(<AdminBackupPage />);

    await screen.findByText('admin.backup.empty');
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('отказ списка (500) — тост error_list и заглушка', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'нет доступа к папке' }, 500));
    render(<AdminBackupPage />);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.backup.error_list'));
    expect(screen.getByText('admin.backup.empty')).toBeInTheDocument();
  });

  it('сетевой сбой списка — тот же тост, исключение не выходит наружу', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
    render(<AdminBackupPage />);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.backup.error_list'));
  });

  it('обновление списка кнопкой refresh делает второй GET', async () => {
    mockFetch.mockImplementation(() => jsonResponse([{ name: 'backup-1.sql', size: 1024, createdAt: '2026-10-01T10:00:00.000Z' }]));
    render(<AdminBackupPage />);
    await screen.findByText('backup-1.sql');

    await userEvent.click(screen.getByTestId('refresh-backups'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls[1][0]).toBe('/api/admin/backup');
  });

  it('создание бэкапа: POST без тела, тост успеха и перечитывание списка', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ ok: true }, 201);
      return jsonResponse([{ name: 'backup-new.sql', size: 2048, createdAt: '2026-10-05T10:00:00.000Z' }]);
    });
    render(<AdminBackupPage />);
    await screen.findByText('backup-new.sql');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('create-backup'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.backup.create_success'));
    const post = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[0]).toBe('/api/admin/backup');
    expect(post?.[1].headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(post?.[1].body).toBeUndefined();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  });

  it('отказ создания: тост error_create, а message сервера не показывается', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ message: 'mysqldump не найден' }, 500) : jsonResponse([]),
    );
    render(<AdminBackupPage />);
    await screen.findByText('admin.backup.empty');

    await userEvent.click(screen.getByTestId('create-backup'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.backup.error_create'));
    expect(h.toastError).not.toHaveBeenCalledWith('mysqldump не найден');
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('создание архива файлов уходит на /api/admin/backup/files и перечитывает список', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ ok: true }, 201);
      return jsonResponse([]);
    });
    render(<AdminBackupPage />);
    await screen.findByText('admin.backup.empty');

    await userEvent.click(screen.getByTestId('create-backup-files'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.backup.create_success'));
    expect(mockFetch.mock.calls[1][0]).toBe('/api/admin/backup/files');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  });

  it('скачивание: GET по закодированному имени, blob в ссылку и отзыв URL', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/download')) return jsonResponse({}, 200);
      return jsonResponse([{ name: 'backup 1.sql', size: 1024, createdAt: '2026-10-01T10:00:00.000Z' }]);
    });
    render(<AdminBackupPage />);
    await screen.findByText('backup 1.sql');

    await userEvent.click(screen.getByTestId('download-backup 1.sql'));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(mockFetch.mock.calls[1][0]).toBe('/api/admin/backup/backup%201.sql/download');
    expect(mockFetch.mock.calls[1][1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:backup');
    clickSpy.mockRestore();
  });

  it('отказ скачивания — тост error_download и ни одной ссылки', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/download')) return jsonResponse({ message: 'файл удалён' }, 500);
      return jsonResponse([{ name: 'backup-1.sql', size: 1024, createdAt: '2026-10-01T10:00:00.000Z' }]);
    });
    render(<AdminBackupPage />);
    await screen.findByText('backup-1.sql');

    await userEvent.click(screen.getByTestId('download-backup-1.sql'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.backup.error_download'));
    expect(clickSpy).not.toHaveBeenCalled();
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('во время создания кнопка create выключена, после ответа — снова активна', async () => {
    let resolvePost: ((value: Response) => void) | undefined;
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      return jsonResponse([]);
    });
    render(<AdminBackupPage />);
    await screen.findByText('admin.backup.empty');

    await userEvent.click(screen.getByTestId('create-backup'));

    expect(screen.getByTestId('create-backup')).toBeDisabled();
    expect(screen.getByText('admin.backup.creating')).toBeInTheDocument();

    resolvePost?.({ ok: true, status: 201, json: () => Promise.resolve({ ok: true }) } as Response);
    await waitFor(() => expect(screen.getByTestId('create-backup')).not.toBeDisabled());
  });
});
