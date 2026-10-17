import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
  clearToken: vi.fn(),
  invalidate: vi.fn(),
  exportToCsv: vi.fn(),
  confirm: vi.fn(() => true),
  token: 'test-token' as string | null,
  config: {
    interests: [] as string[],
    dating_goals: [] as string[],
    education: [] as string[],
    banned_words: [] as string[],
    cities: [] as string[],
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (message?: string) => h.toastSuccess(message),
    error: (message?: string) => h.toastError(message),
  },
}));

vi.mock('@/lib/token', () => ({
  getToken: () => h.token,
  clearToken: () => h.clearToken(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => h.navigate }));

vi.mock('@/context/language-context', () => {
  const t = (key: string) => key;
  return { useLanguage: () => ({ t, language: 'RU', setLanguage: () => {} }) };
});

vi.mock('@/lib/useContentConfig', () => ({
  useContentConfig: () => h.config,
  invalidateContentCache: () => h.invalidate(),
}));

vi.mock('@/lib/admin-mock-data', () => ({
  exportToCsv: (...args: unknown[]) => h.exportToCsv(...args),
}));

import ContentManagementPage from '@/pages/admin-content';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const COUNTRIES_KEY = 'swiftmatch_countries_cities';

function mockSave(status = 200) {
  mockFetch.mockImplementation(() => jsonResponse({}, status));
}

function putCall() {
  return mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
}

function putBody() {
  return JSON.parse(String(putCall()?.[1].body));
}

async function renderWith(config: Partial<typeof h.config> = {}) {
  h.config = {
    interests: ['interest.sport', 'tech'],
    dating_goals: ['serious'],
    education: ['higher'],
    banned_words: ['спам'],
    cities: ['Москва', 'Казань'],
    ...config,
  };
  mockSave();
  render(<ContentManagementPage />);
  await screen.findByText('admin.content.title');
}

describe('Страница admin-content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
    h.confirm.mockReturnValue(true);
    vi.stubGlobal('confirm', h.confirm);
    localStorage.clear();
  });

  it('рисует заголовок, счётчики в табах и списки интересов', async () => {
    await renderWith();

    expect(screen.getByText('admin.content.title')).toBeInTheDocument();
    expect(screen.getByText('admin.content.tab_interests (2)')).toBeInTheDocument();
    expect(screen.getByText('admin.content.tab_goals (1)')).toBeInTheDocument();
    expect(screen.getByText('admin.content.tab_education (1)')).toBeInTheDocument();
    expect(screen.getByText('admin.content.tab_cities (2)')).toBeInTheDocument();
    expect(screen.getByText('admin.content.forbidden_words (1)')).toBeInTheDocument();
    expect(screen.getByText('sport')).toBeInTheDocument();
    expect(screen.getByText('tech')).toBeInTheDocument();
    expect(screen.queryByText('interest.sport')).toBeNull();
    expect(screen.getByText('admin.content.total: 2')).toBeInTheDocument();
  });

  it('добавление интереса сохраняет префикс-очищенный список и обновляет кэш контента', async () => {
    await renderWith();

    await userEvent.type(screen.getByPlaceholderText('admin.content.new_placeholder'), 'йога');
    await userEvent.click(screen.getByRole('button', { name: /admin\.content\.add/ }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.content.saved'));
    expect(putCall()?.[0]).toBe('/api/admin/content/interests');
    const items = putBody().items as string[];
    expect(items).toHaveLength(3);
    expect(items).toEqual(expect.arrayContaining(['sport', 'tech', 'йога']));
    expect(items.some((item: string) => item.startsWith('interest.'))).toBe(false);
    expect(h.invalidate).toHaveBeenCalled();
  });

  it('дубликат (с учётом префикса) не уходит на сервер', async () => {
    await renderWith();

    await userEvent.type(screen.getByPlaceholderText('admin.content.new_placeholder'), 'interest.sport');
    await userEvent.click(screen.getByRole('button', { name: /admin\.content\.add/ }));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('удаление элемента требует подтверждения, при согласии уходит PUT без него', async () => {
    await renderWith();

    const badge = screen.getByText('tech');
    await userEvent.click(within(badge).getByRole('button'));

    await waitFor(() => expect(putCall()?.[0]).toBe('/api/admin/content/interests'));
    expect(putBody().items).toEqual(['sport']);
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.content.saved');
  });

  it('отказ в подтверждении удаления ничего не сохраняет', async () => {
    await renderWith();
    h.confirm.mockReturnValue(false);

    await userEvent.click(within(screen.getByText('tech')).getByRole('button'));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('401 при сохранении — выход на логин и очистка токена', async () => {
    h.config = { interests: ['sport'], dating_goals: [], education: [], banned_words: [], cities: [] };
    mockSave(401);
    render(<ContentManagementPage />);
    await screen.findByText('admin.content.title');

    await userEvent.click(screen.getByRole('button', { name: 'admin.save' }));

    await waitFor(() => expect(h.clearToken).toHaveBeenCalled());
    expect(h.toastError).toHaveBeenCalledWith('admin.session_expired');
    expect(h.navigate).toHaveBeenCalledWith('/login');
  });

  it('ошибка сервера (500) — тост save_error, без выхода из аккаунта', async () => {
    h.config = { interests: ['sport'], dating_goals: [], education: [], banned_words: [], cities: [] };
    mockSave(500);
    render(<ContentManagementPage />);
    await screen.findByText('admin.content.title');

    await userEvent.click(screen.getByRole('button', { name: 'admin.save' }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.content.save_error'));
    expect(h.clearToken).not.toHaveBeenCalled();
  });

  it('сохранение целей уходит в секцию dating_goals', async () => {
    await renderWith({ dating_goals: ['serious', 'friendship'] });

    await userEvent.click(screen.getByRole('tab', { name: /tab_goals/ }));
    await userEvent.click(screen.getByRole('button', { name: 'admin.save' }));

    await waitFor(() => expect(putCall()?.[0]).toBe('/api/admin/content/dating_goals'));
    expect(putBody().items).toEqual(['friendship', 'serious']);
  });

  it('CSV-выгрузка интересов вызывает exportToCsv с именем раздела', async () => {
    await renderWith();

    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));

    expect(h.exportToCsv).toHaveBeenCalledWith('interests.csv', [
      { interests: 'sport' },
      { interests: 'tech' },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.content.csv_downloaded');
  });

  it('запрещённые слова: сырые подписи, файл words.csv и секция banned_words', async () => {
    await renderWith({ banned_words: ['спам', 'казино'] });

    await userEvent.click(screen.getByRole('tab', { name: /forbidden_words/ }));
    expect(screen.getByText('спам')).toBeInTheDocument();
    expect(screen.getByText('казино')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(h.exportToCsv).toHaveBeenCalledWith('words.csv', [{ words: 'казино' }, { words: 'спам' }]);

    await userEvent.click(screen.getByRole('button', { name: 'admin.save' }));
    await waitFor(() => expect(putCall()?.[0]).toBe('/api/admin/content/banned_words'));
  });

  it('страны: добавление, дубликат и удаление пишут в localStorage', async () => {
    localStorage.setItem(COUNTRIES_KEY, JSON.stringify({ Тестланд: [] }));
    await renderWith();

    await userEvent.click(screen.getByRole('tab', { name: /tab_cities/ }));
    expect(screen.getByText('Тестланд')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Новая страна'), 'Остров');
    await userEvent.click(screen.getByRole('button', { name: /Добавить/ }));
    expect(JSON.parse(String(localStorage.getItem(COUNTRIES_KEY)))).toEqual({ Остров: [], Тестланд: [] });

    await userEvent.type(screen.getByPlaceholderText('Новая страна'), 'Остров');
    await userEvent.click(screen.getByRole('button', { name: /Добавить/ }));
    expect(Object.keys(JSON.parse(String(localStorage.getItem(COUNTRIES_KEY))))).toHaveLength(2);

    const trigger = screen.getByText('Остров').closest('button')!;
    await userEvent.click(within(trigger).getAllByRole('button')[0]);
    expect(JSON.parse(String(localStorage.getItem(COUNTRIES_KEY)))).toEqual({ Тестланд: [] });
  });

  it('города внутри страны: раскрытие, добавление и удаление', async () => {
    localStorage.setItem(COUNTRIES_KEY, JSON.stringify({ Тестланд: ['Город1'] }));
    await renderWith();

    await userEvent.click(screen.getByRole('tab', { name: /tab_cities/ }));
    const trigger = screen.getByText('Тестланд').closest('button')!;
    await userEvent.click(trigger);

    await userEvent.type(screen.getByPlaceholderText('Новый город'), 'Город2');
    await userEvent.click(screen.getByRole('button', { name: /Город/ }));

    await waitFor(() =>
      expect(JSON.parse(String(localStorage.getItem(COUNTRIES_KEY)))).toEqual({ Тестланд: ['Город1', 'Город2'] }),
    );

    const badge = screen.getByText('Город1');
    await userEvent.click(within(badge).getByRole('button'));
    expect(JSON.parse(String(localStorage.getItem(COUNTRIES_KEY)))).toEqual({ Тестланд: ['Город2'] });
  });

  it('битый JSON в localStorage откатывается на справочник POPULAR_CITIES', async () => {
    localStorage.setItem(COUNTRIES_KEY, '{oops');
    await renderWith();

    await userEvent.click(screen.getByRole('tab', { name: /tab_cities/ }));
    expect(screen.getByText('Китай')).toBeInTheDocument();
  });

  it('сброс списка городов через Enter в поле нового города', async () => {
    localStorage.setItem(COUNTRIES_KEY, JSON.stringify({ Тестланд: [] }));
    await renderWith();

    await userEvent.click(screen.getByRole('tab', { name: /tab_cities/ }));
    await userEvent.click(screen.getByText('Тестланд').closest('button')!);

    const cityInput = screen.getByPlaceholderText('Новый город');
    fireEvent.change(cityInput, { target: { value: '  ГородX  ' } });
    fireEvent.keyDown(cityInput, { key: 'Enter' });

    await waitFor(() =>
      expect(JSON.parse(String(localStorage.getItem(COUNTRIES_KEY)))).toEqual({ Тестланд: ['ГородX'] }),
    );
  });
});
