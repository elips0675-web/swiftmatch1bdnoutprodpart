/**
 * Гейт «раскладка документации» (`npm run check:docs`).
 *
 * До этапа 32 у проекта было три источника одних и тех же правил
 * (`Промты.txt` разделы 0–20, `docs/AGENTS-*.md`, частично `AGENTS.md`) и два
 * источника истории (`context.txt`, `Что сделано.txt`). Дублирование правил
 * опаснее отсутствия документа: файл, попавший в конец цепочки, протухает
 * отдельно от канона, и агент/человек читает его как истину. Факты из
 * предыдущего аудита:
 *
 *   • `Промты.txt` требовал сделать `adminAuth` пассивным (6 мест) — то есть
 *     прямо разрешал снять защиту `/api/admin`. Этап 24 закрыл это в коде
 *     (`401`/`403`), и правило исправили в шести местах *этого* файла, но
 *     разделы 0–20 так и остались отдельной версией правил;
 *   • `context.txt` объявлял в шапке «React Hook Form + Zod 4 валидация» —
 *     `zod` и `@hookform/resolvers` удалены этапом 31 как мёртвые зависимости,
 *     а та же строка про `zod` осталась в `project-context.md:13`;
 *   • продуктовые идеи (разделы 21–34 `Промты.txt`, 775 строк) не были видны ни
 *     одному гейту: `docs/roadmap.md` оказался журналом этапов, а не списком
 *     идей, поэтому они перенесены в `docs/product-roadmap.md` дословно.
 *
 * Гейт проверяет шесть вещей, каждую — на обоих концах (и «плохо», и «хорошо»):
 *
 *  1. **`Промты.txt` — указатель, а не источник правил.** Есть шапка со словами
 *     «больше не источник правил», нет разделов `## 0.`–`## 20.`, нет
 *     разделов `## 21.`–`## 34.` (они переехали), и каждая ссылка из таблицы
 *     канона указывает на существующий файл.
 *  2. **`docs/product-roadmap.md` не потерял и не распух.** На месте все 14
 *     заголовков разделов 21–34, в каждом не меньше 8 непустых строк, всего не
 *     меньше 600 непустых строк (перенесено 645), и там нет разделов 0–20.
 *  3. **Запрещённые формулировки** (`adminAuth` … «passive» рядом, `Zod 4`)
 *     не появляются в отслеживаемых `.md`/`.txt`. Исключение ровно одно и оно
 *     осознанное: журналы `Что сделано.txt` и `Что доделать.txt` обязаны
 *     процитировать неверное правило, чтобы зафиксировать его закрытие.
 *     Список исключений проверяется тестом — добавить туда файл молча нельзя.
 *  4. **Архивный снимок `context.txt` помечен.** В первых строках есть пометка
 *     «ИСТОРИЧЕСКИЙ СРЕЗ», дата среза и указание канона (`project-context.md`):
 *     иначе агент читает 141 КБ августа как текущее состояние.
 *  5. **Структура бэклога.** `Что доделать.txt` — только открытые пункты:
 *     каждый ID (первая ячейка строк `| … |`) ровно один раз, заголовки
 *     уникальны, нет `⏳` на закрытом, нет хронических заголовков
 *     «## … (ДД.ММ.ГГГГ): …», каждая дата «ЗАКРЫТО …» обязана быть в хронике
 *     «Что сделано.txt», а `docs/agenda-archive.md` обязан оставаться архивом.
 *  6. **Гейт реально запускается.** Скрипт `check:docs` есть в `package.json`,
 *     а `docs-canon-audit.mjs` упомянут в `.github/workflows/ci.yml` и
 *     `deploy.yml`. Гейт, который никто не зовёт, зелёный всегда (питфолл 56).
 *
 * Файлы берутся из `git ls-files`, а не обходом дерева: в рабочем дереве могут
 * лежать чужие удаления (отслеживаемый, но отсутствующий файл) и чужие
 * untracked-черновики. Отсутствующий файл даёт `[SKIP]`, а не падение: иначе
 * гейт блокировал бы работу, не связанную с документацией.
 *
 * Запуск: node scripts/docs-canon-audit.mjs [путь-к-репозиторию]
 * Выход: 0 — находок нет, 1 — есть (для CI).
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const PROMPTS_INDEX = 'Промты.txt'
export const ROADMAP_FILE = 'docs/product-roadmap.md'
export const ARCHIVE_FILE = 'context.txt'
export const CI_WORKFLOW = '.github/workflows/ci.yml'
export const DEPLOY_WORKFLOW = '.github/workflows/deploy.yml'
export const CI_JOB = 'docs-canon'
export const GATE_SCRIPT = 'docs-canon-audit.mjs'
export const NPM_SCRIPT = 'check:docs'

export const PROMPTS_BANNER = 'этот файл больше не источник правил'
export const ARCHIVE_BANNER = 'ИСТОРИЧЕСКИЙ СРЕЗ'
export const ARCHIVE_CANON = 'project-context.md'
export const ARCHIVE_DATE = /\d{2}\.\d{2}\.\d{4}/

/** Разделы-идеи, перенесённые из `Промты.txt` в `docs/product-roadmap.md`. */
export const MOVED_SECTIONS = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]
/** Разделы-правила, которые в `docs/product-roadmap.md` жить не должны. */
export const RULE_SECTIONS = [...Array(21).keys()]

