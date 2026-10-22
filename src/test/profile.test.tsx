import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => {
  const t = (key: string, options?: Record<string, unknown>) => {
    let value = key
    if (options) {
      Object.entries(options).forEach(([k, v]) => { value = value.replace(`{${k}}`, String(v)) })
    }
    return value
  }
  return {
    t,
    push: vi.fn(),
    toast: vi.fn(),
    fetchMock: vi.fn(),
    createObjectURL: vi.fn(() => 'blob:preview-url'),
    revokeObjectURL: vi.fn(),
    state: {
      token: 'profile-token' as string | null,
      language: 'RU' as 'RU' | 'EN',
      flags: { profileActivityEnabled: false, userWatchesEnabled: false } as Record<string, boolean>,
      me: {} as Record<string, unknown>,
      meResponse: null as null | (() => Promise<unknown>),
      aliases: [] as unknown[],
      aliasesResponse: null as null | (() => Promise<unknown>),
      verified: false,
      verificationResponse: null as null | (() => Promise<unknown>),
      uploadResponse: null as null | (() => Promise<unknown>),
      deleteResponse: null as null | (() => Promise<unknown>),
      deletePhotoCalls: [] as Array<{ url: string; init?: RequestInit }>,
      uploadCalls: [] as Array<{ url: string; init?: RequestInit }>,
    },
  }
})

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: h.t, language: h.state.language, setLanguage: vi.fn() }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/context/feature-flags-context', () => ({
  useFeatureFlags: () => h.state.flags,
}))

vi.mock('@/shims/next-navigation', () => ({
  useRouter: () => ({ push: h.push, back: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/token', () => ({ getToken: () => h.state.token }))

vi.mock('@/hooks/use-toast', () => ({
  toast: h.toast,
  useToast: () => ({ toasts: [], toast: h.toast, dismiss: vi.fn() }),
}))

vi.mock('@/components/layout/app-header', () => ({ AppHeader: () => <div data-testid="app-header" /> }))
vi.mock('@/components/navigation/bottom-nav', () => ({ BottomNav: () => <div data-testid="bottom-nav" /> }))

vi.mock('@/lib/demo-data', () => ({
  GROUP_CATEGORIES: [
    {
      name_ru: 'Спорт',
      subgroups: [
        { id: 11, name_ru: 'Бег', name_en: 'Running', members: 42, online: 7 },
        { id: 12, name_ru: 'Кино', name_en: 'Cinema', members: 13, online: 2 },
      ],
    },
  ],
}))

import ProfilePage from '@/pages/profile'

const CONTENT = {
  interests: ['sport', 'travel', 'photography', 'pets'],
  dating_goals: [],
  education: [],
  banned_words: [],
  cities: [],
}

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data })
}

function errorResponse(status = 500) {
  return Promise.resolve({ ok: false, status, json: async () => ({ message: 'boom' }) })
}

function profileFixture(overrides: Record<string, unknown> = {}) {
  return {
    displayName: 'Анна',
    age: 31,
    city: 'Москва',
    bio: 'Люблю горы и кофе по утрам',
    gender: 'female',
    lookingFor: 'male',
    height: 170,
    zodiac: 'common.zodiac.leo',
    datingGoal: 'goal.serious_relationship',
    interests: ['interest.sport'],
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>
  )
}

async function renderReady() {
  const view = renderPage()
  await screen.findByText('profile.tab.data')
  return view
}

function clickTab(name: string) {
  return userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))
}

function fileInput(container: HTMLElement, accept: string) {
  const input = container.querySelector(`input[accept="${accept}"]`)
  if (!input) throw new Error(`input with accept=${accept} not found`)
  return input as HTMLInputElement
}

function videoInput(container: HTMLElement) {
  const input = container.querySelector('input[accept^="video"]')
  if (!input) throw new Error('video input not found')
  return input as HTMLInputElement
}

function headingText() {
  return document.querySelector('h3')?.textContent || ''
}

function galleryImages(container: HTMLElement) {
  return Array.from(container.querySelectorAll('img')).filter((img) => (img.getAttribute('alt') || '').startsWith('Gallery'))
}

