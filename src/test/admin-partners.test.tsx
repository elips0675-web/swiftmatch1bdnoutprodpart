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

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children?: React.ReactNode }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import AdminPartnersPage from '@/pages/admin-partners';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const partners = [
  {
    id: 1, name: 'ТаксиПартнёр', type: 'deeplink', commission_rate: '15.50', hmac_secret: 'abcdef1234567890',
    status: 'active', offers_count: 3, clicks_total: 120, conversions_total: 4, commission_pending: '300.00',
  },
  {
    id: 2, name: 'Цветы', type: 'api', commission_rate: 15, hmac_secret: null,
    status: 'paused', offers_count: 0, clicks_total: 0, conversions_total: 0, commission_pending: 0,
  },
];

const offers = [
  {
    id: 11, partner_id: 1, partner_name: 'ТаксиПартнёр', category: 'taxi', title: 'Скидка 10%',
    placement: 'chat', status: 'active', pinned: 0, clicks_total: 5,
  },
];

const conversions = [
  {
    id: 21, partner_id: 1, partner_name: 'ТаксиПартнёр', offer_id: 11, offer_title: 'Скидка 10%', user_id: 3,
    user_email: 'u@x.ru', conversion_type: 'order', external_order_id: 'ORD-1', amount: 1000, commission: 150,
    status: 'approved', created_at: '2026-10-01T10:00:00.000Z',
  },
];

const payouts = [
  {
    id: 31, partner_id: 1, partner_name: 'ТаксиПартнёр', amount: 500, currency: 'RUB', method: 'bank', details: null,
    status: 'pending', admin_note: null, created_at: '2026-10-02T10:00:00.000Z', processed_at: null,
  },
];

const dailyStats = [
  { date: '2026-10-01', total: 10, clicks: 100, conversions: 5, revenue: 5000, commission: 750 },
];

function mockAll(opts: { partners?: unknown; postStatus?: number; getStatus?: number } = {}) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PUT') return jsonResponse({}, opts.postStatus ?? 200);
    if (opts.getStatus && opts.getStatus >= 400) return jsonResponse({}, opts.getStatus);
    if (url === '/api/admin/partners') return jsonResponse(opts.partners ?? partners);
    if (url === '/api/admin/offers') return jsonResponse(offers);
    if (url === '/api/admin/conversions') return jsonResponse(conversions);
    if (url === '/api/admin/payouts') return jsonResponse(payouts);
    if (url === '/api/admin/stats/daily') return jsonResponse(dailyStats);
    return jsonResponse({});
  });
}

function mutationCall(method: string, url?: string) {
  return mockFetch.mock.calls.find((call) => call[1]?.method === method && (!url || call[0] === url));
}

async function renderLoaded(opts: Parameters<typeof mockAll>[0] = {}) {
  mockAll(opts);
  render(<AdminPartnersPage />);
  await screen.findByText('ТаксиПартнёр');
}

async function openTab(name: RegExp) {
  await userEvent.click(screen.getByRole('button', { name }));
}