/** Нижняя граница содержимого перенесённого блока (перенесено 645 непустых строк). */
export const ROADMAP_MIN_TOTAL_LINES = 600
export const ROADMAP_MIN_SECTION_LINES = 8

/**
 * Ссылки на `test/`-файлы, которые не проверяются на существование. Гейт читает
 * только `Промты.txt`, и любая ссылка с префиксом `test/`, которой здесь нет, —
 * находка `canon-mirror-unknown` (иначе её не проверит ни existence-проверка,
 * ни CI). Список узкий: ровно те `test/`-файлы, на которые ссылается указатель
 * канона.
 */
export const MIRROR_FILES = [
  'test/ИНВЕНТАРЬ-ТЕСТОВ.md',
]

export const FORBIDDEN_PHRASES = [
  {
    id: 'admin-auth-passive',
    re: /adminAuth[^\n]{0,80}\bpassive\b/i,
    hint: 'adminAuth обязан быть ACTIVE (401/403). Если это цитата неверного правила — переформулируйте словами «пассивным» или перенесите в файл из FORBIDDEN_EXEMPT_FILES.',
  },
  {
    id: 'zod-version-claim',
    re: /\bzod[\s-]*4\b/i,
    hint: 'zod и @hookform/resolvers удалены 04.10.2026 (этап 31) как мёртвые зависимости; валидации на zod в проекте нет. Регистр и дефис ловятся намеренно: «zod 4» и «Zod-4» — то же самое ложное утверждение.',
  },
]

/** Журналы обязаны цитировать неверное правило, чтобы зафиксировать его закрытие. */
export const FORBIDDEN_EXEMPT_FILES = [
  'Что сделано.txt',
  'Что доделать.txt',
  'test/Что сделано.txt',
  'test/Что доделать.txt',
]

/**
 * Ссылка на файл в обратных кавычках. `\p{L}` обязателен: `Промты.txt` и
 * `test/ИНВЕНТАРЬ-ТЕСТОВ.md` содержат кириллицу, а `\w` в JS — это только
 * `[A-Za-z0-9_]`. С `\w` гейт молча пропускал бы половину ссылок, и битая
 * ссылка в таблице канона прошла бы как «проверенная».
 */
export const FILE_LINK_RE = /`([\p{L}\p{N}._/@-]+\.(?:md|txt|json|example|mjs|cjs|js|ts|tsx|sql|yml|yaml|ps1|bat|sh))`/gu

const RULE_HEADING_RE = /^##\s+(\d{1,2})\.\s/
const MIRROR_PREFIX = 'test/'

function sectionLine(text, num) {
  return text.split(/\r?\n/).findIndex(l => new RegExp(`^##\\s+${num}\\.\\s`).test(l))
}

/**
 * Проверки `Промты.txt` — файла, который обязан быть только указателем.
 * @param {string} text содержимое файла
 * @param {{fileExists: (p: string) => boolean}} deps
 */
