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
  {
    id: 12, partner_id: 2, partner_name: 'Цветы', category: 'flowers', title: 'Букет недели',
    placement: 'hangout', status: 'paused', pinned: 1, clicks_total: 0,
  },
];

const conversions = [
  {
    id: 21, partner_id: 1, partner_name: 'ТаксиПартнёр', offer_id: 11, offer_title: 'Скидка 10%', user_id: 3,
    user_email: 'u@x.ru', conversion_type: 'order', external_order_id: 'ORD-1', amount: 1000, commission: 150,
    status: 'approved', created_at: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 22, partner_id: 2, partner_name: 'Цветы', offer_id: null, offer_title: null, user_id: null,
    user_email: null, conversion_type: 'click', external_order_id: null, amount: null, commission: null,
    status: 'pending', created_at: '2026-10-03T10:00:00.000Z',
  },
];

const payouts = [
  {
    id: 31, partner_id: 1, partner_name: 'ТаксиПартнёр', amount: 500, currency: 'RUB', method: 'bank', details: null,
    status: 'pending', admin_note: null, created_at: '2026-10-02T10:00:00.000Z', processed_at: null,
  },
  {
    id: 32, partner_id: 2, partner_name: 'Цветы', amount: 1000, currency: 'RUB', method: 'card', details: 'Сбер',
    status: 'completed', admin_note: 'выплачено', created_at: '2026-10-04T10:00:00.000Z', processed_at: '2026-10-05T10:00:00.000Z',
  },
  {
    id: 33, partner_id: 2, partner_name: 'Цветы', amount: 700, currency: 'RUB', method: 'manual', details: null,
    status: 'rejected', admin_note: null, created_at: '2026-10-06T10:00:00.000Z', processed_at: null,
  },
];

const dailyStats = [
  { date: '2026-10-01', total: 10, clicks: 100, conversions: 5, revenue: 5000, commission: 750 },
];