function deleteButton(container: HTMLElement, index = 0) {
  const buttons = Array.from(container.querySelectorAll('button')).filter((b) => b.querySelector('.lucide-trash-2'))
  return buttons[index] as HTMLButtonElement | undefined
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  h.state.token = 'profile-token'
  h.state.language = 'RU'
  h.state.flags = { profileActivityEnabled: false, userWatchesEnabled: false }
  h.state.me = {}
  h.state.meResponse = null
  h.state.aliases = []
  h.state.aliasesResponse = null
  h.state.verified = false
  h.state.verificationResponse = null
  h.state.uploadResponse = null
  h.state.deleteResponse = null
  h.state.deletePhotoCalls = []
  h.state.uploadCalls = []

  Object.defineProperty(URL, 'createObjectURL', { value: h.createObjectURL, writable: true, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: h.revokeObjectURL, writable: true, configurable: true })

  h.fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/content')) return jsonResponse(CONTENT)
    if (u.includes('/api/profile/activity')) return jsonResponse([])
    if (u.includes('/api/profile/me')) return h.state.meResponse ? h.state.meResponse() : jsonResponse(h.state.me)
    if (u.includes('/api/profile/aliases')) return h.state.aliasesResponse ? h.state.aliasesResponse() : jsonResponse(h.state.aliases)
    if (u.includes('/api/profile/verification')) return h.state.verificationResponse ? h.state.verificationResponse() : jsonResponse({ verified: h.state.verified })
    if (u.includes('/api/upload')) {
      h.state.uploadCalls.push({ url: u, init })
      return h.state.uploadResponse ? h.state.uploadResponse() : jsonResponse({ url: '/uploads/pic.webp' })
    }
    if (u.includes('/api/photos/')) {
      h.state.deletePhotoCalls.push({ url: u, init })
      return h.state.deleteResponse ? h.state.deleteResponse() : jsonResponse({ success: true })
    }
    return jsonResponse({})
  })
  globalThis.fetch = h.fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProfilePage: загрузка и данные профиля', () => {
  it('до монтирования показывает скелетон', () => {
    const html = renderToString(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    )
    expect(html).toContain('h-64')
    expect(html).not.toContain('profile.tab.data')
  })

  it('после монтирования показывает демо-профиль при пустом хранилище', async () => {
    await renderReady()
    expect(headingText()).toContain('profile.demo_name, 24')
    expect(screen.getByText('profile.demo_city')).toBeTruthy()
    expect(screen.getByText('profile.score_medium')).toBeTruthy()
  })

  it('берёт профиль из localStorage и подставляет имя вместо пустого displayName', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ displayName: '', name: 'Из имени' })))
    await renderReady()
    expect(headingText()).toContain('Из имени, 31')
    expect(screen.getByText('Москва')).toBeTruthy()
    expect(screen.getByText('profile.score_medium')).toBeTruthy()
  })

  it('женский профиль без поля lookingFor получает male', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ lookingFor: undefined })))
    await renderReady()
    expect(screen.getByText('gender.men')).toBeTruthy()
  })

  it('женщина, которая ищет женщин, не теряет свой выбор', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ gender: 'female', lookingFor: 'female' })))
    await renderReady()
    expect(screen.getByText('gender.female')).toBeTruthy()
    expect(screen.getByText('gender.women')).toBeTruthy()
  })

  it.each(['displayName', 'bio', 'city'])('битый профиль в localStorage (%s = «???») заменяется демо-профилем', async (field) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ [field]: '???' })))
    await renderReady()
    expect(headingText()).toContain('profile.demo_name, 24')
    expect(screen.queryByText('???')).toBeNull()
    expect(spy).toHaveBeenCalledWith('Failed to parse profile', expect.anything())
    spy.mockRestore()
  })

  it('невалидный JSON в localStorage не роняет страницу', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('userProfile', '{oops')
    await renderReady()
    expect(headingText()).toContain('profile.demo_name, 24')
    expect(spy).toHaveBeenCalledWith('Failed to parse profile', expect.anything())
    spy.mockRestore()
  })

  it('подменяет поля данными /api/profile/me и сохраняет их в localStorage', async () => {
    h.state.me = {
      display_name: 'Мария',
      age: 29,
      city: 'Казань',
      height: 165,
      gender: 'male',
      looking_for: 'female',
      dating_goal: 'goal.friendship',
      zodiac: 'common.zodiac.aries',
      bio: 'Новый текст',
      interests: ['interest.travel'],
      attachment_style: 'secure',
      birth_date: '1996-03-08',
    }
    await renderReady()
    expect(headingText()).toContain('Мария, 29')
    expect(screen.getByText('Казань')).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem('userProfile') || '{}')
    expect(saved.birthDate).toBe('1996-03-08')
    expect(saved.interests).toEqual(['interest.travel'])
    expect(saved.attachmentStyle).toBe('secure')
    expect(screen.getByText('attach.style.secure.label')).toBeTruthy()
  })

  it('нечисловая дата рождения остаётся как есть, пустая часть до T даёт пустую строку', async () => {
    h.state.me = { birth_date: 'не дата' }
    const first = await renderReady()
    expect(JSON.parse(localStorage.getItem('userProfile') || '{}').birthDate).toBe('не дата')
    first.unmount()
    cleanup()
    localStorage.clear()
    h.state.me = { birth_date: 'T10:00' }
    await renderReady()
    expect(JSON.parse(localStorage.getItem('userProfile') || '{}').birthDate).toBe('')
  })

  it('пустой ответ API оставляет демо-поля', async () => {
    h.state.me = {}
    await renderReady()
    expect(headingText()).toContain('profile.demo_name, 24')
    const saved = JSON.parse(localStorage.getItem('userProfile') || '{}')
    expect(saved.displayName).toBe('profile.demo_name')
    expect(saved.lookingFor).toBe('male')
  })

  it('падение сети на /api/profile/me не мешает показать профиль', async () => {
    h.state.meResponse = () => Promise.reject(new Error('offline'))
    await renderReady()
    expect(headingText()).toContain('profile.demo_name, 24')
    expect(screen.getByText('profile.tab.data')).toBeTruthy()
  })

  it('не-массив interests от API не затирает интересы из хранилища', async () => {
    h.state.me = { interests: 'interest.sport' }
    await renderReady()
    const saved = JSON.parse(localStorage.getItem('userProfile') || '{}')
    expect(saved.interests).toEqual(['interest.photography', 'interest.travel', 'interest.coffee', 'interest.music', 'interest.sport'])
  })

  it('пустой массив interests от API оставляет прежние интересы', async () => {
    h.state.me = { interests: [] }
    await renderReady()
    const saved = JSON.parse(localStorage.getItem('userProfile') || '{}')
    expect(saved.interests.length).toBe(5)
  })

  it('интересы-строки: technology сводится к tech, дубли и запрещённые слова убираются', async () => {
    h.state.me = { interests: ['interest.technology', 'interest.tech', 'Хуй', 'interest.coffee'] }
    await renderReady()
    const saved = JSON.parse(localStorage.getItem('userProfile') || '{}')
    expect(saved.interests).toEqual(['interest.tech', 'interest.coffee'])
  })

  it('интересы-объекты переводятся в ключи, нераспознанные остаются как есть', async () => {
    h.state.me = {
      interests: [
        { name_ru: 'Спорт' },
        { name_ru: '???', name_en: 'Travel' },
        'interest.coffee',
        { name_ru: 'Неизвестно' },
        { name_en: '' },
        { name_ru: 'Хуй' },
      ],
    }
    await renderReady()
    const saved = JSON.parse(localStorage.getItem('userProfile') || '{}')
    expect(saved.interests).toEqual(['interest.sport', 'interest.travel', 'interest.coffee', 'Неизвестно', ''])
  })

  it('профиль без имени показывает заглушку', async () => {
    localStorage.setItem('userProfile', JSON.stringify({ age: 30 }))
    await renderReady()
    expect(headingText()).toContain('profile.someone, 30')
  })
})

