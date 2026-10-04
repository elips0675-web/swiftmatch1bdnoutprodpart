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
 * Гейт проверяет пять вещей, каждую — на обоих концах (и «плохо», и «хорошо»):
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
 *  5. **Гейт реально запускается.** Скрипт `check:docs` есть в `package.json`,
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
 * Ссылки на файлы, которые обязаны существовать в репозитории. Зеркало `test/`
 * исключено намеренно: оно в `.gitignore` и в CI отсутствует, поэтому обычная
 * проверка существования дала бы в CI красный гейт на честном коде.
 */
export const MIRROR_FILES = [
  'test/README.md',
  'test/ИНВЕНТАРЬ-ТЕСТОВ.md',
  'test/СВОДКА.md',
  'test/АГЕНТ.md',
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
export const FORBIDDEN_EXEMPT_FILES = ['Что сделано.txt', 'Что доделать.txt']

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

/** Блок джобы по отступу: от `  <имя>:` до следующей строки с тем же или меньшим отступом. */
export function getJobBlock(yaml, jobName) {
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
  console.log(`Канон-указатель: ${PROMPTS_INDEX} (ссылок: ${promptsCheck.links.length}); идеи: ${ROADMAP_FILE} (${roadmapCheck.nonEmptyLines} непустых строк); архив: ${ARCHIVE_FILE}`)
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
  console.log(`  5) исключение для журналов задано в FORBIDDEN_EXEMPT_FILES (${FORBIDDEN_EXEMPT_FILES.join(', ')}) и проверяется тестом.`)
  process.exit(1)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()