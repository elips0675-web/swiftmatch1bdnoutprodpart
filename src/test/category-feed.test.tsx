import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  t: (key: string) => key,
  toast: vi.fn(),
  token: 'feed-token' as string | null,
  language: 'RU' as 'RU' | 'EN',
  fetchMock: vi.fn(),
  clipboard: { writeText: vi.fn() },
}))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: h.language, setLanguage: vi.fn() }),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: h.toast, toasts: [] }),
  toast: h.toast,
}))

vi.mock('@/lib/token', () => ({ getToken: () => h.token }))

import { CategoryFeed } from '@/components/feeds/category-feed'

const jsonResponse = (data: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(data) } as unknown as Response)

const pendingForever = () => new Promise<Response>(() => {})

function demoFeed() {
  return render(<CategoryFeed categoryNameRu="Футбол" categoryNameEn="Football" />)
}

function apiFeed(groupId = '5') {
  return render(<CategoryFeed categoryNameRu="Футбол" categoryNameEn="Football" groupId={groupId} />)
}

const cardOf = (text: string) => screen.getByText(text).closest('div.bg-white') as HTMLElement
const postCount = () => screen.queryAllByText(/^Комментарии \(/).length

function apiPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    groupId: 5,
    userId: 3,
    text: 'Первый пост',
    images: [],
    likes: 5,
    likedByMe: false,
    comments: [],
    createdAt: '2026-10-01T10:00:00.000Z',
    author: 'Анна',
    avatar: '/uploads/anna.webp',
    ...overrides,
  }
}