export function collectPromptsFindings(text, deps) {
  const findings = []
  const lines = text.split(/\r?\n/)

  if (!text.includes(PROMPTS_BANNER)) {
    findings.push({ id: 'prompts-banner', file: PROMPTS_INDEX, line: 1, text: `нет фразы «${PROMPTS_BANNER}» — файл снова выглядит как источник правил` })
  }

  lines.forEach((line, i) => {
    const m = RULE_HEADING_RE.exec(line)
    if (!m) return
    const num = Number(m[1])
    if (RULE_SECTIONS.includes(num)) {
      findings.push({ id: 'prompts-rule-section', file: PROMPTS_INDEX, line: i + 1, text: `вернулся раздел-правило «${line.trim()}» — правила живут в docs/AGENTS-*.md` })
    }
    if (MOVED_SECTIONS.includes(num)) {
      findings.push({ id: 'prompts-moved-section', file: PROMPTS_INDEX, line: i + 1, text: `раздел «${line.trim()}» остался здесь, но перенесён в ${ROADMAP_FILE}` })
    }
  })

  const links = [...new Set([...text.matchAll(FILE_LINK_RE)].map(m => m[1]))]
  for (const link of links) {
    if (link.startsWith(MIRROR_PREFIX)) {
      if (!MIRROR_FILES.includes(link)) {
        findings.push({ id: 'canon-mirror-unknown', file: PROMPTS_INDEX, line: 1, text: `ссылка на зеркало ${link}, которой нет в MIRROR_FILES — её не проверит ни existence-проверка, ни CI (зеркала в CI нет)` })
      }
      continue
    }
    if (!deps.fileExists(link)) {
      findings.push({ id: 'canon-link', file: PROMPTS_INDEX, line: 1, text: `ссылка ведёт на несуществующий файл: ${link}` })
    }
  }

  return { findings, links }
}

/**
 * Проверки `docs/product-roadmap.md` — что перенос разделов 21–34 не потерял
 * содержимое и не превратился в свалку правил.
 */
