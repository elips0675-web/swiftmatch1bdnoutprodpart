/**
 * Тесты preflight-обёртки (`scripts/stage-preflight.mjs`, автоматизация B).
 *
 * Preflight — быстрый старт этапа: только офлайн-гейты, без БД, живых
 * серверов и сборки. Прогон реальных процессов здесь не тестируется
 * (долго и хрупко): `collectPreflight` принимает runner, и фейковый раннер
 * проверяет состав, порядок и обработку красных. Состав сверяется с
 * package.json — команда-заглушка (несуществующий npm-скрипт или файл)
 * проваливает тест, а не «проходит молча» (питфолл «гейт с несуществующим
 * glob честно зелёный»).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PREFLIGHT_CHECKS,
  WINDOW_CHECK_NAME,
  WINDOW_LIMITS,
  WINDOW_RED_MESSAGE,
  collectPreflight,
  probeWindow,
  verdictOf,
  renderReport,
} from './stage-preflight.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

describe('PREFLIGHT_CHECKS — состав быстрых гейтов', () => {
  it('ровно 9 проверок: 8 из спецификации (B) плюс окно незакоммиченного и жёсткая проба окна', () => {
    expect(PREFLIGHT_CHECKS.map((c) => c.name)).toEqual([
      'tsc --noEmit',
      'eslint (root)',
      'eslint (server)',
      'счётчики тестов (--skip-e2e)',
      'check:docs',
      'check:mirrors',
      'check:env-parity',
      'незакоммиченное окно',
      WINDOW_CHECK_NAME,
    ])
  })

  it('без БД, живых серверов и сборки; счётчики идут с --skip-e2e', () => {
    const cmds = PREFLIGHT_CHECKS.map((c) => c.cmd).join(' ')
    expect(cmds).not.toContain('check:console')
    expect(cmds).not.toContain('audit:prod')
    expect(cmds).not.toContain('check:deps')
    expect(cmds).not.toContain('vite build')
    expect(cmds).not.toContain('mysql')
    expect(cmds).toContain('--skip-e2e')
  })

  it('каждая команда указывает на реальный npm-скрипт, файл или tsc', () => {
    for (const c of PREFLIGHT_CHECKS.filter((x) => x.kind !== 'window')) {
      const npm = c.cmd.match(/^npm run ([\w:.-]+)$/)
      if (npm) {
        expect(pkg.scripts[npm[1]], `npm-скрипт «${npm[1]}» отсутствует в package.json`).toBeTruthy()
      } else if (c.cmd.startsWith('node ')) {
        const rel = c.cmd.split(' ')[1]
        expect(fs.existsSync(path.join(ROOT, rel)), `файл «${rel}» не существует`).toBe(true)
      } else if (c.cmd.startsWith('npx ')) {
        expect(c.cmd).toBe('npx tsc --noEmit')
        expect(pkg.dependencies?.typescript || pkg.devDependencies?.typescript, 'typescript не в зависимостях').toBeTruthy()
      } else {
        throw new Error(`неизвестный формат команды: ${c.cmd}`)
      }
    }
  })

  it('проба окна объявляет, по чему считается (diff + numstat + untracked)', () => {
    const window = PREFLIGHT_CHECKS.find((c) => c.kind === 'window')
    expect(window).toBeTruthy()
    expect(window.cmd).toContain('git diff --name-only HEAD')
    expect(window.cmd).toContain('git diff --numstat HEAD')
    expect(window.cmd).toContain('untracked')
  })

  it('счётчики — самая долгая проверка: их лимит не меньше остальных', () => {
    const counters = PREFLIGHT_CHECKS.find((c) => c.cmd.includes('test-counter-audit'))
    const rest = PREFLIGHT_CHECKS.filter((c) => c !== counters)
    expect(counters).toBeTruthy()
    expect(counters.timeout).toBeGreaterThanOrEqual(Math.max(...rest.map((c) => c.timeout)))
    for (const c of PREFLIGHT_CHECKS) expect(c.timeout).toBeGreaterThan(0)
  })
})

describe('collectPreflight — прогон через runner', () => {
  const greenProbe = () => ({ exit: 0, message: '', detail: 'окно: 0 файлов / 0 строк' })

  it('вызывает runner для каждой командной проверки в порядке списка, с таймаутом', () => {
    const calls = []
    const runner = (cmd, opts) => {
      calls.push({ cmd, opts })
      return { exit: 0, output: '' }
    }
    const checks = collectPreflight(runner, greenProbe)
    const cmdChecks = PREFLIGHT_CHECKS.filter((c) => c.kind !== 'window')
    expect(calls.map((c) => c.cmd)).toEqual(cmdChecks.map((c) => c.cmd))
    expect(checks.map((c) => c.name)).toEqual(PREFLIGHT_CHECKS.map((c) => c.name))
    for (const call of calls) expect(call.opts.timeout).toBeGreaterThan(0)
  })

  it('exit каждой проверки собирается в результат, красная не маскируется', () => {
    const runner = (cmd) => ({ exit: cmd.includes('check:docs') ? 1 : 0, output: '' })
    const checks = collectPreflight(runner, greenProbe)
    expect(checks).toHaveLength(PREFLIGHT_CHECKS.length)
    expect(checks.find((c) => c.name === 'check:docs').exit).toBe(1)
    expect(checks.filter((c) => c.exit === 0)).toHaveLength(PREFLIGHT_CHECKS.length - 1)
    expect(checks.every((c) => typeof c.exit === 'number')).toBe(true)
  })

  it('проба окна не идёт через runner, а красная окна роняет весь preflight', () => {
    const calls = []
    const runner = (cmd) => {
      calls.push(cmd)
      return { exit: 0, output: '' }
    }
    const redProbe = () => ({ exit: 1, message: WINDOW_RED_MESSAGE, detail: 'окно: 9 файлов / 400 строк' })
    const checks = collectPreflight(runner, redProbe)
    expect(calls).not.toContain(WINDOW_CHECK_NAME)
    const windowCheck = checks.find((c) => c.name === WINDOW_CHECK_NAME)
    expect(windowCheck.exit).toBe(1)
    expect(windowCheck.message).toBe(WINDOW_RED_MESSAGE)
    expect(verdictOf(checks).exit).toBe(1)
    expect(verdictOf(checks).red).toEqual([WINDOW_CHECK_NAME])
  })
})

describe('probeWindow — окно перед стартом этапа', () => {
  const fakeCollect = (summary) => () => ({ summary })

  it('порог жёсткий и зафиксирован литералами: 6 файлов / 300 строк', () => {
    expect(WINDOW_LIMITS).toEqual({ files: 6, lines: 300 })
  })

  it('окно в пределах порога — зелёное, без текста о чекпойнте', () => {
    const res = probeWindow(WINDOW_LIMITS, fakeCollect({ files: 6, lines: 300 }))
    expect(res.exit).toBe(0)
    expect(res.message).toBe('')
  })

  it('больше 6 файлов — красное с точным текстом про чекпойнт', () => {
    const res = probeWindow(WINDOW_LIMITS, fakeCollect({ files: 7, lines: 10 }))
    expect(res.exit).toBe(1)
    expect(res.message).toBe(
      'Слишком много незакоммиченного перед стартом этапа. Сделай чекпойнт (микрокоммит+push) перед началом следующей большой правки.'
    )
  })

  it('больше 300 строк — красное даже при одном файле', () => {
    const res = probeWindow(WINDOW_LIMITS, fakeCollect({ files: 1, lines: 301 }))
    expect(res.exit).toBe(1)
    expect(res.message).toContain('Сделай чекпойнт (микрокоммит+push)')
  })
})

describe('verdictOf', () => {
  it('все зелёные → exit 0, красных нет', () => {
    const checks = PREFLIGHT_CHECKS.map((c) => ({ name: c.name, exit: 0 }))
    expect(verdictOf(checks)).toEqual({ exit: 0, red: [], green: checks.length, total: checks.length })
  })

  it('одна красная → exit 1 и её имя в красных', () => {
    const checks = [
      { name: 'tsc --noEmit', exit: 0 },
      { name: 'check:docs', exit: 1 },
      { name: 'check:mirrors', exit: 0 },
    ]
    expect(verdictOf(checks)).toEqual({ exit: 1, red: ['check:docs'], green: 2, total: 3 })
  })

  it('две красные → обе в списке, красных больше нуля', () => {
    const checks = [
      { name: 'eslint (root)', exit: 2 },
      { name: 'check:mirrors', exit: 1 },
    ]
    const v = verdictOf(checks)
    expect(v.exit).toBe(1)
    expect(v.red).toEqual(['eslint (root)', 'check:mirrors'])
    expect(v.green).toBe(0)
  })
})

describe('renderReport', () => {
  const green = PREFLIGHT_CHECKS.map((c) => ({ name: c.name, cmd: c.cmd, exit: 0 }))

  it('зелёный: таблица всех проверок и разрешение начинать этап', () => {
    const report = renderReport(green)
    expect(report).toContain('=== PREFLIGHT (гейты до начала этапа) ===')
    expect(report).toContain('| проверка | команда | exit | статус |')
    expect(report).toContain(`| check:docs | \`npm run check:docs\` | 0 | ✅ |`)
    expect(report).toContain(`Preflight зелёный: 9/9`)
    expect(report).toContain('можно начинать этап')
    expect(report).not.toContain('НЕ НАЧИНАЙ ЭТАП')
  })

  it('красная: запрет старта с именами красных проверок', () => {
    const checks = green.map((c) => (c.name === 'check:mirrors' ? { ...c, exit: 1 } : c))
    const report = renderReport(checks)
    expect(report).toContain('| check:mirrors | `npm run check:mirrors` | 1 | ❌ |')
    expect(report).toContain('НЕ НАЧИНАЙ ЭТАП')
    expect(report).toContain('красные 1/9')
    expect(report).toContain('check:mirrors')
    expect(report).not.toContain('можно начинать этап')
  })

  it('красная проба окна печатает текст про чекпойнт, а не только «красные 1/9»', () => {
    const checks = green.map((c) =>
      c.name === WINDOW_CHECK_NAME
        ? { ...c, exit: 1, message: WINDOW_RED_MESSAGE, detail: 'окно: 9 файлов / 400 строк' }
        : c
    )
    const report = renderReport(checks)
    expect(report).toContain(WINDOW_RED_MESSAGE)
    expect(report).toContain('окно: 9 файлов / 400 строк')
    expect(report).toContain('НЕ НАЧИНАЙ ЭТАП')
  })
})
