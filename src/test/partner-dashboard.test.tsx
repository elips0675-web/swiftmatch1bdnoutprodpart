import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const h = vi.hoisted(() => ({
  router: { push: vi.fn(), back: vi.fn(), replace: vi.fn() },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  token: 'test-token' as string | null,
}));

vi.mock('@/shims/next-navigation', () => ({ useRouter: () => h.router }));

vi.mock('sonner', () => ({
  toast: {
    success: (message?: string) => h.toastSuccess(message),
    error: (message?: string) => h.toastError(message),
  },
}));

vi.mock('@/lib/token', () => ({ getToken: () => h.token }));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange?: (value: string) => void; children?: React.ReactNode }) => (
    <select data-testid="offer-category" value={value} onChange={(event) => onValueChange?.(event.target.value)}>
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

import PartnerDashboard from '@/pages/partner-dashboard';

const dashboard = {
  partner: { id: 1, name: 'ООО «Ромашка»', type: 'deeplink', status: 'active' },
  stats: {
    offers_count: 3,
    clicks_total: 1240,
    conversions_count: 12,
    commission_total: 2500,
    paid_out: 1000,
    commission_pending: 1500,
  },
  subscription: null as null | { tier: string; status: string; expires_at: string | null },
};

const offers = [
  {
    id: 11,
    category: 'cinema',
    title: 'Билеты со скидкой',
    description: '',
    deeplink: 'https://cinema.example/1',
    price: 500,
    city: 'Москва',
    created_at: '2026-10-01T10:00:00.000Z',
    clicks: 42,
    status: 'active',
  },
  {
    id: 12,
    category: 'flowers',
    title: 'Букет дня',
    description: '',
    deeplink: 'https://flowers.example/2',
    price: null,
    city: '',
    created_at: '2026-10-02T10:00:00.000Z',
    clicks: 7,
    status: 'paused',
  },
];

const conversions = [
  {
    id: 21,
    conversion_type: 'purchase',
    amount: 5000,
    commission: 250,
    status: 'paid',
    external_order_id: 'ext-1',
    created_at: '2026-10-03T10:00:00.000Z',
    offer_title: 'Билеты со скидкой',
  },
  {
    id: 22,
    conversion_type: 'lead',
    amount: 0,
    commission: 100,
    status: 'pending',
    external_order_id: null,
    created_at: '2026-10-04T10:00:00.000Z',
    offer_title: null,
  },
];

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const price = (value: number) => value.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽';

type Scenario = {
  dash?: unknown;
  dashStatus?: number;
  offs?: unknown;
  convs?: unknown;
  onOfferWrite?: (method: string, body: unknown) => Response | Promise<Response>;
  onSubscribe?: () => Response | Promise<Response>;
};

function mockServer(scenario: Scenario = {}) {
  const state = { offers: scenario.offs ?? offers };
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/partner/dashboard') return jsonResponse(scenario.dash ?? dashboard, scenario.dashStatus ?? 200);
    if (url === '/api/partner/conversions') return jsonResponse(scenario.convs ?? conversions);
    if (url === '/api/partner/offers') {
      if (method === 'GET') return jsonResponse(state.offers);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (scenario.onOfferWrite) return scenario.onOfferWrite(method, body);
      state.offers = [...(state.offers as typeof offers), { ...offers[0], id: 99, ...body, clicks: 0, status: 'active' }];
      return jsonResponse({ ok: true }, 201);
    }
    if (url.startsWith('/api/partner/offers/')) {
      if (method === 'DELETE') return jsonResponse({ ok: true });
      return jsonResponse({ ok: true });
    }
    if (url === '/api/partner/subscribe') {
      return scenario.onSubscribe ? scenario.onSubscribe() : jsonResponse({ mock: true });
    }
    return jsonResponse({});
  });
  return state;
}

async function renderLoaded() {
  const view = render(<PartnerDashboard />);
  await screen.findByText('ООО «Ромашка»');
  return view;
}

async function openTab(label: string) {
  await userEvent.click(screen.getByText(label));
}

