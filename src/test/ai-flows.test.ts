import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const tokenState = vi.hoisted(() => ({ value: null as string | null }))

vi.mock('@/lib/token', () => ({ getToken: () => tokenState.value }))

import {
  aiChatIcebreakerSuggestions,
  aiGenerateProfileBio,
  generateIcebreakerSuggestions,
  generateProfileBio,
} from '@/shims/ai-flows'

const fetchMock = vi.fn()
const FALLBACK = ['Какое твое любимое хобби?', 'Где ты любишь отдыхать?', 'Какой фильм посоветуешь?']

const okJson = (body: unknown) => ({ ok: true, json: async () => body })
const failJson = (body: unknown = {}) => ({ ok: false, json: async () => body })

describe('aiChatIcebreakerSuggestions', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    tokenState.value = null
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('отдаёт подсказки сервера и передаёт chatUserId, язык и Bearer', async () => {
    tokenState.value = 'jwt'
    fetchMock.mockResolvedValueOnce(okJson({ suggestions: ['Привет!', 'Как дела?'] }))

    await expect(aiChatIcebreakerSuggestions({ chatUserId: 42, language: 'en' })).resolves.toEqual({
      suggestions: ['Привет!', 'Как дела?'],
    })

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/icebreakers/suggest')
    expect(request.method).toBe('POST')
    expect(request.headers.Authorization).toBe('Bearer jwt')
    expect(JSON.parse(request.body)).toEqual({ chat_user_id: 42, language: 'en' })
  })

  it('берёт userId и chat_user_id как альтернативные имена', async () => {
    fetchMock.mockResolvedValue(okJson({ suggestions: ['x'] }))

    await aiChatIcebreakerSuggestions({ userId: 7 })
    await aiChatIcebreakerSuggestions({ chat_user_id: 9 })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ chat_user_id: 7, language: 'ru' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ chat_user_id: 9, language: 'ru' })
  })

  it('без аргументов берёт язык из localStorage и не шлёт Authorization без токена', async () => {
    localStorage.setItem('lang', 'en')
    fetchMock.mockResolvedValueOnce(okJson({ suggestions: ['x'] }))

    await aiChatIcebreakerSuggestions()

    const [, request] = fetchMock.mock.calls[0]
    expect(request.headers.Authorization).toBeUndefined()
    expect(JSON.parse(request.body)).toEqual({ chat_user_id: undefined, language: 'en' })
  })

  it('без языка в localStorage по умолчанию русский', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ suggestions: ['x'] }))

    await aiChatIcebreakerSuggestions({})

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).language).toBe('ru')
  })

  it('отказ сервера отдаёт готовый fallback даже при подсказках в теле', async () => {
    fetchMock.mockResolvedValueOnce(failJson({ suggestions: ['подмена'] }))

    await expect(aiChatIcebreakerSuggestions({ chatUserId: 1 })).resolves.toEqual({ suggestions: FALLBACK })
  })

  it('пустой или нечисловой список подсказок отдаёт fallback', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ suggestions: [] }))
    fetchMock.mockResolvedValueOnce(okJson({ suggestions: 'нет' }))
    fetchMock.mockResolvedValueOnce(okJson({}))

    await expect(aiChatIcebreakerSuggestions()).resolves.toEqual({ suggestions: FALLBACK })
    await expect(aiChatIcebreakerSuggestions()).resolves.toEqual({ suggestions: FALLBACK })
    await expect(aiChatIcebreakerSuggestions()).resolves.toEqual({ suggestions: FALLBACK })
  })

  it('сетевой сбой отдаёт fallback, а не исключение', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await expect(aiChatIcebreakerSuggestions()).resolves.toEqual({ suggestions: FALLBACK })
  })
})

describe('aiGenerateProfileBio и алиасы', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('возвращает пустую строку и не ходит в сеть', async () => {
    await expect(aiGenerateProfileBio()).resolves.toEqual({ bio: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('алиасы указывают на те же функции', () => {
    expect(generateIcebreakerSuggestions).toBe(aiChatIcebreakerSuggestions)
    expect(generateProfileBio).toBe(aiGenerateProfileBio)
  })
})
