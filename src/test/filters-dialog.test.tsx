import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({
  t: (key: string) => key,
  apply: vi.fn(),
  openChange: vi.fn(),
  pro: true,
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/lib/useContentConfig', () => ({
  useContentConfig: () => ({
    interests: ['interest.music', 'interest.sport'],
    dating_goals: ['goal.serious_relationship'],
  }),
}));

vi.mock('@/hooks/use-premium', () => ({
  usePremium: () => ({ isPremium: h.pro }),
}));

vi.mock('@/components/dialogs/premium-dialog', () => ({
  PremiumDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="premium-dialog" /> : null),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }) => (
    <div className="select-mock">
      <span data-testid={`sel-${value || 'empty'}`}>{value}</span>
      <button type="button" onClick={() => onValueChange?.('Беларусь')}>{`fire-${value || 'empty'}`}</button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import { FiltersDialog } from '@/components/dialogs/filters-dialog';

function baseFilters(extra: Record<string, unknown> = {}) {
  return {
    ageRange: [18, 40],
    distance: [50],
    genderPref: 'all',
    selectedDatingGoal: 'all',
    selectedInterests: [],
    selectedCircadian: 'all',
    selectedAttachment: 'all',
    ...extra,
  };
}

function renderDialog(filters: Record<string, unknown>) {
  return render(
    <FiltersDialog
      open
      onOpenChange={h.openChange}
      currentFilters={filters}
      onApplyFilters={h.apply}
    />,
  );
}

describe('FiltersDialog: канонический «all» вместо русского «Все»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.pro = true;
  });

  it('без выбранного города применяет «all», а не «Все»', () => {
    renderDialog(baseFilters());

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCity: 'all', selectedCountry: '' }),
    );
  });

  it('город и страна из прошлых фильтров переносятся в заявку как есть', () => {
    renderDialog(baseFilters({ selectedCity: 'Москва', selectedCountry: 'Россия' }));

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCity: 'Москва', selectedCountry: 'Россия' }),
    );
  });

  it('счётчик «все города» подписан переводом, а не словом «Все»', () => {
    renderDialog(baseFilters({ selectedCity: 'all', selectedCountry: 'Россия' }));

    expect(screen.getByText('filters.all_cities')).toBeInTheDocument();
    expect(screen.queryByText('Все')).toBeNull();
  });

  it('закрывает диалог после применения', () => {
    renderDialog(baseFilters());

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.openChange).toHaveBeenCalledWith(false);
  });
});

describe('FiltersDialog: дефолты, премиум-лок и гео-автоопределение', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.pro = true;
  });

  it('пустые currentFilters: все дефолты через ||-ветки', () => {
    renderDialog({});

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith({
      ageRange: [18, 40],
      distance: [50],
      selectedCity: 'all',
      selectedCountry: '',
      genderPref: 'all',
      selectedDatingGoal: 'all',
      selectedInterests: [],
      selectedCircadian: 'all',
      selectedAttachment: 'all',
    });
  });

  it('сохранённый город без страны определяет страну по POPULAR_CITIES', () => {
    renderDialog(baseFilters({ selectedCity: 'Minsk' }));

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCity: 'Minsk', selectedCountry: 'Беларусь' }),
    );
  });

  it('страна без списка городов даёт только пункт «все города»', () => {
    renderDialog(baseFilters({ selectedCountry: 'НиГде' }));

    expect(screen.getByText('filters.all_cities')).toBeInTheDocument();

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCountry: 'НиГде', selectedCity: 'all' }),
    );
  });

  it('не-Pro: лок-баннер, заблокированные Pro-секции и заявка со схлопнутыми Pro-полями', () => {
    h.pro = false;
    renderDialog(
      baseFilters({
        selectedDatingGoal: 'goal.serious_relationship',
        selectedInterests: ['interest.music'],
        selectedCircadian: 'night',
        selectedAttachment: 'anxious',
      }),
    );

    expect(screen.getByText('filters.unlock_all')).toBeInTheDocument();
    expect(screen.getByText('interest.music')).toHaveClass('cursor-not-allowed');

    fireEvent.click(screen.getByText('interest.music'));
    fireEvent.click(screen.getByText('filters.dating_goal'));

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedDatingGoal: 'all',
        selectedInterests: [],
        selectedCircadian: 'all',
        selectedAttachment: 'all',
      }),
    );
  });

  it('клик по бейджу добавляет интерес в заявку (Pro)', () => {
    renderDialog(baseFilters());

    fireEvent.click(screen.getByText('interest.sport'));

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({ selectedInterests: ['interest.sport'] }),
    );
  });

  it('повторный клик по выбранному интересу убирает его из заявки', () => {
    renderDialog(baseFilters({ selectedInterests: ['interest.sport'] }));

    fireEvent.click(screen.getByText('interest.sport'));

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({ selectedInterests: [] }),
    );
  });

  it('кнопка «Отмена» закрывает диалог без применения', () => {
    renderDialog(baseFilters());

    fireEvent.click(screen.getByText('filters.cancel'));

    expect(h.openChange).toHaveBeenCalledWith(false);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('кнопка PRO в лок-баннере открывает премиум-диалог', () => {
    h.pro = false;
    renderDialog(baseFilters());

    fireEvent.click(screen.getByText('PRO'));

    expect(screen.getByTestId('premium-dialog')).toBeInTheDocument();
  });

  it('выбор страны через onValueChange сбрасывает город', () => {
    renderDialog(baseFilters({ selectedCity: 'Nowhere-Ville' }));

    expect(screen.getByTestId('sel-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByText('fire-empty'));

    fireEvent.click(screen.getByText('filters.apply'));

    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCountry: 'Беларусь', selectedCity: 'all' }),
    );
  });
});
