import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  confirm: vi.fn(() => true),
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

import AdminTeamsPage from '@/pages/admin-teams';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const teams = [
  { id: 1, name: 'Модерация', isActive: 1, memberCount: 2 },
  { id: 2, name: 'Саппорт', isActive: 0, memberCount: 0 },
];

const membersByTeam: Record<number, unknown> = {
  1: [
    { id: 7, name: 'Аня', email: 'anya@mail.ru' },
    { id: 9, name: 'Борис', email: 'boris@mail.ru' },
  ],
  2: [],
};

const searchResult = {
  users: [
    { id: 11, name: 'Виктор', email: 'viktor@mail.ru' },
    { id: 7, name: 'Аня', email: 'anya@mail.ru' },
  ],
};

function mockAll(opts: { teams?: unknown; me?: unknown; postStatus?: number } = {}) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method) return jsonResponse({}, opts.postStatus ?? 200);
    if (url === '/api/admin/teams') return jsonResponse(opts.teams ?? teams);
    if (url === '/api/admin/me') return jsonResponse(opts.me ?? { id: 7, teams: [] });
    if (url.startsWith('/api/admin/users?')) return jsonResponse(searchResult);
    const memberMatch = url.match(/^\/api\/admin\/teams\/(\d+)\/members$/);
    if (memberMatch) return jsonResponse(membersByTeam[Number(memberMatch[1])] ?? []);
    return jsonResponse({});
  });
}

function mutationCall(method: string) {
  return mockFetch.mock.calls.find((call) => call[1]?.method === method);
}

async function renderLoaded(me?: unknown) {
  mockAll(me === undefined ? {} : { me });
  render(<AdminTeamsPage />);
  await screen.findByText('Модерация');
}

