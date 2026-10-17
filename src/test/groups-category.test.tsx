import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const h = vi.hoisted(() => ({
  t: (key: string) => key,
  toast: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  params: { category: 'music' } as { category: string },
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: 'RU', setLanguage: vi.fn() }),
}));

vi.mock('@/shims/next-navigation', () => ({
  useParams: () => h.params,
  useRouter: () => ({ push: h.push, back: h.back, replace: vi.fn() }),
}));

vi.mock('@/components/layout/app-header', () => ({
  AppHeader: () => null,
}));

vi.mock('@/components/navigation/bottom-nav', () => ({
  BottomNav: () => null,
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: h.toast,
  useToast: () => ({ toast: h.toast, toasts: [] }),
}));

vi.mock('@/components/feeds/category-feed', () => ({
  CategoryFeed: ({ categoryNameRu }: { categoryNameRu: string }) => (
    <div data-testid="category-feed">{categoryNameRu}</div>
  ),
}));

import GroupsCategoryPage from '@/pages/groups-category';

describe('Страница groups-category', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.params.category = 'music';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('для неизвестной категории показывает заглушку и ведёт назад к списку групп', () => {
    h.params.category = 'unknown-category';
    render(
      <MemoryRouter>
        <GroupsCategoryPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('groups.category_not_found')).toBeInTheDocument();

    fireEvent.click(screen.getByText('groups.back_to_groups'));

    expect(h.push).toHaveBeenCalledWith('/groups');
  });

  it('рисует первую страницу подгрупп категории с количеством участников и онлайном', () => {
    const { container } = render(
      <MemoryRouter>
        <GroupsCategoryPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Музыка')).toBeInTheDocument();
    expect(screen.getByText('Хип-хоп')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('25 chats.online')).toBeInTheDocument();
    expect(screen.getAllByText('button.join')).toHaveLength(10);
    expect(screen.getAllByText(/chats\.online/)).toHaveLength(10);

    const links = container.querySelectorAll('a[href^="/chats?groupId="]');
    expect(links).toHaveLength(10);
    expect(container.querySelector('a[href="/chats?groupId=101"]')).not.toBeNull();
  });

  it('переключает страницы пагинации по подгруппам', () => {
    render(
      <MemoryRouter>
        <GroupsCategoryPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Хип-хоп')).toBeInTheDocument();

    fireEvent.click(screen.getByText('2'));

    expect(screen.getByText('Техно')).toBeInTheDocument();
    expect(screen.queryByText('Хип-хоп')).toBeNull();
    expect(screen.getAllByText('button.join')).toHaveLength(10);
  });

  it('кнопка «назад» в шапке вызывает router.back', () => {
    const { container } = render(
      <MemoryRouter>
        <GroupsCategoryPage />
      </MemoryRouter>,
    );

    const backButton = container.querySelector('header button');
    expect(backButton).not.toBeNull();
    fireEvent.click(backButton as HTMLButtonElement);

    expect(h.back).toHaveBeenCalledTimes(1);
  });

  it('переключает вид между лентой и списком групп', () => {
    render(
      <MemoryRouter>
        <GroupsCategoryPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('category-feed')).toBeNull();
    expect(screen.getByText('Хип-хоп')).toBeInTheDocument();

    fireEvent.click(screen.getByText('groups.tab.feed'));

    expect(screen.getByTestId('category-feed')).toHaveTextContent('Музыка');
    expect(screen.queryByText('Хип-хоп')).toBeNull();

    fireEvent.click(screen.getByText('groups.tab.groups'));

    expect(screen.queryByTestId('category-feed')).toBeNull();
    expect(screen.getByText('Хип-хоп')).toBeInTheDocument();
  });

  it('промо-баннер открывает диалог, «смотреть рекламу» даёт тост и закрывает его', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <GroupsCategoryPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('groups.ad.description'));

    expect(screen.getAllByText('groups.ad.title')).toHaveLength(2);
    expect(screen.getAllByText('groups.ad.price').length).toBeGreaterThan(0);
    expect(consoleError).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('autosearch.free'));

    expect(h.toast).toHaveBeenCalledWith({
      title: 'groups.ad.toast.title',
      description: 'groups.ad.toast.description',
    });
    expect(screen.queryByText('groups.ad.price')).toBeNull();
  });

  it('кнопка «не сейчас» закрывает диалог без тоста', () => {
    render(
      <MemoryRouter>
        <GroupsCategoryPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('groups.ad.description'));
    fireEvent.click(screen.getByText('button.not_now'));

    expect(screen.queryByText('groups.ad.price')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });
});
