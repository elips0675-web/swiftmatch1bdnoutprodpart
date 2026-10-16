/**
 * Гейт «деплой не оставляет прод на сломанной версии» (остаток
 * тест-ориентированного свода, дипсик 13.10.2026).
 *
 * Было: `docker compose up -d --build` пересоздавал контейнеры, а шаги после
 * него (миграции, schema-validate, schema-drift) могли упасть — и прод
 * оставался на новой, никем не проверенной версии до ручного вмешательства.
 * Никакого «здоров ли сервис» в пайплайне не было: «контейнер запущен» !=
 * «API отвечает».
 *
 * Гейт проверяет не «есть ли строка про rollback», а **связку трёх файлов**:
 *
 *  1. `docker-compose.yml` — у сервиса `app` объявлены `image:` (иначе имя
 *     образа зависит от имени проекта compose, и откат не знает, за какой тег
 *     цепляться) и `healthcheck` с curl-пробой; у `nginx` тоже `image:`, иначе
 *     откат вернёт сервер, а статику и конфиг nginx оставит новыми.
 *  2. Проба в деплое обязана бить **по тому же порту и пути**, что healthcheck
 *     в compose (`app` healthcheck -> `curl -fsS http://127.0.0.1:<порт><путь>`
 *     в `deploy.yml`). Разъехались — гейт красный: проба проверяет не тот путь,
 *     по которому compose считает сервис здоровым.
 *  3. Порядок и обязательность: снимок предыдущего образа (`:<image>:rollback`)
 *     идёт **до** `up`, `up` собирает и ждёт health (`--wait`) либо падает на
 *     явной пробе, а откат — **отдельный** шаг с `if: failure()`, который
 *     поднимает `:rollback`овский образ (`--no-build`, иначе он пересоберёт ту
 *     же новую версию) и снова проверяет health.
 *
 * Само поведение на VPS гейт не доказывает (нет Docker/SSH локально) — он
 * держит структуру, без которой откат невозможен физически: без тега
 * `:rollback` откатывать нечего, без `--wait` деплой не знает, что сервис
 * поднялся, без отдельного шага `if: failure()` откат не запустится.
 */

import fs from 'node:fs'
import path from 'node:path'

import { getJobSection, getSteps, jobCode } from './e2e-gate-audit.mjs'

const COMPOSE = 'docker-compose.yml'
const DEPLOY_WORKFLOW = '.github/workflows/deploy.yml'

const APP_SERVICE = 'app'
const WEB_SERVICE = 'nginx'

const PROBE_HOST = '127.0.0.1'

function readRepoFile(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

/** Секция сервиса верхнего уровня (отступ 2) из docker-compose.yml. */
export function getServiceSection(compose, name) {
  const lines = compose.split(/\r?\n/)
  const start = lines.findIndex((l) => new RegExp(`^ {2}${name}:\\s*$`).test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^ {2}\S/.test(l) || /^\S/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Имя образа сервиса (`image:`) — стабильный тег для отката. */
export function getServiceImage(compose, name) {
  const m = getServiceSection(compose, name).match(/^\s+image:\s*(\S+)\s*$/m)
  return m ? m[1] : ''
}

/**
 * Проба healthcheck сервиса app из compose: `test: ["CMD", "curl", "-f",
 * "http://localhost:3002/health"]` -> `{ port: '3002', path: '/health' }`.
 * Порт и путь (а не строку целиком) — чтобы сверять пробу с `deploy.yml`
 * независимо от хоста: в compose это `localhost`, из пайплайна — `127.0.0.1`.
 */
export function getHealthProbe(compose) {
  const m = getServiceSection(compose, APP_SERVICE)
    .match(/test:\s*\[[^\]]*"curl"[^\]]*"(https?:\/\/[^"/]+)(\/[^"]*)?"[^\]]*\]/)
  if (!m) return null
  const port = (m[1].match(/:(\d+)$/) || [])[1] || ''
  if (!port) return null
  return { port, path: m[2] || '/' }
}