describe('ProfilePage: фото и галерея', () => {
  it('берёт фото из ответа /api/profile/me и кладёт их в хранилище', async () => {
    h.state.me = { photos: [{ id: 7, url: '/uploads/a.webp' }, { id: 8, url: '/uploads/b.webp' }, { url: '' }, null] }
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(2))
    expect(JSON.parse(localStorage.getItem('userProfileGallery') || '[]')).toEqual(['/uploads/a.webp', '/uploads/b.webp'])
  })

  it('без фото от API берёт сохранённую галерею', async () => {
    localStorage.setItem('userProfileGallery', JSON.stringify(['/old/one.webp']))
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(1))
    expect(localStorage.getItem('userProfileGallery')).toBe('["/old/one.webp"]')
  })

  it('без фото и сохранённой галереи подставляет три демо-фото', async () => {
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    expect(galleryImages(view.container)).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem('userProfileGallery') || '[]')).toHaveLength(3)
  })

  it('кнопка «добавить» открывает выбор файла, успешная загрузка берёт url с сервера', async () => {
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    await userEvent.click(screen.getByText('profile.add'))
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()

    const input = fileInput(view.container, 'image/*')
    fireEvent.change(input, { target: { files: [new File(['x'], 'pic.jpg', { type: 'image/jpeg' })] } })

    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.photo_uploaded' })))
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(4))
    const saved = JSON.parse(localStorage.getItem('userProfileGallery') || '[]')
    expect(saved[saved.length - 1]).toBe('/uploads/pic.webp')
    const call = h.state.uploadCalls[0]
    expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer profile-token')
    expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:preview-url')
    expect(input.value).toBe('')
  })

  it('отказ сервера при загрузке оставляет фото как data-url из файла', async () => {
    h.state.uploadResponse = () => errorResponse(500)
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    fireEvent.change(fileInput(view.container, 'image/*'), { target: { files: [new File(['data'], 'pic.png', { type: 'image/png' })] } })
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('userProfileGallery') || '[]')
      expect(String(saved[saved.length - 1])).toContain('data:')
    })
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.photo_uploaded' }))
  })

  it('сетевая ошибка при загрузке показывает тост и тоже уходит в data-url', async () => {
    h.state.uploadResponse = () => Promise.reject(new Error('offline'))
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    fireEvent.change(fileInput(view.container, 'image/*'), { target: { files: [new File(['data'], 'pic.png', { type: 'image/png' })] } })
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'common.error' })))
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('userProfileGallery') || '[]')
      expect(String(saved[saved.length - 1])).toContain('data:')
    })
  })

  it('успешный ответ без поля url тоже уходит в data-url', async () => {
    h.state.uploadResponse = () => jsonResponse({ id: 5 })
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    fireEvent.change(fileInput(view.container, 'image/*'), { target: { files: [new File(['data'], 'pic.png', { type: 'image/png' })] } })
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('userProfileGallery') || '[]')
      expect(String(saved[saved.length - 1])).toContain('data:')
    })
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.photo_uploaded' }))
  })

  it('ошибка чтения файла оставляет предпросмотр и не пишет галерею', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    class FailingReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() {
        setTimeout(() => this.onerror?.(), 0)
      }
    }
    vi.stubGlobal('FileReader', FailingReader)
    h.state.uploadResponse = () => errorResponse(500)
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    fireEvent.change(fileInput(view.container, 'image/*'), { target: { files: [new File(['x'], 'pic.png', { type: 'image/png' })] } })
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Photo convert error:', expect.anything()))
    const saved = JSON.parse(localStorage.getItem('userProfileGallery') || '[]')
    expect(saved).not.toContain('blob:preview-url')
    errorSpy.mockRestore()
  })

  it('ошибка записи в хранилище при загрузке не теряет фото', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === 'userProfileGallery' && value.includes('/uploads/pic.webp')) throw new Error('quota')
      return undefined as void
    })
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    fireEvent.change(fileInput(view.container, 'image/*'), { target: { files: [new File(['x'], 'pic.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Gallery persist error:', expect.anything()))
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(4))
    setItemSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('без токена загрузка идёт без заголовка авторизации', async () => {
    h.state.token = null
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    fireEvent.change(fileInput(view.container, 'image/*'), { target: { files: [new File(['x'], 'pic.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(h.state.uploadCalls).toHaveLength(1))
    expect(h.state.uploadCalls[0].init?.headers).toEqual({})
  })

  it('пустой выбор файла ничего не делает', async () => {
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    fireEvent.change(fileInput(view.container, 'image/*'), { target: { files: [] } })
    expect(h.state.uploadCalls).toHaveLength(0)
  })

  it('удаление последнего фото показывает ошибку и оставляет его', async () => {
    localStorage.setItem('userProfileGallery', JSON.stringify(['/only/one.webp']))
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(1))
    const button = deleteButton(view.container)
    expect(button).toBeTruthy()
    await userEvent.click(button as HTMLButtonElement)
    await userEvent.click(await screen.findByText('dialog.delete_photo.confirm'))
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'delete_photo_error.title' }))
    expect(galleryImages(view.container)).toHaveLength(1)
    expect(h.state.deletePhotoCalls).toHaveLength(0)
  })

  it('удаление blob-фото отзывает ссылку и чистит хранилище, на сервер не ходит', async () => {
    localStorage.setItem('userProfileGallery', JSON.stringify(['blob:old', '/kept/one.webp']))
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(2))
    await userEvent.click(deleteButton(view.container) as HTMLButtonElement)
    await userEvent.click(await screen.findByText('dialog.delete_photo.confirm'))
    expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:old')
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.photo_deleted' }))
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(1))
    expect(JSON.parse(localStorage.getItem('userProfileGallery') || '[]')).toEqual(['/kept/one.webp'])
    expect(h.state.deletePhotoCalls).toHaveLength(0)
  })

  it('фото с сервера удаляется через DELETE /api/photos/:id с Bearer', async () => {
    h.state.me = { photos: [{ id: 42, url: '/uploads/a.webp' }, { id: 43, url: '/uploads/b.webp' }] }
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(2))
    await userEvent.click(deleteButton(view.container) as HTMLButtonElement)
    await userEvent.click(await screen.findByText('dialog.delete_photo.confirm'))
    await waitFor(() => expect(h.state.deletePhotoCalls).toHaveLength(1))
    expect(h.state.deletePhotoCalls[0].url).toContain('/api/photos/42')
    expect(h.state.deletePhotoCalls[0].init?.method).toBe('DELETE')
    expect((h.state.deletePhotoCalls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer profile-token')
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.error' }))
  })

  it('отказ сервера при удалении показывает тост ошибки', async () => {
    h.state.me = { photos: [{ id: 42, url: '/uploads/a.webp' }, { id: 43, url: '/uploads/b.webp' }] }
    h.state.deleteResponse = () => errorResponse(500)
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(2))
    await userEvent.click(deleteButton(view.container) as HTMLButtonElement)
    await userEvent.click(await screen.findByText('dialog.delete_photo.confirm'))
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.error', description: 'toast.photo_delete_failed' })))
  })

  it('сетевая ошибка при удалении показывает тост ошибки', async () => {
    h.state.me = { photos: [{ id: 42, url: '/uploads/a.webp' }, { id: 43, url: '/uploads/b.webp' }] }
    h.state.deleteResponse = () => Promise.reject(new Error('offline'))
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(2))
    await userEvent.click(deleteButton(view.container) as HTMLButtonElement)
    await userEvent.click(await screen.findByText('dialog.delete_photo.confirm'))
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'toast.photo_delete_failed' })))
  })

  it('просмотр фото открывает карусель и закрывается кнопкой', async () => {
    localStorage.setItem('userProfileGallery', JSON.stringify(['/one.webp', '/two.webp']))
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(2))
    await userEvent.click(screen.getAllByText('button.reveal')[1])
    const dialog = (await screen.findByRole('dialog')) as HTMLElement
    expect(within(dialog).getAllByAltText('Gallery view')).toHaveLength(2)
    const close = dialog.querySelector('div[class*="top-6"] button') as HTMLButtonElement
    await userEvent.click(close)
    await waitFor(() => expect(screen.queryAllByAltText('Gallery view')).toHaveLength(0))
  })
})

