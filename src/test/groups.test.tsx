import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const h = vi.hoisted(() => ({
  t: (key: string) => key,
  toast: vi.fn(),
  language: 'RU' as 'RU' | 'EN',
}));

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: h.language, setLanguage: vi.fn() }),
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

vi.mock('@/components/ui/select', () => {
  type WithChildren = { children?: React.ReactNode };
  return {
    Select: ({ value, onValueChange, children }: WithChildren & { value?: string; onValueChange?: (v: string) => void }) => (
      <select data-testid="group-category" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
        {children}
      </select>
    ),
    SelectTrigger: ({ children }: WithChildren) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => (
      <option value="" disabled>
        {placeholder}
      </option>
    ),
    SelectContent: ({ children }: WithChildren) => <>{children}</>,
    SelectItem: ({ value, children }: WithChildren & { value: string }) => <option value={value}>{children}</option>,
  };
});

import GroupsPage from '@/pages/groups';

describe('Страница groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.language = 'RU';
  });

  it('на вкладке «Найти» показывает первую страницу из 12 категорий и пагинацию', () => {
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('nav.groups')).toBeInTheDocument();

    for (const name of ['Музыка', 'Спорт', 'Творчество', 'Игры', 'Кино и Сериалы', 'Здоровье']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    expect(screen.getAllByText(/chats\.online/)).toHaveLength(12);
    expect(screen.queryByText('Питомцы')).toBeNull();
    expect(screen.queryByText('groups.not_found')).toBeNull();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('пагинация листает категории стрелками и номером, а смена вкладки сбрасывает страницу', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByText('›'));

    expect(screen.getByText('Питомцы')).toBeInTheDocument();
    expect(screen.queryByText('Музыка')).toBeNull();

    await user.click(screen.getByText('‹'));

    expect(screen.getByText('Музыка')).toBeInTheDocument();
    expect(screen.queryByText('Питомцы')).toBeNull();

    await user.click(screen.getByText('2'));

    expect(screen.getByText('Питомцы')).toBeInTheDocument();
    expect(screen.getByText('История')).toBeInTheDocument();
    expect(screen.queryByText('Музыка')).toBeNull();
    expect(screen.getAllByText(/chats\.online/)).toHaveLength(8);

    await user.click(screen.getByText('groups.tabs.my'));
    await user.click(screen.getByText('groups.tabs.find'));

    expect(await screen.findByText('Музыка')).toBeInTheDocument();
    expect(screen.queryByText('Питомцы')).toBeNull();
  });

  it('на вкладке «Мои группы» показывает три группы вместо пустого состояния', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByText('groups.tabs.my'));

    expect(await screen.findByText('Творчество')).toBeInTheDocument();
    expect(screen.getByText('Музыка')).toBeInTheDocument();
    expect(screen.getByText('Игры')).toBeInTheDocument();
    expect(screen.queryByText('groups.not_joined')).toBeNull();
    expect(screen.queryByText('Спорт')).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
  });

  it('на вкладке «Топ недели» показывает четыре группы из середины списка без пагинации', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByText('groups.tabs.top'));

    expect(await screen.findByText('Творчество')).toBeInTheDocument();
    expect(screen.getByText('Игры')).toBeInTheDocument();
    expect(screen.getByText('Кино и Сериалы')).toBeInTheDocument();
    expect(screen.getByText('Путешествия')).toBeInTheDocument();
    expect(screen.queryByText('Музыка')).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
  });

  it('без названия и категории создание отклоняется с ошибкой', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('create-group-button'));
    expect(screen.getByText('groups.create.title')).toBeInTheDocument();

    await user.click(screen.getByTestId('submit-create-group'));

    expect(h.toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'groups.create.error_title',
      description: 'groups.create.error_desc',
    });
    expect(screen.getByTestId('group-name')).toBeInTheDocument();
  });

  it('без выбранной категории группа не создаётся даже с названием', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('create-group-button'));
    await user.type(screen.getByTestId('group-name'), 'Книжный клуб');
    await user.click(screen.getByTestId('submit-create-group'));

    expect(h.toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'groups.create.error_title',
      description: 'groups.create.error_desc',
    });
  });

  it('запрещённое слово в названии или описании блокирует создание', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('create-group-button'));
    await user.selectOptions(screen.getByTestId('group-category'), 'music');
    await user.type(screen.getByTestId('group-name'), 'Казино клуб');
    await user.click(screen.getByTestId('submit-create-group'));

    expect(h.toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'groups.create.forbidden_title',
      description: 'groups.create.forbidden_desc',
    });

    await user.clear(screen.getByTestId('group-name'));
    await user.type(screen.getByTestId('group-name'), 'Книжный клуб');
    await user.type(screen.getByTestId('group-description'), 'спам');
    await user.click(screen.getByTestId('submit-create-group'));

    expect(h.toast).toHaveBeenCalledTimes(2);
  });

  it('создаёт группу при валидных данных, закрывает диалог и очищает форму', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('create-group-button'));
    await user.type(screen.getByTestId('group-name'), 'Книжный клуб');
    await user.type(screen.getByTestId('group-description'), 'Читаем вместе');
    await user.selectOptions(screen.getByTestId('group-category'), 'creativity');
    await user.click(screen.getByTestId('submit-create-group'));

    expect(h.toast).toHaveBeenCalledWith({
      title: 'groups.create.success_title',
      description: 'groups.create.success_desc_startКнижный клубgroups.create.success_desc_end',
    });

    await waitFor(() => expect(screen.queryByTestId('group-name')).toBeNull());

    await user.click(screen.getByTestId('create-group-button'));
    expect(screen.getByTestId('group-name')).toHaveValue('');
    expect(screen.getByTestId('group-description')).toHaveValue('');
  });

  it('после прокрутки больше 300 px показывает кнопку «наверх» и возвращает к началу', () => {
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    const main = document.querySelector('main') as HTMLElement;
    const scrollTo = vi.fn();
    main.scrollTo = scrollTo;

    expect(document.querySelector('button.fixed.bottom-24')).toBeNull();

    main.scrollTop = 500;
    fireEvent.scroll(main);

    const topButton = document.querySelector('button.fixed.bottom-24') as HTMLButtonElement;
    expect(topButton).not.toBeNull();

    fireEvent.click(topButton);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    main.scrollTop = 0;
    fireEvent.scroll(main);

    expect(document.querySelector('button.fixed.bottom-24')).toBeNull();
  });

  it('кнопка «Отмена» закрывает диалог создания и ничего не создаёт', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('create-group-button'));
    await user.type(screen.getByTestId('group-name'), 'Клуб');

    await user.click(screen.getByText('button.cancel'));

    await waitFor(() => expect(screen.queryByTestId('group-name')).toBeNull());
    expect(h.toast).not.toHaveBeenCalled();
    expect(screen.getByText('Музыка')).toBeInTheDocument();
  });

  it('в языке EN карточки и категории в диалоге берут английские названия', async () => {
    h.language = 'EN';
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.queryByText('Музыка')).toBeNull();

    await user.click(screen.getByTestId('create-group-button'));

    expect(screen.getAllByText('Music').length).toBeGreaterThan(1);
    expect(screen.queryByText('Музыка')).toBeNull();
  });
});
