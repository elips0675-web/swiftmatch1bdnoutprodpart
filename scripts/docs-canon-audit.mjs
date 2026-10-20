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
 * Гейт проверяет восемь вещей, каждую — на обоих концах (и «плохо», и «хорошо»):
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
 *  7. **Проза о версиях стека не врёт.** Ряды таблиц стека (`README.md`,
 *     `project-context.md`, `docs/AGENTS-system-prompt.md`,
 *     `docs/AGENTS-workflow.md`) сверяются с `dependencies`/`devDependencies`
 *     `package.json` (точная версия либо только мажор), пропавший ряд — находка,
 *     а возврат «React Hook Form + Zod»/«Zod-схемы»/«RHF + Zod» после удаления
 *     `zod` — тоже. Класс тот же, что у счётчиков тестов (питфолл 93): число
 *     в доке протухает молча и читается как факт — `react-router-dom` 6 → 7
 *     закрыт 11.10.2026, а таблицы держали 6 сразу в четырёх файлах.
 *  8. **Числа и ссылки согласованы с реальными файлами** (Stage 79): число
 *     джоб CI/CD в `test/Для анализа.txt` ↔ число `runs-on:` в workflow-файлах,
 *     лимит загрузки в `docs/AGENTS-security.md`/`docs/AGENTS-production.md` ↔
 *     литерал `fileSize` в `upload.js`, число миграций ↔ `*.sql` в
 *     `database/migrations/`, и `docs/AGENTS-workflow.md` без ссылок на архив
 *     `context.txt`. Класс тот же, что у счётчиков: протухшее число читается
 *     как факт (23 джобы при факте 32, 5MB при коде на 10MB, 60 миграций при
 *     71 — сверено 19.10.2026). Отсутствие якоря — находка, а не пропуск.
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
 * Версии стека в прозаических таблицах. `check:docs` ловил раскладку правил,
 * `test-counter-audit` — числа тестов, но прозу о версиях не сверял никто:
 * апгрейд `react-router-dom 6 → 7` (11.10.2026) закрыт, а таблицы стека
 * остались на 6 — в четырёх файлах сразу (`README.md`, `project-context.md`,
 * `docs/AGENTS-system-prompt.md`, `docs/AGENTS-workflow.md`). Класс тот же,
 * что у счётчиков: число в доке протухает молча и читается как факт
 * (питфолл 93). Источник истины — `package.json`, а не второй список.
 *
 * Каждая строка — якорь на конкретный ряд таблицы + имя пакета. `major`
 * сверяет только мажор (в `project-context.md` версии усечены до мажора
 * намеренно), иначе — версию целиком.
 */
