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
  const t = (key: string) => key;
  return { useLanguage: () => ({ t, language: 'RU', setLanguage: () => {} }) };
});

import AdminExperimentsPage from '@/pages/admin-experiments';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const experiments = [
  {
    id: 1,
    name: 'Онбординг v2',
    experiment_key: 'onboarding_v2',
    description: 'Проверяем новые шаги',
    enabled: 1,
    created_at: '2026-10-01T10:00:00.000Z',
    variant_a_count: 75,
    variant_b_count: 25,
  },
  {
    id: 2,
    name: 'Кнопка лайка',
    experiment_key: 'like_button',
    description: null,
    enabled: 0,
    created_at: '2026-10-02T10:00:00.000Z',
    variant_a_count: 0,
    variant_b_count: 0,
  },
];

async function renderLoaded() {
  render(<AdminExperimentsPage />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
}

describe('Страница admin-experiments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
  });

  it('пока грузится — спиннер, затем GET с Bearer и карточки с долями вариантов', async () => {
    mockFetch.mockImplementation(() => jsonResponse(experiments));

    const { container } = render(<AdminExperimentsPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('Онбординг v2');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/admin/experiments');
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
    expect(screen.getByText('onboarding_v2')).toBeInTheDocument();
    expect(screen.getByText('Проверяем новые шаги')).toBeInTheDocument();
    expect(screen.getByText('A: 75 · B: 25 · 25% B')).toBeInTheDocument();
    expect(screen.getByText('A: 0 · B: 0 · 0% B')).toBeInTheDocument();
    expect(screen.getByText('admin.experiments.active')).toBeInTheDocument();
    expect(screen.getByText('admin.experiments.paused')).toBeInTheDocument();
  });

  it('пустой список — заглушка без тоста', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]));
    render(<AdminExperimentsPage />);

    await screen.findByText('admin.experiments.empty');
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('200 с объектом вместо массива — заглушка, а не падение на experiments.map', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'unexpected shape' }));
    render(<AdminExperimentsPage />);

    await screen.findByText('admin.experiments.empty');
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('отказ списка (500) — тост load_error и заглушка', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'нет доступа' }, 500));
    render(<AdminExperimentsPage />);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.experiments.load_error'));
    expect(screen.getByText('admin.experiments.empty')).toBeInTheDocument();
  });

  it('сетевой сбой списка — тот же тост, исключение не выходит наружу', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
    render(<AdminExperimentsPage />);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.experiments.load_error'));
    expect(screen.getByText('admin.experiments.empty')).toBeInTheDocument();
  });

  it('выключение включённого эксперимента — PUT с телом и переключение метки на «пауза»', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? jsonResponse({}, 200) : jsonResponse(experiments));
    render(<AdminExperimentsPage />);
    await screen.findByText('Онбординг v2');

    const firstSwitch = screen.getAllByRole('switch')[0];
    expect(firstSwitch).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(firstSwitch);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.experiments.disabled'));
    const put = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(put?.[0]).toBe('/api/admin/experiments/1');
    expect(put?.[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' });
    expect(JSON.parse(String(put?.[1].body))).toEqual({ enabled: false });
    await waitFor(() => expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked', 'false'));
    expect(screen.queryByText('admin.experiments.active')).toBeNull();
    expect(screen.getAllByText('admin.experiments.paused')).toHaveLength(2);
  });

  it('включение выключенного эксперимента — тост enabled', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? jsonResponse({}, 200) : jsonResponse(experiments));
    render(<AdminExperimentsPage />);
    await screen.findByText('Кнопка лайка');

    await userEvent.click(screen.getAllByRole('switch')[1]);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.experiments.enabled'));
    const put = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(JSON.parse(String(put?.[1].body))).toEqual({ enabled: true });
  });

  it('отказ переключения (500) — тост ошибки, состояние остаётся прежним', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? jsonResponse({ message: 'boom' }, 500) : jsonResponse(experiments));
    render(<AdminExperimentsPage />);
    await screen.findByText('Онбординг v2');

    const firstSwitch = screen.getAllByRole('switch')[0];
    await userEvent.click(firstSwitch);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getAllByRole('switch')[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('admin.experiments.active')).toBeInTheDocument();
  });

  it('удаление — DELETE с Bearer, тост и исчезновение карточки', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? jsonResponse({}, 200) : jsonResponse(experiments));
    render(<AdminExperimentsPage />);
    await screen.findByText('Онбординг v2');

    await userEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.experiments.deleted'));
    const del = mockFetch.mock.calls.find((call) => call[1]?.method === 'DELETE');
    expect(del?.[0]).toBe('/api/admin/experiments/1');
    expect(del?.[1].headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(screen.queryByText('Онбординг v2')).toBeNull();
    expect(screen.getByText('Кнопка лайка')).toBeInTheDocument();
  });

  it('отказ удаления (500) — тост ошибки, карточка остаётся', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? jsonResponse({ message: 'boom' }, 500) : jsonResponse(experiments));
    render(<AdminExperimentsPage />);
    await screen.findByText('Онбординг v2');

    await userEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'));
    expect(screen.getByText('Онбординг v2')).toBeInTheDocument();
  });

  it('кнопка создания заблокирована, пока не заполнены имя и ключ', async () => {
    mockFetch.mockImplementation(() => jsonResponse([]));
    render(<AdminExperimentsPage />);
    await screen.findByText('admin.experiments.empty');

    const createButton = screen.getByRole('button', { name: 'admin.experiments.create_btn' });
    expect(createButton).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('admin.experiments.name_ph'), 'Новый тест');
    expect(createButton).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('admin.experiments.key_ph'), 'new_test');
    expect(createButton).not.toBeDisabled();
  });

  it('создание — POST с телом, тост, перезагрузка списка и очистка полей', async () => {
    const created = {
      id: 3,
      name: 'Новый тест',
      experiment_key: 'new_test',
      description: 'Описание',
      enabled: 0,
      created_at: '2026-10-03T10:00:00.000Z',
      variant_a_count: 0,
      variant_b_count: 0,
    };
    let posted = false;
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted = true;
        return jsonResponse(created, 201);
      }
      return jsonResponse(posted ? [...experiments, created] : experiments);
    });
    render(<AdminExperimentsPage />);
    await screen.findByText('Онбординг v2');

    await userEvent.type(screen.getByPlaceholderText('admin.experiments.name_ph'), 'Новый тест');
    await userEvent.type(screen.getByPlaceholderText('admin.experiments.key_ph'), 'new_test');
    await userEvent.type(screen.getByPlaceholderText('admin.experiments.desc_ph'), 'Описание');
    await userEvent.click(screen.getByRole('button', { name: 'admin.experiments.create_btn' }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.experiments.created'));
    const post = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[0]).toBe('/api/admin/experiments');
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      name: 'Новый тест',
      experiment_key: 'new_test',
      description: 'Описание',
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    expect(screen.getByText('Новый тест')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('admin.experiments.name_ph')).toHaveValue('');
    expect(screen.getByPlaceholderText('admin.experiments.key_ph')).toHaveValue('');
  });

  it('отказ создания (500) — тост ошибки, поля не очищаются', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ message: 'boom' }, 500) : jsonResponse([]));
    render(<AdminExperimentsPage />);
    await screen.findByText('admin.experiments.empty');

    await userEvent.type(screen.getByPlaceholderText('admin.experiments.name_ph'), 'Тест');
    await userEvent.type(screen.getByPlaceholderText('admin.experiments.key_ph'), 'test_key');
    await userEvent.click(screen.getByRole('button', { name: 'admin.experiments.create_btn' }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'));
    expect(screen.getByPlaceholderText('admin.experiments.name_ph')).toHaveValue('Тест');
    expect(screen.getByRole('button', { name: 'admin.experiments.create_btn' })).not.toBeDisabled();
  });

  it('без токена запрос уходит без Authorization', async () => {
    h.token = null;
    mockFetch.mockImplementation(() => jsonResponse([]));
    render(<AdminExperimentsPage />);

    await screen.findByText('admin.experiments.empty');
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: {} });
  });
});
