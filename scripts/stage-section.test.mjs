/**
 * Тесты рутины «заготовка секции этапа» (`scripts/stage-section.mjs`).
 *
 * Сама генерация markdown-каркаса — чистая: заголовок с датой, плейсхолдеры
 * для редактирования, блок `git diff --stat HEAD`, чек-лист шапки бэклога.
 * Вызов git не тестируется (тонкая обвязка); поведение при пустом diff
 * («изменения уже закоммичены») проверяется на обеих сторонах.
 */

import { describe, expect, it } from 'vitest'
import { buildSection, buildHeaderChecklist, diffSummary, todayRu } from './stage-section.mjs'

describe('buildSection', () => {
  it('собирает заголовок с датой и плейсхолдеры', () => {
    const section = buildSection({ title: 'P1 #11 Merge duplicate profiles', date: '11.10.2026', diffStat: ' 1 file changed, 5 insertions(+)' })
    expect(section).toContain('## P1 #11 Merge duplicate profiles (11.10.2026)')
    expect(section).toContain('РЕДАКТИРУЙ:')
    expect(section).toContain('**Проверки.**')
  })

  it('в «Что сделано» попадает сводка diff', () => {
    const section = buildSection({ title: 'T', date: '11.10.2026', diffStat: ' 2 files changed, 10 insertions(+), 3 deletions(-)' })
    expect(section).toContain('изменено файлов: 2')
  })

  it('пустой diff — честная пометка о чистом рабочем дереве', () => {
    const section = buildSection({ title: 'T', date: '11.10.2026', diffStat: '' })
    expect(section).toContain('закоммичены')
    expect(section).toContain('рабочее дерево чистое')
  })

  it('diff-блок вложен в код-фенс', () => {
    const section = buildSection({ title: 'T', date: '11.10.2026', diffStat: ' scripts/a.mjs | 1 +\n 1 file changed, 1 insertion(+)' })
    expect(section).toContain('```\ngit diff --stat HEAD на 11.10.2026:\n')
    expect(section).toContain('scripts/a.mjs | 1 +')
  })

  it('новые untracked-файлы упоминаются отдельно (diff их не видит)', () => {
    const section = buildSection({ title: 'T', date: '11.10.2026', diffStat: ' 1 file changed, 1 insertion(+)', untracked: ['scripts/stage-facts.mjs', 'scripts/stage-facts.test.mjs'] })
    expect(section).toContain('новых (untracked): 2 — scripts/stage-facts.mjs, scripts/stage-facts.test.mjs')
  })
})

describe('buildHeaderChecklist', () => {
  it('перечисляет правки шапки бэклога', () => {
    const checklist = buildHeaderChecklist({ date: '11.10.2026' })
    expect(checklist).toContain('## Чек-лист шапки «Что доделать.txt» (11.10.2026)')
    expect(checklist).toContain('test-counter-audit.mjs --fix')
    expect(checklist).toContain('check-doc-mirrors.mjs --fix')
  })

  it('диктует канон закрытия (заголовок-маркер без тела), а не надгробие', () => {
    const checklist = buildHeaderChecklist({ date: '11.10.2026' })
    expect(checklist).toContain('без тела')
    expect(checklist).not.toContain('надгробие')
  })
})

describe('diffSummary', () => {
  it('парсит число файлов и хвост', () => {
    const s = diffSummary(' server/src/routes/a.js | 4 ++++\n src/pages/b.tsx | 2 +-\n 2 files changed, 6 insertions(+), 1 deletion(-)')
    expect(s).toContain('2')
    expect(s).toContain('6 insertions')
  })

  it('пустая строка — сообщение о закоммиченном', () => {
    expect(diffSummary('')).toContain('закоммичены')
  })
})

describe('todayRu', () => {
  it('нули спереди у дня и месяца', () => {
    expect(todayRu(new Date(2026, 9, 11))).toBe('11.10.2026')
    expect(todayRu(new Date(2026, 8, 3))).toBe('03.09.2026')
  })
})