export function collectRoadmapFindings(text) {
  const findings = []
  const lines = text.split(/\r?\n/)

  for (const num of MOVED_SECTIONS) {
    if (sectionLine(text, num) < 0) {
      findings.push({ id: 'roadmap-missing-section', file: ROADMAP_FILE, line: 1, text: `нет заголовка раздела ${num} — идея потеряна при переносе` })
    }
  }

  lines.forEach((line, i) => {
    const m = RULE_HEADING_RE.exec(line)
    if (m && RULE_SECTIONS.includes(Number(m[1]))) {
      findings.push({ id: 'roadmap-rule-section', file: ROADMAP_FILE, line: i + 1, text: `раздел-правило «${line.trim()}» не должен попадать в файл идей` })
    }
  })

  const heads = lines
    .map((l, i) => [i, l])
    .filter(([, l]) => /^##\s+\d{1,2}\.\s/.test(l))
  heads.forEach(([idx, line], k) => {
    const num = Number(line.match(RULE_HEADING_RE)[1])
    if (!MOVED_SECTIONS.includes(num)) return
    const end = k + 1 < heads.length ? heads[k + 1][0] : lines.length
    const nonEmpty = lines.slice(idx + 1, end).filter(l => l.trim()).length
    if (nonEmpty < ROADMAP_MIN_SECTION_LINES) {
      findings.push({ id: 'roadmap-thin-section', file: ROADMAP_FILE, line: idx + 1, text: `раздел ${num}: ${nonEmpty} непустых строк, минимум ${ROADMAP_MIN_SECTION_LINES}` })
    }
  })

  const total = lines.filter(l => l.trim()).length
  if (total < ROADMAP_MIN_TOTAL_LINES) {
    findings.push({ id: 'roadmap-thin-total', file: ROADMAP_FILE, line: 1, text: `${total} непустых строк, минимум ${ROADMAP_MIN_TOTAL_LINES} (перенесено 645)` })
  }

  return { findings, nonEmptyLines: total }
}

/**
 * Запрещённые формулировки в отслеживаемых `.md`/`.txt`.
 * @param {Array<{path: string, text: string}>} docs
 */
export function collectForbiddenFindings(docs) {
  const findings = []
  for (const doc of docs) {
    if (FORBIDDEN_EXEMPT_FILES.includes(doc.path)) continue
    doc.text.split(/\r?\n/).forEach((line, i) => {
      for (const rule of FORBIDDEN_PHRASES) {
        if (!rule.re.test(line)) continue
        findings.push({ id: rule.id, file: doc.path, line: i + 1, text: line.trim().slice(0, 160), hint: rule.hint })
      }
    })
  }
  return findings
}

/** Проверки архивного снимка `context.txt`. */
export function collectArchiveFindings(text) {
  const findings = []
  const head = text.split(/\r?\n/).slice(0, 6).join('\n')
  if (!head.includes(ARCHIVE_BANNER)) {
    findings.push({ id: 'archive-banner', file: ARCHIVE_FILE, line: 1, text: `в первых 6 строках нет «${ARCHIVE_BANNER}» — архив выглядит как текущее состояние` })
  }
  if (!text.includes(ARCHIVE_CANON)) {
    findings.push({ id: 'archive-canon', file: ARCHIVE_FILE, line: 1, text: `нет ссылки на канон ${ARCHIVE_CANON}` })
  }
  if (!ARCHIVE_DATE.test(head)) {
    findings.push({ id: 'archive-date', file: ARCHIVE_FILE, line: 1, text: 'в шапке нет даты среза' })
  }
  return findings
}

/**
 * Структурный гейт бэклога (P2, закрыто 11.10.2026). `docs-canon-audit` ловил
 * формулировки и ссылки, счётчики — только числа; структуру `Что доделать.txt`
 * не проверял никто, и автоматизация записи этапов закрепила бы дублирование.
 * Правила (каждое на обоих концах):
 *
 *  1. **Каждый открытый ID ровно один раз.** ID — первая ячейка строк `| … |`
 *     (номера пунктов таблиц, имена конфигов): задвоенная ячейка — это пункт,
 *     учтённый дважды, или две секции, претендующие на один ID.
 *  2. **Заголовки `##`/`###` уникальны** — дубль заголовка прячет секцию от
 *     читателя и от поиска.
 *  3. **Нет `⏳` на закрытом пункте** — строка с `⏳` и одновременно с
 *     ✅/`ЗАКРЫТО`/зачёркиванием противоречит «бэклог ≠ история».
 *  4. **В бэклоге не живут хронические заголовки** `## … (ДД.ММ.ГГГГ): …` —
 *     это формат записей «Что сделано.txt»; разделение ролей: открытые пункты
 *     — бэклог, хроника — «Что сделано.txt», архив срезов — `agenda-archive.md`.
 *  5. **Каждая дата «ЗАКРЫТО …» обязана быть в «Что сделано.txt»** — закрытие
 *     без хроники = запись, которая существует только в бэклоге.
 *  6. **У закрытого заголовка нет тела.** `### … — ЗАКРЫТО <дата>` обязан
 *     стоять один: следующий непустой абзац под ним — это тело надгробия,
 *     то есть история, вернувшаяся в бэклог (правило «Бэклог ≠ история»,
 *     `Что доделать.txt`). Развёрнутая запись живёт только в «Что сделано.txt».
 *     Признак закрытия — маркер **в конце** заголовка (`— ЗАКРЫТО <дата>` или
 *     `✅`); `✅` в середине (`## ✅ Принятые решения`) — маркер всей секции,
 *     не закрытие пункта, и телом она не считается.
 *     Проверка появилась после реального дефекта: инструмент `stage-section.mjs`
 *     и `docs/AGENTS-workflow.md` диктовали «надгробие с телом», и три этапа
 *     копили закрытые секции, пока правило не поймали глазами.
 */
export const TODO_JOURNAL = 'Что доделать.txt'
export const DONE_JOURNAL = 'Что сделано.txt'
export const AGENDA_ARCHIVE = 'docs/agenda-archive.md'
export const CHANGELOG_FILE = 'CHANGELOG.md'
export const AGENDA_BANNER_RE = /(архив|снимок)/i
export const CLOSURE_DATE_RE = /ЗАКРЫТО[^\d]{0,20}(\d{2}\.\d{2}\.\d{4})/g
export const CHRONICLE_HEADER_RE = /^##\s+[^\n]*\(\d{2}\.\d{2}\.\d{4}\)[):]/
export const CHANGELOG_HEAD_RE = /Keep a Changelog/
export const CHANGELOG_UNRELEASED_RE = /^##\s+\[Unreleased\]/im
export const CHANGELOG_RELEASE_RE = /^##\s+\[[0-9]+\.[0-9]+\.[0-9]+\][^\n]*\d{4}-\d{2}-\d{2}/m
export const CLOSED_HEADING_RE = /(?:ЗАКРЫТО\s*\d{2}\.\d{2}\.\d{4}|✅)\s*$/

export function tableIds(text) {
  const ids = []
  text.split(/\r?\n/).forEach((line) => {
    if (!line.startsWith('|')) return
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 2) return
    const id = cells[1].replace(/^~+/g, '').replace(/~+$/g, '').replace(/\*\*/g, '').replace(/`/g, '')
    if (!id || id === '#' || /^-{2,}$/.test(id)) return
    ids.push(id)
  })
  return ids
}

/** Структурные проверки бэклога. */
export function collectBacklogFindings(todoText, doneText) {
  const findings = []
  const lines = todoText.split(/\r?\n/)

  const seenIds = new Map()
  lines.forEach((line, i) => {
    if (!line.startsWith('|')) return
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 2) return
    const id = cells[1].replace(/^~+/g, '').replace(/~+$/g, '').replace(/\*\*/g, '').replace(/`/g, '')
    if (!id || id === '#' || /^-{2,}$/.test(id)) return
    if (seenIds.has(id)) {
      findings.push({ id: 'backlog-table-id-dup', file: TODO_JOURNAL, line: i + 1, text: `ID «${id}» повторяется (ранее: строка ${seenIds.get(id)}) — открытый пункт обязан быть ровно один раз` })
    } else {
      seenIds.set(id, i + 1)
    }
  })

  const seenHeads = new Map()
  lines.forEach((line, i) => {
    const m = /^#{2,3}\s+(.+)$/.exec(line)
    if (!m) return
    const heading = m[1].replace(/\s+/g, ' ').trim()
    if (seenHeads.has(heading)) {
      findings.push({ id: 'backlog-heading-dup', file: TODO_JOURNAL, line: i + 1, text: `заголовок «${heading}» повторяется (ранее: строка ${seenHeads.get(heading)})` })
    } else {
      seenHeads.set(heading, i + 1)
    }
  })

  lines.forEach((line, i) => {
    const leadingWait = /^\s*(?:[|>-]\s*)*⏳/.test(line)
    if (leadingWait && /(✅|ЗАКРЫТО|~~)/.test(line)) {
      findings.push({ id: 'backlog-closed-waiting', file: TODO_JOURNAL, line: i + 1, text: '`⏳` (ждёт действий) в начале строки с признаком закрытия — закрытый пункт в бэклоге не живёт' })
    }
    const head = CHRONICLE_HEADER_RE.exec(line)
    if (head) {
      findings.push({ id: 'backlog-history-header', file: TODO_JOURNAL, line: i + 1, text: 'заголовок в формате хроники «## … (ДД.ММ.ГГГГ): …» — записи этапов живут в «Что сделано.txt»' })
    }
    const closedHead = /^#{2,6}\s+(.+)$/.exec(line)
    if (closedHead && CLOSED_HEADING_RE.test(closedHead[1])) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]
        if (/^#{1,6}\s/.test(next)) break
        if (!next.trim() || next.trim() === '---') continue
        findings.push({ id: 'backlog-closed-body', file: TODO_JOURNAL, line: j + 1, text: 'тело под закрытым заголовком — закрытый пункт в бэклоге не живёт, развёрнутая запись — в «Что сделано.txt»' })
        break
      }
    }
  })

  const closureDates = [...todoText.matchAll(CLOSURE_DATE_RE)].map((m) => m[1])
  const done = String(doneText || '')
  for (const date of [...new Set(closureDates)]) {
    if (!done.includes(date)) {
      findings.push({ id: 'backlog-closure-unchronicled', file: TODO_JOURNAL, line: 1, text: `дата «ЗАКРЫТО ${date}» отсутствует в ${DONE_JOURNAL} — закрытие без хроники` })
    }
  }

  return findings
}