describe('ProfilePage: конкурс, буст и сторис', () => {
  it('кнопка участия открывает выбор фото и отправляет выбранное', async () => {
    localStorage.setItem('userProfileGallery', JSON.stringify(['/one.webp', '/two.webp']))
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(2))
    await userEvent.click(screen.getByText('button.participate'))
    const option = await screen.findByAltText('Photo 1')
    await userEvent.click(option)
    await userEvent.click(screen.getByText('profile.contest_submit'))
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.contest_accepted' }))
    expect(localStorage.getItem('contest_participation')).toBe('true')
    await waitFor(() => expect(screen.getByText('profile.application_sent')).toBeTruthy())
  })

  it('blob-фото нельзя отправить в конкурс', async () => {
    localStorage.setItem('userProfileGallery', JSON.stringify(['blob:fresh', '/two.webp']))
    const view = await renderReady()
    await clickTab('profile.tab.gallery')
    await waitFor(() => expect(galleryImages(view.container)).toHaveLength(2))
    await userEvent.click(screen.getByText('button.participate'))
    await userEvent.click(await screen.findByAltText('Photo 0'))
    const submit = screen.getByText('profile.contest_submit').closest('button') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await userEvent.click(screen.getByText('button.close'))
    await waitFor(() => expect(screen.queryByText('profile.contest_submit')).toBeNull())
  })

  it('участие из хранилища блокирует кнопку и показывает отметку', async () => {
    localStorage.setItem('contest_participation', 'true')
    await renderReady()
    await clickTab('profile.tab.gallery')
    expect(screen.getByText('profile.application_sent')).toBeTruthy()
    const button = screen.getByText('profile.application_sent').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('реклама в бусте активирует его и повторное нажатие пишет, что он уже активен', async () => {
    await renderReady()
    await userEvent.click(screen.getByText('profile.boost'))
    await userEvent.click(await screen.findByText('profile.boost_watch_ad'))
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.boost_activated' }))
    await waitFor(() => expect(screen.getByText('profile.boost_active')).toBeTruthy())
    await userEvent.click(screen.getByText('profile.boost_active'))
    await userEvent.click(await screen.findByText('profile.boost_watch_ad'))
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.boost_already_active' }))
  })

  it('оплата буста показывает заглушку оплаты', async () => {
    await renderReady()
    await userEvent.click(screen.getByText('profile.boost'))
    await userEvent.click(await screen.findByText('profile.boost_pay'))
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.payment' }))
  })

  it('активный буст из профиля включает статус и тост с остатком минут', async () => {
    const until = new Date(Date.now() + 10 * 60_000).toISOString()
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ boost: { boostedUntil: until } })))
    await renderReady()
    await waitFor(() => expect(screen.getByText('profile.boost_active')).toBeTruthy())
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'toast.boost_active' }))
  })

  it('истёкший буст не включает статус', async () => {
    const until = new Date(Date.now() - 60_000).toISOString()
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ boost: { boostedUntil: until } })))
    await renderReady()
    expect(screen.getByText('profile.boost')).toBeTruthy()
    expect(screen.queryByText('profile.boost_active')).toBeNull()
  })

  it('добавление сторис кладёт видео в сетку и очищает input', async () => {
    const view = await renderReady()
    await clickTab('profile.tab.stories')
    const input = videoInput(view.container)
    fireEvent.change(input, { target: { files: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })] } })
    await waitFor(() => expect(view.container.querySelectorAll('video')).toHaveLength(1))
    expect(view.container.querySelector('video')?.getAttribute('src')).toBe('blob:preview-url')
    expect(input.value).toBe('')
  })

  it('кнопка «добавить» в сторис открывает выбор видео', async () => {
    const view = await renderReady()
    await clickTab('profile.tab.stories')
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    await userEvent.click(screen.getByText('profile.add'))
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
    expect(videoInput(view.container)).toBeTruthy()
  })

  it('пустой выбор видео ничего не добавляет', async () => {
    const view = await renderReady()
    await clickTab('profile.tab.stories')
    fireEvent.change(videoInput(view.container), { target: { files: [] } })
    expect(view.container.querySelectorAll('video')).toHaveLength(0)
  })
})

