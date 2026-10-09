/**
 * Гейт «E2E — обязательный, а не декоративный» (этап 30, B2).
 *
 * До этого этапа E2E жил только в `deploy.yml`, а этот workflow триггерится на
 * push в `main`/`develop` и PR в `main`. Следствие: на фиче-ветке E2E не
 * шёл вообще — джоба `e2e-test` была зелёной вакансией, а `deploy` зависел от
 * неё и потому не запускался, пока она красная. То есть «E2E перед продом»
 * существовало только на бумаге.
 *
 * Гейт проверяет две разные вещи, и их важно не путать:
 *
 *  1. **Обязательность.** В `ci.yml` (триггер на любой push и любой PR, без
 *     фильтра по веткам) должна быть джоба `e2e`, без `continue-on-error` и без
 *     условия на уровне джобы, а `deploy` в `deploy.yml` должен зависеть от
 *     E2E-джобы. Отсутствие джобы и `continue-on-error` — это не «минус
 *     проверки», это гейт, который тихо ничего не проверяет (питфолл 56).
 *
 *  2. **Исполнимость рецепта.** Зелёного цвета у E2E до этого не было ни разу,
 *     и на то были три молчаливые причины, каждая из которых выглядит как
 *     «тесты флакают»:
 *     - **нет сида демо-данных.** `database/mysql_schema.sql` не содержит ни
 *       одной строки `INSERT INTO users`, а `e2e/setup/global-setup.ts` логинится
 *       за `user2@mail.ru` и `admin@mail.ru`. На пустой схеме все четыре
 *       `storageState` не создаются, и 13 тестов падают не из-за своего бага;
 *     - **`sleep 5` вместо ожидания готовности** — на холодном runner'е сервис
 *       не успевает, падение выглядит как флак, и через пару итераций джобу
 *       начинают ретраить, а потом и отключать;
 *     - **`vite --port 8081` без `--strictPort`** — при занятом порту Vite не
 *       падает, а молча уходит на 8082, и E2E проверяет то, что висит на 8081
 *       (в локальном замере этого этапа так и вышло: фронт уехал на 8082).
 *     - **очистка E2E-хвостов только в `globalTeardown`** (N10) — если прогон
 *       убит таймаутом/SIGKILL или сам teardown упал, `e2e_*`-юзеры остаются в
 *       БД; поэтому джоба обязана иметь отдельный шаг
 *       `node scripts/e2e-cleanup.mjs` с `if: always()`.
 *
 *     Рецепт в двух workflow дублируется, поэтому гейт сверяет их между собой:
 *     одинаковый шаг сида, одинаковая команда запуска Playwright. Расхождение
 *     означает, что «зелёный» деплой проверяет не то, что «красный» фиче-ветки.
 */

import fs from 'node:fs'
import path from 'node:path'

const CI_WORKFLOW = '.github/workflows/ci.yml'
const DEPLOY_WORKFLOW = '.github/workflows/deploy.yml'

const API_HEALTH_URL = 'http://127.0.0.1:3002/health'
const FRONTEND_URL = 'http://127.0.0.1:8081'

const RUNS_PLAYWRIGHT = /(playwright test|npm run test:e2e)/

