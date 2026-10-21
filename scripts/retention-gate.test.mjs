/**
 * Тесты гейта незакоммиченного окна (`scripts/retention-gate.mjs`).
 *
 * Правило «не терять работу» (Stage 146) машинно проверяется здесь: границы
 * порога в обе стороны, честная сумма строк (tracked — из `--numstat`,
 * untracked — длиной файла), игнор владельческих черновиков и запрет молчания
 * при пустом дереве. Сломать правило = покрасить эти тесты.
 *
 * Stage 148 (часть 2) — пороги ужесточены (строгий 6/300, preflight 10/450).
 * Числа зафиксированы в тесте **литералами**, а не ссылкой на константы гейта:
 * иначе ослабление порога (8/400 → 12/800) осталось бы зелёным — гейт
 * сверялся бы сам с собой (питфолл «гейт сверяет реальность с собственной
 * константой»).
 *
 * Там же — фикс реального бага гейта: git отдаёт не-ASCII пути в кавычках
 * восьмеричными байтами, поэтому `IGNORED_UNTRACKED` никогда не совпадал, и
 * **владельческие черновики считались в окне двумя лишними файлами** (треть
 * бюджета порога!). Фикстура ниже воспроизводит именно тот вывод, который
 * отдаёт git, — иначе тест кормил бы парсер несуществующим форматом и баг жил
 * бы дальше (питфолл «фикстура воспроизводит то, что создаёт тестируемый код»).
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIMITS,
  PREFLIGHT_LIMITS,
  IGNORED_UNTRACKED,
  parsePorcelain,
  parseNumstat,
  classify,
  summarize,
  verdictOf,
  renderReport,
  collectRetention,
} from './retention-gate.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('parsePorcelain', () => {
  it('разбирает изменённые и untracked, снимает кавычки и берёт цель переименования', () => {
    const text = [
      ' M README.md',
      '?? scripts/stage-preflight.mjs',
      'R  old.md -> docs/new.md',
      '?? "Анализ тестов.txt"',
    ].join('\n')
    const entries = parsePorcelain(text)
    expect(entries).toEqual([
      { status: ' M', file: 'README.md', untracked: false },
      { status: '??', file: 'scripts/stage-preflight.mjs', untracked: true },
      { status: 'R ', file: 'docs/new.md', untracked: false },
      { status: '??', file: 'Анализ тестов.txt', untracked: true },
    ])
  })

  it('пустой вывод — пустой список, не падение', () => {
    expect(parsePorcelain('')).toEqual([])
    expect(parsePorcelain('\n')).toEqual([])
  })

  it('декодирует восьмеричные байты git в настоящее имя — иначе черновики не исключаются', () => {
    const octal = (name) =>
      '"' +
      [...Buffer.from(name, 'utf8')]
        .map((b) => '\\' + b.toString(8).padStart(3, '0'))
        .join('') +
      '"'
    const text = [
      '?? ' + octal('Анализ тестов.txt'),
      '?? ' + octal('Анализ задание агенту.txt'),
    ].join('\n')
    const entries = parsePorcelain(text)
    expect(entries.map((e) => e.file)).toEqual(['Анализ тестов.txt', 'Анализ задание агенту.txt'])
    const { untracked } = classify(entries, parseNumstat(''), () => 5)
    expect(untracked.every((u) => u.ignored)).toBe(true)
  })
})

describe('parseNumstat', () => {
  it('суммирует добавленные и удалённые строки, бинарные считает нулём', () => {
    const text = ['12\t3\tserver/src/redis.js', '-\t-\tpublic/logo.png'].join('\n')
    const parsed = parseNumstat(text)
    expect(parsed.added).toBe(12)
    expect(parsed.removed).toBe(3)
    expect(parsed.perFile.get('public/logo.png')).toEqual({ added: 0, removed: 0 })
  })
})

describe('classify и summarize', () => {
  const entries = parsePorcelain(
    [' M a.md', ' M b.md', '?? new.mjs', '?? Анализ тестов.txt'].join('\n')
  )
  const numstat = parseNumstat(['100\t0\ta.md', '50\t0\tb.md'].join('\n'))
  const lineCounter = (file) => (file === 'new.mjs' ? 20 : 999)

  it('untracked считаются длиной файла, владельческие — помечены ignored', () => {
    const { tracked, untracked } = classify(entries, numstat, lineCounter)
    expect(tracked.map((t) => t.lines)).toEqual([100, 50])
    const newFile = untracked.find((u) => u.file === 'new.mjs')
    expect(newFile.lines).toBe(20)
    expect(newFile.ignored).toBe(false)
    expect(untracked.find((u) => u.file === 'Анализ тестов.txt').ignored).toBe(true)
  })

  it('игнорируемые untracked не входят в число файлов и строк', () => {
    const { tracked, untracked } = classify(entries, numstat, lineCounter)
    const summary = summarize(tracked, untracked)
    expect(summary.files).toBe(3)
    expect(summary.lines).toBe(170)
    expect(summary.ignoredFiles).toBe(1)
  })
})

describe('verdictOf', () => {
  it('порог строгий сверху: ровно на границе — зелёный, на единицу больше — красный', () => {
    const atLimit = verdictOf({ files: LIMITS.files, lines: LIMITS.lines }, LIMITS)
    expect(atLimit.exit).toBe(0)
    const overFiles = verdictOf({ files: LIMITS.files + 1, lines: 0 }, LIMITS)
    expect(overFiles.exit).toBe(1)
    expect(overFiles.red.join(' ')).toContain('файлов')
    const overLines = verdictOf({ files: 0, lines: LIMITS.lines + 1 }, LIMITS)
    expect(overLines.exit).toBe(1)
    expect(overLines.red.join(' ')).toContain('строк')
  })

  it('preflight-порог мягче строгого (старт этапа прощает больше)', () => {
    expect(PREFLIGHT_LIMITS.files).toBeGreaterThan(LIMITS.files)
    expect(PREFLIGHT_LIMITS.lines).toBeGreaterThan(LIMITS.lines)
    const mid = { files: LIMITS.files + 1, lines: LIMITS.lines + 1 }
    expect(verdictOf(mid, LIMITS).exit).toBe(1)
    expect(verdictOf(mid, PREFLIGHT_LIMITS).exit).toBe(0)
  })

  it('пороги зафиксированы литералами: ослабить окно молча нельзя', () => {
    expect(LIMITS).toEqual({ files: 6, lines: 300 })
    expect(PREFLIGHT_LIMITS).toEqual({ files: 10, lines: 450 })
  })
})

describe('renderReport', () => {
  const tracked = [{ file: 'a.md', lines: 500 }]
  const untracked = [{ file: 'Анализ заданий.txt', lines: 1, ignored: true }]

  it('красный отчёт называет порог и требует дробления этапа', () => {
    const summary = summarize(tracked, untracked)
    const verdict = verdictOf(summary, LIMITS)
    const report = renderReport(summary, verdict, tracked, untracked)
    expect(report).toContain('ОКНО СЛИШКОМ БОЛЬШОЕ')
    expect(report).toContain('git push')
    expect(report).toContain('Что сделано.txt')
  })

  it('красный отчёт зовёт именно к микрокоммиту, а не «разбей этап когда-нибудь»', () => {
    const summary = summarize(tracked, untracked)
    const verdict = verdictOf(summary, LIMITS)
    const report = renderReport(summary, verdict, tracked, untracked)
    expect(report).toContain('Сделай МИКРОКОММИТ')
    expect(report).toContain('разбей правки на логические блоки')
    expect(report).toContain('git add поимённо по каждому блоку')
    expect(report).toContain('запиши Stage N.Y в «Что сделано.txt»')
    expect(report).toContain('git commit --no-verify -F + git push origin main')
    expect(report).toContain('Затем продолжай следующий блок.')
  })

  it('зелёный отчёт фиксирует норму и перечисляет игнорируемое', () => {
    const small = [{ file: 'a.md', lines: 5 }]
    const summary = summarize(small, untracked)
    const verdict = verdictOf(summary, LIMITS)
    const report = renderReport(summary, verdict, small, untracked)
    expect(report).toContain('Окно в норме')
    expect(report).toContain('не коммитить')
  })
})

describe('гейт подключён и не молчит на пустом дереве', () => {
  it('список игнора — ровно два владельческих файла', () => {
    expect(IGNORED_UNTRACKED).toEqual(['Анализ задание агенту.txt', 'Анализ тестов.txt'])
  })

  it('preflight содержит проверку незакоммиченного окна', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/stage-preflight.mjs'), 'utf8')
    expect(src).toContain('retention-gate.mjs')
    expect(src).toContain('--preflight')
  })

  it('npm-скрипты оболочки объявлены', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['retent:check']).toBe('node scripts/retention-gate.mjs')
    expect(pkg.scripts['stage:preflight']).toBe('node scripts/stage-preflight.mjs')
  })

  it('на живом дереве владельческие черновики исключаются (кириллица не ломает сравнение)', () => {
    const { untracked } = collectRetention()
    for (const u of untracked) {
      if (IGNORED_UNTRACKED.includes(u.file)) expect(u.ignored).toBe(true)
    }
  })
})
