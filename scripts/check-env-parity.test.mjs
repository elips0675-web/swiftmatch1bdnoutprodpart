import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseEnvKeys, findMissingKeys } from './check-env-parity.mjs'

const ROOT = process.cwd()

describe('parseEnvKeys', () => {
  it('читает и обычные, и закомментированные ключи', () => {
    const keys = parseEnvKeys('# FOO=1\nBAR=2\n# NOPE\nbaz=3\nQUX=\n')
    expect(keys.has('FOO')).toBe(true)
    expect(keys.has('BAR')).toBe(true)
    expect(keys.has('QUX')).toBe(true)
    expect(keys.has('baz')).toBe(false)
  })
})

describe('findMissingKeys', () => {
  it('возвращает ключи сервера, которых нет в корне', () => {
    expect(findMissingKeys(new Set(['A', 'B', 'C']), new Set(['A', 'C']))).toEqual(['B'])
  })

  it('пусто, когда корень покрывает сервер', () => {
    expect(findMissingKeys(new Set(['A']), new Set(['A', 'B']))).toEqual([])
  })
})

describe('check-env-parity: реальный репозиторий', () => {
  it('корневой .env.example покрывает все ключи server/.env.example', () => {
    const serverKeys = parseEnvKeys(fs.readFileSync(path.join(ROOT, 'server/.env.example'), 'utf8'))
    const rootKeys = parseEnvKeys(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'))
    expect(findMissingKeys(serverKeys, rootKeys)).toEqual([])
  })

  it('гейт краснеет, если ключ убрать из корня (та самая ошибка #34а)', () => {
    const serverKeys = parseEnvKeys(fs.readFileSync(path.join(ROOT, 'server/.env.example'), 'utf8'))
    const rootKeys = parseEnvKeys(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'))
    const victim = 'PHOTO_MODERATION_MODE'
    expect(serverKeys.has(victim)).toBe(true)
    rootKeys.delete(victim)
    expect(findMissingKeys(serverKeys, rootKeys)).toContain(victim)
  })
})
