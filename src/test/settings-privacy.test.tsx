import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPrivacy from '@/pages/settings-privacy';

const flags = vi.hoisted(() => ({ value: { partnerOffersEnabled: false, activityPrivacyEnabled: true } }));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'ru', setLanguage: vi.fn() }),
}));

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => flags.value,
}));

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/token', () => ({
  getToken: () => 'test-token',
}));

const jsonRes = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as unknown as Response;

describe('SettingsPrivacy — приватность статуса активности', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.value = { partnerOffersEnabled: false, activityPrivacyEnabled: true };
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({
          incognito: false,
          passport_mode: false,
          passport_city: '',
          show_online: false,
          show_last_seen: true,
        });
      }
      return jsonRes({});
    }) as unknown as typeof fetch;
  });

  it('рисует оба переключателя из настроек сервера', async () => {
    render(<SettingsPrivacy />);

    await waitFor(() => {
      expect(screen.getByTestId('switch-show-online')).toHaveAttribute('data-state', 'unchecked');
    });
    expect(screen.getByTestId('switch-show-last-seen')).toHaveAttribute('data-state', 'checked');
  });

  it('включение «показывать, что я в сети» отправляет PUT с show_online', async () => {
    render(<SettingsPrivacy />);

    await waitFor(() => {
      expect(screen.getByTestId('switch-show-online')).toHaveAttribute('data-state', 'unchecked');
    });

    fireEvent.click(screen.getByTestId('switch-show-online'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings/privacy',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ show_online: true }),
        }),
      );
    });
  });

  it('выключение «показывать последнее посещение» отправляет PUT с show_last_seen', async () => {
    render(<SettingsPrivacy />);

    await waitFor(() => {
      expect(screen.getByTestId('switch-show-last-seen')).toHaveAttribute('data-state', 'checked');
    });

    fireEvent.click(screen.getByTestId('switch-show-last-seen'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings/privacy',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ show_last_seen: false }),
        }),
      );
    });
  });

  it('при выключенном флаге activityPrivacyEnabled переключателей нет', async () => {
    flags.value = { partnerOffersEnabled: false, activityPrivacyEnabled: false };

    render(<SettingsPrivacy />);

    await waitFor(() => {
      expect(screen.getByTestId('switch-incognito')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('switch-show-online')).not.toBeInTheDocument();
    expect(screen.queryByTestId('switch-show-last-seen')).not.toBeInTheDocument();
  });
});
