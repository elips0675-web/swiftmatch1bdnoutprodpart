import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import SettingsPrivacy from '@/pages/settings-privacy';

const flags = vi.hoisted(() => ({ value: { partnerOffersEnabled: false, activityPrivacyEnabled: true } }));
const tok = vi.hoisted(() => ({ value: 'test-token' as string | null }));
const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }));
const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'ru', setLanguage: vi.fn() }),
}));

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => flags.value,
}));

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => nav,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/token', () => ({
  getToken: () => tok.value,
}));

vi.mock('@/components/chat/hotel-booking-dialog', () => ({
  HotelBookingDialog: ({ offer, onOpenChange }: { offer: { title: string }; onOpenChange: (open: boolean) => void }) => (
    <div data-testid="hotel-booking-dialog">
      {offer.title}
      <button data-testid="hotel-close" onClick={() => onOpenChange(false)}>close</button>
    </div>
  ),
}));

const jsonRes = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as unknown as Response;

describe('SettingsPrivacy — приватность статуса активности', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.value = { partnerOffersEnabled: false, activityPrivacyEnabled: true };
    tok.value = 'test-token';
    nav.back.mockClear();
    nav.push.mockClear();
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

describe('SettingsPrivacy: фолбэки сервера, passport_mode и отели', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.value = { partnerOffersEnabled: false, activityPrivacyEnabled: true };
    tok.value = 'test-token';
    nav.back.mockClear();
    nav.push.mockClear();
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

  it('отсутствующие у сервера show_online и show_last_seen дефолтятся в true', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: false, passport_city: '' });
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => {
      expect(screen.getByTestId('switch-show-online')).toHaveAttribute('data-state', 'checked');
      expect(screen.getByTestId('switch-show-last-seen')).toHaveAttribute('data-state', 'checked');
    });
  });

  it('passport_mode: включение рисует поле города, выключение шлёт passport_city: null', async () => {
    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-passport-mode')).toBeInTheDocument());
    expect(screen.queryByTestId('passport-city')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('switch-passport-mode'));

    await waitFor(() => expect(screen.getByTestId('passport-city')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/settings/privacy',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ passport_mode: true, passport_city: '' }) }),
    );

    fireEvent.click(screen.getByTestId('switch-passport-mode'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings/privacy',
        expect.objectContaining({ body: JSON.stringify({ passport_mode: false, passport_city: null }) }),
      ),
    );
    expect(screen.queryByTestId('passport-city')).not.toBeInTheDocument();
  });

  it('с включённым passport_mode и пустым городом отели не запрашиваются', async () => {
    flags.value = { partnerOffersEnabled: true, activityPrivacyEnabled: true };
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: true, passport_city: '' });
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('passport-city')).toHaveValue(''));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('passport_mode выключен при включённом флаге — hotel-эффект в поке', async () => {
    flags.value = { partnerOffersEnabled: true, activityPrivacyEnabled: true };

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-passport-mode')).toBeInTheDocument());
    expect(screen.queryByTestId('passport-city')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('город без токена: карточки отелей приходят без Bearer и открывают диалог брони', async () => {
    tok.value = null;
    flags.value = { partnerOffersEnabled: true, activityPrivacyEnabled: true };
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: true, passport_city: 'Сочи' });
      }
      if (String(url).startsWith('/api/partners/offers/hotel')) {
        return jsonRes([
          { id: 7, title: 'Отель Пример', description: 'У моря', partner_name: 'Партнёр', price: 5000 },
          { id: 8, title: 'Отель Второй', description: '', partner_name: 'Владелец' },
        ]);
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('hotel-offer-7')).toBeInTheDocument());
    expect(screen.getByTestId('hotel-offer-7')).toHaveTextContent('Отель Пример');
    expect(screen.getByTestId('hotel-offer-8')).toHaveTextContent('Владелец');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/partners/offers/hotel'),
      { headers: {} },
    );

    fireEvent.click(screen.getByTestId('hotel-offer-7'));

    await waitFor(() => expect(screen.getByTestId('hotel-booking-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('hotel-booking-dialog')).toHaveTextContent('Отель Пример');
  });

  it('тосты показывают нужную сторону при каждом переключении активности', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: false, passport_city: '', show_online: true, show_last_seen: false });
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-show-online')).toHaveAttribute('data-state', 'checked'));

    fireEvent.click(screen.getByTestId('switch-show-online'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('settings.show_online.disabled_desc'));

    fireEvent.click(screen.getByTestId('switch-show-last-seen'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('settings.show_last_seen.enabled_desc'));
  });

  it('отели с Bearer-токеном: не-массив ответ даёт пустые офферы и подсказку', async () => {
    flags.value = { partnerOffersEnabled: true, activityPrivacyEnabled: true };
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: true, passport_city: 'Минск' });
      }
      if (String(url).startsWith('/api/partners/offers/hotel')) {
        return jsonRes({ error: 'oops' });
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByText('partner.hotel.no_offers')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/partners/offers/hotel'),
      { headers: { Authorization: 'Bearer test-token' } },
    );
  });

  it('скелет отелей виден, пока карточки не загрузились', async () => {
    flags.value = { partnerOffersEnabled: true, activityPrivacyEnabled: true };
    global.fetch = vi.fn((url: string) => {
      if (url === '/api/settings/privacy') {
        return Promise.resolve(jsonRes({ incognito: false, passport_mode: true, passport_city: 'Сочи' }));
      }
      if (String(url).startsWith('/api/partners/offers/hotel')) {
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(jsonRes({}));
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(document.querySelector('.animate-pulse')).toBeTruthy());
  });
});

