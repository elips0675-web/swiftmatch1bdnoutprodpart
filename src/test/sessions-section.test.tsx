import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionsSection } from '@/components/settings/sessions-section';

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        'sessions.title': 'Активные сессии',
        'sessions.desc': 'Устройства, с которых выполнен вход.',
        'sessions.current': 'Текущее устройство',
        'sessions.revoke': 'Отозвать',
        'sessions.revoke_all': 'Выйти со всех устройств',
        'sessions.revoke_confirm': 'Отозвать эту сессию?',
        'sessions.revoked': 'Сессия отозвана',
        'sessions.revoke_error': 'Не удалось отозвать сессию',
        'sessions.revoke_all_done': 'Все сессии отозваны',
        'sessions.empty': 'Активных сессий нет',
        'sessions.loading': 'Загрузка сессий…',
        'sessions.error': 'Не удалось загрузить сессии',
        'sessions.unknown_device': 'Неизвестное устройство',
        'sessions.retry': 'Повторить',
        'sessions.last_used': 'Активность',
      })[key] ?? key,
    language: 'RU',
    setLanguage: vi.fn(),
  }),
}));

const logout = vi.fn();
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ logout }),
}));

const apiGet = vi.fn();
const apiDelete = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const DESKTOP = {
  familyId: '11111111-1111-4111-8111-111111111111',
  current: true,
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0',
  createdAt: '2026-10-01 09:00:00',
  lastUsedAt: '2026-10-01 09:00:00',
  expiresAt: '2026-10-31 09:00:00',
};
const PHONE = {
  familyId: '22222222-2222-4222-8222-222222222222',
  current: false,
  ipAddress: '198.51.100.9',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1',
  createdAt: '2026-09-28 20:00:00',
  lastUsedAt: '2026-09-30 12:00:00',
  expiresAt: '2026-10-28 20:00:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('confirm', vi.fn(() => true));
  apiGet.mockResolvedValue({ sessions: [] });
});

describe('SessionsSection', () => {
  it('показывает заголовок и описание', async () => {
    render(<SessionsSection />);
    expect(screen.getByText('Активные сессии')).toBeInTheDocument();
    expect(screen.getByText('Устройства, с которых выполнен вход.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('sessions-loading')).not.toBeInTheDocument());
  });

  it('запрашивает список сессий', async () => {
    render(<SessionsSection />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/auth/sessions'));
  });

  it('помечает текущую сессию и не даёт на неё кнопку отзыва', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP, PHONE] });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(2));
    expect(screen.getByTestId('session-current')).toBeInTheDocument();
    // кнопка отзыва только у НЕтекущей сессии
    expect(screen.getAllByTestId('session-revoke')).toHaveLength(1);
  });

  it('подписывает устройство по user_agent', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP, PHONE] });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(2));
    const devices = screen.getAllByTestId('session-device').map((el) => el.textContent);
    expect(devices).toContain('Chrome · Windows');
    expect(devices).toContain('Safari · iOS');
  });

  it('показывает IP и дату активности', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP] });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('session-item')).toBeInTheDocument());
    expect(screen.getByText(/203\.0\.113\.7/)).toBeInTheDocument();
    expect(screen.getByText(/01\.10\.2026/)).toBeInTheDocument();
  });

  it('пустой список показывает заглушку, а не пустоту', async () => {
    apiGet.mockResolvedValue({ sessions: [] });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('sessions-empty')).toBeInTheDocument());
    expect(screen.getByText('Активных сессий нет')).toBeInTheDocument();
  });

  it('отзывает нетекущую сессию и убирает её из списка', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP, PHONE] });
    apiDelete.mockResolvedValue({ currentRevoked: false });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(2));
    fireEvent.click(screen.getByTestId('session-revoke'));

    await waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith(
        `/api/auth/sessions/${encodeURIComponent(PHONE.familyId)}`,
      ),
    );
    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(1));
    expect(logout).not.toHaveBeenCalled();
  });

  it('у текущей сессии нет кнопки отзыва — её глушит revoke-all', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP, PHONE] });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(2));
    expect(screen.getAllByTestId('session-revoke')).toHaveLength(1);
    expect(screen.getByTestId('sessions-revoke-all')).toBeInTheDocument();
  });

  // Клиент считает текущую сессию по fingerprint, сервер — по тому же хэшу,
  // но значения могут разойтись между двумя запросами (сменился IP, мобильная
  // сеть, прокси переподключился). Тогда UI показывает кнопку на «чужой» сессии,
  // а сервер отвечает currentRevoked: true — и клиент обязан разлогиниться,
  // иначе пользователь остался бы с мёртвым токеном и401 на каждом запросе.
  it('currentRevoked: true разлогинивает, даже если UI считал сессию чужой', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP, PHONE] });
    apiDelete.mockResolvedValue({ currentRevoked: true });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('session-revoke')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('session-revoke'));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    // сессия исчезает из списка только через разлогин, а не через локальный фильтр
    expect(screen.getAllByTestId('session-item')).toHaveLength(2);
  });

  it('кнопка «выйти со всех» скрыта, когда других устройств нет', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP] });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('session-item')).toBeInTheDocument());
    expect(screen.queryByTestId('sessions-revoke-all')).not.toBeInTheDocument();
  });

  it('revoke-all дергает logout-all и разлогинивает', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP, PHONE] });
    apiPost.mockResolvedValue({ message: 'All sessions revoked' });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('sessions-revoke-all')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('sessions-revoke-all'));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/auth/logout-all'));
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it('ошибка загрузки показывает сообщение и кнопку повтора', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('sessions-error')).toBeInTheDocument());
    expect(screen.getByText('Не удалось загрузить сессии')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-retry')).toBeInTheDocument();
  });

  it('повтор загружает сессии ещё раз', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('sessions-retry')).toBeInTheDocument());
    apiGet.mockResolvedValue({ sessions: [DESKTOP] });
    fireEvent.click(screen.getByTestId('sessions-retry'));

    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(1));
  });

  it('не показывает кнопку отзыва без подтверждения', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    apiGet.mockResolvedValue({ sessions: [DESKTOP, PHONE] });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('session-revoke')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('session-revoke'));

    expect(apiDelete).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('session-item')).toHaveLength(2);
  });

  it('ошибка отзыва не убирает сессию из списка', async () => {
    apiGet.mockResolvedValue({ sessions: [DESKTOP, PHONE] });
    apiDelete.mockRejectedValue(new Error('boom'));
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('session-revoke')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('session-revoke'));

    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(screen.getAllByTestId('session-item')).toHaveLength(2);
  });

  it('устройство без user_agent подписывается как неизвестное', async () => {
    apiGet.mockResolvedValue({
      sessions: [{ ...DESKTOP, current: false, userAgent: null, ipAddress: null }],
    });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getByTestId('session-device')).toBeInTheDocument());
    expect(screen.getByTestId('session-device').textContent).toBe('Неизвестное устройство');
  });

  it('Edge и Firefox распознаются', async () => {
    apiGet.mockResolvedValue({
      sessions: [
        {
          ...DESKTOP,
          current: true,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0',
        },
        { ...PHONE, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Firefox/133.0' },
      ],
    });
    render(<SessionsSection />);

    await waitFor(() => expect(screen.getAllByTestId('session-device')).toHaveLength(2));
    const devices = screen.getAllByTestId('session-device').map((el) => el.textContent);
    expect(devices).toContain('Edge · Windows');
    expect(devices).toContain('Firefox · Linux');
  });
});