export const STACK_VERSION_ROWS = [
  { id: 'stack-react', file: 'README.md', pkg: 'react', re: /^\|\s*UI-библиотека\s*\|\s*React \/ React DOM\s*\|\s*([^\s|]+)\s*\|/m },
  { id: 'stack-vite', file: 'README.md', pkg: 'vite', re: /^\|\s*Сборка\s*\|\s*Vite\s*\|\s*([^\s|]+)\s*\|/m },
  { id: 'stack-react-router', file: 'README.md', pkg: 'react-router-dom', re: /^\|\s*Роутинг\s*\|\s*react-router-dom\s*\|\s*([^\s|]+)\s*\|/m },
  { id: 'stack-react-hook-form', file: 'README.md', pkg: 'react-hook-form', re: /^\|\s*Формы\s*\|\s*React Hook Form\s*\|\s*([^\s|]+)\s*\|/m },
  { id: 'stack-tanstack-query', file: 'README.md', pkg: '@tanstack/react-query', re: /^\|\s*Серверное состояние\s*\|\s*TanStack Query\s*\|\s*([^\s|]+)\s*\|/m },
  { id: 'stack-pc-react', file: 'project-context.md', pkg: 'react', major: true, re: /^\|\s*React\s*\|\s*(\d+)/m },
  { id: 'stack-pc-vite', file: 'project-context.md', pkg: 'vite', major: true, re: /^\|\s*Vite\s*\|\s*(\d+)/m },
  { id: 'stack-pc-typescript', file: 'project-context.md', pkg: 'typescript', major: true, re: /^\|\s*TypeScript\s*\|\s*(\d+)/m },
  { id: 'stack-pc-tailwind', file: 'project-context.md', pkg: 'tailwindcss', major: true, re: /^\|\s*Tailwind CSS\s*\|\s*(\d+)/m },
  { id: 'stack-pc-react-router', file: 'project-context.md', pkg: 'react-router-dom', major: true, re: /^\|\s*React Router\s*\|\s*(\d+)/m },
  { id: 'stack-pc-react-hook-form', file: 'project-context.md', pkg: 'react-hook-form', major: true, re: /^\|\s*React Hook Form\s*\|\s*(\d+)/m },
  { id: 'stack-pc-framer-motion', file: 'project-context.md', pkg: 'framer-motion', major: true, re: /^\|\s*Framer Motion\s*\|\s*(\d+)/m },
  { id: 'stack-pc-socketio', file: 'project-context.md', pkg: 'socket.io-client', major: true, re: /^\|\s*Socket\.IO\s*\|\s*(\d+)/m },
  { id: 'stack-sp-react-router', file: 'docs/AGENTS-system-prompt.md', pkg: 'react-router-dom', major: true, re: /^\|\s*Routing\s*\|\s*React Router v(\d+)/m },
  { id: 'stack-wf-react-router', file: 'docs/AGENTS-workflow.md', pkg: 'react-router-dom', major: true, re: /Роутинг: React Router (\d+)/ },
]

/**
 * Формулировки об удалённой зависимости. `zod` и `@hookform/resolvers`
 * удалены 04.10.2026 (этап 31), но строка «React Hook Form + Zod» пережила
 * удаление в трёх файлах: `FORBIDDEN_PHRASES` ловит только «zod 4», а не сам
 * факт использования. Тексты — канон, а не журнал, поэтому исключения
 * `FORBIDDEN_EXEMPT_FILES` здесь не действуют.
 */
