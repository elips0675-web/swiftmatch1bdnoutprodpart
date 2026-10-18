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
  PremiumDialog: () => null,
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