/** Роль `docs/agenda-archive.md` — архив срезов, а не живой документ. */
export function collectAgendaFindings(text) {
  const findings = []
  const head = text.split(/\r?\n/).slice(0, 6).join('\n')
  if (!AGENDA_BANNER_RE.test(head)) {
    findings.push({ id: 'agenda-archive-role', file: AGENDA_ARCHIVE, line: 1, text: 'в первых 6 строках нет «архив»/«снимок» — файл обязан оставаться архивом срезов' })
  }
  return findings
}

/**
 * Публичный `CHANGELOG.md` (P2, перенесено у Service Desk). Это
 * пользовательская сводка по релизам (Keep a Changelog), **не** вторая
 * хроника: развёрнутая история этапов живёт в «Что сделано.txt», и changelog
 * обязан на неё ссылаться. Без структурного контракта файл протухает молча
 * (питфолл «три копии правил вместо одной»), поэтому проверяются форма и
 * наличие живых разделов, а не содержание.
 */
export function collectChangelogFindings(text) {
  const findings = []
  if (!text) {
    findings.push({ id: 'changelog-missing', file: CHANGELOG_FILE, line: 1, text: 'файл не найден — публичный changelog обязан существовать' })
    return findings
  }
  const head = text.split(/\r?\n/).slice(0, 8).join('\n')
  if (!CHANGELOG_HEAD_RE.test(head)) {
    findings.push({ id: 'changelog-format', file: CHANGELOG_FILE, line: 1, text: 'в первых 8 строках нет «Keep a Changelog» — формат обязан быть объявлен' })
  }
  if (!CHANGELOG_UNRELEASED_RE.test(text)) {
    findings.push({ id: 'changelog-unreleased', file: CHANGELOG_FILE, line: 1, text: 'нет раздела «## [Unreleased]» — незакрытым изменениям некуда писаться' })
  }
  if (!CHANGELOG_RELEASE_RE.test(text)) {
    findings.push({ id: 'changelog-release', file: CHANGELOG_FILE, line: 1, text: 'нет ни одного заголовка «## [X.Y.Z] — ГГГГ-ММ-ДД» — changelog без релизов бесполезен' })
  }
  if (!text.includes(DONE_JOURNAL)) {
    findings.push({ id: 'changelog-chronicle-link', file: CHANGELOG_FILE, line: 1, text: `нет ссылки на «${DONE_JOURNAL}» — публичная сводка обязана указывать внутреннюю хронику (иначе это вторая история)` })
  }
  return findings
}

