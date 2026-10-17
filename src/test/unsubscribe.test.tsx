import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

import UnsubscribePage from '@/pages/unsubscribe';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

function renderPage(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/unsubscribe${query}`]}>
      <UnsubscribePage />
    </MemoryRouter>,
  );
}

describe('Страница unsubscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('без параметров сразу показывает битую ссылку и не стучит в API', () => {
    renderPage();

    expect(screen.getByText('unsubscribe.error')).toBeInTheDocument();
    expect(screen.getByText('unsubscribe.invalid_link')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('unsubscribe.retry')).toBeNull();
  });

  it('успешная отписка отвечает success и не показывает кнопку повтора', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ ok: true }));

    renderPage('?u=user-1&t=tok-1');

    expect(screen.getByText('unsubscribe.loading')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('unsubscribe.success')).toBeInTheDocument());

    expect(screen.getByText('unsubscribe.success_desc')).toBeInTheDocument();
    expect(screen.queryByText('unsubscribe.retry')).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/api/email/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ u: 'user-1', t: 'tok-1' }),
    });
  });

  it('код UNSUBSCRIBE_DISABLED показывает отключённое состояние', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ code: 'UNSUBSCRIBE_DISABLED' }, 403));

    renderPage('?u=user-1&t=tok-1');

    await waitFor(() => expect(screen.getByText('unsubscribe.disabled')).toBeInTheDocument());
    expect(screen.getByText('unsubscribe.support_hint')).toBeInTheDocument();
  });

  it('код UNSUBSCRIBE_INVALID объясняет, что ссылка неверна, а не «ошибка»', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ code: 'UNSUBSCRIBE_INVALID' }, 400));

    renderPage('?u=user-1&t=tok-1');

    await waitFor(() => expect(screen.getByText('unsubscribe.invalid_link')).toBeInTheDocument());
    expect(screen.getByText('unsubscribe.error')).toBeInTheDocument();
  });

  it('прочий отказ даёт ошибку с кнопкой повтора, повтор шлёт запрос снова', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ code: 'SOMETHING_ELSE' }, 500));

    renderPage('?u=user-1&t=tok-1');

    await waitFor(() => expect(screen.getByText('unsubscribe.retry')).toBeInTheDocument());
    expect(screen.getByText('unsubscribe.support_hint')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('unsubscribe.retry'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it('сетевой сбой даёт ошибку с кнопкой повтора', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

    renderPage('?u=user-1&t=tok-1');

    await waitFor(() => expect(screen.getByText('unsubscribe.retry')).toBeInTheDocument());
    expect(screen.getByText('unsubscribe.error')).toBeInTheDocument();
  });
});