describe('Страница admin-partners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
  });

  it('пока грузится — спиннер, затем пять GET с Bearer и таблица партнёров', async () => {
    mockAll();

    const { container } = render(<AdminPartnersPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('ТаксиПартнёр');
    const getUrls = mockFetch.mock.calls.filter((call) => !call[1]?.method).map((call) => call[0]);
    expect(getUrls).toEqual([
      '/api/admin/partners',
      '/api/admin/offers',
      '/api/admin/conversions',
      '/api/admin/payouts',
      '/api/admin/stats/daily',
    ]);
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer test-token' });

    const row = screen.getByTestId('admin-partner-1');
    expect(within(row).getByText('deeplink')).toBeInTheDocument();
    expect(within(row).getByText('15.5%')).toBeInTheDocument();
    expect(within(row).getByText('abcdef12…')).toBeInTheDocument();
    expect(within(row).getByText('120')).toBeInTheDocument();

    const pausedRow = screen.getByTestId('admin-partner-2');
    expect(within(pausedRow).getByText('15.0%')).toBeInTheDocument();
    expect(within(pausedRow).getByText('—')).toBeInTheDocument();
    expect(within(pausedRow).getByTestId('activate-partner-2')).toBeInTheDocument();
  });

  it('без токена GET уходит без заголовка Authorization', async () => {
    h.token = null;
    await renderLoaded();

    expect(mockFetch.mock.calls[0][1].headers).toEqual({});
  });

  it('офферы: строка с переводом категории и кнопкой паузы', async () => {
    await renderLoaded();
    await openTab(/admin\.partners\.offers_list/);

    const row = screen.getByTestId('admin-offer-11');
    expect(within(row).getByText('Скидка 10%')).toBeInTheDocument();
    expect(within(row).getByText('partner.category.taxi')).toBeInTheDocument();
    expect(within(row).getByText('chat')).toBeInTheDocument();
    expect(within(row).getByTestId('pin-offer-11')).toBeInTheDocument();
    expect(within(row).getByTestId('pause-offer-11')).toBeInTheDocument();
  });

  it('конверсии: суммы и статус, комиссия в заголовке выплат', async () => {
    await renderLoaded();

    await openTab(/admin\.partners\.conversions/);
    const conversionRow = screen.getByTestId('admin-conversion-21');
    expect(within(conversionRow).getByText('$1000.00')).toBeInTheDocument();
    expect(within(conversionRow).getByText('$150.00')).toBeInTheDocument();
    expect(within(conversionRow).getByText('approved')).toBeInTheDocument();
    expect(within(conversionRow).getByText('ORD-1')).toBeInTheDocument();

    await openTab(/admin\.partners\.payouts/);
    expect(screen.getByText('admin.partners.total_commission: $150.00')).toBeInTheDocument();
    const payoutRow = screen.getByTestId('admin-payout-31');
    expect(within(payoutRow).getByText('500 ₽')).toBeInTheDocument();
    expect(within(payoutRow).getByRole('button', { name: /admin\.partners\.approve/ })).toBeInTheDocument();
  });

  it('статистика: строка дня со счётчиками', async () => {
    await renderLoaded();
    await openTab(/admin\.partners\.stats/);

    const row = screen.getByText('2026-10-01').closest('tr')!;
    expect(within(row).getByText('100')).toBeInTheDocument();
    expect(within(row).getByText('750 ₽')).toBeInTheDocument();
  });

  it('пауза партнёра — PUT с инвертированным статусом', async () => {
    await renderLoaded();

    await userEvent.click(screen.getByTestId('pause-partner-1'));

    await waitFor(() => expect(mutationCall('PUT', '/api/admin/partners/1')).toBeDefined());
    const put = mutationCall('PUT', '/api/admin/partners/1');
    expect(JSON.parse(String(put?.[1].body))).toEqual({ status: 'paused' });
    expect(put?.[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' });
  });

  it('отказ переключения партнёра — тост generic', async () => {
    await renderLoaded({ postStatus: 500 });

    await userEvent.click(screen.getByTestId('pause-partner-1'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('error.generic_title'));
  });

  it('создание партнёра: диалог, тип из селекта, POST и перезагрузка', async () => {
    await renderLoaded();
    const before = mockFetch.mock.calls.length;

    await userEvent.click(screen.getByTestId('add-partner-button'));
    const submit = screen.getByTestId('submit-create-partner');
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId('partner-name'), { target: { value: 'НовыйПартнёр' } });
    expect(submit).not.toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'saas' } });

    fireEvent.click(submit);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.features.saved'));
    const post = mutationCall('POST', '/api/admin/partners');
    expect(JSON.parse(String(post?.[1].body))).toEqual({ name: 'НовыйПартнёр', type: 'saas' });
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(before));
  });

  it('отказ создания партнёра — тост generic, диалог не подтверждает успех', async () => {
    await renderLoaded({ postStatus: 500 });

    await userEvent.click(screen.getByTestId('add-partner-button'));
    fireEvent.change(screen.getByTestId('partner-name'), { target: { value: 'НовыйПартнёр' } });
    fireEvent.click(screen.getByTestId('submit-create-partner'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('error.generic_title'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('создание оффера: выбор партнёра, заголовок, диплинк и POST', async () => {
    await renderLoaded();

    await userEvent.click(screen.getByTestId('add-offer-button'));
    const submit = screen.getByTestId('submit-create-offer');
    expect(submit).toBeDisabled();

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(3);
    fireEvent.change(selects[0], { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('offer-title'), { target: { value: 'Акция' } });
    fireEvent.change(screen.getByTestId('offer-deeplink'), { target: { value: 'https://swiftmatch.app/o/1' } });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.features.saved'));
    const post = mutationCall('POST', '/api/admin/partners/1/offers');
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      category: 'taxi',
      title: 'Акция',
      deeplink: 'https://swiftmatch.app/o/1',
      placement: 'chat',
    });
  });

  it('закрепление оффера — PUT с инвертированным pinned', async () => {
    await renderLoaded();
    await openTab(/admin\.partners\.offers_list/);

    await userEvent.click(screen.getByTestId('pin-offer-11'));

    await waitFor(() => expect(mutationCall('PUT', '/api/admin/offers/11')).toBeDefined());
    expect(JSON.parse(String(mutationCall('PUT', '/api/admin/offers/11')?.[1].body))).toEqual({ pinned: true });
  });

  it('пауза оффера — PUT со статусом paused', async () => {
    await renderLoaded();
    await openTab(/admin\.partners\.offers_list/);

    await userEvent.click(screen.getByTestId('pause-offer-11'));

    await waitFor(() => expect(mutationCall('PUT', '/api/admin/offers/11')).toBeDefined());
    expect(JSON.parse(String(mutationCall('PUT', '/api/admin/offers/11')?.[1].body))).toEqual({ status: 'paused' });
  });

  it('подтверждение выплаты — PUT completed и тост', async () => {
    await renderLoaded();
    await openTab(/admin\.partners\.payouts/);

    await userEvent.click(screen.getByRole('button', { name: /admin\.partners\.approve/ }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.features.saved'));
    expect(JSON.parse(String(mutationCall('PUT', '/api/admin/payouts/31')?.[1].body))).toEqual({ status: 'completed' });
  });

  it('создание выплаты: партнёр, сумма и метод уходят числами', async () => {
    await renderLoaded();
    await openTab(/admin\.partners\.payouts/);

    await userEvent.click(screen.getByTestId('add-payout-button'));
    const submit = screen.getByTestId('submit-create-payout');
    expect(submit).toBeDisabled();

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('payout-amount'), { target: { value: '500' } });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.features.saved'));
    const post = mutationCall('POST', '/api/admin/payouts');
    expect(JSON.parse(String(post?.[1].body))).toEqual({ partner_id: 1, amount: 500, method: 'bank' });
  });

  it('нулевая сумма и отсутствие партнёра блокируют создание выплаты', async () => {
    await renderLoaded();
    await openTab(/admin\.partners\.payouts/);

    await userEvent.click(screen.getByTestId('add-payout-button'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('payout-amount'), { target: { value: '0' } });

    expect(screen.getByTestId('submit-create-payout')).toBeDisabled();
    expect(mutationCall('POST', '/api/admin/payouts')).toBeUndefined();
  });

  it('не-массивные ответы API дают пустые таблицы с прочерками', async () => {
    mockAll({ partners: { message: 'nope' } });
    render(<AdminPartnersPage />);

    await screen.findByText('—');
    expect(screen.queryByTestId('admin-partner-1')).toBeNull();
  });

  it('отказ всех GET не роняет страницу — таблицы пустые', async () => {
    mockAll({ getStatus: 500 });
    render(<AdminPartnersPage />);

    await screen.findByText('—');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('admin-partner-1')).toBeNull();
  });
});
