import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children?: React.ReactNode }) => (
    <div role="menuitem">{children}</div>
  ),
  DropdownMenuSubContent: ({ children }: { children?: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuLabel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import AdminReportsPage from '@/pages/admin-reports';

const mockCreateObjectURL = vi.fn(() => 'blob:csv');
const mockRevokeObjectURL = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const reports = [
  {
    id: 1, reporterName: 'Аня', reportedUserName: 'Спамер', reason: 'Спам', description: 'd1',
    evidence: 'скрин', date: '2026-10-01', status: 'pending', teamId: 5, teamName: 'Модерация',
  },
  {
    id: 2, reporterName: 'Борис', reportedUserName: 'Фейк', reason: 'Фейк', description: 'd2',
    evidence: '', date: '2026-10-02', status: 'dismissed', teamId: null, teamName: null,
  },
];

const modLog = [
  { id: 1, date: '2026-10-01 10:00', admin: 'admin@swiftmatch.ru', action: 'Бан', targetUser: 'Спамер', reason: 'Спам' },
];

const banned = { users: [{ id: 5, name: 'Никита', email: 'nikita@mail.ru', city: 'Москва', joined: '2026-01-01' }] };

const teams = [{ id: 5, name: 'Модерация', isActive: 1, memberCount: 1 }];

function mockAll(opts: { reports?: unknown; users?: unknown; me?: unknown; postStatus?: number; getStatus?: number } = {}) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return jsonResponse({}, opts.postStatus ?? 200);
    if (opts.getStatus && opts.getStatus >= 400) return jsonResponse({}, opts.getStatus);
    if (url === '/api/admin/reports') return jsonResponse(opts.reports ?? reports);
    if (url === '/api/admin/moderation-log') return jsonResponse(modLog);
    if (url === '/api/admin/users?status=banned&page=1') return jsonResponse(opts.users ?? banned);
    if (url === '/api/admin/teams') return jsonResponse(teams);
    if (url === '/api/admin/me') return jsonResponse(opts.me ?? { teams: [] });
    return jsonResponse({});
  });
}

function postCall(url?: string) {
  return mockFetch.mock.calls.find((call) => call[1]?.method === 'POST' && (!url || call[0] === url));
}

function getCalls(url: string) {
  return mockFetch.mock.calls.filter((call) => call[0] === url && !call[1]?.method);
}

async function renderLoaded(opts: Parameters<typeof mockAll>[0] = {}) {
  mockAll(opts);
  render(<AdminReportsPage />);
  await screen.findByRole('tab', { name: /Очередь модерации/ });
}

