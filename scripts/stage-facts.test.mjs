/**
 * Тесты рутины «факты этапа» (`scripts/stage-facts.mjs`).
 *
 * Прогон процессов не тестируется (долгий и хрупкий), но вся логика вокруг
 * него — чистая: разбор флагов, статусы, команда счётчиков, markdown-блок и
 * таблица. Красная проверка обязана попасть в блок как ❌, зелёная — как ✅,
 * а режим `--gate` (одна проверка) не должен падать на отсутствующих строках
 * «Проверки.». Оба конца проверяются: и «плохо», и «хорошо».
 */

import { describe, expect, it } from 'vitest'
import {
  OFFLINE_CHECKS,
  parseArgs,
  statusOf,
  countersCommand,
  lastLine,
  lintSummary,
  renderTable,
  renderFactBlock,
  skippedFor,
  flagList,
  todayRu,
} from './stage-facts.mjs'

describe('parseArgs', () => {
  it('по умолчанию все флаги выключены', () => {
    expect(parseArgs([])).toEqual({ skipE2e: false, fix: false, bundle: false, network: false, gate: null })
  })

  it('флаги включаются по отдельности и понимают все', () => {
    const flags = parseArgs(['--fix', '--bundle', '--network'])
    expect(flags.fix).toBe(true)
    expect(flags.bundle).toBe(true)
    expect(flags.network).toBe(true)
    expect(flags.skipE2e).toBe(false)
  })

  it('--gate берёт следующее слово как имя проверки', () => {
    expect(parseArgs(['--gate', 'check:docs']).gate).toBe('check:docs')
    expect(parseArgs(['--fix', '--gate', 'check:mirrors']).gate).toBe('check:mirrors')
  })
})

describe('statusOf / lastLine / lintSummary', () => {
  it('0 — зелёный, иное — красный', () => {
    expect(statusOf(0)).toBe('✅')
    expect(statusOf(1)).toBe('❌')
  })

  it('lastLine отдаёт последнюю непустую строку', () => {
    expect(lastLine('a\n\nb\n')).toBe('b')
    expect(lastLine('')).toBe('')
  })

  it('lintSummary вытаскивает число ошибок', () => {
    expect(lintSummary('  12 errors and 3 warnings')).toContain('12')
    expect(lintSummary('')).toBe('')
  })
})

describe('countersCommand', () => {
  it('собирает команду счётчиков', () => {
    expect(countersCommand(parseArgs([]))).toBe('node scripts/test-counter-audit.mjs')
    expect(countersCommand(parseArgs(['--fix', '--skip-e2e'])).split(' ')).toEqual(
      expect.arrayContaining(['--fix', '--skip-e2e']),
    )
  })
})

describe('renderTable / renderFactBlock', () => {
  const green = [
    { name: 'check:docs', cmd: 'npm run check:docs', exit: 0 },
    { name: 'vite build', cmd: 'npm run build', exit: 0 },
  ]

  it('таблица содержит имя, команду, exit и статус', () => {
    const table = renderTable(green)
    expect(table).toContain('| проверка | команда | exit | статус |')
    expect(table).toContain('| check:docs | `npm run check:docs` | 0 | ✅ |')
  })

  it('полный блок: зелёные гейты, нет секции «Красные»', () => {
    const checks = [...green, { name: 'tsc --noEmit', cmd: 'npx tsc --noEmit', exit: 0 }]
    const block = renderFactBlock({ date: '11.10.2026', flags: parseArgs([]), checks, skipped: ['check:console'] })
    expect(block).toContain('=== ФАКТЫ ЭТАПА 11.10.2026 ===')
    expect(block).toContain('**Проверки.**')
    expect(block).toContain('**Гейты:** 1/1 ✅')
    expect(block).not.toContain('Красные')
    expect(block).toContain('check:console')
  })

  it('красная проверка видна в блоке статусом и секцией «Красные»', () => {
    const checks = [{ name: 'check:docs', cmd: 'npm run check:docs', exit: 1 }]
    const block = renderFactBlock({ date: '11.10.2026', flags: parseArgs([]), checks, skipped: [] })
    expect(block).toContain('| check:docs | `npm run check:docs` | 1 | ❌ |')
    expect(block).toContain('❌ Красные (1): check:docs')
  })

  it('режим --gate с одной проверкой не падает на отсутствующих строках', () => {
    const checks = [{ name: 'check:mirrors', cmd: 'npm run check:mirrors', exit: 0 }]
    const block = renderFactBlock({ date: '11.10.2026', flags: parseArgs(['--gate', 'check:mirrors']), checks, skipped: [] })
    expect(block).toContain('tsc --noEmit:** —')
    expect(block).toContain('**Гейты:** 1/1 ✅')
  })

  it('flagList перечисляет только включённые флаги', () => {
    expect(flagList(parseArgs(['--bundle', '--network']))).toBe('--bundle --network')
    expect(flagList(parseArgs([]))).toBe('')
  })

  it('skippedFor всегда помнит про check:console, бандл и сеть — по флагам', () => {
    const skipped = skippedFor(parseArgs([]))
    expect(skipped.some((s) => s.includes('check:console'))).toBe(true)
    expect(skipped.some((s) => s.includes('--bundle'))).toBe(true)
    expect(skipped.some((s) => s.includes('--network'))).toBe(true)
  })
})

describe('todayRu', () => {
  it('форматирует дату ДД.ММ.ГГГГ', () => {
    expect(todayRu(new Date(2026, 9, 11))).toBe('11.10.2026')
    expect(todayRu(new Date(2026, 0, 5))).toBe('05.01.2026')
  })
})

describe('список офлайн-проверок', () => {
  it('содержит структурный гейт и зеркала, не содержит сетевые', () => {
    const names = OFFLINE_CHECKS.map((c) => c.name)
    expect(names).toContain('check:docs')
    expect(names).toContain('check:mirrors')
    expect(names).toContain('schema-drift --offline')
    expect(names.some((n) => n.includes('audit:prod'))).toBe(false)
  })
})