/**
 * Тесты контекста этапа (`scripts/stage-context.mjs`, автоматизация A).
 *
 * Парсеры проверяются на фактических структурах проекта: нумерованной
 * очереди под `## Очередь этапов`, абзацах `(Stage N … ДД.ММ.ГГГГ) — …`
 * журнала и нумерованных питфоллах. Отдельно фиксируется суть команды —
 * она read-only и не падает на пустых источниках (печатает «не найдено»).
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseQueue,
  lastStageEntries,
  latestStage,
  lastPitfalls,
  readInventory,
  parseGateLine,
  renderContext,
} from './stage-context.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const BACKLOG = [
  '## 🟢 P3 — бэклог',
  '',
  '1. не очередь',
  '',
  '---',
  '',
  '## Очередь этапов (кандидаты)',
  '',
  '1. **COV-03 (остаток):** ветки security-роутеров; пороги только вверх.',
  '2. **SRCH-01:** диалог фильтров.',
  '3. **HAN-01:** чек-ин по радиусу.',
  '',
  '## ❌ Не брать',
  '',
  '1. **уже закрыто** — вне очереди',
].join('\n')

describe('parseQueue', () => {
  it('берёт только пункты под «Очередь этапов», до следующего ##', () => {
    const queue = parseQueue(BACKLOG)
    expect(queue.map((q) => q.index)).toEqual([1, 2, 3])
    expect(queue[0].text).toContain('COV-03')
    expect(queue.map((q) => q.text).join(' ')).not.toContain('уже закрыто')
  })

  it('без заголовка очереди возвращает пусто, а не падает', () => {
    expect(parseQueue('# другой файл\n\n1. **x**')).toEqual([])
    expect(parseQueue('')).toEqual([])
  })

  it('обрезает длинный пункт до 90 символов с многоточием', () => {
    const long = `## Очередь этапов\n\n1. **Тема:** ${'т'.repeat(120)}`
    const queue = parseQueue(long)
    expect(queue[0].text.length).toBe(91)
    expect(queue[0].text.endsWith('…')).toBe(true)
  })
})

const JOURNAL = [
  '# Что сделано',
  '',
  '> Актуально на 21.10.2026.',
  '',
  '(Stage 146, часть 2 — правило, 21.10.2026) — описание.',
  '',
  '(Stage 146, часть 1 — фикс блокера, 21.10.2026) — описание.',
  '',
  '(Stage 145 — находка 1.2, 21.10.2026) — описание.',
].join('\n')

describe('lastStageEntries / latestStage', () => {
  it('находит абзацы журнала с номером и датой, свежие сверху', () => {
    const entries = lastStageEntries(JOURNAL)
    expect(entries.map((e) => e.stage)).toEqual([146, 146, 145])
    expect(entries[0].date).toBe('21.10.2026')
    expect(entries[0].line).toBe(5)
  })

  it('latestStage берёт наибольший номер, а не первый по файлу', () => {
    const text = '(Stage 99 — a, 01.01.2026) — x.\n\n(Stage 146 — b, 02.02.2026) — y.'
    expect(latestStage(text).stage).toBe(146)
    expect(latestStage('# пустой журнал')).toBeNull()
  })
})

describe('lastPitfalls', () => {
  it('сортирует по номеру, а не по появлению в файле (нумерация вне порядка)', () => {
    const text = ['1. **ранний**', '24. **средний**', '107. **новый**', '47. **старый**'].join('\n')
    const falls = lastPitfalls(text, 3)
    expect(falls.map((p) => p.number)).toEqual([107, 47, 24])
    expect(falls[0].title).toBe('новый')
  })

  it('count по умолчанию — 3', () => {
    const text = Array.from({ length: 10 }, (_, i) => `${i + 1}. **п${i + 1}**`).join('\n')
    expect(lastPitfalls(text)).toHaveLength(3)
  })
})

describe('readInventory / parseGateLine', () => {
  it('читает счётчики секций и итог; негодный json — null', () => {
    const inv = readInventory(
      JSON.stringify({
        generated: '2026-10-21T10:07:33.449Z',
        frontend: { files: 126, tests: 1644, failed: 0 },
        server: { files: 147, tests: 2553, failed: 0 },
        e2e: { files: 22, tests: 206, failed: 0 },
        total: { tests: 4197 },
      })
    )
    expect(inv.frontend).toEqual({ files: 126, tests: 1644, failed: 0 })
    expect(inv.total.tests).toBe(4197)
    expect(inv.generated).toBe('2026-10-21')
    expect(readInventory('{ не json')).toBeNull()
  })

  it('разбирает строку гейтов, считая красные как total − green', () => {
    const gates = parseGateLine('- **Гейты:** 19/21 ✅ — check:docs, check:mirrors')
    expect(gates).toEqual({ green: 19, total: 21, red: 2 })
    expect(parseGateLine('нет такой строки')).toBeNull()
  })
})

describe('renderContext — read-only справка', () => {
  it('на пустых источниках печатает «не найдено», а не падает', () => {
    const report = renderContext({
      status: '',
      log: 'abc123 fix: x',
      journal: null,
      backlog: null,
      pitfalls: null,
      inventory: null,
    })
    expect(report).toContain('(дерево чистое)')
    expect(report).toContain('Stage-записей')
    expect(report).toContain('инвентарь')
    expect(report).toContain('очередь не найдена')
    expect(report).toContain('питфоллы не найдены')
  })

  it('на реальных данных проекта печатает очередь, питфоллы и счётчики', () => {
    const inventoryRaw = fs.readFileSync(path.join(ROOT, 'test/machine/test-inventory.json'), 'utf8')
    const pitfallsRaw = fs.readFileSync(path.join(ROOT, 'docs/AGENTS-pitfalls.md'), 'utf8')
    const report = renderContext({
      status: '',
      log: '',
      journal: fs.readFileSync(path.join(ROOT, 'Что сделано.txt'), 'utf8'),
      backlog: fs.readFileSync(path.join(ROOT, 'Что доделать.txt'), 'utf8'),
      pitfalls: pitfallsRaw,
      inventory: inventoryRaw,
    })
    expect(report).toContain('=== ОТКРЫТЫЕ ПУНКТЫ ОЧЕРЕДИ ===')
    expect(report).not.toContain('очередь не найдена')
    // Ожидаемые значения берутся из источников истины, а не из снимка:
    // счётчики пересобираются гейтом (`--fix`), номер питфолла растёт —
    // захардкоженные числа в тесте протухали бы на каждом прогоне.
    const inv = JSON.parse(inventoryRaw)
    expect(report).toContain(`фронт ${inv.frontend.files}/${inv.frontend.tests}`)
    const maxPitfall = Math.max(
      ...[...pitfallsRaw.matchAll(/^(\d+)\.\s+\*\*/gm)].map((m) => Number(m[1]))
    )
    expect(report).toContain(`${maxPitfall}. `)
  })

  it('npm-скрипт stage:context объявлен и указывает на этот файл', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['stage:context']).toBe('node scripts/stage-context.mjs')
  })
})