describe('Страница admin-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
    vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });
  });

  it('пока грузится — спиннер, затем пять GET с Bearer и счётчики в табах', async () => {
    mockAll();

    const { container } = render(<AdminReportsPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByRole('tab', { name: /Очередь модерации/ });
    const getUrls = mockFetch.mock.calls.filter((call) => !call[1]?.method).map((call) => call[0]);
    expect(getUrls).toEqual([
      '/api/admin/reports',
      '/api/admin/moderation-log',
      '/api/admin/users?status=banned&page=1',
      '/api/admin/teams',
      '/api/admin/me',
    ]);
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(screen.getByRole('tab', { name: /^Очередь модерации/ })).toHaveAccessibleName(/1$/);
    expect(screen.getByRole('tab', { name: 'Заблокированные (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Лог действий (1)' })).toBeInTheDocument();
  });

  it('таблица жалоб: имена, причина, доказательство и статус-перевод', async () => {
    await renderLoaded();

    const firstRow = screen.getByText('Спамер').closest('tr')!;

    expect(within(firstRow).getByText('Аня')).toBeInTheDocument();
    expect(within(firstRow).getByText('Спам')).toBeInTheDocument();
    expect(within(firstRow).getByText('скрин')).toBeInTheDocument();
    expect(within(firstRow).getByText('admin.reports.status.pending')).toBeInTheDocument();
    expect(within(firstRow).getAllByText('Модерация').length).toBeGreaterThan(0);

    const secondRow = screen.getAllByText('Фейк')[0].closest('tr')!;
    expect(within(secondRow).getByText('admin.reports.status.dismissed')).toBeInTheDocument();
    expect(within(secondRow).getByText('—')).toBeInTheDocument();
    expect(within(secondRow).getByText('admin.reports.no_team')).toBeInTheDocument();
    expect(screen.getByText('Всего: 2 жалоб')).toBeInTheDocument();
  });

  it('фильтр по команде сужает список и обновляет итог', async () => {
    await renderLoaded();
    const select = screen.getByLabelText('admin.reports.team');

    fireEvent.change(select, { target: { value: 'none' } });
    expect(screen.getAllByText('Фейк').length).toBeGreaterThan(0);
    expect(screen.queryByText('Спамер')).toBeNull();
    expect(screen.getByText('Всего: 1 жалоб')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: '5' } });
    expect(screen.getAllByText('Спамер').length).toBeGreaterThan(0);
    expect(screen.queryByText('Фейк')).toBeNull();
  });

  it('смена статуса — POST, тост с номером и статусом, перезагрузка списка', async () => {
    await renderLoaded();

    const buttons = screen.getAllByRole('menuitem', { name: /Предупредить/ });
    await userEvent.click(buttons[0]);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('#1: admin.reports.status.reviewed'));
    const post = postCall('/api/admin/reports/1/status');
    expect(post?.[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' });
    expect(JSON.parse(String(post?.[1].body))).toEqual({ status: 'reviewed' });
    await waitFor(() => expect(getCalls('/api/admin/reports')).toHaveLength(2));
  });

  it('отказ смены статуса — тост ошибки операции', async () => {
    await renderLoaded({ postStatus: 500 });

    await userEvent.click(screen.getAllByRole('menuitem', { name: /Заблокировать/ })[0]);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.error.operation'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('увольнение: отклонение уходит статусом dismissed', async () => {
    await renderLoaded();

    await userEvent.click(screen.getAllByRole('menuitem', { name: /Отклонить/ })[0]);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('#1: admin.reports.status.dismissed'));
    expect(postCall('/api/admin/reports/1/status')?.[0]).toBe('/api/admin/reports/1/status');
  });

  it('супер-админ назначает и снимает команду — POST с teamId и null', async () => {
    await renderLoaded();

    const assignCalls = () => mockFetch.mock.calls.filter((call) => call[0] === '/api/admin/reports/1/assign');

    await userEvent.click(screen.getAllByRole('menuitem', { name: 'Модерация' })[0]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.reports.assigned'));
    expect(assignCalls()).toHaveLength(1);
    expect(JSON.parse(String(assignCalls()[0][1].body))).toEqual({ teamId: 5 });

    await userEvent.click(screen.getAllByRole('menuitem', { name: 'admin.reports.unassign' })[0]);
    await waitFor(() => expect(assignCalls()).toHaveLength(2));
    expect(JSON.parse(String(assignCalls()[1][1].body))).toEqual({ teamId: null });
  });

  it('не-супер-админ не получает управления командами', async () => {
    await renderLoaded({ me: { teams: [5] } });

    expect(screen.queryByRole('menuitem', { name: 'admin.reports.assign' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'admin.reports.unassign' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Модерация' })).toBeNull();
  });

  it('CSV-выгрузка жалоб подтверждается тостом', async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.content.csv_downloaded');
  });

  it('заблокированные и лог модерации доступны во вкладках', async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole('tab', { name: /Заблокированные/ }));
    expect(screen.getByText('Никита')).toBeInTheDocument();
    expect(screen.getByText('nikita@mail.ru')).toBeInTheDocument();
    expect(screen.getByText('Москва')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Лог действий/ }));
    expect(screen.getByText('admin@swiftmatch.ru')).toBeInTheDocument();
    expect(screen.getByText('Бан')).toBeInTheDocument();
  });

  it('не-массивные ответы API не роняют страницу', async () => {
    mockAll({ reports: { message: 'nope' }, users: { message: 'nope' } });
    render(<AdminReportsPage />);

    await screen.findByRole('tab', { name: /Очередь модерации/ });
    expect(screen.getByRole('tab', { name: 'Заблокированные (0)' })).toBeInTheDocument();
    expect(screen.getByText('Всего: 0 жалоб')).toBeInTheDocument();
  });

  it('отказ загрузки списка — тост ошибки и пустые вкладки', async () => {
    mockAll({ getStatus: 500 });
    render(<AdminReportsPage />);

    await screen.findByRole('tab', { name: /Очередь модерации/ });
    expect(h.toastError).toHaveBeenCalledWith('admin.error.load');
    expect(screen.getByRole('tab', { name: 'Заблокированные (0)' })).toBeInTheDocument();
  });

  it('без токена GET уходит без заголовка Authorization', async () => {
    h.token = null;
    await renderLoaded();

    expect(mockFetch.mock.calls[0][1].headers).toEqual({});
  });

  it('лог модерации выгружается в CSV', async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole('tab', { name: /Лог действий/ }));
    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith('admin.content.csv_downloaded');
  });

  it('пустой набор жалоб не блокирует CSV', async () => {
    await renderLoaded({ reports: [] });

    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));

    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});