describe('ProfilePage: вкладки, группы и флаги', () => {
  it('показывает вкладку групп с пустым состоянием', async () => {
    await renderReady()
    await clickTab('profile.tab.groups')
    expect(await screen.findByText('chats.no_groups')).toBeTruthy()
  })

  it('выводит только группы, в которые вступил пользователь, и переводит названия', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ joinedGroups: ['Бег'] })))
    const view = await renderReady()
    await clickTab('profile.tab.groups')
    expect(await screen.findByText('Бег')).toBeTruthy()
    expect(screen.queryByText('Кино')).toBeNull()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText(/^7 chats\.online$/)).toBeTruthy()
    const link = view.container.querySelector('a[href="/chats?groupId=11"]')
    expect(link).toBeTruthy()
  })

  it('на английском показывает английское название группы', async () => {
    h.state.language = 'EN'
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ joinedGroups: ['Running'] })))
    await renderReady()
    await clickTab('profile.tab.groups')
    expect(await screen.findByText('Running')).toBeTruthy()
    expect(screen.queryByText('Running')).toBeTruthy()
  })

  it('ссылка на просмотры скрыта без флага и показана с флагом', async () => {
    const first = await renderReady()
    expect(first.container.querySelector('[data-testid="profile-watching-link"]')).toBeNull()
    first.unmount()
    cleanup()
    h.state.flags = { profileActivityEnabled: false, userWatchesEnabled: true }
    const second = await renderReady()
    expect(second.container.querySelector('[data-testid="profile-watching-link"]')).toBeTruthy()
  })

  it('вкладка активности появляется только под флагом', async () => {
    h.state.flags = { profileActivityEnabled: true, userWatchesEnabled: false }
    await renderReady()
    expect(screen.getByText('profile.tab.activity')).toBeTruthy()
    await clickTab('profile.tab.activity')
    await waitFor(() => expect(h.fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/profile/activity'))).toBe(true))
  })

  it('алиасы рисуются, основной помечен звездой; не-массив игнорируется', async () => {
    h.state.aliases = [{ id: 1, alias: 'Аня', is_primary: true }, { id: 2, alias: 'Энни', is_primary: false }]
    const first = await renderReady()
    expect(await screen.findByText('Аня')).toBeTruthy()
    expect(screen.getByText('Энни')).toBeTruthy()
    first.unmount()
    cleanup()
    h.state.aliasesResponse = () => jsonResponse({ not: 'array' })
    const second = await renderReady()
    expect(second.container.textContent).not.toContain('Аня')
    expect(screen.queryByText('Аня')).toBeNull()
    second.unmount()
    cleanup()
    h.state.aliasesResponse = () => errorResponse(401)
    await renderReady()
    expect(screen.queryByText('Аня')).toBeNull()
  })

  it('без токена не запрашивает алиасы и верификацию', async () => {
    h.state.token = null
    await renderReady()
    const urls = h.fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/profile/aliases'))).toBe(false)
    expect(urls.some((u) => u.includes('/api/profile/verification'))).toBe(false)
  })

  it('падение запросов алиасов и верификации не ломает страницу', async () => {
    h.state.aliasesResponse = () => Promise.reject(new Error('offline'))
    h.state.verificationResponse = () => Promise.reject(new Error('offline'))
    await renderReady()
    expect(screen.getByText('profile.tab.data')).toBeTruthy()
  })

  it('верификация показывается только при verified true', async () => {
    h.state.verified = true
    const first = await renderReady()
    await waitFor(() => expect(first.container.querySelectorAll('svg').length).toBeGreaterThan(0))
    first.unmount()
    cleanup()
    h.state.verified = false
    h.state.verificationResponse = () => errorResponse(401)
    await renderReady()
    expect(screen.getByText('profile.tab.data')).toBeTruthy()
  })
})