/** Проба так, как её должен звать пайплайн: хоть compose пишет localhost. */
export function expectedProbeUrl(probe) {
  return `http://${PROBE_HOST}:${probe.port}${probe.path}`
}

/** Строка `docker compose up ...` шага (первая) вместе с флагами. */
function upLineOf(stepText) {
  return (stepText.match(/docker compose up[^\n]*/) || [''])[0].trim()
}

function failOnCompose(compose, problems) {
  const appSection = getServiceSection(compose, APP_SERVICE)
  const webSection = getServiceSection(compose, WEB_SERVICE)
  if (!appSection) {
    problems.push(`${COMPOSE}: нет сервиса ${APP_SERVICE}`)
    return
  }
  if (!webSection) {
    problems.push(`${COMPOSE}: нет сервиса ${WEB_SERVICE}`)
  }
  if (!/^\s+image:/m.test(appSection)) {
    problems.push(`${COMPOSE}: у сервиса ${APP_SERVICE} нет image: — имя образа зависит от имени проекта compose, и откат не знает, за какой тег цепляться`)
  }
  if (appSection && webSection && !/^\s+image:/m.test(webSection)) {
    problems.push(`${COMPOSE}: у сервиса ${WEB_SERVICE} нет image: — откат вернёт сервер, а статику и конфиг nginx оставит новыми`)
  }
  if (!getHealthProbe(compose)) {
    problems.push(`${COMPOSE}: у сервиса ${APP_SERVICE} нет healthcheck с curl-пробой — \`docker compose up --wait\` нечего ждать, «запущен» подменит «здоров»`)
  }
}

function auditRolloutStep(stepText, probe, appImage, webImage, problems) {
  const label = `${DEPLOY_WORKFLOW}: шаг выкладки`
  const up = upLineOf(stepText)

  if (!/--build/.test(up)) {
    problems.push(`${label}: \`docker compose up\` без --build — деплой не соберёт новые образы`)
  }
  if (!/--wait/.test(up)) {
    problems.push(`${label}: \`docker compose up\` без --wait — деплой не ждёт healthcheck, «контейнер запущен» != «API отвечает»`)
  }
  if (/continue-on-error/.test(stepText)) {
    problems.push(`${label}: continue-on-error — упавшая выкладка не роняет джобу и откат не сработает`)
  }

  const upIndex = stepText.indexOf(up)
  const appTagIndex = stepText.indexOf(`${appImage}:rollback`)
  const webTagIndex = stepText.indexOf(`${webImage}:rollback`)
  if (appTagIndex === -1 || webTagIndex === -1) {
    problems.push(`${label}: нет снимка предыдущих образов (${appImage}:rollback / ${webImage}:rollback) — откатывать нечего`)
  } else if (appTagIndex > upIndex || webTagIndex > upIndex) {
    problems.push(`${label}: снимок :rollback делается после \`docker compose up\` — он затрёт образ новой версии, откат вернёт её же`)
  }

  if (probe) {
    const expected = expectedProbeUrl(probe)
    const probeIndex = stepText.indexOf(expected)
    if (probeIndex === -1) {
      problems.push(`${label}: нет пробы ${expected} — она обязана совпадать с healthcheck сервиса ${APP_SERVICE} в ${COMPOSE}`)
    } else {
      if (probeIndex < upIndex) {
        problems.push(`${label}: проба ${expected} идёт до \`docker compose up\` — она проверяет ещё работающий старый контейнер`)
      }
      if (!/exit 1/.test(stepText.slice(probeIndex))) {
        problems.push(`${label}: проба ${expected} логируется, но не роняет шаг (нет \`exit 1\`) — молчаливый «не поднялся»`)
      }
    }
  }
}