beforeEach(() => {
  h.toast.mockClear()
  h.fetchMock.mockReset()
  h.token = 'feed-token'
  h.language = 'RU'
  h.clipboard.writeText.mockReset()
  h.clipboard.writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: h.clipboard, configurable: true })
  vi.stubGlobal('fetch', h.fetchMock)
  h.fetchMock.mockImplementation(() => pendingForever())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('CategoryFeed: демо-лента', () => {
  it('рисует первую страницу из 15 постов и пагинацию на 19', () => {
    const view = demoFeed()
    expect(postCount()).toBe(15)
    expect(screen.getByText('Футбол')).toBeTruthy()
    expect(screen.getByText(/Добро пожаловать в группу «Футбол»/)).toBeTruthy()
    expect(view.container.querySelectorAll('.lucide-chevron-right').length).toBe(1)
  })

  it('вторая страница показывает оставшиеся 4 поста и ведёт назад', async () => {
    const view = demoFeed()
    const next = view.container.querySelector('.lucide-chevron-right')!.closest('button')!
    await userEvent.click(next)
    expect(postCount()).toBe(4)
    expect(screen.getByText('Исследователь')).toBeTruthy()
    const prev = view.container.querySelector('.lucide-chevron-left')!.closest('button')!
    await userEvent.click(prev)
    expect(postCount()).toBe(15)
  })

  it('на первой странице назад идти некуда, на последней — вперёд', () => {
    const view = demoFeed()
    const prev = view.container.querySelector('.lucide-chevron-left')!.closest('button') as HTMLButtonElement
    const next = view.container.querySelector('.lucide-chevron-right')!.closest('button') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect(next.disabled).toBe(false)
  })

  it('лайк в демо-режиме переключается и меняет счётчик', async () => {
    demoFeed()
    const card = cardOf('Футбол')
    const likeButton = within(card).getByText('100').closest('button') as HTMLButtonElement
    await userEvent.click(likeButton)
    expect(within(card).getByText('101')).toBeTruthy()
    await userEvent.click(likeButton)
    expect(within(card).getByText('100')).toBeTruthy()
  })

  it('счётчик комментариев совпадает с реальным числом комментариев', async () => {
    demoFeed()
    const card = cardOf('Мастер')
    expect(within(card).getByText(/^Комментарии \(3\)$/)).toBeTruthy()
    await userEvent.click(within(card).getByText(/^Комментарии \(3\)$/))
    expect(within(card).getByText('А можно подробнее?')).toBeTruthy()
    expect(within(card).getByText('Проверено на себе — работает.')).toBeTruthy()
    expect(within(card).getByText('Отличная подборка, спасибо!')).toBeTruthy()
  })

  it('комментарий добавляется по Enter, счётчик растёт, поле очищается', async () => {
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    const input = within(card).getByPlaceholderText('Напишите комментарий...')
    await userEvent.type(input, 'Спасибо за совет{Enter}')
    expect(within(card).getByText('Спасибо за совет')).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('')
    expect(within(card).getByText(/^Комментарии \(3\)$/)).toBeTruthy()
    expect(within(card).getByText('Вы')).toBeTruthy()
  })

  it('пустой комментарий и комментарий из пробелов не отправляются', async () => {
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    const input = within(card).getByPlaceholderText('Напишите комментарий...')
    fireEvent.keyDown(input, { key: 'Enter' })
    await userEvent.type(input, '   ')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(within(card).getByText(/^Комментарии \(2\)$/)).toBeTruthy()
  })

  it('запрещённые слова и гиберриш в комментарии отбиваются тостом', async () => {
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    const input = within(card).getByPlaceholderText('Напишите комментарий...')
    await userEvent.type(input, 'купи слона')
    await userEvent.click(within(card).getAllByRole('button').filter((b) => b.querySelector('.lucide-send'))[0])
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'filter.toast.title' }))
    await userEvent.clear(input)
    await userEvent.type(input, 'ываываыва')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'filter.toast.title' }))
    expect(within(card).getByText(/^Комментарии \(2\)$/)).toBeTruthy()
  })

  it('фото к комментарию показывается в превью, отправляется и очищается', async () => {
    const view = demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    const fileInput = card.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'c.png', { type: 'image/png' })] } })
    expect(await within(card).findByAltText('pending')).toBeTruthy()
    await userEvent.click(within(card).getAllByRole('button').filter((b) => b.querySelector('.lucide-send'))[0])
    await waitFor(() => expect(within(card).queryByAltText('pending')).toBeNull())
    expect(within(card).getByText(/^Комментарии \(3\)$/)).toBeTruthy()
    expect(view.container.querySelectorAll('img[alt="Вы"]').length).toBeGreaterThan(0)
  })

  it('выбранное фото комментария можно убрать до отправки', async () => {
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    const fileInput = card.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'c.png', { type: 'image/png' })] } })
    await within(card).findByAltText('pending')
    const remove = within(card).getByAltText('pending').parentElement!.querySelector('button') as HTMLButtonElement
    await userEvent.click(remove)
    expect(within(card).queryByAltText('pending')).toBeNull()
  })

  it('пустой выбор файла для комментария ничего не добавляет', async () => {
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    const fileInput = card.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [] } })
    expect(within(card).queryByAltText('pending')).toBeNull()
  })

  it('кнопка картинки у комментария открывает выбор файла', async () => {
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    const fileInput = card.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click')
    const imageButton = within(card).getAllByRole('button').filter((b) => b.querySelector('.lucide-image'))[0]
    await userEvent.click(imageButton)
    expect(clickSpy).toHaveBeenCalled()
  })

  it('шаринг копирует ссылку в буфер и подтверждает это', async () => {
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getAllByRole('button').filter((b) => b.querySelector('.lucide-share-2'))[0])
    await waitFor(() => expect(h.clipboard.writeText).toHaveBeenCalled())
    expect(h.clipboard.writeText.mock.calls[0][0]).toContain('groupId=')
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ссылка скопирована' }))
  })

  it('отказ буфера обмена честно сообщает об ошибке и показывает ссылку', async () => {
    h.clipboard.writeText.mockRejectedValue(new Error('denied'))
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getAllByRole('button').filter((b) => b.querySelector('.lucide-share-2'))[0])
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Не удалось скопировать' }))
    )
  })

  it('поиск фильтрует по тексту, автору и группе и сбрасывает страницу', async () => {
    demoFeed()
    const search = screen.getByPlaceholderText('Поиск по постам...')
    await userEvent.type(search, 'розы')
    expect(postCount()).toBe(1)
    expect(screen.getByText(/Как вырастить розы/)).toBeTruthy()
    await userEvent.clear(search)
    await userEvent.type(search, 'Садовод')
    expect(postCount()).toBe(1)
    await userEvent.clear(search)
    await userEvent.type(search, 'Наука')
    expect(postCount()).toBe(1)
    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')
    expect(postCount()).toBe(0)
  })

  it('поиск со второй страницы возвращает на первую', async () => {
    const view = demoFeed()
    await userEvent.click(view.container.querySelector('.lucide-chevron-right')!.closest('button')!)
    expect(postCount()).toBe(4)
    await userEvent.type(screen.getByPlaceholderText('Поиск по постам...'), 'розы')
    expect(postCount()).toBe(1)
  })

  it('повторный клик по комментариям закрывает ветку', async () => {
    demoFeed()
    const card = cardOf('Новичок')
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    expect(within(card).getByPlaceholderText('Напишите комментарий...')).toBeTruthy()
    await userEvent.click(within(card).getByText(/^Комментарии \(2\)$/))
    await waitFor(() => expect(within(card).queryByPlaceholderText('Напишите комментарий...')).toBeNull())
  })

  it('открывает лайтбокс, листает стрелками и клавиатурой и закрывает', async () => {
    const view = demoFeed()
    const card = cardOf('Коллекционер')
    expect(within(card).getAllByAltText(/^Post image/).length).toBe(4)
    await userEvent.click(within(card).getByAltText('Post image 1'))
    const lightbox = view.container.querySelector('.fixed.inset-0') as HTMLElement
    expect(lightbox).toBeTruthy()
    const shown = lightbox.querySelector('img') as HTMLImageElement
    expect(shown.src).toContain('picsum.photos')
    const firstSrc = shown.src
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect((lightbox.querySelector('img') as HTMLImageElement).src).not.toBe(firstSrc))
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await waitFor(() => expect((lightbox.querySelector('img') as HTMLImageElement).src).toBe(firstSrc))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(view.container.querySelector('.fixed.inset-0.bg-black\\/80')).toBeNull())
  })

  it('лайтбокс листается кнопками и закрывается крестиком', async () => {
    const view = demoFeed()
    const card = cardOf('Коллекционер')
    await userEvent.click(within(card).getByAltText('Post image 1'))
    const lightbox = view.container.querySelector('.fixed.inset-0') as HTMLElement
    const before = (lightbox.querySelector('img') as HTMLImageElement).src
    await userEvent.click(lightbox.querySelector('.lucide-chevron-right')!.closest('button')!)
    await waitFor(() => expect((lightbox.querySelector('img') as HTMLImageElement).src).not.toBe(before))
    await userEvent.click(lightbox.querySelector('.lucide-chevron-left')!.closest('button')!)
    await waitFor(() => expect((lightbox.querySelector('img') as HTMLImageElement).src).toBe(before))
    const closeButton = lightbox.querySelector('.lucide-x')!.closest('button')!
    await userEvent.click(closeButton)
    await waitFor(() => expect(view.container.querySelector('.fixed.inset-0.bg-black\\/80')).toBeNull())
  })

  it('клик по фону лайтбокса закрывает его, клик по фото — нет', async () => {
    const view = demoFeed()
    const card = cardOf('Коллекционер')
    await userEvent.click(within(card).getByAltText('Post image 1'))
    const lightbox = view.container.querySelector('.fixed.inset-0') as HTMLElement
    await userEvent.click(lightbox.querySelector('img')!)
    expect(view.container.querySelector('.fixed.inset-0.bg-black\\/80')).toBeTruthy()
    await userEvent.click(lightbox)
    await waitFor(() => expect(view.container.querySelector('.fixed.inset-0.bg-black\\/80')).toBeNull())
  })

  it('галерея с одним и двумя фото рисует все, с тремя — первое крупным', () => {
    const view = demoFeed()
    expect(within(cardOf('Новичок')).getAllByAltText(/^Post image/).length).toBe(1)
    expect(within(cardOf('Эксперт')).getAllByAltText(/^Post image/).length).toBe(2)
    const three = cardOf('Практик')
    expect(within(three).getAllByAltText(/^Post image/).length).toBe(3)
    expect(within(three).getByAltText('Post image 1').parentElement!.className).toContain('col-span-2')
  })

  it('длинный текст раскрывается и сворачивается', async () => {
    const view = demoFeed()
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    const long = 'Очень длинный пост про футбол. '.repeat(12)
    fireEvent.change(within(dialog).getByPlaceholderText('Напишите что-нибудь...'), { target: { value: long } })
    await userEvent.click(within(dialog).getByText('Опубликовать'))
    const expand = await screen.findByText('Показать больше')
    await userEvent.click(expand)
    expect(screen.getByText('Скрыть')).toBeTruthy()
    await userEvent.click(screen.getByText('Скрыть'))
    expect(screen.getByText('Показать больше')).toBeTruthy()
  })
})

