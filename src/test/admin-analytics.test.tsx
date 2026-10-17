import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const h = vi.hoisted(() => ({
  token: 'test-token' as string | null,
}));

vi.mock('@/lib/token', () => ({ getToken: () => h.token }));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="responsive">{children}</div>,
  AreaChart: ({ data }: { data?: unknown }) => <div data-testid="area-chart" data-points={JSON.stringify(data)} />,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  PieChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ data }: { data?: unknown }) => <div data-testid="pie" data-points={JSON.stringify(data)} />,
  Cell: () => null,
}));

import AdminAnalyticsPage from '@/pages/admin-analytics';

const overview = { mau: '12 480', conversionRate: '3.4%', arpu: '890 ₽' };
const retention = [
  { day: 'D1', rate: 42 },
  { day: 'D7', rate: 21 },
];
const revenueMix = [
  { name: 'Подписки', value: 70, color: '#fe3c72' },
  { name: 'B2B', value: 30, color: '#3b82f6' },
];
const registrations = [
  { day: '10.10', users: 120 },
  { day: '11.10', users: 150 },
];

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

function mockAll() {
  mockFetch.mockImplementation((url: string) => {
    if (url === '/api/admin/analytics/overview') return jsonResponse(overview);
    if (url === '/api/admin/analytics/retention') return jsonResponse(retention);
    if (url === '/api/admin/analytics/revenue-mix') return jsonResponse(revenueMix);
    if (url === '/api/admin/analytics/registrations') return jsonResponse(registrations);
    return jsonResponse({});
  });
}

describe('Страница admin-analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    h.token = 'test-token';
  });

  it('пока грузится — спиннер, затем четыре запроса с Bearer и три метрики', async () => {
    mockAll();

    const { container } = render(<AdminAnalyticsPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    await screen.findByText('12 480');
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(mockFetch.mock.calls.map((call) => call[0]).sort()).toEqual([
      '/api/admin/analytics/overview',
      '/api/admin/analytics/registrations',
      '/api/admin/analytics/retention',
      '/api/admin/analytics/revenue-mix',
    ]);
    for (const call of mockFetch.mock.calls) {
      expect(call[1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
    }
    expect(screen.getByText('3.4%')).toBeInTheDocument();
    expect(screen.getByText('890 ₽')).toBeInTheDocument();
    expect(screen.getByText('MAU')).toBeInTheDocument();
    expect(screen.getByText('Conversion')).toBeInTheDocument();
    expect(screen.getByText('ARPU')).toBeInTheDocument();
  });

  it('без токена запросы уходят без Authorization', async () => {
    h.token = null;
    mockAll();
    render(<AdminAnalyticsPage />);

    await screen.findByText('12 480');
    expect(mockFetch.mock.calls[0][1]).toEqual({ headers: {} });
  });

  it('отказ одного из четырёх запросов — прочерки вместо значений, страница не пустая', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/analytics/retention') return jsonResponse({ message: 'boom' }, 500);
      if (url === '/api/admin/analytics/overview') return jsonResponse(overview);
      if (url === '/api/admin/analytics/revenue-mix') return jsonResponse(revenueMix);
      return jsonResponse(registrations);
    });

    render(<AdminAnalyticsPage />);

    await screen.findByText('Аналитика и Метрики');
    expect(screen.queryByText('12 480')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('сетевой сбой всех запросов — прочерки вместо падения страницы', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));

    render(<AdminAnalyticsPage />);

    await screen.findByText('Аналитика и Метрики');
    expect(screen.getByText('MAU')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('данные ретеншена и регистраций доходят до чартов', async () => {
    mockAll();
    render(<AdminAnalyticsPage />);
    await screen.findByText('12 480');

    const points = screen.getAllByTestId('area-chart').map((node) => node.getAttribute('data-points'));
    expect(points).toContain(JSON.stringify(retention));
    expect(points).toContain(JSON.stringify(registrations));
  });

  it('состав выручки: имена категорий, проценты и цвет в легенде', async () => {
    mockAll();
    render(<AdminAnalyticsPage />);
    await screen.findByText('12 480');

    expect(screen.getByText('Подписки')).toBeInTheDocument();
    expect(screen.getByText('B2B')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    const pie = screen.getByTestId('pie');
    expect(pie.getAttribute('data-points')).toBe(JSON.stringify(revenueMix));
  });

  it('блок технического состояния рендерится и не берёт данные из API', async () => {
    mockAll();
    render(<AdminAnalyticsPage />);
    await screen.findByText('12 480');

    expect(screen.getByText('Technical Health')).toBeInTheDocument();
    expect(screen.getByText('API Status')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Live DB')).toBeInTheDocument();
    expect(mockFetch.mock.calls.every((call) => String(call[0]).includes('/api/admin/analytics/'))).toBe(true);
  });
});
