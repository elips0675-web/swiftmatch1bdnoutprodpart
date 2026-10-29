import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const h = vi.hoisted(() => ({
  t: (key: string) => key,
  toast: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  language: 'RU' as 'RU' | 'EN',
  params: { category: 'music' } as { category: string },
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: h.language, setLanguage: vi.fn() }),
}));

vi.mock('@/shims/next-navigation', () => ({
  useParams: () => h.params,
  useRouter: () => ({ push: h.push, back: h.back, replace: vi.fn() }),
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

import GroupsCategoryPage, { LoadingSkeleton, Pagination } from '@/pages/groups-category';

function renderPage() {
  return render(
    <MemoryRouter>
      <GroupsCategoryPage />
    </MemoryRouter>,
  );
}

describe('Страница groups-category', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.params.category = 'music';
    h.language = 'RU';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('для неизвестной категории показывает заглушку и ведёт назад к списку групп', () => {
    h.params.category = 'unknown-category';
    renderPage();

    expect(screen.getByText('groups.category_not_found')).toBeInTheDocument();

    fireEvent.click(screen.getByText('groups.back_to_groups'));

    expect(h.push).toHaveBeenCalledWith('/groups');
  });

  it('рисует первую страницу подгрупп категории с количеством участников и онлайном', () => {
    const { container } = renderPage();

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
    renderPage();

    expect(screen.getByText('Хип-хоп')).toBeInTheDocument();

    fireEvent.click(screen.getByText('2'));

    expect(screen.getByText('Техно')).toBeInTheDocument();
    expect(screen.queryByText('Хип-хоп')).toBeNull();
    expect(screen.getAllByText('button.join')).toHaveLength(10);
  });

  it('стрелки пагинации листают вперёд и назад и блокируются на краях', () => {
    renderPage();

    const prev = screen.getByLabelText('groups.prev_page');
    const next = screen.getByLabelText('groups.next_page');
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);

    expect(screen.getByText('Техно')).toBeInTheDocument();
    expect(screen.getByLabelText('groups.next_page')).toBeDisabled();
    expect(screen.getByLabelText('groups.prev_page')).toBeEnabled();

    fireEvent.click(screen.getByLabelText('groups.prev_page'));

    expect(screen.getByText('Хип-хоп')).toBeInTheDocument();
    expect(screen.getByLabelText('groups.prev_page')).toBeDisabled();
  });

  it('для одной страницы пагинация не рисуется', () => {
    const { container } = render(<Pagination current={1} total={1} onChange={vi.fn()} t={(key) => key} />);

    expect(container.firstChild).toBeNull();
  });

  it('для пустого списка пагинация не рисуется', () => {
    const { container } = render(<Pagination current={1} total={0} onChange={vi.fn()} t={(key) => key} />);

    expect(container.firstChild).toBeNull();
  });

  it('при смене категории сбрасывает страницу на первую', () => {
    const { rerender } = renderPage();

    fireEvent.click(screen.getByLabelText('groups.next_page'));
    expect(screen.getByText('Техно')).toBeInTheDocument();

    h.params.category = 'movies';
    rerender(
      <MemoryRouter>
        <GroupsCategoryPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Кино и Сериалы')).toBeInTheDocument();
    expect(screen.getByText('Netflix')).toBeInTheDocument();
    expect(screen.queryByText('Техно')).toBeNull();
  });

  it('на английском показывает name_en категории и подгрупп', () => {
    h.language = 'EN';
    renderPage();

    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.getByText('Hip-hop')).toBeInTheDocument();
    expect(screen.queryByText('Хип-хоп')).toBeNull();
  });

  it('кнопка «назад» в шапке вызывает router.back', () => {
    const { container } = renderPage();

    const backButton = container.querySelector('header button');
    expect(backButton).not.toBeNull();
    fireEvent.click(backButton as HTMLButtonElement);

    expect(h.back).toHaveBeenCalledTimes(1);
  });

  it('переключает вид между лентой и списком групп', () => {
    renderPage();

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
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderPage();

    fireEvent.click(screen.getByText('groups.ad.description'));

    expect(screen.getAllByText('groups.ad.title')).toHaveLength(2);
    expect(screen.getAllByText('groups.ad.price').length).toBeGreaterThan(0);
    const warnings = consoleWarn.mock.calls.map((call) => String(call[0]));
    expect(warnings.some((warning) => warning.includes('Missing `Description`'))).toBe(false);

    fireEvent.click(screen.getByText('autosearch.free'));

    expect(h.toast).toHaveBeenCalledWith({
      title: 'groups.ad.toast.title',
      description: 'groups.ad.toast.description',
    });
    expect(screen.queryByText('groups.ad.price')).toBeNull();
  });

  it('кнопка «не сейчас» закрывает диалог без тоста', () => {
    renderPage();

    fireEvent.click(screen.getByText('groups.ad.description'));
    fireEvent.click(screen.getByText('button.not_now'));

    expect(screen.queryByText('groups.ad.price')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('кнопка оплаты закрывает диалог без тоста', () => {
    renderPage();

    fireEvent.click(screen.getByText('groups.ad.description'));
    fireEvent.click(screen.getByText('autosearch.paid'));

    expect(screen.queryByText('groups.ad.price')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('промо-баннер открывается с клавиатуры по Enter и пробелу', () => {
    renderPage();

    const banner = screen.getByRole('button', { name: /groups\.ad\.title/ });

    fireEvent.keyDown(banner, { key: 'Enter' });
    expect(screen.getAllByText('groups.ad.title')).toHaveLength(2);
    fireEvent.click(screen.getByText('button.not_now'));

    fireEvent.keyDown(banner, { key: ' ' });
    expect(screen.getAllByText('groups.ad.title')).toHaveLength(2);
    fireEvent.click(screen.getByText('button.not_now'));

    fireEvent.keyDown(banner, { key: 'a' });
    expect(screen.queryByText('groups.ad.price')).toBeNull();
  });

  it('скелетон загрузки рисует шапку и десять карточек-заглушек', () => {
    const { container } = render(<LoadingSkeleton />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(22);
    expect(container.querySelector('header')).not.toBeNull();
    expect(container.querySelector('main')).not.toBeNull();
  });
});