describe('CategoryFeed: создание поста и картинки', () => {
  const openDialog = async () => {
    const view = demoFeed()
    const plus = view.container.querySelector('.lucide-circle-plus')!.closest('button')!
    await userEvent.click(plus)
    return screen.findByRole('dialog')
  }

  it('пустой пост не публикуется и показывает тост', async () => {
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByText('Опубликовать'))
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Пустой пост' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('текст публикуется, диалог закрывается, пост встаёт первым', async () => {
    const dialog = await openDialog()
    fireEvent.change(within(dialog).getByPlaceholderText('Напишите что-нибудь...'), { target: { value: 'Новый пост в ленте' } })
    await userEvent.click(within(dialog).getByText('Опубликовать'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Новый пост в ленте')).toBeTruthy()
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Пост опубликован' }))
    expect(postCount()).toBe(15)
  })

  it('ссылки на картинки берутся только http, не-ссылки отбрасываются', async () => {
    const view = demoFeed()
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Вставьте ссылку на изображение'), {
      target: { value: 'просто текст, https://img.test/a.png' },
    })
    await userEvent.click(within(dialog).getByText('Опубликовать'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const card = cardOf('Вы')
    const images = within(card).getAllByAltText(/^Post image/)
    expect(images.length).toBe(1)
    expect((images[0] as HTMLImageElement).src).toBe('https://img.test/a.png')
  })

  it('файл из формы поста попадает в превью и удаляется', async () => {
    const view = demoFeed()
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } })
    const preview = await within(dialog).findByAltText('preview 0')
    expect(preview).toBeTruthy()
    expect(within(dialog).getByText(/\(1\/14\)/)).toBeTruthy()
    const remove = preview.parentElement!.querySelector('button') as HTMLButtonElement
    await userEvent.click(remove)
    await waitFor(() => expect(within(dialog).queryByAltText('preview 0')).toBeNull())
    expect(within(dialog).getByText(/\(0\/14\)/)).toBeTruthy()
  })

  it('кнопка «Добавить» открывает выбор файла, пустой выбор ничего не даёт', async () => {
    const view = demoFeed()
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click')
    await userEvent.click(within(dialog).getByText('Добавить'))
    expect(clickSpy).toHaveBeenCalled()
    fireEvent.change(fileInput, { target: { files: [] } })
    expect(within(dialog).queryByAltText('preview 0')).toBeNull()
    fireEvent.change(fileInput, { target: { files: null } })
    expect(within(dialog).queryByAltText('preview 0')).toBeNull()
  })

  it('пост с одним фото публикуется без текста', async () => {
    const view = demoFeed()
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Вставьте ссылку на изображение'), {
      target: { value: 'https://img.test/only.png' },
    })
    await userEvent.click(within(dialog).getByText('Опубликовать'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const card = cardOf('Вы')
    expect(within(card).getByAltText('Post image 1')).toBeTruthy()
  })

  it('переход по номеру страницы работает', async () => {
    demoFeed()
    const pageTwo = screen.getAllByText('2').map((el) => el.closest('button')).filter(Boolean).pop()!
    await userEvent.click(pageTwo)
    expect(postCount()).toBe(4)
  })

  it('английский язык переводит интерфейс и длинный текст', async () => {
    h.language = 'EN'
    const view = demoFeed()
    expect(screen.getByPlaceholderText('Search posts...')).toBeTruthy()
    expect(screen.getByText(/Welcome to the "Football" group!/)).toBeTruthy()
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Create post')).toBeTruthy()
    expect(within(dialog).getByText(/Publish a new post in the "Football" feed\./)).toBeTruthy()
    expect(within(dialog).getByText(/^Add photos/)).toBeTruthy()
    fireEvent.change(within(dialog).getByPlaceholderText('Write something...'), {
      target: { value: 'A very long post about football. '.repeat(12) },
    })
    await userEvent.click(within(dialog).getByText('Publish'))
    await userEvent.click(await screen.findByText('Show more'))
    expect(screen.getByText('Hide')).toBeTruthy()
  })
})