describe('Страница admin-teams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
    h.confirm.mockReturnValue(true);
    vi.stubGlobal('confirm', h.confirm);
  });

  it('пока грузится — спиннер, затем команды, участники и счётчики', async () => {
    mockAll();

    const { container } = render(<AdminTeamsPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('Модерация');
    expect(screen.getByText('admin.teams.title')).toBeInTheDocument();
    expect(screen.getByText('Саппорт')).toBeInTheDocument();
    expect(screen.getByText('Аня')).toBeInTheDocument();
    expect(screen.getByText('admin.teams.no_members')).toBeInTheDocument();
    expect(screen.getAllByText('admin.teams.active')).toHaveLength(2);
    expect(screen.getAllByText('admin.teams.inactive')).toHaveLength(2);
  });

  it('GET-запросы уходят с Bearer, а участники грузятся по каждой команде', async () => {
    mockAll();
    render(<AdminTeamsPage />);
    await screen.findByText('Модерация');

    const getCalls = mockFetch.mock.calls.filter((call) => !call[1]?.method).map((call) => call[0]);
    expect(getCalls).toEqual([
      '/api/admin/teams',
      '/api/admin/me',
      '/api/admin/teams/1/members',
      '/api/admin/teams/2/members',
    ]);
    for (const call of mockFetch.mock.calls) {
      expect(call[1].headers.Authorization).toBe('Bearer test-token');
    }
  });

  it('без токена GET уходит с пустым набором заголовков', async () => {
    h.token = null;
    mockAll();
    render(<AdminTeamsPage />);
    await screen.findByText('Модерация');

    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: {} });
  });

  it('не-супер-админ видит только баннер и не получает формы создания', async () => {
    await renderLoaded({ id: 3, teams: [1] });

    expect(screen.getByText('admin.teams.super_only')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('admin.teams.name_placeholder')).toBeNull();
    expect(screen.queryByPlaceholderText('admin.teams.search_placeholder')).toBeNull();
    expect(screen.queryByRole('button', { name: /admin\.teams\.create/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /admin\.teams\.pause|admin\.teams\.inactive/ })).toBeNull();
  });

  it('не-супер-админ может снять только себя, чужие участники без крестика', async () => {
    await renderLoaded({ id: 7, teams: [1] });

    const removeButtons = screen.getAllByRole('button', { name: 'admin.teams.remove' });
    expect(removeButtons).toHaveLength(1);

    await userEvent.click(removeButtons[0]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.teams.member_removed'));
    const del = mutationCall('DELETE');
    expect(del?.[0]).toBe('/api/admin/teams/1/members/7');
  });

  it('супер-админ создаёт команду — POST с именем, тост и перезагрузка списка', async () => {
    await renderLoaded();
    const before = mockFetch.mock.calls.length;

    await userEvent.type(screen.getByPlaceholderText('admin.teams.name_placeholder'), 'Новая');
    await userEvent.click(screen.getByRole('button', { name: /admin\.teams\.create/ }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.teams.created'));
    const post = mutationCall('POST');
    expect(post?.[0]).toBe('/api/admin/teams');
    expect(post?.[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' });
    expect(JSON.parse(String(post?.[1].body))).toEqual({ name: 'Новая' });
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('кнопка создания заблокирована на пустом имени, Enter запускает создание', async () => {
    await renderLoaded();
    const createButton = screen.getByRole('button', { name: /admin\.teams\.create/ });
    expect(createButton).toBeDisabled();

    const input = screen.getByPlaceholderText('admin.teams.name_placeholder');
    fireEvent.change(input, { target: { value: 'С Enter' } });
    expect(createButton).not.toBeDisabled();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mutationCall('POST')?.[0]).toBe('/api/admin/teams'));
  });

  it('отказ создания команды — тост ошибки сохранения', async () => {
    mockAll({ postStatus: 500 });
    render(<AdminTeamsPage />);
    await screen.findByText('Модерация');

    await userEvent.type(screen.getByPlaceholderText('admin.teams.name_placeholder'), 'Новая');
    await userEvent.click(screen.getByRole('button', { name: /admin\.teams\.create/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.save'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('переключение активности — PATCH с инвертированным флагом', async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole('button', { name: 'admin.teams.inactive' }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.teams.saved'));
    const patch = mutationCall('PATCH');
    expect(patch?.[0]).toBe('/api/admin/teams/1');
    expect(JSON.parse(String(patch?.[1].body))).toEqual({ isActive: false });
  });

  it('удаление команды: подтверждение требуется, отказ ничего не отправляет', async () => {
    await renderLoaded();

    const iconButtons = screen.getAllByRole('button').filter((b) => !b.textContent?.trim() && !b.getAttribute('aria-label'));
    expect(iconButtons).toHaveLength(2);

    h.confirm.mockReturnValue(false);
    await userEvent.click(iconButtons[0]);
    expect(mutationCall('DELETE')).toBeUndefined();

    h.confirm.mockReturnValue(true);
    await userEvent.click(iconButtons[0]);
    await waitFor(() => expect(mutationCall('DELETE')?.[0]).toBe('/api/admin/teams/1'));
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.teams.deleted');
  });

  it('поиск от двух символов: запрос после задержки, занятый участник помечен занятым', async () => {
    await renderLoaded();

    const input = screen.getAllByPlaceholderText('admin.teams.search_placeholder')[0];
    await userEvent.type(input, 'Ви');

    await waitFor(() => expect(mockFetch.mock.calls.some((call) => String(call[0]).startsWith('/api/admin/users?'))).toBe(true));
    const searchCall = mockFetch.mock.calls.find((call) => String(call[0]).startsWith('/api/admin/users?'))!;
    expect(String(searchCall[0])).toContain(`search=${encodeURIComponent('Ви')}&page=1`);
    expect(screen.getByText('Виктор')).toBeInTheDocument();
    expect(screen.getAllByText('Аня').length).toBeGreaterThan(0);

    const addButtons = screen.getAllByRole('button', { name: /admin\.teams\.add_member/ });
    expect(addButtons).toHaveLength(1);

    await userEvent.click(addButtons[0]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.teams.member_added'));
    const post = mutationCall('POST');
    expect(post?.[0]).toBe('/api/admin/teams/1/members');
    expect(JSON.parse(String(post?.[1].body))).toEqual({ userId: 11 });
    await waitFor(() => expect(screen.queryByRole('button', { name: /admin\.teams\.add_member/ })).toBeNull());
  });

  it('поиск короче двух символов не уходит на сервер', async () => {
    await renderLoaded();

    await userEvent.type(screen.getAllByPlaceholderText('admin.teams.search_placeholder')[0], 'В');

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockFetch.mock.calls.some((call) => String(call[0]).startsWith('/api/admin/users?'))).toBe(false);
  });

  it('не-массив в списке команд — пустое состояние вместо падения', async () => {
    mockAll({ teams: { message: 'unexpected shape' } });
    render(<AdminTeamsPage />);

    await screen.findByText('admin.teams.empty');
    expect(screen.getByText('admin.teams.title')).toBeInTheDocument();
  });

  it('отказ загрузки участников не роняет карточку — пустой список', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/teams') return jsonResponse(teams);
      if (url === '/api/admin/me') return jsonResponse({ id: 7, teams: [] });
      if (url.endsWith('/members')) return jsonResponse({}, 500);
      return jsonResponse({});
    });
    render(<AdminTeamsPage />);

    await screen.findByText('Модерация');
    expect(screen.getAllByText('admin.teams.no_members')).toHaveLength(2);
  });
});