export const STACK_ABSENCES = [
  { id: 'stack-zod-forms-pc', file: 'project-context.md', re: /^-\s*\*\*Формы\*\*:[^\n]*\+\s*`?zod\b/im, hint: 'zod удалён 04.10.2026 (этап 31) — в разделе State Management его быть не должно' },
  { id: 'stack-zod-forms-sp', file: 'docs/AGENTS-system-prompt.md', re: /^\|\s*Forms\s*\|[^|\n]*\bzod\b/im, hint: 'zod удалён — строка Forms не должна его называть' },
  { id: 'stack-zod-schemas-sp', file: 'docs/AGENTS-system-prompt.md', re: /\bZod-схемы\b/i, hint: 'zod удалён — Zod-схемы не пишем' },
  { id: 'stack-zod-forms-arch', file: 'docs/architecture.md', re: /RHF \+ Zod/i, hint: 'zod удалён — формы на React Hook Form без Zod' },
]

/**
 * Ссылка на файл в обратных кавычках. `\p{L}` обязателен: `Промты.txt` и
 * `test/ИНВЕНТАРЬ-ТЕСТОВ.md` содержат кириллицу, а `\w` в JS — это только
 * `[A-Za-z0-9_]`. С `\w` гейт молча пропускал бы половину ссылок, и битая
 * ссылка в таблице канона прошла бы как «проверенная».
 */
export const FILE_LINK_RE = /`([\p{L}\p{N}._/@-]+\.(?:md|txt|json|example|mjs|cjs|js|ts|tsx|sql|yml|yaml|ps1|bat|sh))`/gu

/** Согласованность чисел документации с реальными файлами (пункт 8 гейта). */
export const ANALYSIS_FILE = 'test/Для анализа.txt'
export const UPLOAD_ROUTE = 'server/src/routes/upload.js'
export const SECURITY_DOC = 'docs/AGENTS-security.md'
export const PRODUCTION_DOC = 'docs/AGENTS-production.md'
export const WORKFLOW_DOC = 'docs/AGENTS-workflow.md'
export const MIGRATIONS_DIR = 'database/migrations'
export const README_FILE = 'README.md'

export const CI_JOBS_CLAIM_RE = /(\d+)\s+джобы\s+`ci\.yml`/
export const DEPLOY_JOBS_CLAIM_RE = /(\d+)\s+`deploy\.yml`/
export const MIGRATIONS_CLAIM_RE = /`database\/migrations\/`\s*\|\s*(\d+)\s+нумерованн/i
export const README_MIGRATIONS_COUNT_RE = /(\d+)\s+пронумерованных\s+`\.sql`/i
export const README_MIGRATIONS_SQL_RE = /`migrations\/`\s*\((\d+)\s+SQL\)/i
export const UPLOAD_CODE_RE = /fileSize:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/
export const UPLOAD_MB_CLAIM_RE = /ограничение\s+(\d+)\s*MB/i
export const WORKFLOW_ARCHIVE_RE = /context\.txt/

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

const semverMajor = v => (String(v).match(/\d+/) || [''])[0]
const semverClean = v => String(v).replace(/^[\^~>=<\s]+/, '').replace(/\s+$/, '')
const lineAt = (text, index) => text.slice(0, index).split('\n').length

/**
 * Сверка версий стека и формулировок об удалённом `zod`. На вход — те же
 * отслеживаемые документы, что и у запрещённых формулировок, плюс карта
 * «пакет → версия» из `package.json`.
 * @param {Array<{path: string, text: string}>} docs
 * @param {Record<string, string>} versions
 */
export function collectStackFindings(docs, versions) {
  const byPath = new Map(docs.map(d => [d.path, d.text]))
  const findings = []

  for (const row of STACK_VERSION_ROWS) {
    const text = byPath.get(row.file)
    if (text === undefined) continue
    const m = row.re.exec(text)
    if (!m) {
      findings.push({ id: row.id, file: row.file, line: 1, text: `не найден ряд стека для «${row.pkg}» — гейт перестал видеть таблицу, а не версия совпала` })
      continue
    }
    const actual = versions[row.pkg]
    if (!actual) continue
    const docV = row.major ? semverMajor(m[1]) : semverClean(m[1])
    const pkgV = row.major ? semverMajor(actual) : semverClean(actual)
    if (docV !== pkgV) {
      findings.push({ id: row.id, file: row.file, line: lineAt(text, m.index), text: `в доке ${row.pkg} — «${m[1]}», а в package.json «${actual}»` })
    }
  }

  for (const rule of STACK_ABSENCES) {
    const text = byPath.get(rule.file)
    if (text === undefined) continue
    const m = rule.re.exec(text)
    if (m) findings.push({ id: rule.id, file: rule.file, line: lineAt(text, m.index), text: rule.hint })
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
 *  7. **Закрытых строк таблиц и пунктов в бэклоге нет** (`backlog-closed-line`):
 *     пометка `✅`/`ЗАКРЫТО <дата>` или зачёркнутый ID в строке `| … |`/пункте
 *     `- …` — тот же дефект, что и тело под закрытым заголовком, только
 *     построчный. Раздел «Правила работы с журналами и бэклогом» исключён:
 *     там маркеры цитируются как правило. Проверка закрыла дыру, через которую
 *     шесть закрытых пунктов (P1, P2 #17–23, P3 #26–31/#37) лежали в бэклоге
 *     как описания и копились с каждым этапом.
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
export const CLOSED_LINE_RE = /(?:✅|ЗАКРЫТО\s*\d{2}\.\d{2}\.\d{4})/
export const RULES_SECTION_RE = /^##\s+Правила работы с журналами/

/** Объём бэклога: сигнал, что в него снова пишут историю, а не открытые пункты. */
export const BACKLOG_MAX_LINES = 1500
export const BACKLOG_MAX_KB = 120
/** Строка таблицы открытого/решаемого пункта: первая ячейка — стабильный ID `<ДОМЕН>-<номер>`. */
export const BACKLOG_ID_ROW_RE = /^\|\s*[A-ZА-Я]+-\d+\s*\|/
/** Дата проверки в колонке «Проверено». */
export const BACKLOG_VERIFIED_DATE_RE = /\d{2}\.\d{2}\.\d{4}/

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

  const rulesAt = lines.findIndex((l) => RULES_SECTION_RE.test(l))
  let rulesEnd = lines.length
  if (rulesAt >= 0) {
    for (let j = rulesAt + 1; j < lines.length; j++) {
      if (/^##\s/.test(lines[j])) { rulesEnd = j; break }
    }
  }

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
    const inRulesSection = rulesAt >= 0 && i >= rulesAt && i < rulesEnd
    const isBacklogItem = line.startsWith('|') || /^\s*(?:[-*]|\d+\.)\s/.test(line)
    if (isBacklogItem && !inRulesSection) {
      const firstCell = line.startsWith('|') ? (line.split('|')[1] || '') : ''
      if (CLOSED_LINE_RE.test(line) || /~~/.test(firstCell)) {
        findings.push({ id: 'backlog-closed-line', file: TODO_JOURNAL, line: i + 1, text: 'закрытая строка таблицы / пункт в бэклоге — закрытый пункт живёт в «Что сделано.txt», в бэклоге остаётся только заголовок-маркер без тела' })
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

  const sizeKb = Buffer.byteLength(todoText, 'utf8') / 1024
  if (lines.length > BACKLOG_MAX_LINES || sizeKb > BACKLOG_MAX_KB) {
    findings.push({ id: 'backlog-max-lines', file: TODO_JOURNAL, line: 1, text: `файл раздулся до ${lines.length} строк / ${sizeKb.toFixed(1)} КБ (лимит ${BACKLOG_MAX_LINES} строк / ${BACKLOG_MAX_KB} КБ) — закрытые пункты выносите в ${DONE_JOURNAL} или ${AGENDA_ARCHIVE}` })
  }

  lines.forEach((line, i) => {
    if (!BACKLOG_ID_ROW_RE.test(line)) return
    if (BACKLOG_VERIFIED_DATE_RE.test(line)) return
    findings.push({ id: 'backlog-item-verified', file: TODO_JOURNAL, line: i + 1, text: 'у пункта в таблице нет даты в колонке «Проверено» — пункт без даты проверки в бэклог не берётся' })
  })

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

/** Число джоб в workflow: по одной строке `runs-on:` на джобу (внешние вызовы `uses:` без runner не считаются). */
export function countWorkflowJobs(yaml) {
  if (!yaml) return 0
  return (yaml.match(/^ {4}runs-on:/gm) || []).length
}

/** Число нумерованных миграций (`*.sql` в `database/migrations/`); `null` — каталог не найден. */
export function countMigrations(root) {
  try {
    return fs.readdirSync(path.join(root, MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).length
  } catch {
    return null
  }
}

/**
 * Сверка чисел и ссылок документации с реальными файлами (Stage 79, пункт 8).
 *
 * Прежний гейт проверял форму текста, но не числа вне таблиц стека: ручная
 * сверка 19.10.2026 нашла четыре протухших утверждения, которых не видел ни
 * один гейт (23 джобы `ci.yml` при факте 32, «ограничение 5MB» при коде на
 * 10MB, 60 миграций при факте 71, пошаговый workflow со ссылкой на архив
 * `context.txt`). Источники истины — реальные файлы, а не константы гейта
 * (питфолл «гейт сверяет реальность с собственной константой»): workflow-файлы
 * считаются по строкам `runs-on:`, миграции — по `*.sql` в каталоге, лимит —
 * по литералу `fileSize` в `upload.js`. Отсутствие якоря (утверждение пропало
 * из дока, в коде нет литерала, каталог не найден) — находка, а не пропуск.
 */
export function collectConsistencyFindings({ analysisText, readmeText, ciYaml, deployYaml, uploadJs, securityText, productionText, workflowText, migrationCount }) {
  const findings = []

  if (readmeText && migrationCount !== null) {
    for (const re of [README_MIGRATIONS_COUNT_RE, README_MIGRATIONS_SQL_RE]) {
      const m = re.exec(readmeText)
      if (!m) continue
      if (Number(m[1]) !== migrationCount) {
        findings.push({ id: 'consistency-readme-migrations', file: README_FILE, line: lineAt(readmeText, m.index), text: `заявлено «${m[1]}» миграций, а в ${MIGRATIONS_DIR} ${migrationCount} *.sql` })
      }
    }
  }

  if (analysisText) {
    const ciClaim = CI_JOBS_CLAIM_RE.exec(analysisText)
    if (!ciClaim) {
      findings.push({ id: 'consistency-ci-jobs-claim', file: ANALYSIS_FILE, line: 1, text: 'нет утверждения «N джобы ci.yml» — гейт не может сверить число джоб CI' })
    } else if (ciYaml && Number(ciClaim[1]) !== countWorkflowJobs(ciYaml)) {
      findings.push({ id: 'consistency-ci-jobs', file: ANALYSIS_FILE, line: lineAt(analysisText, ciClaim.index), text: `заявлено «${ciClaim[1]} джобы ci.yml», а в ${CI_WORKFLOW} ${countWorkflowJobs(ciYaml)} (считается по строкам runs-on:)` })
    }

    const deployClaim = DEPLOY_JOBS_CLAIM_RE.exec(analysisText)
    if (!deployClaim) {
      findings.push({ id: 'consistency-deploy-jobs-claim', file: ANALYSIS_FILE, line: 1, text: 'нет утверждения «N `deploy.yml`» рядом с числом джоб — гейт не может сверить число джоб деплоя' })
    } else if (deployYaml && Number(deployClaim[1]) !== countWorkflowJobs(deployYaml)) {
      findings.push({ id: 'consistency-deploy-jobs', file: ANALYSIS_FILE, line: lineAt(analysisText, deployClaim.index), text: `заявлено «${deployClaim[1]} deploy.yml», а в ${DEPLOY_WORKFLOW} ${countWorkflowJobs(deployYaml)} (считается по строкам runs-on:)` })
    }

    const migClaim = MIGRATIONS_CLAIM_RE.exec(analysisText)
    if (!migClaim) {
      findings.push({ id: 'consistency-migrations-claim', file: ANALYSIS_FILE, line: 1, text: 'нет строки «`database/migrations/` | N нумерованная миграция» — гейт не может сверить число миграций' })
    } else if (migrationCount === null) {
      findings.push({ id: 'consistency-migrations-anchor', file: MIGRATIONS_DIR, line: 1, text: 'каталог не найден — источник истины по числу миграций отсутствует' })
    } else if (Number(migClaim[1]) !== migrationCount) {
      findings.push({ id: 'consistency-migrations', file: ANALYSIS_FILE, line: lineAt(analysisText, migClaim.index), text: `заявлено «${migClaim[1]} нумерованных миграций», а в ${MIGRATIONS_DIR} ${migrationCount} *.sql` })
    }
  }

  const code = uploadJs ? UPLOAD_CODE_RE.exec(uploadJs) : null
  if (!uploadJs) {
    findings.push({ id: 'consistency-upload-source', file: UPLOAD_ROUTE, line: 1, text: 'файл не найден — источник истины по лимиту загрузки отсутствует' })
  } else if (!code) {
    findings.push({ id: 'consistency-upload-source', file: UPLOAD_ROUTE, line: 1, text: 'не найден литерал fileSize: N * 1024 * 1024 — сверка лимита с доками потеряла якорь' })
  } else {
    const mb = Number(code[1])
    const sec = securityText ? UPLOAD_MB_CLAIM_RE.exec(securityText) : null
    if (!securityText) {
      findings.push({ id: 'consistency-upload-security', file: SECURITY_DOC, line: 1, text: 'файл не найден — сверка лимита загрузки невозможна' })
    } else if (!sec) {
      findings.push({ id: 'consistency-upload-security', file: SECURITY_DOC, line: 1, text: 'нет строки «ограничение NMB» — сверка лимита загрузки потеряла якорь' })
    } else if (Number(sec[1]) !== mb) {
      findings.push({ id: 'consistency-upload-security', file: SECURITY_DOC, line: lineAt(securityText, sec.index), text: `заявлено «ограничение ${sec[1]}MB», а код даёт ${mb}MB (${UPLOAD_ROUTE})` })
    }

    const prod = productionText ? UPLOAD_CODE_RE.exec(productionText) : null
    if (!productionText) {
      findings.push({ id: 'consistency-upload-production', file: PRODUCTION_DOC, line: 1, text: 'файл не найден — сверка лимита загрузки невозможна' })
    } else if (!prod) {
      findings.push({ id: 'consistency-upload-production', file: PRODUCTION_DOC, line: 1, text: 'нет литерала fileSize: N * 1024 * 1024 в чек-листе — сверка лимита потеряла якорь' })
    } else if (Number(prod[1]) !== Number(code[1])) {
      findings.push({ id: 'consistency-upload-production', file: PRODUCTION_DOC, line: lineAt(productionText, prod.index), text: `в чек-листе fileSize: ${prod[1]} * 1024 * 1024, а в коде ${code[1]} (${UPLOAD_ROUTE})` })
    }
  }

  if (workflowText) {
    const m = WORKFLOW_ARCHIVE_RE.exec(workflowText)
    if (m) {
      findings.push({ id: 'consistency-workflow-archive', file: WORKFLOW_DOC, line: lineAt(workflowText, m.index), text: 'ссылка на архив context.txt — архив среза не обновляется на этапах, канон — project-context.md и docs/AGENTS-*.md' })
    }
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
  const pkgVersions = { ...(pkgJson && pkgJson.dependencies), ...(pkgJson && pkgJson.devDependencies) }
  findings.push(...collectStackFindings(docs, pkgVersions))
  findings.push(...collectWiringFindings({ pkgJson, ciYaml: read(CI_WORKFLOW), deployYaml: read(DEPLOY_WORKFLOW) }))
  findings.push(...collectConsistencyFindings({
    analysisText: read(ANALYSIS_FILE),
    readmeText: read(README_FILE),
    ciYaml: read(CI_WORKFLOW),
    deployYaml: read(DEPLOY_WORKFLOW),
    uploadJs: read(UPLOAD_ROUTE),
    securityText: read(SECURITY_DOC),
    productionText: read(PRODUCTION_DOC),
    workflowText: read(WORKFLOW_DOC),
    migrationCount: countMigrations(root),
  }))

  return { findings, docs, missing, source, promptsCheck, roadmapCheck }
}

function main() {
  const root = path.resolve(process.argv[2] || process.cwd())
  const { findings, docs, missing, source, promptsCheck, roadmapCheck } = audit(root)
  const read = rel => {
    const abs = path.join(root, rel)
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
  }

  console.log(`docs-canon audit: ${docs.length} отслеживаемых .md/.txt (список: ${source}${missing.length ? `, пропущено отсутствующих: ${missing.length}` : ''})`)
  for (const m of missing) console.log(`  [SKIP] ${m} — отслеживается в git, но отсутствует в дереве`)
  console.log(`Канон-указатель: ${PROMPTS_INDEX} (ссылок: ${promptsCheck.links.length}); идеи: ${ROADMAP_FILE} (${roadmapCheck.nonEmptyLines} непустых строк); архив: ${ARCHIVE_FILE}; бэклог: ${TODO_JOURNAL} (структура), хроника: ${DONE_JOURNAL}, архив срезов: ${AGENDA_ARCHIVE}`)
  console.log(`Стек: ${STACK_VERSION_ROWS.length} версий сверяется с package.json, ${STACK_ABSENCES.length} запрета на удалённую зависимость`)
  console.log(`Согласованность: джобы CI/CD ↔ runs-on (${countWorkflowJobs(read(CI_WORKFLOW))}/${countWorkflowJobs(read(DEPLOY_WORKFLOW))}), лимит загрузки ↔ ${UPLOAD_ROUTE}, миграции ↔ ${MIGRATIONS_DIR} (${countMigrations(root) ?? 'нет'}), ${WORKFLOW_DOC} без архивных ссылок`)
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
  console.log('  7) версии стека и упоминания `zod` — привести к `package.json`: источник истины — зависимости, а не проза.')
  console.log('  8) числа в доках (джобы, лимиты, миграции) — править по реальному файлу-источнику, а не по другому доку.')
  process.exit(1)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()