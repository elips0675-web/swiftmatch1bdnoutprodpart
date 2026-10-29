// Stage 226: fail-fast при старте. `server/src/index.js:100` требует
// CORS_ORIGIN в production: без него CORS открывается на `*` и любой источник
// получает доступ к API с cookie сессии. Проверка живёт в теле модуля, поэтому
// её нельзя покрыть из теста собранного приложения — здесь импорт модуля
// обязан отклониться до создания HTTP-сервера.

import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NODE_ENV = 'production'
  process.env.CORS_ORIGIN = ''
  process.env.JWT_SECRET = 'test-index-cors-secret-0123456789abcdef'
  delete process.env.REDIS_URL
})

describe('старт в production без CORS_ORIGIN', () => {
  it('падает с понятной ошибкой, а не открывает CORS на *', async () => {
    await expect(import('../index.js')).rejects.toThrow('CORS_ORIGIN is required in production (fail-fast)')
  })
})
