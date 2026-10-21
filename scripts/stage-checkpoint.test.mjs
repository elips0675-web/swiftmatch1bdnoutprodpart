/**
 * Тесты чекпойнта (`scripts/stage-checkpoint.mjs`, Stage 148, часть 4).
 *
 * Скрипт трогает рабочее дерево и историю git, поэтому в тестах всё
 * инъецируется: сборщик окна, чтение/запись файлов и запуск git. Проверяется
 * главное — «красное окно не трогает ничего» и «коммит поимённо, без
 * `git add .`»: именно эти два свойства отличает рабочий чекпойнт от
 * скрипта, который тихо коммитит половину репозитория.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LIMITS } from './retention-gate.mjs'
import { todayRu } from './stage-section.mjs'
import {
  JOURNAL_FILE,
  MSG_FILE,
  buildJournalLine,
  defaultMessage,
  hasStage,
  insertJournalLine,
  parseArgs,
  runCheckpoint,
} from './stage-checkpoint.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const JOURNAL_SAMPLE = '# Что сделано\r\n\r\n(Stage 100 — 01.01.2026) — старая запись.\r\n'

const GREEN = { files: 2, lines: 40, trackedFiles: 2, untrackedFiles: 0, ignoredFiles: 0 }
const RED = { files: 7, lines: 40, trackedFiles: 7, untrackedFiles: 0, ignoredFiles: 0 }

function harness({ summary = GREEN, journal = JOURNAL_SAMPLE, files = {} } = {}) {
  const writes = new Map()
  const calls = []
  const deps = {
    // Ровно та форма, которую отдаёт collectRetention: вердикта в ней нет —
    // считать его обязан сам скрипт (иначе подмена формы скрывает падение).
    collect: () => ({ entries: [], tracked: [], untracked: [], summary }),
    readFile: (p) => (writes.has(p) ? writes.get(p) : files[p] ?? journal),
    writeFile: (p, content) => writes.set(p, content),
    exists: () => true,
    run: (args) => {
      calls.push(args)
    },
    now: new Date('2026-10-21T10:00:00Z'),
  }
  return { deps, writes, calls }
}

describe('parseArgs — разбор аргументов', () => {
  it('читает метку, суть, список файлов и флаги', () => {
    const args = parseArgs([
      '--stage',
      '149.1',
      '--note',
      'суть блока',
      '--file',
      'a.ts',
      '--file',
      'b.ts',
      '--message-file',
      'msg.txt',
      '--dry-run',
      '--no-push',
    ])
    expect(args.stage).toBe('149.1')
    expect(args.note).toBe('суть блока')
    expect(args.files).toEqual(['a.ts', 'b.ts'])
    expect(args.messageFile).toBe('msg.txt')
    expect(args.dryRun).toBe(true)
    expect(args.push).toBe(false)
  })

  it('неизвестный аргумент — ошибка, а не тихий игнор', () => {
    expect(() => parseArgs(['--stage', '1', '--что-то'])).toThrow(/неизвестный аргумент/)
  })
})

describe('журнал — строка Stage N.Y', () => {
  it('вставляется сразу после шапки и пустой строки', () => {
    const out = insertJournalLine(JOURNAL_SAMPLE, '(Stage 149.1 — 21.10.2026) — суть')
    const lines = out.split('\r\n')
    expect(lines[0]).toBe('# Что сделано')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('(Stage 149.1 — 21.10.2026) — суть')
    expect(lines[3]).toBe('')
    expect(lines[4]).toContain('(Stage 100 — 01.01.2026)')
  })

  it('переводы строк файла не ломаются (CRLF остаётся CRLF)', () => {
    const out = insertJournalLine(JOURNAL_SAMPLE, '(Stage 149.1 — 21.10.2026) — суть')
    expect(out).not.toMatch(/(?<!\r)\n/)
  })

  it('без шапки «# Что сделано» — ошибка, а не запись в начало файла', () => {
    expect(() => insertJournalLine('без шапки\r\n', 'строка')).toThrow(/шапки/)
  })

  it('метка уже есть — не дублируется; похожая метка не считается той же', () => {
    expect(hasStage(JOURNAL_SAMPLE, '100')).toBe(true)
    expect(hasStage(JOURNAL_SAMPLE, '149.1')).toBe(false)
    expect(hasStage('(Stage 149.10 — 21.10.2026)', '149.1')).toBe(false)
    expect(hasStage('(Stage 149.1 — 21.10.2026)', '149.1')).toBe(true)
  })

  it('текст строки собирается из метки, сути и даты', () => {
    expect(buildJournalLine({ stage: '149.1', note: 'суть', date: '21.10.2026' })).toBe(
      '(Stage 149.1 — 21.10.2026) — суть'
    )
  })
})

describe('runCheckpoint — красное окно', () => {
  it('ничего не трогает: ни git, ни журнал', () => {
    const { deps, writes, calls } = harness({ summary: RED })
    const res = runCheckpoint({
      args: { stage: '149.1', note: 'суть', files: ['a.ts'], messageFile: '', dryRun: false, push: true },
      deps,
    })
    expect(res.exit).toBe(1)
    expect(calls).toEqual([])
    expect(writes.size).toBe(0)
    expect(res.log.join('\n')).toContain('Чекпойнт остановлен')
  })

  it('красное окно — это тот же порог, что у retent:check (6 файлов / 300 строк)', () => {
    expect(LIMITS).toEqual({ files: 6, lines: 300 })
    const { deps } = harness({ summary: { ...GREEN, files: 7 } })
    const res = runCheckpoint({
      args: { stage: '149.1', note: '', files: ['a.ts'], messageFile: '', dryRun: false, push: true },
      deps,
    })
    expect(res.exit).toBe(1)
  })

  it('граница окна: ровно 6 файлов и 300 строк — ещё зелёное', () => {
    const { deps, calls } = harness({ summary: { ...GREEN, files: 6, lines: 300 } })
    const res = runCheckpoint({
      args: { stage: '149.1', note: '', files: ['a.ts'], messageFile: '', dryRun: false, push: true },
      deps,
    })
    expect(res.exit).toBe(0)
    expect(calls.length).toBeGreaterThan(0)
  })
})

describe('runCheckpoint — зелёное окно', () => {
  const args = {
    stage: '149.1',
    note: 'суть блока',
    files: ['scripts/stage-checkpoint.mjs'],
    messageFile: '',
    dryRun: false,
    push: true,
  }

  it('коммит идёт поимённо: в add нет «.» и «-A», журнал добавлен отдельно', () => {
    const { deps, calls } = harness()
    const res = runCheckpoint({ args, deps })
    expect(res.exit).toBe(0)
    const add = calls.find((c) => c[0] === 'add')
    expect(add).toBeTruthy()
    expect(add).toContain('-f')
    expect(add).not.toContain('.')
    expect(add).not.toContain('-A')
    expect(add[add.length - 1]).toBe(JOURNAL_FILE)
    expect(add).toContain('scripts/stage-checkpoint.mjs')
  })

  it('порядок: add → commit → push; коммит с --no-verify и сообщением из файла', () => {
    const { deps, calls } = harness({ files: { [path.join(ROOT, 'msg.txt')]: 'мой текст коммита\n' } })
    const res = runCheckpoint({ args: { ...args, messageFile: 'msg.txt' }, deps })
    expect(res.exit).toBe(0)
    expect(calls.map((c) => c[0])).toEqual(['add', 'commit', 'push'])
    const commit = calls[1]
    expect(commit).toContain('--no-verify')
    expect(commit[commit.length - 1]).toBe(MSG_FILE)
    expect(calls[2]).toEqual(['push', 'origin', 'main'])
  })

  it('журнал: строка Stage N.Y вставлена и сохранена', () => {
    const { deps, writes } = harness()
    runCheckpoint({ args, deps })
    const journal = writes.get(path.join(ROOT, JOURNAL_FILE))
    const date = todayRu(new Date('2026-10-21T10:00:00Z'))
    expect(journal).toContain(`(Stage 149.1 — ${date}) — суть блока`)
  })

  it('журнал: метка уже есть — не дублируется и файл не переписывается', () => {
    const { deps, writes } = harness({ journal: '# Что сделано\r\n\r\n(Stage 149.1 — 21.10.2026) — суть блока\r\n' })
    const res = runCheckpoint({ args, deps })
    expect(res.exit).toBe(0)
    expect(writes.has(path.join(ROOT, JOURNAL_FILE))).toBe(false)
  })

  it('сообщение коммита по умолчанию содержит метку этапа', () => {
    expect(defaultMessage({ stage: '149.1', note: 'суть', files: ['a.ts'] })).toContain('Stage 149.1')
  })

  it('--message-file принимает и абсолютный путь (сообщение может лежать вне репозитория)', () => {
    const seen = []
    const { deps } = harness()
    const res = runCheckpoint({
      args: { ...args, messageFile: 'C:\\tmp\\msg.txt' },
      deps: {
        ...deps,
        readFile: (p) => {
          seen.push(p)
          return String(p).endsWith(JOURNAL_FILE) ? JOURNAL_SAMPLE : 'текст\r\n'
        },
      },
    })
    expect(res.exit).toBe(0)
    expect(seen).toContain('C:\\tmp\\msg.txt')
  })

  it('--no-push: push не вызывается', () => {
    const { deps, calls } = harness()
    runCheckpoint({ args: { ...args, push: false }, deps })
    expect(calls.map((c) => c[0])).toEqual(['add', 'commit'])
  })

  it('--dry-run: ничего не меняется, но план печатается', () => {
    const { deps, writes, calls } = harness()
    const res = runCheckpoint({ args: { ...args, dryRun: true }, deps })
    expect(res.exit).toBe(0)
    expect(calls).toEqual([])
    expect(writes.size).toBe(0)
    expect(res.log.join('\n')).toContain('dry-run')
    expect(res.log.join('\n')).toContain('git add')
  })

  it('файл из --file не найден — понятная ошибка, а не коммит половины дерева', () => {
    const { deps, calls } = harness()
    const res = runCheckpoint({
      args: { ...args, files: ['нет-такого-файла.ts'] },
      deps: { ...deps, exists: (p) => !p.includes('нет-такого-файла') },
    })
    expect(res.exit).toBe(1)
    expect(calls).toEqual([])
  })
})

describe('скрипт в репозитории', () => {
  it('объявлен в package.json как stage:checkpoint', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['stage:checkpoint']).toBe('node scripts/stage-checkpoint.mjs')
  })

  it('никогда не коммитит «всё целиком» — только поимённо', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'stage-checkpoint.mjs'), 'utf8')
    expect(source).not.toMatch(/'add',\s*'\.'/)
    expect(source).not.toMatch(/'add',\s*'-A'/)
  })
})