describe('SettingsPrivacy: роутер, экспорт, стирание и согласие', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.value = { partnerOffersEnabled: false, activityPrivacyEnabled: true };
    tok.value = 'test-token';
    nav.back.mockClear();
    nav.push.mockClear();
    clipboard.writeText.mockClear();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    if (!('clipboard' in navigator)) {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    }
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: false, passport_city: '', show_online: false, show_last_seen: true });
      }
      return jsonRes({});
    }) as unknown as typeof fetch;
  });

  it('кнопка «назад» зовёт router.back, строка политики — router.push', async () => {
    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-incognito')).toBeInTheDocument());

    fireEvent.click(screen.getByText('common.back'));
    expect(nav.back).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('settings.privacy_policy'));
    expect(nav.push).toHaveBeenCalledWith('/legal/privacy');
  });

  it('инкогнито: PUT с incognito, запись в localStorage и тост', async () => {
    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-incognito')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('switch-incognito'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings/privacy',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ incognito: true }) }),
      ),
    );
    expect(localStorage.getItem('incognito-mode')).toBe('true');
    expect(toast.success).toHaveBeenCalledWith('settings.incognito.enabled_desc');

    fireEvent.click(screen.getByTestId('switch-incognito'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('settings.incognito.disabled_desc'));
    expect(localStorage.getItem('incognito-mode')).toBe('false');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/settings/privacy',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ incognito: false }) }),
    );
  });

  it('blur по полю города при включённом passport_mode сохраняет город', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: true, passport_city: '' });
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('passport-city')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('passport-city'), { target: { value: 'Сочи' } });
    fireEvent.blur(screen.getByTestId('passport-city'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings/privacy',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ passport_city: 'Сочи' }) }),
      ),
    );
  });

  it('экспорт данных создаёт blob-ссылку и показывает тост успеха', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: false, passport_city: '' });
      }
      if (String(url).startsWith('/api/data/export')) {
        return { ok: true, status: 200, blob: async () => new Blob(['zip']) } as unknown as Response;
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByText('settings.data_export')).toBeInTheDocument());

    fireEvent.click(screen.getByText('settings.data_export'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('settings.data_export.success'));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('экспорт при ответе сервера не ok показывает тост ошибки', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: false, passport_city: '' });
      }
      if (String(url).startsWith('/api/data/export')) {
        return { ok: false, status: 500 } as unknown as Response;
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByText('settings.data_export')).toBeInTheDocument());

    fireEvent.click(screen.getByText('settings.data_export'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Export failed'));
  });

  it('стирание данных: confirm → POST → тост; отмена confirm не шлёт запрос', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: false, passport_city: '' });
      }
      if (String(url).startsWith('/api/data/erase/request')) {
        return jsonRes({ token: 'erase-token' });
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByText('settings.data_erase')).toBeInTheDocument());

    fireEvent.click(screen.getByText('settings.data_erase'));
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/data/erase/request',
      expect.anything(),
    );

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText('settings.data_erase'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/data/erase/request', { method: 'POST' }),
    );
    expect(clipboard.writeText).toHaveBeenCalledWith('erase-token');
    expect(toast.success).toHaveBeenCalledWith('settings.data_erase.token_sent');
    confirmSpy.mockRestore();
  });

  it('согласие на обработку данных: POST /api/consent и тост отозванного', async () => {
    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-data-consent')).toHaveAttribute('data-state', 'checked'));

    fireEvent.click(screen.getByTestId('switch-data-consent'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/consent',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ consent_type: 'data_processing', granted: false }),
        }),
      ),
    );
    expect(localStorage.getItem('data-processing-consent')).toBe('false');
    expect(toast.success).toHaveBeenCalledWith('settings.consent_withdrawn');
  });

  it('клик по карточке отеля открывает диалог брони, его закрытие снимает выбор', async () => {
    flags.value = { partnerOffersEnabled: true, activityPrivacyEnabled: true };
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/settings/privacy') {
        return jsonRes({ incognito: false, passport_mode: true, passport_city: 'Сочи' });
      }
      if (String(url).startsWith('/api/partners/offers/hotel')) {
        return jsonRes([{ id: 3, title: 'Отель Закрытие', description: '', partner_name: 'Партнёр' }]);
      }
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('hotel-offer-3')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('hotel-offer-3'));
    await waitFor(() => expect(screen.getByTestId('hotel-booking-dialog')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('hotel-close'));
    await waitFor(() => expect(screen.queryByTestId('hotel-booking-dialog')).not.toBeInTheDocument());
  });

  it('обрыв загрузки настроек падает в localStorage-фолбэк', async () => {
    localStorage.setItem('incognito-mode', 'true');
    global.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-incognito')).toHaveAttribute('data-state', 'checked'));
    expect(screen.getByTestId('switch-show-online')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByTestId('switch-show-last-seen')).toHaveAttribute('data-state', 'checked');
    localStorage.removeItem('incognito-mode');
  });

  it('отозванное согласие включается обратно: POST granted:true и тост', async () => {
    localStorage.setItem('data-processing-consent', 'false');

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-data-consent')).toHaveAttribute('data-state', 'unchecked'));

    fireEvent.click(screen.getByTestId('switch-data-consent'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/consent',
        expect.objectContaining({ body: JSON.stringify({ consent_type: 'data_processing', granted: true }) }),
      ),
    );
    expect(localStorage.getItem('data-processing-consent')).toBe('true');
    expect(toast.success).toHaveBeenCalledWith('settings.consent_enabled');
    localStorage.removeItem('data-processing-consent');
  });

  it('обрыв без сохранённых ключей: фолбэк по умолчанию из чистого хранилища', async () => {
    localStorage.removeItem('incognito-mode');
    localStorage.removeItem('data-processing-consent');
    global.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;

    render(<SettingsPrivacy />);

    await waitFor(() => expect(screen.getByTestId('switch-incognito')).toBeInTheDocument());
    expect(localStorage.getItem('incognito-mode')).toBeNull();
    expect(localStorage.getItem('data-processing-consent')).toBeNull();
  });
});
