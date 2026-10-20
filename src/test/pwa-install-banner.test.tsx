import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  t: (key: string) => key,
}));

vi.mock('@/hooks/use-toast', () => ({ toast: (arg: unknown) => h.toast(arg) }));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: () => {} }),
}));

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...rest }: { children?: React.ReactNode }) => <div {...rest}>{children}</div> },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { PwaInstallBanner } from '@/components/shared/pwa-install-banner';
import { CookieConsent } from '@/components/shared/cookie-consent';

const DISMISS_KEY = 'pwa-install-dismissed';
const CONSENT_KEY = 'cookie-consent';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function setStandalone(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('standalone') ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}

function installPromptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn();
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  vi.clearAllMocks();
  user = userEvent.setup({ delay: null });
  localStorage.clear();
  sessionStorage.clear();
  setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  setStandalone(false);
});

afterEach(() => {
  vi.useRealTimers();
});

function withFakeTimers() {
  vi.useFakeTimers();
}

function showBanner() {
  localStorage.setItem(CONSENT_KEY, 'true');
  render(<PwaInstallBanner />);
  act(() => { vi.advanceTimersByTime(2000); });
}

async function showBannerRealTimers() {
  localStorage.setItem(CONSENT_KEY, 'true');
  render(<PwaInstallBanner />);
  await screen.findByText('pwa.install.title', {}, { timeout: 5000 });
}

describe('PwaInstallBanner', () => {
  it('shows the banner after 2s when the cookie consent is already stored', () => {
    withFakeTimers();
    localStorage.setItem(CONSENT_KEY, 'true');
    render(<PwaInstallBanner />);
    expect(screen.queryByText('pwa.install.title')).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('pwa.install.title')).toBeTruthy();
  });

  it('waits 4s on iOS because there is no install prompt', () => {
    withFakeTimers();
    localStorage.setItem(CONSENT_KEY, 'true');
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    render(<PwaInstallBanner />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText('pwa.install.title')).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('pwa.install.title')).toBeTruthy();
  });

  it('waits for the cookie-consent-accepted event when no consent is stored', () => {
    withFakeTimers();
    render(<PwaInstallBanner />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText('pwa.install.title')).toBeNull();
    act(() => { window.dispatchEvent(new Event('cookie-consent-accepted')); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('pwa.install.title')).toBeTruthy();
  });

  it('renders nothing in standalone mode', () => {
    withFakeTimers();
    localStorage.setItem(CONSENT_KEY, 'true');
    setStandalone(true);
    const { container } = render(<PwaInstallBanner />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.textContent).toBe('');
  });

  it('does not show again after a dismissal', () => {
    withFakeTimers();
    localStorage.setItem(CONSENT_KEY, 'true');
    sessionStorage.setItem(DISMISS_KEY, 'true');
    render(<PwaInstallBanner />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText('pwa.install.title')).toBeNull();
  });

  it('clears the pending timer on unmount when the consent is already stored', () => {
    withFakeTimers();
    localStorage.setItem(CONSENT_KEY, 'true');
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<PwaInstallBanner />);
    unmount();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('clears the pending timer on unmount when waiting for the consent event', () => {
    withFakeTimers();
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<PwaInstallBanner />);
    act(() => { window.dispatchEvent(new Event('cookie-consent-accepted')); });
    unmount();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not show the banner in standalone mode when the consent event fires', () => {
    withFakeTimers();
    setStandalone(true);
    const { container } = render(<PwaInstallBanner />);
    act(() => { window.dispatchEvent(new Event('cookie-consent-accepted')); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.textContent).toBe('');
  });

  it('does not show the banner after a dismissal when the consent event fires', () => {
    withFakeTimers();
    sessionStorage.setItem(DISMISS_KEY, 'true');
    render(<PwaInstallBanner />);
    act(() => { window.dispatchEvent(new Event('cookie-consent-accepted')); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText('pwa.install.title')).toBeNull();
  });

  it('uses the deferred install prompt and toasts after the user accepts', async () => {
    await showBannerRealTimers();
    const prompt = installPromptEvent('accepted');
    await act(async () => { window.dispatchEvent(prompt); });
    await user.click(screen.getByText('pwa.install.button'));
    expect(prompt.prompt).toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith({ title: 'pwa.install.success' });
    expect(screen.queryByText('pwa.install.title')).toBeNull();
  });

  it('keeps the banner visible when the user dismisses the native prompt', async () => {
    await showBannerRealTimers();
    const prompt = installPromptEvent('dismissed');
    await act(async () => { window.dispatchEvent(prompt); });
    await user.click(screen.getByText('pwa.install.button'));
    expect(h.toast).not.toHaveBeenCalled();
    expect(screen.getByText('pwa.install.title')).toBeTruthy();
  });

  it('falls back to the manual guide when there is no install prompt', async () => {
    await showBannerRealTimers();
    await user.click(screen.getByText('pwa.install.guide_button'));
    expect(screen.getByText(/pwa.install.menu_open/)).toBeTruthy();
    expect(screen.getByText(/pwa.install.menu_install/)).toBeTruthy();
    expect(screen.getByText(/pwa.install.address_bar_install/)).toBeTruthy();
  });

  it('toggles the guide closed on a second click', async () => {
    await showBannerRealTimers();
    const guideButton = screen.getByText('pwa.install.guide_button');
    await user.click(guideButton);
    expect(screen.getByText(/pwa.install.menu_open/)).toBeTruthy();
    await user.click(guideButton);
    expect(screen.queryByText(/pwa.install.menu_open/)).toBeNull();
  });

  it('records the dismissal and hides the banner', async () => {
    await showBannerRealTimers();
    await user.click(screen.getByText('pwa.install.cancel'));
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe('true');
    expect(screen.queryByText('pwa.install.title')).toBeNull();
  });
});

describe('CookieConsent', () => {
  it('shows the banner after 2s when no consent is stored', () => {
    withFakeTimers();
    render(<CookieConsent />);
    expect(screen.queryByText('cookie.title')).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('cookie.title')).toBeTruthy();
  });

  it('stays hidden when the consent is already stored', () => {
    withFakeTimers();
    localStorage.setItem(CONSENT_KEY, 'true');
    render(<CookieConsent />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText('cookie.title')).toBeNull();
  });

  it('stores the consent, hides itself and notifies listeners on accept', async () => {
    vi.useRealTimers();
    user = userEvent.setup({ delay: null });
    render(<CookieConsent />);
    await screen.findByText('cookie.title', {}, { timeout: 5000 });
    const notify = vi.fn();
    window.addEventListener('cookie-consent-accepted', notify);
    await user.click(screen.getByText('cookie.accept_all'));
    expect(localStorage.getItem(CONSENT_KEY)).toBe('true');
    expect(notify).toHaveBeenCalled();
    expect(screen.queryByText('cookie.title')).toBeNull();
    window.removeEventListener('cookie-consent-accepted', notify);
  });

  it('closes without storing the consent when the X is clicked', async () => {
    vi.useRealTimers();
    user = userEvent.setup({ delay: null });
    render(<CookieConsent />);
    await screen.findByText('cookie.title', {}, { timeout: 5000 });
    const closeButton = document.querySelector('button:not([class*="gradient-bg"])');
    await user.click(closeButton as Element);
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(screen.queryByText('cookie.title')).toBeNull();
  });
});