describe('CategoryFeed: режим API группы', () => {
  it('загружает посты с Bearer, показывает автора, текст и группу', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      return jsonResponse({})
    })
    apiFeed()
    expect(await screen.findByText('Первый пост')).toBeTruthy()
    expect(screen.getByText('Анна')).toBeTruthy()
    expect(screen.getByText('Футбол')).toBeTruthy()
    expect(h.fetchMock).toHaveBeenCalledWith('/api/groups/5/posts', {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer feed-token' },
    })
  })

  it('без токена запрос идёт без заголовка авторизации', async () => {
    h.token = null
    h.fetchMock.mockImplementation(() => jsonResponse([]))
    apiFeed()
    await waitFor(() => expect(h.fetchMock).toHaveBeenCalled())
    expect((h.fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers).toEqual({
      'Content-Type': 'application/json',
    })
  })

  it('поиск в режиме API не падает и фильтрует по плоским полям', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts')
        return jsonResponse([apiPost(), apiPost({ id: 12, text: 'Второй пост', author: 'Иван' })])
      return jsonResponse({})
    })
    apiFeed()
    await screen.findByText('Второй пост')
    const search = screen.getByPlaceholderText('Поиск по постам...')
    await userEvent.type(search, 'Второй')
    expect(postCount()).toBe(1)
    expect(screen.queryByText('Первый пост')).toBeNull()
    await userEvent.clear(search)
    await userEvent.type(search, 'zzz')
    expect(postCount()).toBe(0)
  })

  it('отказ сервера и падение сети дают пустую ленту без ошибок', async () => {
    h.fetchMock.mockImplementation(() => jsonResponse({ message: 'fail' }, false))
    const first = apiFeed()
    await waitFor(() => expect(h.fetchMock).toHaveBeenCalled())
    expect(postCount()).toBe(0)
    first.unmount()
    h.fetchMock.mockImplementation(() => Promise.reject(new Error('offline')))
    apiFeed()
    await waitFor(() => expect(h.fetchMock).toHaveBeenCalled())
    expect(postCount()).toBe(0)
  })

  it('комментарии и картинки комментариев приходят с сервера и локализуются', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts')
        return jsonResponse([
          apiPost({
            comments: [
              { id: 91, author: 'Иван', avatar: '', text: 'Первый!', imageUrl: '/uploads/c.webp', createdAt: '2026-10-01T11:00:00.000Z' },
            ],
          }),
        ])
      return jsonResponse({})
    })
    apiFeed()
    const card = await screen.findByText('Первый пост')
    const post = card.closest('div.bg-white') as HTMLElement
    expect(within(post).getByText(/^Комментарии \(1\)$/)).toBeTruthy()
    await userEvent.click(within(post).getByText(/^Комментарии \(1\)$/))
    expect(within(post).getByText('Первый!')).toBeTruthy()
    const commentPhoto = within(post).getAllByAltText('Иван').find((img) => (img as HTMLImageElement).src.includes('/uploads/c.webp'))
    expect(commentPhoto).toBeTruthy()
  })

  it('лайк в API-режиме отправляется и обновляет счётчик', async () => {
    h.fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      if (url === '/api/groups/5/posts/11/like') return jsonResponse({ liked: true })
      return jsonResponse({})
    })
    apiFeed()
    const card = (await screen.findByText('Первый пост')).closest('div.bg-white') as HTMLElement
    await userEvent.click(within(card).getByText('5').closest('button')!)
    await waitFor(() => expect(within(card).getByText('6')).toBeTruthy())
    const likeCall = h.fetchMock.mock.calls.find((c) => c[0] === '/api/groups/5/posts/11/like')
    expect((likeCall![1] as RequestInit).method).toBe('POST')
  })

  it('отказ лайка показывает тост и не трогает счётчик', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost({ likes: 7, likedByMe: true })])
      if (url === '/api/groups/5/posts/11/like') return jsonResponse({ message: 'fail' }, false)
      return jsonResponse({})
    })
    apiFeed()
    const card = (await screen.findByText('Первый пост')).closest('div.bg-white') as HTMLElement
    await userEvent.click(within(card).getByText('7').closest('button')!)
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось поставить лайк' }))
    )
    expect(within(card).getByText('7')).toBeTruthy()
  })

  it('комментарий с фото уходит с image_url и появляется в ленте', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      if (url === '/api/groups/5/posts/11/comments')
        return jsonResponse({
          id: 77, postId: 11, text: '', imageUrl: '/uploads/new.webp',
          createdAt: '2026-10-02T10:00:00.000Z', author: 'Анна', avatar: '',
        })
      return jsonResponse({})
    })
    apiFeed()
    const card = (await screen.findByText('Первый пост')).closest('div.bg-white') as HTMLElement
    await userEvent.click(within(card).getByText(/^Комментарии \(0\)$/))
    const fileInput = card.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'c.png', { type: 'image/png' })] } })
    await within(card).findByAltText('pending')
    await userEvent.click(within(card).getAllByRole('button').filter((b) => b.querySelector('.lucide-send'))[0])
    await waitFor(() => expect(card.querySelector('img[src="/uploads/new.webp"]')).toBeTruthy())
    const call = h.fetchMock.mock.calls.find((c) => c[0] === '/api/groups/5/posts/11/comments')
    const body = JSON.parse((call![1] as RequestInit).body as string)
    expect(body.image_url).toMatch(/^data:image\/png;base64,/)
    expect(within(card).getByText(/^Комментарии \(1\)$/)).toBeTruthy()
  })

  it('отказ отправки комментария показывает тост и сохраняет текст', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      if (url === '/api/groups/5/posts/11/comments') return jsonResponse({ message: 'fail' }, false)
      return jsonResponse({})
    })
    apiFeed()
    const card = (await screen.findByText('Первый пост')).closest('div.bg-white') as HTMLElement
    await userEvent.click(within(card).getByText(/^Комментарии \(0\)$/))
    const input = within(card).getByPlaceholderText('Напишите комментарий...')
    await userEvent.type(input, 'Не потеряйся{Enter}')
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось отправить комментарий' }))
    )
    expect((input as HTMLInputElement).value).toBe('Не потеряйся')
    expect(within(card).getByText(/^Комментарии \(0\)$/)).toBeTruthy()
  })

  it('опубликованный пост добавляется после успешного ответа', async () => {
    h.fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/groups/5/posts' && init?.method === 'POST')
        return jsonResponse(apiPost({ id: 40, text: 'Свежий пост', author: 'Я' }))
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      return jsonResponse({})
    })
    const view = apiFeed()
    await screen.findByText('Первый пост')
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Напишите что-нибудь...'), { target: { value: 'Свежий пост' } })
    await userEvent.click(within(dialog).getByText('Опубликовать'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Свежий пост')).toBeTruthy()
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Пост опубликован' }))
  })

  it('отказ публикации оставляет диалог и текст и не врёт об успехе', async () => {
    h.fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/groups/5/posts' && init?.method === 'POST') return jsonResponse({ message: 'fail' }, false)
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      return jsonResponse({})
    })
    const view = apiFeed()
    await screen.findByText('Первый пост')
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    const textarea = within(dialog).getByPlaceholderText('Напишите что-нибудь...')
    fireEvent.change(textarea, { target: { value: 'Черновик' } })
    await userEvent.click(within(dialog).getByText('Опубликовать'))
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось опубликовать пост' }))
    )
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Пост опубликован' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((textarea as HTMLTextAreaElement).value).toBe('Черновик')
  })

  it('пост без необязательных полей рисуется пустым и не ломает поиск', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([{ id: 21, text: null, comments: [] }])
      return jsonResponse({})
    })
    apiFeed()
    await waitFor(() => expect(postCount()).toBe(1))
    const search = screen.getByPlaceholderText('Поиск по постам...')
    await userEvent.type(search, 'zzz')
    expect(postCount()).toBe(0)
  })

  it('пост без texts, comments и images вообще не ломает рендер', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([{ id: 22 }])
      return jsonResponse({})
    })
    apiFeed()
    await waitFor(() => expect(postCount()).toBe(1))
    expect(screen.getByText(/^Комментарии \(0\)$/)).toBeTruthy()
  })

  it('если сервер вернул null вместо комментария, счётчик не растёт', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      if (url === '/api/groups/5/posts/11/comments') return jsonResponse(null)
      return jsonResponse({})
    })
    apiFeed()
    const card = (await screen.findByText('Первый пост')).closest('div.bg-white') as HTMLElement
    await userEvent.click(within(card).getByText(/^Комментарии \(0\)$/))
    await userEvent.type(within(card).getByPlaceholderText('Напишите комментарий...'), 'Тишина{Enter}')
    await waitFor(() => expect(h.fetchMock.mock.calls.some((c) => c[0] === '/api/groups/5/posts/11/comments')).toBe(true))
    expect(within(card).getByText(/^Комментарии \(0\)$/)).toBeTruthy()
  })

  it('лайк и комментарий трогают только свой пост из двух', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost(), apiPost({ id: 12, text: 'Второй пост', author: 'Иван' })])
      if (url === '/api/groups/5/posts/11/like') return jsonResponse({ liked: true })
      if (url === '/api/groups/5/posts/11/comments')
        return jsonResponse({ id: 78, text: 'Только первому', createdAt: '2026-10-02T10:00:00.000Z', author: 'Анна', avatar: '' })
      return jsonResponse({})
    })
    apiFeed()
    const first = (await screen.findByText('Первый пост')).closest('div.bg-white') as HTMLElement
    const second = (await screen.findByText('Второй пост')).closest('div.bg-white') as HTMLElement
    await userEvent.click(within(first).getByText('5').closest('button')!)
    await waitFor(() => expect(within(first).getByText('6')).toBeTruthy())
    expect(within(second).getByText('5')).toBeTruthy()
    await userEvent.click(within(first).getByText(/^Комментарии \(0\)$/))
    await userEvent.type(within(first).getByPlaceholderText('Напишите комментарий...'), 'Только первому{Enter}')
    await waitFor(() => expect(within(first).getByText(/^Комментарии \(1\)$/)).toBeTruthy())
    expect(within(second).getByText(/^Комментарии \(0\)$/)).toBeTruthy()
  })

  it('пост, созданный сервером без даты и аватара, рисуется без падения', async () => {
    h.fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/groups/5/posts' && init?.method === 'POST') return jsonResponse({ id: 41 })
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      return jsonResponse({})
    })
    const view = apiFeed()
    await screen.findByText('Первый пост')
    await userEvent.click(view.container.querySelector('.lucide-circle-plus')!.closest('button')!)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Напишите что-нибудь...'), { target: { value: 'Без даты' } })
    await userEvent.click(within(dialog).getByText('Опубликовать'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(postCount()).toBe(2)
  })

  it('снятие лайка в API-режиме уменьшает счётчик', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost({ likes: 6, likedByMe: true })])
      if (url === '/api/groups/5/posts/11/like') return jsonResponse({ liked: false })
      return jsonResponse({})
    })
    apiFeed()
    const card = (await screen.findByText('Первый пост')).closest('div.bg-white') as HTMLElement
    await userEvent.click(within(card).getByText('6').closest('button')!)
    await waitFor(() => expect(within(card).getByText('5')).toBeTruthy())
  })

  it('комментарий-картинка без текста и даты с сервера рисуется', async () => {
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts')
        return jsonResponse([apiPost({ comments: [{ id: 90, author: 'Иван', avatar: '', imageUrl: '/uploads/only.webp', text: null }] })])
      return jsonResponse({})
    })
    apiFeed()
    const card = (await screen.findByText('Первый пост')).closest('div.bg-white') as HTMLElement
    await userEvent.click(within(card).getByText(/^Комментарии \(1\)$/))
    expect(card.querySelector('img[src="/uploads/only.webp"]')).toBeTruthy()
  })

  it('в английском режиме название группы и тексты — на английском', async () => {
    h.language = 'EN'
    h.fetchMock.mockImplementation((url: string) => {
      if (url === '/api/groups/5/posts') return jsonResponse([apiPost()])
      return jsonResponse({})
    })
    apiFeed()
    expect(await screen.findByText('Football')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search posts...')).toBeTruthy()
  })
})
