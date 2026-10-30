import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TwoFaSettings from '@/components/admin/two-fa-settings';
import { getToken } from '@/lib/token';
import QRCode from 'qrcode';

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        two_fa_title: 'Двухфакторная аутентификация',
        two_fa_hint: 'hint',
        two_fa_setup: 'Настроить 2FA',
        two_fa_scan_qr: 'Отсканируйте QR-код',
        two_fa_manual_key: 'Ключ для ручного ввода',
        two_fa_code_placeholder: '6-значный код',
        two_fa_enable: 'Включить 2FA',
        two_fa_disable: 'Отключить 2FA',
        two_fa_disable_hint: 'hint',
        two_fa_enabled: '2FA включена',
        two_fa_disabled: '2FA отключена',
        two_fa_invalid_code: 'Неверный код',
        two_fa_scan_or_key: 'Добавьте по ссылке или ключу',
        two_fa_already_enabled: '2FA уже включена, сначала отключите текущим кодом',
        two_fa_setup_required: 'Сначала начните настройку 2FA',
        two_fa_code_required: 'Введите код из приложения',
        two_fa_not_enabled: '2FA не включена',
        two_fa_error_generic: 'Не удалось выполнить запрос',
        two_fa_status_error: 'Не удалось получить состояние 2FA',
        two_fa_retry: 'Повторить',
      })[key] ?? key,
    language: 'RU',
    setLanguage: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/token', () => ({
  getToken: vi.fn(() => 'test-token'),
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') },
}));

type RouteResult = { status: number; body: unknown } | 'reject';

