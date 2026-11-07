import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { AutosearchDialog } from '@/components/dialogs/autosearch-dialog';

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU', setLanguage: vi.fn() }),
}));

function renderDialog(overrides: Partial<React.ComponentProps<typeof AutosearchDialog>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onAutosearch: vi.fn(),
    ...overrides,
  };
  render(<AutosearchDialog {...props} />);
  return props;
}

describe('AutosearchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('в закрытом состоянии ничего не рендерит', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('показывает заголовок, описание и оба способа доступа', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('autosearch.title')).toBeInTheDocument();
    expect(screen.getByText('autosearch.desc')).toBeInTheDocument();
    expect(screen.getByText('autosearch.free')).toBeInTheDocument();
    expect(screen.getByText('autosearch.watch_ad')).toBeInTheDocument();
    expect(screen.getByText('autosearch.paid')).toBeInTheDocument();
    expect(screen.getByText('autosearch.price')).toBeInTheDocument();
    expect(screen.getByText('button.not_now')).toBeInTheDocument();
  });

  it('бесплатный доступ сначала показывает загрузку, затем выдаёт автопоиск', () => {
    vi.useFakeTimers();
    const props = renderDialog();

    fireEvent.click(screen.getByText('autosearch.free'));

    expect(screen.getByText('common.loading')).toBeInTheDocument();
    expect(screen.queryByText('autosearch.watch_ad')).toBeNull();
    expect(screen.getByText('common.loading').closest('button')).toBeDisabled();
    expect(props.onAutosearch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onAutosearch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('common.loading')).toBeNull();
  });

  it('до истечения рекламной паузы доступ не выдаётся', () => {
    vi.useFakeTimers();
    const props = renderDialog();

    fireEvent.click(screen.getByText('autosearch.free'));
    act(() => {
      vi.advanceTimersByTime(1999);
    });

    expect(props.onAutosearch).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('платный доступ выдаёт автопоиск сразу и закрывает диалог', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByText('autosearch.paid'));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onAutosearch).toHaveBeenCalledTimes(1);
  });

  it('«не сейчас» закрывает диалог, но доступ не выдаёт', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByText('button.not_now'));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onAutosearch).not.toHaveBeenCalled();
  });
});