describe('ProfilePage: блок данных профиля', () => {
  it.each([
    [{ displayName: 'Анна' }, 'profile.score_low'],
    [{ displayName: 'Анна', bio: 'а'.repeat(240), city: 'Москва', gender: 'female' }, 'profile.score_medium'],
    [
      {
        displayName: 'Анна',
        bio: 'а'.repeat(240),
        city: 'Москва',
        gender: 'female',
        zodiac: 'common.zodiac.leo',
        height: 170,
        datingGoal: 'goal.serious_relationship',
        education: 'education.higher',
        attachmentStyle: 'secure',
      },
      'profile.score_high',
    ],
    [
      {
        displayName: 'Анна',
        bio: 'а'.repeat(240),
        city: 'Москва',
        gender: 'female',
        zodiac: 'common.zodiac.leo',
        height: 170,
        datingGoal: 'goal.serious_relationship',
        education: 'education.higher',
        attachmentStyle: 'secure',
        photos: ['a', 'b', 'c'],
        interests: ['interest.sport', 'interest.travel', 'interest.coffee', 'interest.music', 'interest.yoga'],
      },
      'profile.score_perfect',
    ],
  ])('считает полноту профиля (%#)', async (data, expected) => {
    localStorage.setItem('userProfile', JSON.stringify(data))
    await renderReady()
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('показывает мужской пол, поиск женщин и цель', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ gender: 'male', lookingFor: 'female' })))
    await renderReady()
    expect(screen.getByText('gender.male')).toBeTruthy()
    expect(screen.getByText('gender.women')).toBeTruthy()
    expect(screen.getByText('goal.serious_relationship')).toBeTruthy()
  })

  it('поиск «все» показывается отдельной подписью', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ gender: 'male', lookingFor: 'all' })))
    await renderReady()
    expect(screen.getByText('gender.all')).toBeTruthy()
  })

  it('интересы фильтруются по разрешённым и запрещённым словам и сортируются', async () => {
    localStorage.setItem(
      'userProfile',
      JSON.stringify(
        profileFixture({
          interests: ['interest.travel', 'interest.sport', 'Хуй', 'interest.coffee', 'interest.pets'],
        })
      )
    )
    await renderReady()
    const badges = Array.from(document.querySelectorAll('span,div'))
      .filter((el) => el.className.includes('rounded-lg'))
      .map((el) => (el.textContent || '').trim())
      .filter((text) => text.startsWith('interest.'))
    expect(badges).toEqual(['interest.pets', 'interest.sport', 'interest.travel'])
  })

  it('без attachmentStyle предлагает пройти тест и ведёт на него', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ attachmentStyle: null })))
    await renderReady()
    await userEvent.click(screen.getByText('profile.start_test'))
    expect(h.push).toHaveBeenCalledWith('/profile/attachment-test')
  })

  it('с attachmentStyle показывает стиль и кнопку повторного прохождения', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ attachmentStyle: 'anxious' })))
    await renderReady()
    expect(screen.getByText('attach.style.anxious.label')).toBeTruthy()
    await userEvent.click(screen.getByText('profile.retake_test'))
    expect(h.push).toHaveBeenCalledWith('/profile/attachment-test')
  })

  it('ранг подтягивается из совместимости и интересов', async () => {
    localStorage.setItem('userProfile', JSON.stringify(profileFixture({ match: 95 })))
    await renderReady()
    expect(screen.getByText('profile.rank')).toBeTruthy()
  })

  it('кнопки шапки ведут на редактирование, faq и настройки', async () => {
    const view = await renderReady()
    const hrefs = Array.from(view.container.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/profile/edit')
    expect(hrefs).toContain('/faq')
    expect(hrefs).toContain('/settings')
  })
})
