import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const sp = vi.hoisted(() => ({
  push: vi.fn(),
  logout: vi.fn(),
  toast: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  sessionsSection: vi.fn(() => null),
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: sp.push, back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ logout: sp.logout }),
}));

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => null,
}));

vi.mock('@/components/settings/notification-preferences-section', () => ({
  NotificationPreferencesSection: () => null,
}));

vi.mock('@/components/settings/sessions-section', () => ({
  SessionsSection: sp.sessionsSection,
}));

vi.mock('@/lib/push-notifications', () => ({
  subscribeToPush: sp.subscribeToPush,
  unsubscribeFromPush: sp.unsubscribeFromPush,
}));

vi.mock('@/lib/token', () => ({
  getToken: () => 'test-token',
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: sp.toast,
  useToast: () => ({ toast: sp.toast, toasts: [] }),
}));

import SettingsPage from '@/pages/settings';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

function renderPage() {
  return render(<SettingsPage />);
}

async function rendered() {
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/settings/privacy', {
    headers: { Authorization: 'Bearer test-token' },
  }));
}

describe('Страница settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    localStorage.clear();
    sp.subscribeToPush.mockResolvedValue(true);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('на монтировании читает приватность с токеном и рисует переключатели', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: false }));

    renderPage();
    await rendered();

    expect(screen.getByTestId('switch-push-notifications')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByTestId('switch-incognito')).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByTestId('switch-data-consent')).toHaveAttribute('data-state', 'checked');
  });

  it('инкогнито из ответа применяется и пишется в localStorage', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: true }));

    renderPage();
    await rendered();

    await waitFor(() => expect(screen.getByTestId('switch-incognito')).toHaveAttribute('data-state', 'checked'));
    expect(localStorage.getItem('incognito-mode')).toBe('true');
  });

  it('при сбое запроса инкогнито берётся из localStorage', async () => {
    localStorage.setItem('incognito-mode', 'true');
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

    renderPage();

    await waitFor(() => expect(screen.getByTestId('switch-incognito')).toHaveAttribute('data-state', 'checked'));
  });

  it('выключение пуш-уведомлений снимает подписку', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: false }));

    renderPage();
    await rendered();

    fireEvent.click(screen.getByTestId('switch-push-notifications'));

    await waitFor(() => expect(sp.unsubscribeFromPush).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('switch-push-notifications')).toHaveAttribute('data-state', 'unchecked');
  });

  it('отказ в подписке даёт destructive-тост и не включает переключатель', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: false }));
    sp.subscribeToPush.mockResolvedValue(false);

    renderPage();
    await rendered();

    fireEvent.click(screen.getByTestId('switch-push-notifications'));
    await waitFor(() => expect(sp.unsubscribeFromPush).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('switch-push-notifications'));

    await waitFor(() => expect(sp.toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'settings.push_denied_title',
      description: 'settings.push_denied_desc',
    }));
    expect(screen.getByTestId('switch-push-notifications')).toHaveAttribute('data-state', 'unchecked');
  });

  it('инкогнито сохраняется на сервере, в localStorage и тостом', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/settings/privacy' && init?.method === 'PUT'
        ? jsonResponse({})
        : jsonResponse({ incognito: false }),
    );

    renderPage();
    await rendered();

    fireEvent.click(screen.getByTestId('switch-incognito'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/settings/privacy', expect.objectContaining({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ incognito: true }),
    })));
    expect(localStorage.getItem('incognito-mode')).toBe('true');
    expect(sp.toast).toHaveBeenCalledWith({
      title: 'settings.incognito',
      description: 'settings.incognito.enabled_desc',
    });
  });

  it('отзыв согласия на обработку данных уходит на /api/consent', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: false }));

    renderPage();
    await rendered();

    fireEvent.click(screen.getByTestId('switch-data-consent'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/consent', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ consent_type: 'data_processing', granted: false }),
    })));
    expect(localStorage.getItem('data-processing-consent')).toBe('false');
    expect(sp.toast).toHaveBeenCalledWith({
      title: 'settings.data_consent',
      description: 'settings.consent_withdrawn',
    });
  });

  it('раздел сессий раскрывается по кнопке', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: false }));

    renderPage();
    await rendered();

    expect(sp.sessionsSection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('sessions-toggle'));

    expect(sp.sessionsSection).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sessions-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('юридические пункты и раздел безопасности уводят на свои страницы', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: false }));

    renderPage();
    await rendered();

    fireEvent.click(screen.getByText('settings.privacy_policy'));
    expect(sp.push).toHaveBeenCalledWith('/legal/privacy');

    fireEvent.click(screen.getByText('settings.terms_of_service'));
    expect(sp.push).toHaveBeenCalledWith('/legal/terms');

    fireEvent.click(screen.getAllByText('settings.about_app')[1]);
    expect(sp.push).toHaveBeenCalledWith('/about');

    fireEvent.click(screen.getByTestId('safety-link'));
    expect(sp.push).toHaveBeenCalledWith('/safety');
  });

  it('выход вычищает локальные ключи и уводит на вход', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: false }));
    localStorage.setItem('authToken', 'x');
    localStorage.setItem('userProfile', '{}');
    localStorage.setItem('userProfileGallery', '[]');
    localStorage.setItem('incognito-mode', 'true');
    localStorage.setItem('swiftchat_state', 'stale');
    localStorage.setItem('unrelated', 'keep');

    renderPage();
    await rendered();

    fireEvent.click(screen.getByTestId('logout-button'));

    expect(sp.logout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('userProfile')).toBeNull();
    expect(localStorage.getItem('userProfileGallery')).toBeNull();
    expect(localStorage.getItem('incognito-mode')).toBeNull();
    expect(localStorage.getItem('swiftchat_state')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
    expect(sp.toast).toHaveBeenCalledWith({ title: 'logout.title' });
    expect(sp.push).toHaveBeenCalledWith('/login');
  });

  it('отказ от подтверждения не удаляет аккаунт', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ incognito: false }));
    vi.stubGlobal('confirm', vi.fn(() => false));

    renderPage();
    await rendered();

    fireEvent.click(screen.getByTestId('delete-account-button'));

    expect(mockFetch.mock.calls.filter((c) => c[1]?.method === 'DELETE')).toHaveLength(0);
    expect(sp.logout).not.toHaveBeenCalled();
    expect(sp.toast).not.toHaveBeenCalledWith({ title: 'delete_profile.done' });
  });

  it('подтверждённое удаление: DELETE с токеном, тост и выход', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/profile/me' && init?.method === 'DELETE'
        ? jsonResponse({})
        : jsonResponse({ incognito: false }),
    );

    renderPage();
    await rendered();

    fireEvent.click(screen.getByTestId('delete-account-button'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/profile/me', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-token' },
    }));
    expect(sp.toast).toHaveBeenCalledWith({ title: 'delete_profile.done' });
    expect(sp.logout).toHaveBeenCalledTimes(1);
  });
});
