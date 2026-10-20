vi.hoisted(() => {
  delete process.env.JWT_SECRET
})

const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: {
      ...actual.default,
      readFileSync: fsMocks.readFileSync,
      writeFileSync: fsMocks.writeFileSync,
    },
  }
})

describe('JWT_SECRET: dev-секрет без JWT_SECRET в окружении', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    delete process.env.JWT_SECRET
  })

  afterEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    vi.restoreAllMocks()
  })

  it('создаёт dev-секрет, пишет его в файл и предупреждает, когда файла ещё нет', async () => {
    fsMocks.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { JWT_SECRET } = await import('../middleware.js')
    const secret = JWT_SECRET()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1)
    expect(fsMocks.writeFileSync.mock.calls[0][1]).toBe(secret)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET не задан'))
  })

  it('повторный вызов отдаёт тот же секрет из кэша процесса', async () => {
    fsMocks.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { JWT_SECRET } = await import('../middleware.js')
    expect(JWT_SECRET()).toBe(JWT_SECRET())
    expect(fsMocks.readFileSync).toHaveBeenCalledTimes(1)
  })

  it('сохранённый секрет читается из файла без пересоздания', async () => {
    fsMocks.readFileSync.mockReturnValue('saved-dev-secret-value\n')
    const { JWT_SECRET } = await import('../middleware.js')
    expect(JWT_SECRET()).toBe('saved-dev-secret-value')
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled()
  })

  it('отказ файловой системы не мешает процессу: секрет остаётся в памяти', async () => {
    fsMocks.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })
    fsMocks.writeFileSync.mockImplementation(() => {
      throw Object.assign(new Error('EROFS'), { code: 'EROFS' })
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { JWT_SECRET } = await import('../middleware.js')
    expect(JWT_SECRET()).toMatch(/^[0-9a-f]{64}$/)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
