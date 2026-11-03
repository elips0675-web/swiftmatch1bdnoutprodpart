import { describe, it, expect, vi, afterEach } from 'vitest'

async function loadConfig() {
  vi.resetModules()
  return import('@/lib/env')
}

describe('config: адрес API', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('без VITE_API_URL подставляет /api', async () => {
    vi.stubEnv('VITE_API_URL', undefined)

    const { config } = await loadConfig()

    expect(config.apiUrl).toBe('/api')
  })

  it('берёт адрес API из окружения', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')

    const { config } = await loadConfig()

    expect(config.apiUrl).toBe('https://api.example.test')
  })
})
