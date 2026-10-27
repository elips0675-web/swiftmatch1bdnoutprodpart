import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

const clientStub = { auth: { getUser: vi.fn() } }

const load = async () => {
  vi.resetModules()
  return import('@/lib/supabase')
}

describe('getSupabase', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    createClientMock.mockReturnValue(clientStub)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('создаёт клиента с сессией, автообновлением токена и realtime-лимитом', async () => {
    const { getSupabase } = await load()

    expect(getSupabase()).toBe(clientStub)
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(createClientMock).toHaveBeenCalledWith('https://demo.supabase.co', 'anon-key', {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  })

  it('повторный вызов отдаёт уже созданного клиента без новой инициализации', async () => {
    const { getSupabase } = await load()

    const first = getSupabase()
    const second = getSupabase()
    const third = getSupabase()

    expect(first).toBe(clientStub)
    expect(second).toBe(clientStub)
    expect(third).toBe(clientStub)
    expect(createClientMock).toHaveBeenCalledTimes(1)
  })

  it('без URL возвращает null, не создаёт клиента и предупреждает', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    const { getSupabase } = await load()

    expect(getSupabase()).toBeNull()
    expect(createClientMock).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('VITE_SUPABASE_URL'))
  })

  it('без anon-ключа возвращает null и не создаёт клиента', async () => {
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { getSupabase } = await load()

    expect(getSupabase()).toBeNull()
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('неудачная инициализация не повторяется: клиент остаётся null', async () => {
    createClientMock.mockImplementation(() => {
      throw new Error('bad url')
    })
    const { getSupabase } = await load()

    expect(getSupabase()).toBeNull()
    expect(getSupabase()).toBeNull()
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith('[Supabase] Failed to init:', expect.any(Error))
  })

  it('в продакшене отсутствие ключей не пишет предупреждение в консоль', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('DEV', false)
    const { getSupabase } = await load()

    expect(getSupabase()).toBeNull()
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('в продакшене сбой инициализации не пишет в консоль', async () => {
    createClientMock.mockImplementation(() => {
      throw new Error('bad url')
    })
    vi.stubEnv('DEV', false)
    const { getSupabase } = await load()

    expect(getSupabase()).toBeNull()
    expect(console.warn).not.toHaveBeenCalled()
  })
})