describe('TwoFaSettings', () => {
  const setupResponse = {
    otpauthUrl: 'otpauth://totp/SwiftMatch%20Admin:admin@mail.ru?secret=ABC123&issuer=SwiftMatch%20Admin',
    secret: 'ABC123',
  };
  const routes: Record<string, RouteResult> = {};

  const setRoute = (url: string, result: RouteResult) => {
    routes[url] = result;
  };

  const fetchMock = () => global.fetch as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getToken).mockReturnValue('test-token');
    Object.keys(routes).forEach((key) => delete routes[key]);
    setRoute('/api/auth/2fa/status', { status: 200, body: { enabled: false } });
    setRoute('/api/auth/2fa/setup', { status: 200, body: setupResponse });
    setRoute('/api/auth/2fa/enable', { status: 200, body: { ok: true } });
    setRoute('/api/auth/2fa/disable', { status: 200, body: { ok: true } });
    global.fetch = vi.fn(async (url: string) => {
      const result = routes[url] ?? { status: 404, body: {} };
      if (result === 'reject') throw new Error('network down');
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.body,
      } as Response;
    }) as unknown as typeof fetch;
  });

  const renderWithSetup = async () => {
    render(<TwoFaSettings />);
    await waitFor(() => expect(screen.getByText('Настроить 2FA')).toBeInTheDocument());
  };

  const openSetup = async () => {
    await renderWithSetup();
    fireEvent.click(screen.getByText('Настроить 2FA'));
    await waitFor(() => expect(screen.getByTestId('two-fa-qr')).toBeInTheDocument());
  };

  it('читает состояние с сервера и показывает выключенную 2FA с Bearer-токеном', async () => {
    await renderWithSetup();
    expect(screen.getByText('OFF')).toBeInTheDocument();
    expect(fetchMock()).toHaveBeenCalledWith(
      '/api/auth/2fa/status',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
  });

  it('включённая 2FA с сервера показывает ON и форму отключения, а не настройку', async () => {
    setRoute('/api/auth/2fa/status', { status: 200, body: { enabled: true } });
    render(<TwoFaSettings />);
    await waitFor(() => expect(screen.getByText('Отключить 2FA')).toBeInTheDocument());
    expect(screen.getByText('ON')).toBeInTheDocument();
    expect(screen.queryByText('Настроить 2FA')).not.toBeInTheDocument();
  });

  it('ошибка сети при чтении состояния: русский текст, без формы настройки, повтор запроса работает', async () => {
    setRoute('/api/auth/2fa/status', 'reject');
    render(<TwoFaSettings />);
    await waitFor(() => expect(screen.getByText('Не удалось получить состояние 2FA')).toBeInTheDocument());
    expect(screen.queryByText('Настроить 2FA')).not.toBeInTheDocument();

    setRoute('/api/auth/2fa/status', { status: 200, body: { enabled: true } });
    fireEvent.click(screen.getByText('Повторить'));
    await waitFor(() => expect(screen.getByText('Отключить 2FA')).toBeInTheDocument());
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('не-200 ответ статуса (401) трактуется как недоступное состояние, а не как «выключено»', async () => {
    setRoute('/api/auth/2fa/status', { status: 401, body: { message: 'Unauthorized' } });
    render(<TwoFaSettings />);
    await waitFor(() => expect(screen.getByTestId('two-fa-retry')).toBeInTheDocument());
    expect(screen.queryByText('Настроить 2FA')).not.toBeInTheDocument();
  });

  it('настройка: показывает QR, секрет и otpauth-ссылку', async () => {
    await openSetup();
    const img = screen.getByTestId('two-fa-qr') as HTMLImageElement;
    expect(img.src).toContain('data:image/png;base64');
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByText(setupResponse.otpauthUrl)).toBeInTheDocument();
  });

  it('настройка: сбой генерации QR не ломает экран и показывает ручной ключ', async () => {
    vi.mocked(QRCode.toDataURL).mockRejectedValueOnce(new Error('canvas'));
    await renderWithSetup();
    fireEvent.click(screen.getByText('Настроить 2FA'));
    await waitFor(() => expect(screen.getByText('Добавьте по ссылке или ключу:')).toBeInTheDocument());
    expect(screen.queryByTestId('two-fa-qr')).not.toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
  });

  it('настройка при уже включённой 2FA: 409 переключает бейдж в ON и не показывает сырой код ошибки', async () => {
    setRoute('/api/auth/2fa/setup', { status: 409, body: { message: 'ALREADY_ENABLED' } });
    await renderWithSetup();
    fireEvent.click(screen.getByText('Настроить 2FA'));
    await waitFor(() =>
      expect(screen.getByText('2FA уже включена, сначала отключите текущим кодом')).toBeInTheDocument(),
    );
    expect(screen.getByText('ON')).toBeInTheDocument();
    expect(screen.queryByText('ALREADY_ENABLED')).not.toBeInTheDocument();
    expect(screen.queryByTestId('two-fa-qr')).not.toBeInTheDocument();
  });

  it('настройка: серверная ошибка 500 показывается по-русски, а не английским message', async () => {
    setRoute('/api/auth/2fa/setup', { status: 500, body: { message: 'Internal server error' } });
    await renderWithSetup();
    fireEvent.click(screen.getByText('Настроить 2FA'));
    await waitFor(() => expect(screen.getByText('Не удалось выполнить запрос')).toBeInTheDocument());
    expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
  });

  it('включение: кнопка заблокирована до шести цифр, нецифры отбрасываются', async () => {
    await openSetup();
    const input = screen.getByPlaceholderText('6-значный код');
    const enableButton = screen.getByText('Включить 2FA').closest('button');
    expect(enableButton).toBeDisabled();

    fireEvent.change(input, { target: { value: '12ab34' } });
    expect((input as HTMLInputElement).value).toBe('1234');
    expect(enableButton).toBeDisabled();

    fireEvent.change(input, { target: { value: '123456' } });
    expect(enableButton).not.toBeDisabled();
  });

  it('включение: успешный код отправляет его на сервер и показывает ON', async () => {
    await openSetup();
    fireEvent.change(screen.getByPlaceholderText('6-значный код'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Включить 2FA'));

    await waitFor(() => expect(screen.getByText('2FA включена')).toBeInTheDocument());
    expect(screen.getByText('ON')).toBeInTheDocument();
    expect(fetchMock()).toHaveBeenCalledWith(
      '/api/auth/2fa/enable',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: '123456' }) }),
    );
  });

  it('включение: TOTP_INVALID переводится в русский текст', async () => {
    setRoute('/api/auth/2fa/enable', { status: 400, body: { message: 'TOTP_INVALID' } });
    await openSetup();
    fireEvent.change(screen.getByPlaceholderText('6-значный код'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Включить 2FA'));
    await waitFor(() => expect(screen.getByText('Неверный код')).toBeInTheDocument());
    expect(screen.queryByText('TOTP_INVALID')).not.toBeInTheDocument();
  });

  it('включение: SETUP_REQUIRED переводится в русский текст', async () => {
    setRoute('/api/auth/2fa/enable', { status: 400, body: { message: 'SETUP_REQUIRED' } });
    await openSetup();
    fireEvent.change(screen.getByPlaceholderText('6-значный код'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Включить 2FA'));
    await waitFor(() => expect(screen.getByText('Сначала начните настройку 2FA')).toBeInTheDocument());
  });

  it('отключение: успешный код показывает OFF и сбрасывает поле', async () => {
    setRoute('/api/auth/2fa/status', { status: 200, body: { enabled: true } });
    render(<TwoFaSettings />);
    await waitFor(() => expect(screen.getByText('Отключить 2FA')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('6-значный код');
    fireEvent.change(input, { target: { value: '654321' } });
    fireEvent.click(screen.getByText('Отключить 2FA'));

    await waitFor(() => expect(screen.getByText('2FA отключена')).toBeInTheDocument());
    expect(screen.getByText('OFF')).toBeInTheDocument();
    expect(screen.getByText('Настроить 2FA')).toBeInTheDocument();
  });

  it('отключение: TOTP_INVALID и NOT_ENABLED переводятся в русский текст', async () => {
    setRoute('/api/auth/2fa/status', { status: 200, body: { enabled: true } });
    setRoute('/api/auth/2fa/disable', { status: 400, body: { message: 'TOTP_INVALID' } });
    render(<TwoFaSettings />);
    await waitFor(() => expect(screen.getByText('Отключить 2FA')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('6-значный код'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Отключить 2FA'));
    await waitFor(() => expect(screen.getByText('Неверный код')).toBeInTheDocument());

    setRoute('/api/auth/2fa/disable', { status: 400, body: { message: 'NOT_ENABLED' } });
    fireEvent.change(screen.getByPlaceholderText('6-значный код'), { target: { value: '111111' } });
    fireEvent.click(screen.getByText('Отключить 2FA'));
    await waitFor(() => expect(screen.getByText('2FA не включена')).toBeInTheDocument());
  });

  it('без токена запросы идут без заголовка Authorization', async () => {
    vi.mocked(getToken).mockReturnValue(null);
    await renderWithSetup();
    expect(fetchMock()).toHaveBeenCalledWith('/api/auth/2fa/status', expect.objectContaining({ headers: {} }));
    fireEvent.click(screen.getByText('Настроить 2FA'));
    await waitFor(() => expect(screen.getByTestId('two-fa-qr')).toBeInTheDocument());
    expect(fetchMock()).toHaveBeenCalledWith(
      '/api/auth/2fa/setup',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
  });
});
