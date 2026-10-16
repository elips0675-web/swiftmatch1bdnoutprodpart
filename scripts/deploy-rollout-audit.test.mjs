/**
 * Тесты гейта `scripts/deploy-rollout-audit.mjs` (остаток дипсика 13.10.2026).
 *
 * Фикстуры собираются в temp-каталоге: гейт читает `docker-compose.yml` и
 * `.github/workflows/deploy.yml` из переданного root, поэтому «сломать» рецепт
 * можно точечно — убрать `--wait`, снять снимок `:rollback` после сборки,
 * вынести пробу до `up`, потерять `if: failure()`. Каждая поломка обязана
 * дать свой FAIL: гейт, который ловит только отсутствие слова «rollback»,
 * пропускал бы откат, который физически не может сработать.
 *
 * Отдельный тест проверяет сам репозиторий (`process.cwd()`): гейт зелёный на
 * настоящем `deploy.yml` + `docker-compose.yml`, а не только на фикстуре.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { audit, getHealthProbe, getServiceImage } from './deploy-rollout-audit.mjs'

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-audit-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function composeFixture({
  appImage = 'swiftmatch-app',
  webImage = 'swiftmatch-web',
  healthUrl = 'http://localhost:3002/health',
  healthcheck = true,
} = {}) {
  const lines = ['services:', '  app:']
  if (appImage) lines.push(`    image: ${appImage}`)
  lines.push('    build:', '      context: .', '      target: server', '    ports:', '      - "3002:3002"')
  if (healthcheck) {
    lines.push(
      '    healthcheck:',
      `      test: ["CMD", "curl", "-f", "${healthUrl}"]`,
      '      interval: 30s',
      '      timeout: 5s',
      '      retries: 3',
      '      start_period: 15s',
    )
  }
  lines.push('    restart: unless-stopped', '  nginx:')
  if (webImage) lines.push(`    image: ${webImage}`)
  lines.push('    build:', '      context: .', '      target: web', '    ports:', '      - "8080:80"', '    restart: unless-stopped', '', 'volumes:', '  uploads_data:')
  return lines.join('\n') + '\n'
}

const PROBE_LINES = [
  '            for i in $(seq 1 30); do',
  '              if curl -fsS http://127.0.0.1:3002/health >/dev/null; then ok=1; break; fi',
  '              sleep 5',
  '            done',
]

function rolloutStep({
  upFlags = '--build --wait',
  capture = true,
  captureAfter = false,
  probe = true,
  probeFirst = false,
  exitOnFail = true,
  continueOnError = false,
} = {}) {
  const lines = ['      - name: Build & migrate & deploy via Docker', '        uses: appleboy/ssh-action@v1.1.0']
  if (continueOnError) lines.push('        continue-on-error: true')
  lines.push('        with:', '          host: h', '          script: |', '            set -e')
  const captureLines = capture
    ? ['            docker tag swiftmatch-app:latest swiftmatch-app:rollback', '            docker tag swiftmatch-web:latest swiftmatch-web:rollback']
    : []
  const upLine = `            docker compose up -d ${upFlags}`.trimEnd()
  const probeLines = probe ? [...PROBE_LINES] : []
  if (exitOnFail) probeLines.push('            if [ "${ok:-}" != "1" ]; then exit 1; fi')

  if (probeFirst) lines.push(...probeLines)
  if (captureAfter) lines.push(upLine, ...captureLines)
  else lines.push(...captureLines, upLine)
  if (!probeFirst) lines.push(...probeLines)
  lines.push('            docker compose ps')
  return lines.join('\n')
}

function rollbackStep({
  upFlags = '--no-build --wait',
  ifLine = 'failure()',
  probe = true,
  tags = true,
  exitOnFail = true,
} = {}) {
  const lines = ['      - name: Rollback on failed deploy']
  if (ifLine) lines.push(`        if: ${ifLine}`)
  lines.push('        uses: appleboy/ssh-action@v1.1.0', '        with:', '          host: h', '          script: |', '            set -e')
  if (tags) {
    lines.push('            docker tag swiftmatch-app:rollback swiftmatch-app:latest', '            docker tag swiftmatch-web:rollback swiftmatch-web:latest')
  }
  lines.push(`            docker compose up -d ${upFlags}`.trimEnd())
  if (probe) lines.push(...PROBE_LINES)
  if (exitOnFail) lines.push('            if [ "${ok:-}" != "1" ]; then exit 1; fi')
  return lines.join('\n')
}

function deployFixture({
  needs = '[lint-and-typecheck, frontend-test, server-test, e2e-test]',
  rollback = true,
  order = 'normal',
  rollout = {},
  rollbackStep: back = {},
} = {}) {
  const rolloutText = rolloutStep(rollout)
  const rollbackText = rollbackStep(back)
  const steps = order === 'reversed' ? [rollbackText, rolloutText] : [rolloutText]
  if (rollback && order !== 'reversed') steps.push(rollbackText)
  return [
    'name: Deploy to Production',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '',
    'jobs:',
    '  deploy:',
    '    name: Deploy',
    `    needs: ${needs}`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...steps,
    '',
  ].join('\n')
}

function run({ compose = {}, deploy = {} } = {}) {
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), composeFixture(compose))
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'deploy.yml'), deployFixture(deploy))
  return audit(dir)
}

function problemsOf(opts) {
  return run(opts).problems.join('\n')
}

describe('deploy-rollout-audit: корректный рецепт', () => {
  it('зелёный на связке compose + deploy с health-gate и откатом', () => {
    const { problems, facts } = run()
    expect(problems).toEqual([])
    expect(facts.appImage).toBe('swiftmatch-app')
    expect(facts.webImage).toBe('swiftmatch-web')
    expect(facts.healthProbe).toBe('http://127.0.0.1:3002/health')
  })

  it('читает пробу healthcheck как порт + путь, а не как строку целиком', () => {
    expect(getHealthProbe(composeFixture())).toEqual({ port: '3002', path: '/health' })
    expect(getHealthProbe(composeFixture({ healthUrl: 'http://localhost:4100/healthz' }))).toEqual({ port: '4100', path: '/healthz' })
    expect(getServiceImage(composeFixture(), 'nginx')).toBe('swiftmatch-web')
  })

  it('зелёный на настоящем репозитории', () => {
    expect(audit(process.cwd()).problems).toEqual([])
  })
})

describe('deploy-rollout-audit: выкладка без health-gate', () => {
  it('ловит `docker compose up` без --wait', () => {
    expect(problemsOf({ deploy: { rollout: { upFlags: '--build' } } })).toContain('без --wait')
  })

  it('ловит `docker compose up` без --build', () => {
    expect(problemsOf({ deploy: { rollout: { upFlags: '--wait' } } })).toContain('без --build')
  })

  it('ловит continue-on-error на шаге выкладки', () => {
    expect(problemsOf({ deploy: { rollout: { continueOnError: true } } })).toContain('continue-on-error')
  })

  it('ловит пробу не того порта, что healthcheck в compose', () => {
    const problems = problemsOf({ compose: { healthUrl: 'http://localhost:3001/health' } })
    expect(problems).toContain('нет пробы http://127.0.0.1:3001/health')
  })

  it('ловит пробу до `docker compose up`', () => {
    expect(problemsOf({ deploy: { rollout: { probeFirst: true } } })).toContain('идёт до')
  })

  it('ловит пробу, которая логируется, но не роняет шаг', () => {
    expect(problemsOf({ deploy: { rollout: { exitOnFail: false } } })).toContain('не роняет шаг')
  })

  it('ловит отсутствие пробы health', () => {
    expect(problemsOf({ deploy: { rollout: { probe: false } } })).toContain('нет пробы')
  })
})

describe('deploy-rollout-audit: снимок предыдущих образов', () => {
  it('ловит отсутствие снимка :rollback', () => {
    expect(problemsOf({ deploy: { rollout: { capture: false } } })).toContain('откатывать нечего')
  })

  it('ловит снимок :rollback, снятый после сборки', () => {
    expect(problemsOf({ deploy: { rollout: { captureAfter: true } } })).toContain('затрёт образ новой версии')
  })

  it('ловит отсутствие image: у app — откату не за что цепляться', () => {
    expect(problemsOf({ compose: { appImage: '' } })).toContain('у сервиса app нет image:')
  })

  it('ловит отсутствие image: у nginx — откат вернёт сервер со старым фронтом', () => {
    expect(problemsOf({ compose: { webImage: '' } })).toContain('у сервиса nginx нет image:')
  })

  it('ловит отсутствие healthcheck — `up --wait` нечего ждать', () => {
    expect(problemsOf({ compose: { healthcheck: false } })).toContain('нет healthcheck с curl-пробой')
  })
})

describe('deploy-rollout-audit: шаг отката', () => {
  it('ловит отсутствие шага отката', () => {
    expect(problemsOf({ deploy: { rollback: false } })).toContain('нет отдельного шага отката')
  })

  it('ловит шаг отката без `if: failure()`', () => {
    expect(problemsOf({ deploy: { rollbackStep: { ifLine: '' } } })).toContain('нет отдельного шага отката')
  })

  it('ловит откат без --no-build — он пересоберёт ту же новую версию', () => {
    expect(problemsOf({ deploy: { rollbackStep: { upFlags: '--build --wait' } } })).toContain('без --no-build')
  })

  it('ловит откат, который не восстанавливает образы из :rollback', () => {
    expect(problemsOf({ deploy: { rollbackStep: { tags: false } } })).toContain('не восстанавливает образы')
  })

  it('ловит откат без пробы health', () => {
    expect(problemsOf({ deploy: { rollbackStep: { probe: false } } })).toContain('откат не проверяет, поднялся ли он')
  })

  it('ловит откат без `exit 1` — сломанный откат выглядит успешным', () => {
    expect(problemsOf({ deploy: { rollbackStep: { exitOnFail: false } } })).toContain('нечем упасть')
  })

  it('ловит шаг отката, поставленный раньше выкладки', () => {
    expect(problemsOf({ deploy: { order: 'reversed' } })).toContain('раньше шага выкладки')
  })

  it('ловит deploy без зависимости от e2e-test', () => {
    expect(problemsOf({ deploy: { needs: '[lint-and-typecheck, server-test]' } })).toContain('не зависит от e2e-test')
  })
})