function mockAll(opts: { partners?: unknown; postStatus?: number; getStatus?: number; allNonArray?: boolean } = {}) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PUT') return jsonResponse({}, opts.postStatus ?? 200);
    if (opts.getStatus && opts.getStatus >= 400) return jsonResponse({}, opts.getStatus);
    if (opts.allNonArray) return jsonResponse({ message: 'nope' });
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

  it('пустые ответы всех пяти GET дают прочерк в каждой вкладке', async () => {
    mockAll({ allNonArray: true });
    render(<AdminPartnersPage />);

    await screen.findByText('—');
    expect(screen.queryByTestId('admin-partner-1')).toBeNull();

    await openTab(/^admin\.partners\.offers_list$/);
    expect(screen.getByText('—')).toBeInTheDocument();

    await openTab(/^admin\.partners\.conversions$/);
    expect(screen.getByText('—')).toBeInTheDocument();

    await openTab(/^admin\.partners\.payouts$/);
    expect(screen.getByText('—')).toBeInTheDocument();

    await openTab(/^admin\.partners\.stats$/);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('сетевая ошибка загрузки показывает тост и оставляет таблицы пустыми', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));
    render(<AdminPartnersPage />);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('error.generic_title'));
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-partner-1')).toBeNull();
  });

  it('активация партнёра без токена шлёт PUT active без Authorization', async () => {
    h.token = null;
    await renderLoaded();

    await userEvent.click(screen.getByTestId('activate-partner-2'));

    await waitFor(() => expect(mutationCall('PUT', '/api/admin/partners/2')).toBeDefined());
    const put = mutationCall('PUT', '/api/admin/partners/2');
    expect(JSON.parse(String(put?.[1].body))).toEqual({ status: 'active' });
    expect(put?.[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('создание партнёра без токена не шлёт Authorization', async () => {
    h.token = null;
    await renderLoaded();

    await userEvent.click(screen.getByTestId('add-partner-button'));
    fireEvent.change(screen.getByTestId('partner-name'), { target: { value: 'БезТокена' } });
    fireEvent.click(screen.getByTestId('submit-create-partner'));

    await waitFor(() => expect(mutationCall('POST', '/api/admin/partners')).toBeDefined());
    expect(mutationCall('POST', '/api/admin/partners')?.[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('создание оффера без токена: категория и размещение из селектов', async () => {
    h.token = null;
    await renderLoaded();

    await userEvent.click(screen.getByTestId('add-offer-button'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '2' } });
    fireEvent.change(selects[1], { target: { value: 'cinema' } });
    fireEvent.change(screen.getByTestId('offer-title'), { target: { value: 'Премьера' } });
    fireEvent.change(screen.getByTestId('offer-deeplink'), { target: { value: 'https://swiftmatch.app/o/2' } });
    fireEvent.change(selects[2], { target: { value: 'hangout' } });
    fireEvent.click(screen.getByTestId('submit-create-offer'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.features.saved'));
    const post = mutationCall('POST', '/api/admin/partners/2/offers');
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      category: 'cinema',
      title: 'Премьера',
      deeplink: 'https://swiftmatch.app/o/2',
      placement: 'hangout',
    });
    expect(post?.[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('отказ создания оффера — тост generic, диалог не подтверждает успех', async () => {
    await renderLoaded({ postStatus: 500 });

    await userEvent.click(screen.getByTestId('add-offer-button'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('offer-title'), { target: { value: 'Акция' } });
    fireEvent.change(screen.getByTestId('offer-deeplink'), { target: { value: 'https://swiftmatch.app/o/1' } });
    fireEvent.click(screen.getByTestId('submit-create-offer'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('error.generic_title'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('submit-create-offer')).toBeInTheDocument();
  });

  it('активация приостановленного оффера — PUT active', async () => {
    await renderLoaded();
    await openTab(/^admin\.partners\.offers_list$/);

    await userEvent.click(screen.getByTestId('activate-offer-12'));

    await waitFor(() => expect(mutationCall('PUT', '/api/admin/offers/12')).toBeDefined());
    expect(JSON.parse(String(mutationCall('PUT', '/api/admin/offers/12')?.[1].body))).toEqual({ status: 'active' });
  });

  it('отказ переключения оффера — тост generic', async () => {
    await renderLoaded({ postStatus: 500 });
    await openTab(/^admin\.partners\.offers_list$/);

    await userEvent.click(screen.getByTestId('pause-offer-11'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('error.generic_title'));
  });

  it('закреплённый оффер показывает «спонсируется» и снимается PUT pinned false', async () => {
    await renderLoaded();
    await openTab(/^admin\.partners\.offers_list$/);

    const pinnedRow = screen.getByTestId('admin-offer-12');
    expect(within(pinnedRow).getByText('admin.partners.sponsored_on')).toBeInTheDocument();
    expect(within(pinnedRow).getByText('admin.partners.activate')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('pin-offer-12'));

    await waitFor(() => expect(mutationCall('PUT', '/api/admin/offers/12')).toBeDefined());
    expect(JSON.parse(String(mutationCall('PUT', '/api/admin/offers/12')?.[1].body))).toEqual({ pinned: false });
  });

  it('пауза оффера без токена не шлёт Authorization', async () => {
    h.token = null;
    await renderLoaded();
    await openTab(/^admin\.partners\.offers_list$/);

    await userEvent.click(screen.getByTestId('pause-offer-11'));

    await waitFor(() => expect(mutationCall('PUT', '/api/admin/offers/11')).toBeDefined());
    expect(mutationCall('PUT', '/api/admin/offers/11')?.[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('снятие закрепления без токена и отказ — тост generic', async () => {
    h.token = null;
    await renderLoaded({ postStatus: 500 });
    await openTab(/^admin\.partners\.offers_list$/);

    await userEvent.click(screen.getByTestId('pin-offer-12'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('error.generic_title'));
    expect(mutationCall('PUT', '/api/admin/offers/12')?.[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('создание выплаты без токена: метод и детали из формы', async () => {
    h.token = null;
    await renderLoaded();
    await openTab(/^admin\.partners\.payouts$/);

    await userEvent.click(screen.getByTestId('add-payout-button'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('payout-amount'), { target: { value: '1200' } });
    fireEvent.change(selects[1], { target: { value: 'card' } });
    fireEvent.change(screen.getByTestId('payout-details'), { target: { value: 'Сбер, 1234' } });
    fireEvent.click(screen.getByTestId('submit-create-payout'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.features.saved'));
    const post = mutationCall('POST', '/api/admin/payouts');
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      partner_id: 2, amount: 1200, method: 'card', details: 'Сбер, 1234',
    });
    expect(post?.[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('отказ создания выплаты — тост generic, успеха нет', async () => {
    await renderLoaded({ postStatus: 500 });
    await openTab(/^admin\.partners\.payouts$/);

    await userEvent.click(screen.getByTestId('add-payout-button'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('payout-amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('submit-create-payout'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('error.generic_title'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('отрицательная и дробная сумма ниже min блокируют выплату', async () => {
    await renderLoaded();
    await openTab(/^admin\.partners\.payouts$/);

    await userEvent.click(screen.getByTestId('add-payout-button'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '1' } });

    const submit = screen.getByTestId('submit-create-payout');
    const amount = screen.getByTestId('payout-amount');

    fireEvent.change(amount, { target: { value: '-500' } });
    expect(submit).toBeDisabled();

    fireEvent.change(amount, { target: { value: '0.5' } });
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    expect(mutationCall('POST', '/api/admin/payouts')).toBeUndefined();

    fireEvent.change(amount, { target: { value: '1' } });
    expect(submit).not.toBeDisabled();
  });

  it('отклонение выплаты — PUT rejected и тост успеха', async () => {
    await renderLoaded();
    await openTab(/^admin\.partners\.payouts$/);

    await userEvent.click(screen.getByRole('button', { name: /admin\.partners\.reject/ }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.features.saved'));
    expect(JSON.parse(String(mutationCall('PUT', '/api/admin/payouts/31')?.[1].body))).toEqual({ status: 'rejected' });
  });

  it('подтверждение выплаты без токена и отказ — тост generic', async () => {
    h.token = null;
    await renderLoaded({ postStatus: 500 });
    await openTab(/^admin\.partners\.payouts$/);

    await userEvent.click(screen.getByRole('button', { name: /admin\.partners\.approve/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('error.generic_title'));
    expect(mutationCall('PUT', '/api/admin/payouts/31')?.[1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('конверсия без оффера, суммы и комиссии показывает прочерки', async () => {
    await renderLoaded();
    await openTab(/^admin\.partners\.conversions$/);

    const row = screen.getByTestId('admin-conversion-22');
    expect(within(row).getAllByText('—')).toHaveLength(4);
    expect(within(row).getByText('pending')).toBeInTheDocument();
  });

  it('выплаты показывают завершённую и отклонённую без кнопок решения', async () => {
    await renderLoaded();
    await openTab(/^admin\.partners\.payouts$/);

    const completed = screen.getByTestId('admin-payout-32');
    expect(within(completed).getByText('completed')).toBeInTheDocument();
    expect(within(completed).getByText('выплачено')).toBeInTheDocument();
    expect(within(completed).queryByRole('button')).toBeNull();

    const rejected = screen.getByTestId('admin-payout-33');
    expect(within(rejected).getByText('rejected')).toBeInTheDocument();
    expect(within(rejected).getByText('—')).toBeInTheDocument();
    expect(within(rejected).queryByRole('button')).toBeNull();
  });

  it('активная вкладка объявляется через aria-pressed', async () => {
    await renderLoaded();

    const partnersTab = screen.getByRole('button', { name: /^admin\.partners$/ });
    const offersTab = screen.getByRole('button', { name: /^admin\.partners\.offers_list$/ });
    expect(partnersTab).toHaveAttribute('aria-pressed', 'true');
    expect(offersTab).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(offersTab);

    expect(offersTab).toHaveAttribute('aria-pressed', 'true');
    expect(partnersTab).toHaveAttribute('aria-pressed', 'false');
  });
});