/** Блок джобы по отступу: от `  <имя>:` до следующей строки с тем же или меньшим отступом. */
export function getJobBlock(yaml, jobName) {
  if (!yaml) return null
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex(l => new RegExp(`^ {2}${jobName}:\\s*$`).test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

/**
 * Блок шага, содержащего `needle`. Ищет не строку с `-`, а начало элемента
 * списка выше неё: шаг может называться через `name:`, а вызов гейта лежать в
 * `run:`, поэтому «строка с дефисом, в которой есть needle» — неправильное
 * условие (оно молча возвращает пустоту на валидном YAML).
 *
 * Обход блока, а не окно строк выше, обязателен: в YAML ключ шага может стоять
 * после `run:` (`- run: X`, ниже `continue-on-error: true`), и поиск «в
 * предыдущих строках» такую расстановку пропускает — гейт остаётся зелёным на
 * шаге, который ничего не блокирует (питфолл 56).
 */
export function getStepBlock(yaml, needle) {
  if (!yaml) return null
  const lines = yaml.split(/\r?\n/)
  const at = lines.findIndex(l => l.includes(needle))
  if (at < 0) return null

  let start = -1
  for (let i = at; i >= 0; i--) {
    if (/^\s*-\s/.test(lines[i])) { start = i; break }
    if (/^\S/.test(lines[i])) return null
  }
  if (start < 0) return null

  const indent = (lines[start].match(/^\s*/) || [''])[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const ind = (lines[i].match(/^\s*/) || [''])[0].length
    if (/^\s*-\s/.test(lines[i]) && ind <= indent) { end = i; break }
    if (/^\S/.test(lines[i]) || ind < indent) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

/** Есть ли у шага `continue-on-error: true` / `if: false`. */
export function blockAllowsFailure(block) {
  if (!block) return false
  return /continue-on-error:\s*true/.test(block) || /^\s*if:\s*(\$\{\{\s*)?false/m.test(block)
}

/**
 * Есть ли `continue-on-error: true` / `if: false` на уровне самой джобы, а не
 * внутри её шагов. Отделено от `blockAllowsFailure` намеренно: у джобы гейта
 * может быть несколько шагов (checkout, setup-node, сам гейт), и
 * `continue-on-error` у постороннего шага не должен красить проверку wiring.
 */
export function jobAllowsFailure(jobBlock) {
  if (!jobBlock) return false
  return jobBlock
    .split(/\r?\n/)
    .some(l => /^ {4}(continue-on-error:\s*true|if:\s*(\$\{\{\s*)?false)/.test(l))
}

/**
 * Проверки того, что гейт кого-то зовёт. Цепочка проверяется целиком:
 * скрипт есть в `package.json` и указывает на файл гейта → в `ci.yml` есть
 * джоба с ожидаемым именем, которая вызывает гейт и не разрешает падать → в
 * `deploy.yml` гейт тоже вызывается и тоже блокирующий. Раньше проверка искала
 * просто подстроку, и переименование джобы (`docs-canon` → `docs-canon-off`)
 * оставалось зелёным: подстрока `check:docs` на месте, а человек, читая
 * workflow, такого вызова уже не находит.
 */
export function collectWiringFindings({ pkgJson, ciYaml, deployYaml }) {
  const findings = []
  const script = pkgJson && pkgJson.scripts ? pkgJson.scripts[NPM_SCRIPT] : undefined
  if (!script) {
    findings.push({ id: 'wiring-npm', file: 'package.json', line: 1, text: `нет скрипта «${NPM_SCRIPT}» — гейт никто не запускает` })
  } else if (!script.includes(GATE_SCRIPT)) {
    findings.push({ id: 'wiring-npm-target', file: 'package.json', line: 1, text: `скрипт «${NPM_SCRIPT}» указывает на «${script}», а не на ${GATE_SCRIPT}` })
  }

  const ciJob = getJobBlock(ciYaml, CI_JOB)
  if (!ciYaml || (!ciYaml.includes(NPM_SCRIPT) && !ciYaml.includes(GATE_SCRIPT))) {
    findings.push({ id: 'wiring-ci', file: CI_WORKFLOW, line: 1, text: `${CI_WORKFLOW} не вызывает ни «${NPM_SCRIPT}», ни ${GATE_SCRIPT}` })
    return finishWiring(findings, deployYaml)
  }
  if (!ciJob) {
    findings.push({ id: 'wiring-ci-job', file: CI_WORKFLOW, line: 1, text: `в ${CI_WORKFLOW} нет джобы «${CI_JOB}» (вызов гейта спрятан в другую джобу или остался в переименованной)` })
  } else {
    if (jobAllowsFailure(ciJob)) {
      findings.push({ id: 'wiring-ci-soft', file: CI_WORKFLOW, line: 1, text: `джоба «${CI_JOB}» помечена continue-on-error или if: false — гейт зелёный всегда` })
    }
    const ciStep = getStepBlock(ciJob, NPM_SCRIPT) || getStepBlock(ciJob, GATE_SCRIPT)
    if (!ciStep) {
      findings.push({ id: 'wiring-ci-step', file: CI_WORKFLOW, line: 1, text: `в джобе «${CI_JOB}» нет вызова гейта` })
    } else if (blockAllowsFailure(ciStep)) {
      findings.push({ id: 'wiring-ci-step-soft', file: CI_WORKFLOW, line: 1, text: `шаг вызова гейта в джобе «${CI_JOB}» помечен continue-on-error или if: false` })
    }
  }

  return finishWiring(findings, deployYaml)
}

function finishWiring(findings, deployYaml) {
  if (!deployYaml || (!deployYaml.includes(NPM_SCRIPT) && !deployYaml.includes(GATE_SCRIPT))) {
    findings.push({ id: 'wiring-deploy', file: DEPLOY_WORKFLOW, line: 1, text: `${DEPLOY_WORKFLOW} не вызывает ни «${NPM_SCRIPT}», ни ${GATE_SCRIPT}` })
    return findings
  }
  const step = getStepBlock(deployYaml, NPM_SCRIPT) || getStepBlock(deployYaml, GATE_SCRIPT)
  if (!step) {
    findings.push({ id: 'wiring-deploy-step', file: DEPLOY_WORKFLOW, line: 1, text: 'вызов гейта в deploy.yml не принадлежит шагу (- …) — разберись, что это за строка' })
    return findings
  }
  if (blockAllowsFailure(step)) {
    findings.push({ id: 'wiring-deploy-soft', file: DEPLOY_WORKFLOW, line: 1, text: 'шаг вызова гейта в deploy.yml помечен continue-on-error или if: false — гейт зелёный всегда' })
  }
  return findings
}

/** Отслеживаемые `.md`/`.txt`, существующие в дереве. */
export function collectTrackedDocs(root) {
  let tracked = []
  let viaGit = true
  try {
    tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)
  } catch {
    viaGit = false
  }
  if (viaGit) {
    const docs = []
    const missing = []
    for (const rel of tracked) {
      if (!/\.(md|txt)$/i.test(rel)) continue
      const abs = path.join(root, rel)
      if (!fs.existsSync(abs)) { missing.push(rel); continue }
      docs.push({ path: rel, text: fs.readFileSync(abs, 'utf8') })
    }
    return { docs, missing, source: 'git' }
  }
  const docs = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(rel); continue }
      const r = rel.replace(/\\/g, '/')
      if (!/\.(md|txt)$/i.test(entry.name)) continue
      if (/^\.github\//.test(r) || /(^|\/)node_modules\//.test(r)) continue
      docs.push({ path: r, text: fs.readFileSync(rel, 'utf8') })
    }
  }
  walk(root)
  return { docs, missing: [], source: 'fs' }
}

/**
 * Полный прогон гейта.
 * @param {string} root корень репозитория
 */
export function audit(root) {
  const read = rel => {
    const abs = path.join(root, rel)
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
  }

  const prompts = read(PROMPTS_INDEX)
  const roadmap = read(ROADMAP_FILE)
  const archive = read(ARCHIVE_FILE)
  const todo = read(TODO_JOURNAL)
  const done = read(DONE_JOURNAL)
  const agenda = read(AGENDA_ARCHIVE)
  const findings = []
  let promptsCheck = { findings: [], links: [] }
  let roadmapCheck = { findings: [], nonEmptyLines: 0 }

  if (!prompts) findings.push({ id: 'prompts-missing', file: PROMPTS_INDEX, line: 1, text: 'файл не найден' })
  else {
    promptsCheck = collectPromptsFindings(prompts, { fileExists: rel => fs.existsSync(path.join(root, rel)) })
    findings.push(...promptsCheck.findings)
  }

  if (!roadmap) findings.push({ id: 'roadmap-missing', file: ROADMAP_FILE, line: 1, text: 'файл не найден' })
  else {
    roadmapCheck = collectRoadmapFindings(roadmap)
    findings.push(...roadmapCheck.findings)
  }

  if (!archive) findings.push({ id: 'archive-missing', file: ARCHIVE_FILE, line: 1, text: 'файл не найден' })
  else findings.push(...collectArchiveFindings(archive))

  if (!todo) findings.push({ id: 'backlog-missing', file: TODO_JOURNAL, line: 1, text: 'файл не найден' })
  else findings.push(...collectBacklogFindings(todo, done || ''))

  if (!agenda) findings.push({ id: 'agenda-archive-missing', file: AGENDA_ARCHIVE, line: 1, text: `файл не найден — бэклог ссылается на него как на архив срезов` })
  else findings.push(...collectAgendaFindings(agenda))

  findings.push(...collectChangelogFindings(read(CHANGELOG_FILE)))

  const { docs, missing, source } = collectTrackedDocs(root)
  findings.push(...collectForbiddenFindings(docs))

  let pkgJson = null
  try { pkgJson = JSON.parse(read('package.json') || 'null') } catch { pkgJson = null }
  findings.push(...collectWiringFindings({ pkgJson, ciYaml: read(CI_WORKFLOW), deployYaml: read(DEPLOY_WORKFLOW) }))

  return { findings, docs, missing, source, promptsCheck, roadmapCheck }
}

function main() {
  const root = path.resolve(process.argv[2] || process.cwd())
  const { findings, docs, missing, source, promptsCheck, roadmapCheck } = audit(root)

  console.log(`docs-canon audit: ${docs.length} отслеживаемых .md/.txt (список: ${source}${missing.length ? `, пропущено отсутствующих: ${missing.length}` : ''})`)
  for (const m of missing) console.log(`  [SKIP] ${m} — отслеживается в git, но отсутствует в дереве`)
  console.log(`Канон-указатель: ${PROMPTS_INDEX} (ссылок: ${promptsCheck.links.length}); идеи: ${ROADMAP_FILE} (${roadmapCheck.nonEmptyLines} непустых строк); архив: ${ARCHIVE_FILE}; бэклог: ${TODO_JOURNAL} (структура), хроника: ${DONE_JOURNAL}, архив срезов: ${AGENDA_ARCHIVE}`)
  console.log(`\nНаходок: ${findings.length}\n`)

  if (!findings.length) {
    console.log('Раскладка документации в порядке: правила в docs/AGENTS-*.md, идеи в product-roadmap, архив помечен.')
    process.exit(0)
  }

  for (const f of findings) {
    console.log(`FAIL: ${f.file}${f.line ? ':' + f.line : ''} [${f.id}] ${f.text}`)
    if (f.hint) console.log(`      подсказка: ${f.hint}`)
  }
  console.log('')
  console.log('Как править:')
  console.log(`  1) правила — в docs/AGENTS-*.md, ${PROMPTS_INDEX} оставить указателем с таблицей канона;`)
  console.log(`  2) идеи — в ${ROADMAP_FILE}, раздел за разделом 21–34, дословно;`)
  console.log(`  3) архив (${ARCHIVE_FILE}) — шапка «${ARCHIVE_BANNER}» с датой среза и ссылкой на канон;`)
  console.log('  4) запрещённые формулировки — переформулировать, а не цитировать как правило;')
  console.log(`  5) исключение для журналов задано в FORBIDDEN_EXEMPT_FILES (${FORBIDDEN_EXEMPT_FILES.join(', ')}) и проверяется тестом;`)
  console.log(`  6) структура бэклога (${TODO_JOURNAL}) — уникальные ID и заголовки, закрытие с хроникой в ${DONE_JOURNAL}, записи этапов — только там.`)
  process.exit(1)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()