import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="responsive">{children}</div>,
  BarChart: ({ data, children }: { data?: unknown; children?: React.ReactNode }) => (
    <div data-testid="bar-chart" data-points={JSON.stringify(data)}>{children}</div>
  ),
  Bar: ({ dataKey, name }: { dataKey?: string; name?: string }) => <div data-testid={`bar-${dataKey}`}>{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

import MonetizationPage from '@/pages/admin-monetization';

const DEFAULT_GOOGLE_ID = 'ca-app-pub-3940256099942544/5224354917';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const pricing = [
  { key: 'basic', tier: 'Basic', color: '#94a3b8', prices: { '1': 199, '6': 999, '12': 1499 } },
  { key: 'premium', tier: 'Premium', color: '#fe3c72', prices: { '1': 399, '6': 1999, '12': 2999 } },
];
const revenue = [{ month: 'окт', subscriptions: 100, ads: 50, boosts: 20 }];
const funnel = [
  { stage: 'Открыли приложение', count: 100 },
  { stage: 'Оформили подписку', count: 25 },
];
const ads = { google: true, yandex: true, googleId: 'ca-app-pub-1', yandexId: 'R-M-1' };

function mockAll(putStatus = 200) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return jsonResponse({}, putStatus);
    if (url === '/api/admin/monetization/pricing') return jsonResponse(pricing);
    if (url === '/api/admin/monetization/revenue') return jsonResponse(revenue);
    if (url === '/api/admin/monetization/funnel') return jsonResponse(funnel);
    if (url === '/api/admin/monetization/ads') return jsonResponse(ads);
    return jsonResponse({});
  });
}

async function renderLoaded() {
  render(<MonetizationPage />);
  await screen.findByText('admin.monetization.pricing_title');
}

describe('Страница admin-monetization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
  });

  it('пока грузится — спиннер, затем четыре GET с Bearer и все блоки настроек', async () => {
    mockAll();

    const { container } = render(<MonetizationPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('admin.monetization.pricing_title');
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(mockFetch.mock.calls.map((call) => call[0]).sort()).toEqual([
      '/api/admin/monetization/ads',
      '/api/admin/monetization/funnel',
      '/api/admin/monetization/pricing',
      '/api/admin/monetization/revenue',
    ]);
    for (const call of mockFetch.mock.calls) {
      expect(call[1]).toEqual({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' } });
    }
    expect(screen.getByText('Basic')).toBeInTheDocument();
    expect(screen.getByText('Premium')).toBeInTheDocument();
    expect(screen.getByText('admin.monetization.ad_blocks')).toBeInTheDocument();
    expect(screen.getByText('admin.monetization.monthly_revenue')).toBeInTheDocument();
    expect(screen.getByText('admin.monetization.conversion_funnel')).toBeInTheDocument();
  });

  it('тарифы: три периода у каждого уровня и цены из API', async () => {
    mockAll();
    await renderLoaded();

    expect(screen.getAllByText('1 units.month_short')).toHaveLength(2);
    expect(screen.getAllByText('6 units.month_short')).toHaveLength(2);
    expect(screen.getAllByText('12 units.month_short')).toHaveLength(2);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(6);
    expect(inputs[0]).toHaveValue(199);
    expect(inputs[2]).toHaveValue(1499);
    expect(inputs[3]).toHaveValue(399);
  });

  it('график дохода получает данные API, у столбцов — переведённые имена', async () => {
    mockAll();
    await renderLoaded();

    expect(screen.getByTestId('bar-chart').getAttribute('data-points')).toBe(JSON.stringify(revenue));
    expect(screen.getByTestId('bar-subscriptions')).toHaveTextContent('admin.monetization.subscriptions');
    expect(screen.getByTestId('bar-ads')).toHaveTextContent('admin.monetization.ads');
    expect(screen.getByTestId('bar-boosts')).toHaveTextContent('admin.monetization.boosts');
  });

  it('воронка конверсии: доля считается от первой ступени', async () => {
    mockAll();
    await renderLoaded();

    expect(screen.getByText('Открыли приложение')).toBeInTheDocument();
    expect(screen.getByText('100 (100%)')).toBeInTheDocument();
    expect(screen.getByText('Оформили подписку')).toBeInTheDocument();
    expect(screen.getByText('25 (25%)')).toBeInTheDocument();
  });

  it('правка цены и сохранение — PUT с обновлённым телом и тост prices_saved', async () => {
    mockAll();
    await renderLoaded();

    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '249' } });
    await userEvent.click(screen.getAllByRole('button', { name: 'admin.monetization.save' })[0]);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.monetization.prices_saved'));
    const put = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(put?.[0]).toBe('/api/admin/monetization/pricing');
    const body = JSON.parse(String(put?.[1].body));
    expect(body.tiers[0].prices['1']).toBe(249);
    expect(body.tiers[0].prices['12']).toBe(1499);
    expect(body.tiers[1].prices['1']).toBe(399);
  });

  it('отказ сохранения цен (500) — тост save_error', async () => {
    mockAll(500);
    await renderLoaded();

    await userEvent.click(screen.getAllByRole('button', { name: 'admin.monetization.save' })[0]);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.monetization.save_error'));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('адблоки: состояние приходит из API, выключение Google скрывает его Ad Unit ID', async () => {
    mockAll();
    await renderLoaded();

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    expect(screen.getByDisplayValue('ca-app-pub-1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('R-M-1')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(screen.queryByDisplayValue('ca-app-pub-1')).toBeNull());
    expect(screen.getByDisplayValue('R-M-1')).toBeInTheDocument();
  });

  it('сохранение рекламы — PUT с текущим конфигом и тост ads_saved', async () => {
    mockAll();
    await renderLoaded();

    await userEvent.click(screen.getAllByRole('button', { name: 'admin.monetization.save' })[1]);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('admin.monetization.ads_saved'));
    const put = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(put?.[0]).toBe('/api/admin/monetization/ads');
    expect(JSON.parse(String(put?.[1].body))).toEqual(ads);
  });

  it('отказ сохранения рекламы (500) — тост save_error', async () => {
    mockAll(500);
    await renderLoaded();

    await userEvent.click(screen.getAllByRole('button', { name: 'admin.monetization.save' })[1]);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('admin.monetization.save_error'));
  });

  it('отказ загрузки рекламы не роняет страницу — остаются дефолты', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/monetization/ads') return Promise.reject(new Error('ads down'));
      if (url === '/api/admin/monetization/pricing') return jsonResponse(pricing);
      if (url === '/api/admin/monetization/revenue') return jsonResponse(revenue);
      return jsonResponse(funnel);
    });
    await renderLoaded();

    expect(screen.getByText('Basic')).toBeInTheDocument();
    expect(screen.getByDisplayValue(DEFAULT_GOOGLE_ID)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('R-M-DEMO-rewarded')).toBeNull();
  });

  it('не-массивы вместо списков — пустые блоки, а не падение', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/monetization/ads') return Promise.reject(new Error('ads down'));
      return jsonResponse({ message: 'unexpected shape' });
    });
    await renderLoaded();

    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.getByText('admin.monetization.monthly_revenue')).toBeInTheDocument();
    expect(screen.getByText('admin.monetization.conversion_funnel')).toBeInTheDocument();
  });

  it('без токена запросы уходят только с Content-Type', async () => {
    h.token = null;
    mockAll();
    await renderLoaded();

    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: { 'Content-Type': 'application/json' } });
  });
});
