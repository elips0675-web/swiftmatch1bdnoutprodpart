import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TwoFaSettings from '@/components/admin/two-fa-settings';

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
      })[key] ?? key,
    language: 'RU',
    setLanguage: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/token', () => ({
  getToken: () => 'test-token',
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') },
}));

describe('TwoFaSettings', () => {
  const setupResponse = { otpauthUrl: 'otpauth://totp/SwiftMatch%20Admin:admin@mail.ru?secret=ABC123&issuer=SwiftMatch%20Admin', secret: 'ABC123' };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/auth/2fa/setup') {
        return { status: 200, json: async () => setupResponse } as Response;
      }
      if (url === '/api/auth/2fa/enable') {
        return { status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { status: 404, json: async () => ({}) } as Response;
    });
  });

  it('setups and renders scannable QR code', async () => {
    render(<TwoFaSettings />);
    fireEvent.click(screen.getByText('Настроить 2FA'));

    await waitFor(() => {
      expect(screen.getByTestId('two-fa-qr')).toBeInTheDocument();
    });

    const img = screen.getByTestId('two-fa-qr') as HTMLImageElement;
    expect(img.src).toContain('data:image/png;base64');
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByText(setupResponse.otpauthUrl)).toBeInTheDocument();
  });

  it('enables 2FA after entering code', async () => {
    render(<TwoFaSettings />);
    fireEvent.click(screen.getByText('Настроить 2FA'));
    await waitFor(() => expect(screen.getByTestId('two-fa-qr')).toBeInTheDocument());

    const codeInput = screen.getByPlaceholderText('6-значный код');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Включить 2FA'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/2fa/enable',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