function auditRollbackStep(stepText, probe, appImage, webImage, problems) {
  const label = `${DEPLOY_WORKFLOW}: шаг отката`
  const up = upLineOf(stepText)

  if (!/--no-build/.test(up)) {
    problems.push(`${label}: \`docker compose up\` без --no-build — откат пересоберёт рабочую копию, то есть ту же новую версию`)
  }
  if (!stepText.includes(`${appImage}:rollback`) || !stepText.includes(`${webImage}:rollback`)) {
    problems.push(`${label}: не восстанавливает образы из :rollback (${appImage} / ${webImage})`)
  }
  if (probe) {
    const expected = expectedProbeUrl(probe)
    if (!stepText.includes(expected)) {
      problems.push(`${label}: нет пробы ${expected} — откат не проверяет, поднялся ли он`)
    }
  }
  if (!/exit 1/.test(stepText)) {
    problems.push(`${label}: нечем упасть при неудачном откате (нет \`exit 1\`) — сломанный откат выглядит как успешный`)
  }
}

export function audit(root) {
  const compose = readRepoFile(root, COMPOSE)
  const deploy = readRepoFile(root, DEPLOY_WORKFLOW)

  const problems = []
  const facts = {}

  failOnCompose(compose, problems)

  const probe = getHealthProbe(compose)
  const appImage = getServiceImage(compose, APP_SERVICE)
  const webImage = getServiceImage(compose, WEB_SERVICE)
  facts.appImage = appImage || 'нет'
  facts.webImage = webImage || 'нет'
  facts.healthProbe = probe ? expectedProbeUrl(probe) : 'не найдена'

  const deployJob = getJobSection(deploy, 'deploy')
  if (!deployJob) {
    problems.push(`${DEPLOY_WORKFLOW}: нет джобы deploy — нечего проверять`)
    return { facts, problems }
  }

  const needs = deployJob.split(/\r?\n/).find((l) => /^\s+needs:/.test(l)) || ''
  facts.deployNeeds = needs.trim()
  if (!/\be2e-test\b/.test(needs)) {
    problems.push(`${DEPLOY_WORKFLOW}: deploy не зависит от e2e-test — выкладывается код, не прошедший E2E`)
  }

  const steps = getSteps(jobCode(deployJob))
  const isRollback = (s) => /docker compose up\b/.test(s) && /if:\s*failure\(\)/.test(s)
  const isRollout = (s) => /docker compose up\b/.test(s) && !/if:\s*failure\(\)/.test(s)
  const rolloutIndex = steps.findIndex(isRollout)
  const rollbackIndex = steps.findIndex(isRollback)
  facts.steps = steps.length

  if (rolloutIndex === -1) {
    problems.push(`${DEPLOY_WORKFLOW}: в джобе deploy нет шага с \`docker compose up\``)
  } else {
    auditRolloutStep(steps[rolloutIndex], probe, appImage, webImage, problems)
  }

  if (rollbackIndex === -1) {
    problems.push(`${DEPLOY_WORKFLOW}: нет отдельного шага отката (\`if: failure()\` + \`docker compose up\`) — упавшая выкладка оставляет прод на новой версии`)
  } else {
    if (rolloutIndex !== -1 && rollbackIndex < rolloutIndex) {
      problems.push(`${DEPLOY_WORKFLOW}: шаг отката идёт раньше шага выкладки`)
    }
    auditRollbackStep(steps[rollbackIndex], probe, appImage, webImage, problems)
  }

  return { facts, problems }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`образы compose: app=${facts.appImage}, nginx=${facts.webImage}`)
  console.log(`healthcheck-проба: ${facts.healthProbe}`)
  console.log(`deploy needs: ${facts.deployNeeds || 'нет'}`)
  console.log(`шагов в джобе deploy: ${facts.steps}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: деплой не доказывает, что версия поднялась, или не умеет откатиться.')
    process.exit(1)
  }
  console.log('\nИтог: выкладка ждёт health по пробе из compose, снимает :rollback до сборки, а при падении откатывается отдельным шагом.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
