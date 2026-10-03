/**
 * Тесты гейта `scripts/e2e-gate-audit.mjs` (этап 30, B2).
 *
 * Фикстуры собираются целиком в temp-каталоге: гейт читает workflow из
 * переданного root, поэтому «до» и «после» — это два разных каталога с
 * записанными `.github/workflows/{ci,deploy}.yml`. Так проверяется и то, что
 * гейт ловит, и то, что он НЕ ругается на корректный рецепт.
 *
 * Отдельно проверяется `scripts/wait-for-url.mjs`: без него в workflow
 * возвращается `sleep N`, и падение E2E становится гонкой, которую начинают
 * ретраить, а потом отключают.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  audit,
  auditE2eJob,
  getJobSection,
  getOnSection,
  getPlaywrightCommand,
  getStepLines,
  jobCode,
} from './e2e-gate-audit.mjs'
import { isReady, parseArgs, waitForUrl } from './wait-for-url.mjs'

const GOOD_E2E_STEPS = [
  '      - run: mysql -h127.0.0.1 -uroot -pswiftmatch_test swiftmatch_test < database/mysql_schema.sql',
  '      - run: node scripts/seed-migrations.mjs',
  '      - run: node database/migrations/migrate.js',
  '      - run: node server/src/seed.js',
  '      - run: npx vite build',
  '      - run: npx vite preview --port 8081 --strictPort &',
  '      - run: node scripts/wait-for-url.mjs http://127.0.0.1:3002/health --status 200 --timeout 120000',
  '      - run: node scripts/wait-for-url.mjs http://127.0.0.1:8081 --timeout 120000',
  '      - run: npm run test:e2e',
  '      - name: Playwright report',
  '        if: always()',
  '        uses: actions/upload-artifact@v4',
  '        with:',
  '          name: playwright-report',
  '          path: |',
  '            playwright-report/',
  '            test-results/',
].join('\n')

function ciYaml(e2eBody) {
  return [
    'name: CI',
    '',
    'on: [push, pull_request]',
    '',
    'jobs:',
    '  lint:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npm run lint',
    ...(e2eBody === null ? [] : ['  e2e:', '    runs-on: ubuntu-latest', '    services:', '      mysql:', '        image: mysql:8.0', '    steps:', e2eBody]),
    '',
  ].join('\n')
}

const CI_GOOD = ciYaml(GOOD_E2E_STEPS)

const DEPLOY_GOOD = [
  'name: CI/CD',
  '',
  'on:',
  '  push:',
  '    branches: [main, develop]',
  '',
  'jobs:',
  '  e2e-test:',
  '    needs: [lint-and-typecheck]',
  '    runs-on: ubuntu-latest',
  '    services:',
  '      mysql:',
  '        image: mysql:8.0',
  '    steps:',
  GOOD_E2E_STEPS.split('\n').map((l) => (l.startsWith('      - ') ? `  ${l}` : l)).join('\n'),
  '  deploy:',
  '    needs: [lint-and-typecheck, e2e-test]',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: ./deploy.sh',
  '',
].join('\n')

const CI_BEFORE_STAGE_30 = [
  'name: CI',
  '',
  'on: [push, pull_request]',
  '',
  'jobs:',
  '  lint:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: npm run lint',
  '  test:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: npm test',
  '',
].join('\n')

const DEPLOY_BEFORE_STAGE_30 = [
  'name: CI/CD',
  '',
  'on:',
  '  push:',
  '    branches: [main, develop]',
  '',
  'jobs:',
  '  e2e-test:',
  '    needs: [lint-and-typecheck]',
  '    runs-on: ubuntu-latest',
  '    services:',
  '      mysql:',
  '        image: mysql:8.0',
  '    steps:',
  '      - run: npm ci',
  '      - run: mysql -h127.0.0.1 -uroot -pswiftmatch_test swiftmatch_test < database/mysql_schema.sql',
  '      - run: node scripts/seed-migrations.mjs',
  '      - run: node database/migrations/migrate.js',
  '      - run: npx playwright install chromium --with-deps',
  '      - run: |',
  '          PORT=3002 DB_HOST=127.0.0.1 node server/src/index.js &',
  '          sleep 5',
  '      - run: |',
  '          npx vite --port 8081 --host &',
  '          sleep 5',
  '      - run: npx playwright test --reporter=html',
  '  deploy:',
  '    needs: [lint-and-typecheck, e2e-test]',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: ./deploy.sh',
  '',
].join('\n')

let tmpRoot

function writeRepo(ci, deploy) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'repo-'))
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), ci, 'utf8')
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'deploy.yml'), deploy, 'utf8')
  return dir
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-gate-'))
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('audit: корректный рецепт', () => {
  it('принимает конфигурацию этапа 30 без замечаний', () => {
    const { problems, facts } = audit(writeRepo(CI_GOOD, DEPLOY_GOOD))
    expect(problems).toEqual([])
    expect(facts.ciE2eJob).toBe('есть')
    expect(facts.deployE2eJob).toBe('есть')
    expect(facts.playwrightCommand).toBe('npm run test:e2e')
  })
})

describe('audit: обязательность гейта', () => {
  it('ловит конфигурацию до этапа 30 — E2E жил только в deploy.yml', () => {
    const { problems, facts } = audit(writeRepo(CI_BEFORE_STAGE_30, DEPLOY_BEFORE_STAGE_30))
    expect(facts.ciE2eJob).toBe('нет')
    expect(problems.join('\n')).toContain('нет джобы e2e')
  })

  it('ловит continue-on-error у E2E-джобы', () => {
    const yaml = ciYaml(['    continue-on-error: true', ...GOOD_E2E_STEPS.split('\n')].join('\n'))
    const { problems } = audit(writeRepo(yaml, DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('continue-on-error')
  })

  it('ловит условие if: на уровне джобы — на части событий E2E не пойдёт', () => {
    const yaml = ciYaml(["    if: github.event_name == 'push'", ...GOOD_E2E_STEPS.split('\n')].join('\n'))
    const { problems } = audit(writeRepo(yaml, DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('условие (if:)')
  })

  it('ловит триггер, ограниченный ветками', () => {
    const yaml = CI_GOOD.replace('on: [push, pull_request]', 'on:\n  push:\n    branches: [main]\n  pull_request:')
    const { problems } = audit(writeRepo(yaml, DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('ограничен ветками')
  })

  it('ловит deploy, не зависящий от E2E', () => {
    const deploy = DEPLOY_GOOD.replace('needs: [lint-and-typecheck, e2e-test]', 'needs: [lint-and-typecheck]')
    const { problems } = audit(writeRepo(CI_GOOD, deploy))
    expect(problems.join('\n')).toContain('не зависит от e2e-test')
  })
})

describe('audit: исполнимость рецепта', () => {
  it('ловит отсутствие сида демо-данных — 13 тестов падают на пустых storageState', () => {
    const steps = GOOD_E2E_STEPS.split('\n').filter((l) => !l.includes('server/src/seed.js')).join('\n')
    const { problems } = audit(writeRepo(ciYaml(steps), DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('нет сида демо-данных')
  })

  it('ловит sleep вместо проверки готовности', () => {
    const steps = GOOD_E2E_STEPS.split('\n')
      .filter((l) => !l.includes('wait-for-url'))
      .concat(['      - run: |', '          node server/src/index.js &', '          sleep 5'])
      .join('\n')
    const { problems } = audit(writeRepo(ciYaml(steps), DEPLOY_GOOD))
    const text = problems.join('\n')
    expect(text).toContain('готовность сервисов не проверяется')
    expect(text).toContain('sleep N')
  })

  it('ловит vite без --strictPort — фронт молча уедет на соседний порт', () => {
    const steps = GOOD_E2E_STEPS.split('\n').filter((l) => !l.includes('strictPort')).join('\n')
    const { problems } = audit(writeRepo(ciYaml(steps), DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('--strictPort')
  })

  it('ловит dev-сервер вместо production-режима', () => {
    const steps = GOOD_E2E_STEPS.split('\n')
      .filter((l) => !l.includes('vite build') && !l.includes('vite preview'))
      .concat(['      - run: npx vite --port 8081 --host &'])
      .join('\n')
    const { problems } = audit(writeRepo(ciYaml(steps), DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('vite preview')
  })

  it('ловит джобу, которая не запускает тесты', () => {
    const steps = GOOD_E2E_STEPS.split('\n').filter((l) => !l.includes('test:e2e')).join('\n')
    const { problems } = audit(writeRepo(ciYaml(steps), DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('не запускает Playwright')
  })

  it('ловит отсутствие отчёта при падении', () => {
    const steps = GOOD_E2E_STEPS.split('\n')
      .filter((l) => !l.includes('upload-artifact') && !l.includes('if: always()'))
      .join('\n')
    const { problems } = audit(writeRepo(ciYaml(steps), DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('upload-artifact')
  })

  it('ловит расхождение команд Playwright между workflow', () => {
    const ci = ciYaml(GOOD_E2E_STEPS.replace('npm run test:e2e', 'npx playwright test --reporter=line'))
    const { problems } = audit(writeRepo(ci, DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('команда Playwright отличается')
  })

  it('ловит сид демо-данных после запуска тестов', () => {
    const lines = GOOD_E2E_STEPS.split('\n')
    const seedIdx = lines.findIndex((l) => l.includes('server/src/seed.js'))
    const [seed] = lines.splice(seedIdx, 1)
    lines.push(seed)
    const { problems } = audit(writeRepo(ciYaml(lines.join('\n')), DEPLOY_GOOD))
    expect(problems.join('\n')).toContain('идёт после запуска тестов')
  })
})

describe('auditE2eJob: без MySQL', () => {
  it('требует живой БД', () => {
    const job = ['    runs-on: ubuntu-latest', '    steps:', '      - run: npm run test:e2e'].join('\n')
    expect(auditE2eJob(job, 'test').join('\n')).toContain('MySQL-service')
  })

  it('требует MySQL именно как service, а не как строку в комментарии', () => {
    const job = ['    runs-on: ubuntu-latest', '    steps:', '      - run: echo mysql:', '      - run: npm run test:e2e'].join('\n')
    expect(auditE2eJob(job, 'test').join('\n')).toContain('MySQL-service')
  })
})

describe('парсеры workflow', () => {
  it('getJobSection вырезает ровно свою джобу и не залезает в соседнюю', () => {
    const section = getJobSection(DEPLOY_GOOD, 'e2e-test')
    expect(section).toContain('npm run test:e2e')
    expect(section).not.toContain('deploy.sh')
  })

  it('getJobSection возвращает пустую строку для несуществующей джобы', () => {
    expect(getJobSection(DEPLOY_GOOD, 'nope')).toBe('')
  })

  it('getOnSection читает и инлайн-список, и блочную форму', () => {
    expect(getOnSection('on: [push, pull_request]\n')).toContain('pull_request')
    expect(getOnSection('on:\n  push:\n  pull_request:\njobs:\n')).toContain('pull_request')
  })

  it('getPlaywrightCommand понимает многострочный run: |', () => {
    const job = ['    steps:', '      - run: |', '          cd server', '          npm run test:e2e'].join('\n')
    expect(getPlaywrightCommand(job)).toBe('cd server npm run test:e2e')
  })

  it('getPlaywrightCommand не берёт соседний шаг с не-indented строкой', () => {
    const job = ['    steps:', '      - run: |', '          npm run test:e2e', '      - run: echo done'].join('\n')
    expect(getPlaywrightCommand(job)).toBe('npm run test:e2e')
  })

  it('getStepLines отдаёт только элементы списка шагов', () => {
    const job = ['    steps:', '      - run: a', '        with:', '          x: 1', '      - run: b'].join('\n')
    expect(getStepLines(job)).toEqual(['      - run: a', '      - run: b'])
  })

  it('jobCode выкидывает комментарии — иначе шаг можно «нарисовать» в комментарии', () => {
    const job = ['    steps:', '      # - run: node server/src/seed.js', '      - run: npm run test:e2e'].join('\n')
    expect(jobCode(job)).not.toContain('seed.js')
    expect(jobCode(job)).toContain('test:e2e')
  })
})

describe('auditE2eJob: комментарии не считаются шагами', () => {
  it('не принимает схему, упомянутую только в комментарии', () => {
    const job = [
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      # раньше здесь был шаг с database/mysql_schema.sql',
      '      - run: npm run test:e2e',
    ].join('\n')
    expect(auditE2eJob(job, 'test').join('\n')).toContain('схема не создаётся')
  })

  it('не принимает --strictPort, упомянутый в комментарии', () => {
    const job = [
      '    services:',
      '      mysql:',
      '        image: mysql:8.0',
      '    steps:',
      '      # раньше было npx vite preview --port 8081 --strictPort',
      '      - run: npx vite preview --port 8081 &',
    ].join('\n')
    expect(auditE2eJob(job, 'test').join('\n')).toContain('--strictPort')
  })
})

describe('wait-for-url', () => {
  it('считает готовым ответ с кодом меньше 500', () => {
    expect(isReady(200, null)).toBe(true)
    expect(isReady(404, null)).toBe(true)
    expect(isReady(503, null)).toBe(false)
    expect(isReady(0, null)).toBe(false)
  })

  it('с --status требует ровно этот код: 500 у API означает «БД недоступна»', () => {
    expect(isReady(200, 200)).toBe(true)
    expect(isReady(500, 200)).toBe(false)
  })

  it('читает флаги из аргументов', () => {
    const args = parseArgs(['http://x/health', '--status=200', '--timeout=5000', '--interval=100'])
    expect(args).toEqual({ url: 'http://x/health', timeoutMs: 5000, intervalMs: 100, status: 200 })
  })

  it('возвращается, как только сервис ответил', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      return { status: calls < 3 ? 503 : 200 }
    }
    const res = await waitForUrl({ url: 'u', timeoutMs: 5000, intervalMs: 1, status: 200 }, fetchImpl)
    expect(res).toMatchObject({ ok: true, attempts: 3, status: 200 })
  })

  it('отдаёт код 1 по таймауту и сообщает последнее, что видел', async () => {
    const fetchImpl = async () => ({ status: 503 })
    const res = await waitForUrl({ url: 'u', timeoutMs: 5, intervalMs: 1, status: 200 }, fetchImpl)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('503')
  })

  it('не падает, пока сервис не поднялся (соединение отклонено)', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls < 2) throw new Error('ECONNREFUSED')
      return { status: 200 }
    }
    const res = await waitForUrl({ url: 'u', timeoutMs: 5000, intervalMs: 1, status: null }, fetchImpl)
    expect(res.ok).toBe(true)
    expect(res.attempts).toBe(2)
  })
})