describe('Страница partner-dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('пока грузится — спиннер, затем имя партнёра и шесть метрик с ценами', async () => {
    mockServer();

    const { container } = render(<PartnerDashboard />);
    expect(screen.queryByText('ООО «Ромашка»')).toBeNull();
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('ООО «Ромашка»');

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1240')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText(price(2500))).toBeInTheDocument();
    expect(screen.getByText(price(1000))).toBeInTheDocument();
    expect(screen.getByText(price(1500))).toBeInTheDocument();
    expect(screen.getByText('partner.stat_commission')).toBeInTheDocument();
  });

  it('три запроса уходят с Bearer-токеном', async () => {
    mockServer();
    await renderLoaded();

    const urls = mockFetch.mock.calls.map((call) => call[0]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
    expect([...new Set(urls)].sort()).toEqual([
      '/api/partner/conversions',
      '/api/partner/dashboard',
      '/api/partner/offers',
    ]);
  });

  it('бейджи шапки лежат в div, а не в p — React не пишет validateDOMNesting', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockServer();
    try {
      await renderLoaded();
      await openTab('partner.tab_subscription');

      const warnings = consoleError.mock.calls.map((call) => String(call[0]));
      expect(warnings.filter((warning) => warning.includes('validateDOMNesting'))).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('дашборд не отдан — редирект на главную и пустой экран', async () => {
    mockServer({ dash: null, dashStatus: 500 });

    const { container } = render(<PartnerDashboard />);

    await waitFor(() => expect(h.router.replace).toHaveBeenCalledWith('/'));
    expect(container.textContent).toBe('');
    expect(screen.queryByText('partner.tab_dashboard')).toBeNull();
  });

  it('пустые офферы и конверсии дают заглушки', async () => {
    mockServer({ offs: [], convs: [] });
    await renderLoaded();

    await openTab('partner.tab_offers');
    expect(screen.getByText('partner.offer_empty')).toBeInTheDocument();

    await openTab('partner.tab_conversions');
    expect(screen.getByText('partner.conversion_empty')).toBeInTheDocument();
  });

  it('список офферов: категория, клики, цена, город и бейдж паузы', async () => {
    mockServer();
    await renderLoaded();

    await openTab('partner.tab_offers');

    expect(screen.getByText('partner.category.cinema')).toBeInTheDocument();
    expect(screen.getByText('partner.category.flowers')).toBeInTheDocument();
    expect(screen.getByText('Билеты со скидкой')).toBeInTheDocument();
    expect(screen.getByText('partner.offer_clicks: 42')).toBeInTheDocument();
    expect(screen.getByText(price(500))).toBeInTheDocument();
    expect(screen.getByText('Москва')).toBeInTheDocument();
    expect(screen.getAllByText('partner.status_paused')).toHaveLength(1);
  });

  it('создание оффера без названия и ссылки: тост и ни одного запроса', async () => {
    mockServer();
    await renderLoaded();

    await openTab('partner.tab_offers');
    await userEvent.click(screen.getByText('partner.offer_new'));
    await userEvent.click(screen.getByText('partner.offer_save'));

    expect(h.toastError).toHaveBeenCalledWith('partner.offer_required_fields');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('создание оффера при лимите тарифа: UPGRADE_REQUIRED показывает upgrade_required', async () => {
    mockServer({ onOfferWrite: () => jsonResponse({ code: 'UPGRADE_REQUIRED' }, 402) });
    await renderLoaded();

    await openTab('partner.tab_offers');
    await userEvent.click(screen.getByText('partner.offer_new'));
    fireEvent.change(screen.getByPlaceholderText('partner.offer_title_placeholder'), { target: { value: 'Такси со скидкой' } });
    fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: 'https://taxi.example/1' } });
    await userEvent.click(screen.getByText('partner.offer_save'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('partner.upgrade_required'));
    expect(screen.getByText('partner.offer_save')).toBeInTheDocument();
  });

  it('создание оффера: POST с числовой ценой, форма закрывается, список перечитывается', async () => {
    mockServer();
    await renderLoaded();

    await openTab('partner.tab_offers');
    await userEvent.click(screen.getByText('partner.offer_new'));
    fireEvent.change(screen.getByTestId('offer-category'), { target: { value: 'taxi' } });
    fireEvent.change(screen.getByPlaceholderText('partner.offer_title_placeholder'), { target: { value: 'Такси со скидкой' } });
    fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: 'https://taxi.example/1' } });
    fireEvent.change(screen.getByPlaceholderText('partner.offer_price'), { target: { value: '300' } });
    fireEvent.change(screen.getByPlaceholderText('partner.offer_city'), { target: { value: 'Санкт-Петербург' } });
    await userEvent.click(screen.getByText('partner.offer_save'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('partner.offer_created'));

    const post = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[0]).toBe('/api/partner/offers');
    expect(post?.[1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-token' });
    expect(JSON.parse(String(post?.[1].body))).toEqual({
      category: 'taxi',
      title: 'Такси со скидкой',
      description: '',
      deeplink: 'https://taxi.example/1',
      price: 300,
      city: 'Санкт-Петербург',
      placement: 'chat',
    });
    await waitFor(() => expect(screen.queryByText('partner.offer_save')).toBeNull());
    expect(await screen.findByText('Такси со скидкой')).toBeInTheDocument();
  });

  it('удаление оффера: DELETE, тост и исчезновение из списка', async () => {
    mockServer();
    await renderLoaded();

    await openTab('partner.tab_offers');
    await userEvent.click(screen.getByTestId('delete-offer-11'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('partner.offer_deleted'));
    expect(mockFetch.mock.calls.some((call) => call[1]?.method === 'DELETE' && call[0] === '/api/partner/offers/11')).toBe(true);
    expect(screen.queryByText('Билеты со скидкой')).toBeNull();
    expect(screen.getByText('Букет дня')).toBeInTheDocument();
  });

  it('ошибка удаления: тост и оффер остаётся в списке', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/partner/dashboard') return jsonResponse(dashboard);
      if (url === '/api/partner/conversions') return jsonResponse(conversions);
      if (url === '/api/partner/offers') return jsonResponse(offers);
      if (url.startsWith('/api/partner/offers/') && init?.method === 'DELETE') return jsonResponse({ message: 'boom' }, 500);
      return jsonResponse({});
    });
    await renderLoaded();

    await openTab('partner.tab_offers');
    await userEvent.click(screen.getByTestId('delete-offer-11'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('partner.offer_delete_error'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Билеты со скидкой')).toBeInTheDocument();
  });

  it('пауза оффера: PUT с новым статусом и бейдж паузы', async () => {
    mockServer();
    await renderLoaded();

    await openTab('partner.tab_offers');
    expect(screen.getAllByText('partner.status_paused')).toHaveLength(1);

    await userEvent.click(screen.getByTestId('toggle-offer-11'));

    const put = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(put?.[0]).toBe('/api/partner/offers/11');
    expect(JSON.parse(String(put?.[1].body))).toEqual({ status: 'paused' });
    await waitFor(() => expect(screen.getAllByText('partner.status_paused')).toHaveLength(2));
  });

  it('конверсии: название оффера, заглушка неизвестного оффера и комиссия', async () => {
    mockServer();
    await renderLoaded();

    await openTab('partner.tab_conversions');

    expect(screen.getByText('Билеты со скидкой')).toBeInTheDocument();
    expect(screen.getByText('partner.conversion_unknown_offer')).toBeInTheDocument();
    expect(screen.getByText(price(250))).toBeInTheDocument();
    expect(screen.getByText('purchase')).toBeInTheDocument();
    expect(screen.getByText('lead')).toBeInTheDocument();
  });

  it('подписка Pro: mock-ответ включает тариф без перехода', async () => {
    mockServer({ onSubscribe: () => jsonResponse({ mock: true }) });
    await renderLoaded();

    await openTab('partner.tab_subscription');
    await userEvent.click(screen.getByText('partner.tier_upgrade'));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('partner.pro_activated'));
    expect(screen.queryByText('partner.tier_upgrade')).toBeNull();
    expect(screen.getAllByText('partner.tier_current').length).toBeGreaterThan(0);
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('подписка Pro: STRIPE_NOT_CONFIGURED показывает ключ недоступности Stripe', async () => {
    mockServer({ onSubscribe: () => jsonResponse({ code: 'STRIPE_NOT_CONFIGURED' }, 503) });
    await renderLoaded();

    await openTab('partner.tab_subscription');
    await userEvent.click(screen.getByText('partner.tier_upgrade'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('partner.stripe_unavailable'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('partner.tier_upgrade')).toBeInTheDocument();
  });

  it('подписка Pro: url в ответе уводит на оплату', async () => {
    const locationStub = { href: '' };
    vi.stubGlobal('location', locationStub);
    mockServer({ onSubscribe: () => jsonResponse({ url: 'https://checkout.stripe.com/session/abc' }) });
    await renderLoaded();

    await openTab('partner.tab_subscription');
    await userEvent.click(screen.getByText('partner.tier_upgrade'));

    await waitFor(() => expect(locationStub.href).toBe('https://checkout.stripe.com/session/abc'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('partner.tier_upgrade')).toBeInTheDocument();
  });
});