function readRepoFile(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

/** Блок джобы по отступу: от `  <имя>:` до следующей строки с тем же или меньшим отступом. */
export function getJobSection(yaml, jobName) {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp(`^ {2}${jobName}:\\s*$`).test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^ {0,2}\S/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Блок `on:` — либо инлайн-список (`on: [push, pull_request]`), либо многострочный. */
export function getOnSection(yaml) {
  const inline = yaml.match(/^on:\s*\[(.*?)\]\s*$/m)
  if (inline) return inline[0]
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => /^on:\s*$/.test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^\S/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

function hasEvent(onSection, event) {
  if (/^on:\s*\[/.test(onSection.trim())) {
    return onSection.includes(event)
  }
  return new RegExp(`^ {2}${event}:`, 'm').test(onSection)
}

function branchFilters(onSection) {
  return onSection.split(/\r?\n/).filter((l) => /^\s+branches(-ignore)?:/.test(l)).map((l) => l.trim())
}

/** Строки `- name:` / `- run:` / `- uses:` джобы в порядке следования. */
export function getStepLines(jobSection) {
  return jobSection.split(/\r?\n/).filter((l) => /^ {6}- /.test(l))
}

/**
 * Шаги джобы вместе с телом каждого шага (строки до следующего `- ` того же или
 * меньшего отступа). Нужен там, где важно, чтобы флаг стоял в том же шаге, а не
 * где-то рядом: `if: always()` есть и у `upload-artifact`, поэтому поиск по
 * всему тексту джобы не доказывает, что очистка тоже безусловная.
 */
export function getSteps(jobSection) {
  const steps = []
  let current = null
  let indent = -1
  for (const raw of jobSection.split(/\r?\n/)) {
    if (raw.trim().startsWith('#')) continue
    const marker = raw.match(/^(\s*)- /)
    if (marker && (current === null || marker[1].length <= indent)) {
      current = []
      indent = marker[1].length
      steps.push(current)
      current.push(raw)
      continue
    }
    if (current !== null) current.push(raw)
  }
  return steps.map((lines) => lines.join('\n'))
}

/**
 * Код джобы без комментариев.
 *
 * Проверки ниже ищут файлы и флаги (`database/mysql_schema.sql`,
 * `--strictPort`, `upload-artifact`...) по тексту шагов. Если брать сырой
 * текст джобы, достаточно упомянуть нужное имя в комментарии — и гейт
 * считает шаг выполненным, хотя шага нет. Это ровно тот класс ловушек, что
 * гейт и должен ловить, поэтому комментарии вырезаются на входе.
 */
export function jobCode(jobSection) {
  return jobSection
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
}

/**
 * Команда запуска Playwright в джобе. Принимаются оба вызова, которыми
 * запускают тесты: `npx playwright test ...` и npm-скрипт `npm run test:e2e`
 * (второй preferred: версия Playwright и набор спек берутся из package.json,
 * а не из строки в workflow). Сравнение двух workflow идёт по нормализованной
 * команде, поэтому важно, чтобы обе джобы звали одно и то же.
 */
export function getPlaywrightCommand(jobSection) {
  const lines = jobSection.split(/\r?\n/).filter((l) => !l.trim().startsWith('#'))
  for (let i = 0; i < lines.length; i += 1) {
    const inline = lines[i].match(/^\s*(?:- )?run:\s*(\S.*)$/)
    if (inline && RUNS_PLAYWRIGHT.test(inline[1])) return inline[1].trim()
    if (!/^\s*(?:- )?run:\s*[|>]\s*$/.test(lines[i])) continue
    const block = []
    const indent = lines[i].match(/^\s*/)[0].length
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j]
      if (!line.trim()) continue
      if (line.match(/^\s*/)[0].length <= indent) break
      block.push(line.trim())
    }
    const joined = block.join(' ')
    if (RUNS_PLAYWRIGHT.test(joined)) return joined
  }
  return ''
}

function normalizePlaywrightCommand(command) {
  return command.replace(/\s+/g, ' ').trim()
}

function indexOfStep(jobSection, re) {
  return jobSection.split(/\r?\n/).findIndex((l) => re.test(l))
}

/** Рецепт одной E2E-джобы: что в ней есть и чего не хватает. */
export function auditE2eJob(jobSection, label) {
  const problems = []
  const text = jobCode(jobSection)

  if (!/^\s{4}services:\s*$/m.test(text) || !/^\s{6}mysql:\s*$/m.test(text)) {
    problems.push(`${label}: нет MySQL-service — E2E нужен живой БД, global-setup падает на \`/health\` с db != connected`)
  }
  if (!/mysql_schema\.sql/.test(text)) {
    problems.push(`${label}: схема не создаётся (нет шага с database/mysql_schema.sql)`)
  }
  if (!/seed-migrations\.mjs/.test(text)) {
    problems.push(`${label}: не засеяна таблица применённых миграций (scripts/seed-migrations.mjs)`)
  }
  if (!/database\/migrations\/migrate\.js/.test(text)) {
    problems.push(`${label}: миграции не применяются (database/migrations/migrate.js)`)
  }
  if (!/server\/src\/seed\.js/.test(text)) {
    problems.push(
      `${label}: нет сида демо-данных (server/src/seed.js) — в mysql_schema.sql нет ни одного INSERT INTO users, поэтому global-setup не сможет залогиниться за user2@mail.ru/admin@mail.ru и 13 тестов упадут на пустых storageState`,
    )
  }
  if (!/wait-for-url\.mjs/.test(text)) {
    problems.push(`${label}: готовность сервисов не проверяется (нет scripts/wait-for-url.mjs) — \`sleep 5\` на холодном runner'е даёт падение, не связанное с тестом`)
  }
  if (!/wait-for-url\.mjs[^\n]*3002\/health/.test(text)) {
    problems.push(`${label}: не ждём готовности API (wait-for-url.mjs ... ${API_HEALTH_URL})`)
  }
  if (!new RegExp(`wait-for-url\\.mjs[^\\n]*${FRONTEND_URL.replace(/[.]/g, '\\.')}`).test(text)) {
    problems.push(`${label}: не ждём готовности фронта (wait-for-url.mjs ... ${FRONTEND_URL})`)
  }
  if (!/vite preview/.test(text)) {
    problems.push(`${label}: фронт поднимается не в production-режиме (нет \`vite preview\`; dev-сервер компилирует модули на лету и замедляет каждый тест)`)
  }
  if (!/--strictPort/.test(text)) {
    problems.push(`${label}: нет --strictPort — при занятом порту Vite молча уходит на соседний, и E2E проверяет чужое приложение`)
  }
  if (/sleep \d+/.test(text)) {
    problems.push(`${label}: остался \`sleep N\` вместо проверки готовности — это гонка по времени, а не ожидание`)
  }
  if (!getPlaywrightCommand(jobSection)) {
    problems.push(`${label}: джоба не запускает Playwright (нет шага \`npm run test:e2e\` или \`npx playwright test\`)`)
  }
  if (/continue-on-error:\s*true/.test(text)) {
    problems.push(`${label}: continue-on-error: true — джоба зелёная при провале E2E, то есть не гейт`)
  }
  if (/^ {4}if:/m.test(text)) {
    problems.push(`${label}: у джобы есть условие (if:) — на части событий E2E не запустится вовсе`)
  }
  if (!/upload-artifact/.test(text) || !/if: always\(\)/.test(text)) {
    problems.push(`${label}: отчёт Playwright не выкладывается при падении (нужен upload-artifact с if: always())`)
  }
  const cleanupStep = getSteps(text).find((step) => /e2e-cleanup\.mjs/.test(step))
  if (!cleanupStep || !/if:\s*always\(\)/.test(cleanupStep)) {
    problems.push(
      `${label}: нет независимого шага очистки E2E-данных (\`node scripts/e2e-cleanup.mjs\` с \`if: always()\`) — если прогон или сам teardown упадёт, юзеры e2e_* останутся в БД (N10)`,
    )
  }
  return problems
}

export function audit(root) {
  const ci = readRepoFile(root, CI_WORKFLOW)
  const deploy = readRepoFile(root, DEPLOY_WORKFLOW)

  const problems = []
  const facts = {}

  const onSection = getOnSection(ci)
  facts.ciTriggers = onSection.trim()
  if (!onSection) {
    problems.push(`${CI_WORKFLOW}: не найден блок on: — нечем понять, когда запускаются гейты`)
  } else {
    if (!hasEvent(onSection, 'push')) problems.push(`${CI_WORKFLOW}: триггер не содержит push`)
    if (!hasEvent(onSection, 'pull_request')) problems.push(`${CI_WORKFLOW}: триггер не содержит pull_request`)
    const filters = branchFilters(onSection)
    if (filters.length) {
      problems.push(
        `${CI_WORKFLOW}: триггер ограничен ветками (${filters.join(', ')}) — на фиче-ветке гейты, включая E2E, не запустятся`,
      )
    }
  }

  const ciE2e = getJobSection(ci, 'e2e')
  facts.ciE2eJob = ciE2e ? 'есть' : 'нет'
  if (!ciE2e) {
    problems.push(`${CI_WORKFLOW}: нет джобы e2e — E2E не обязательный гейт, он живёт только в deploy.yml и не идёт на фиче-ветке`)
  } else {
    problems.push(...auditE2eJob(ciE2e, `${CI_WORKFLOW}: джоба e2e`))
  }

  const deployE2e = getJobSection(deploy, 'e2e-test')
  facts.deployE2eJob = deployE2e ? 'есть' : 'нет'
  if (!deployE2e) {
    problems.push(`${DEPLOY_WORKFLOW}: нет джобы e2e-test — пред-деплойный E2E больше не блокирует прод`)
  } else {
    problems.push(...auditE2eJob(deployE2e, `${DEPLOY_WORKFLOW}: джоба e2e-test`))
    const deployJob = getJobSection(deploy, 'deploy')
    const needsLine = deployJob.split(/\r?\n/).find((l) => /^\s+needs:/.test(l)) || ''
    facts.deployNeeds = needsLine.trim()
    if (!/\be2e-test\b/.test(needsLine)) {
      problems.push(`${DEPLOY_WORKFLOW}: джоба deploy не зависит от e2e-test — E2E не блокирует выкладку`)
    }
  }

  if (ciE2e && deployE2e) {
    const ciCmd = normalizePlaywrightCommand(getPlaywrightCommand(ciE2e))
    const deployCmd = normalizePlaywrightCommand(getPlaywrightCommand(deployE2e))
    facts.playwrightCommand = ciCmd
    if (ciCmd && deployCmd && ciCmd !== deployCmd) {
      problems.push(
        `${DEPLOY_WORKFLOW}: команда Playwright отличается от ci.yml (\`${deployCmd}\` против \`${ciCmd}\`) — зелёный деплой проверяет не то, что фиче-ветка`,
      )
    }
  }

  const seedStepCi = indexOfStep(jobCode(ciE2e), /server\/src\/seed\.js/)
  const testStepCi = indexOfStep(jobCode(ciE2e), RUNS_PLAYWRIGHT)
  if (ciE2e && seedStepCi !== -1 && testStepCi !== -1 && seedStepCi > testStepCi) {
    problems.push(`${CI_WORKFLOW}: джоба e2e — сид демо-данных идёт после запуска тестов`)
  }

  return { facts, problems }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`триггер CI: ${facts.ciTriggers || 'не найден'}`)
  console.log(`E2E-джоба в ci.yml: ${facts.ciE2eJob}`)
  console.log(`E2E-джоба в deploy.yml: ${facts.deployE2eJob}`)
  console.log(`deploy needs: ${facts.deployNeeds || 'нет'}`)
  console.log(`команда Playwright: ${facts.playwrightCommand || 'не найдена'}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: E2E не является обязательным гейтом либо его рецепт не может стать зелёным.')
    process.exit(1)
  }
  console.log('\nИтог: E2E обязателен на любом push/PR, рецепт в обоих workflow одинаков и способен стать зелёным.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
