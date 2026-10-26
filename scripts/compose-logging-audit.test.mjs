/**
 * Тесты гейта `scripts/compose-logging-audit.mjs` (26.10.2026).
 *
 * Фикстуры собираются в temp-каталоге: гейт читает `docker-compose.yml` и
 * `.github/workflows/*.yml` из переданного root, поэтому «сломать» рецепт можно
 * точечно — убрать `logging:` у сервиса, оставить `driver: none`, убрать
 * `max-size`/`max-file`, сослаться на несуществующий якорь, снять retention у
 * Prometheus, добавить в деплой `docker system prune -a`. Каждая поломка
 * обязана дать свой FAIL: гейт, который ищет слово «logging» в файле, был бы
 * зелёным при лимите в 500 МБ и при `max-file: 100`.
 *
 * Отдельный тест проверяет сам репозиторий (`process.cwd()`): гейт зелёный на
 * настоящих `docker-compose.yml` и workflow, а не только на фикстуре.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { audit, getLogging, getServiceNames, getAnchors, parseSize } from './compose-logging-audit.mjs'

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-logging-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function composeFixture({
  anchor = true,
  anchorDriver = 'json-file',
  anchorMaxSize = '10m',
  anchorMaxFile = '3',
  appLogging = 'logging: *default-logging',
  nginxLogging = 'logging: *default-logging',
  prometheusLogging = 'logging: *default-logging',
  prometheusRetention = true,
} = {}) {
  const lines = []
  if (anchor) {
    lines.push('x-logging: &default-logging')
    if (anchorDriver) lines.push(`  driver: ${anchorDriver}`)
    lines.push('  options:')
    if (anchorMaxSize) lines.push(`    max-size: "${anchorMaxSize}"`)
    if (anchorMaxFile) lines.push(`    max-file: "${anchorMaxFile}"`)
    lines.push('')
  }
  lines.push('services:')
  lines.push('  prometheus:')
  lines.push('    image: prom/prometheus:v3.15.0')
  lines.push('    command:')
  if (prometheusRetention) lines.push("      - '--storage.tsdb.retention.time=15d'")
  lines.push("      - '--storage.tsdb.path=/prometheus'")
  if (prometheusLogging) lines.push(`    ${prometheusLogging}`)
  lines.push('  app:')
  lines.push('    image: swiftmatch-app')
  if (appLogging) lines.push(`    ${appLogging}`)
  lines.push('  nginx:')
  lines.push('    image: swiftmatch-web')
  if (nginxLogging) lines.push(`    ${nginxLogging}`)
  return lines.join('\n') + '\n'
}

function deployFixture({ prune = null } = {}) {
  const lines = [
    'name: CI/CD',
    'jobs:',
    '  deploy:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Build & deploy',
    '        uses: appleboy/ssh-action@v1.1.0',
    '        with:',
    '          script: |',
    '            set -e',
    '            docker compose up -d --build --wait',
  ]
  if (prune) lines.push(`            ${prune}`)
  lines.push('            docker compose ps')
  return lines.join('\n') + '\n'
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

describe('compose-logging-audit: корректный рецепт', () => {
  it('зелёный на compose с якорем лимитов и retention у Prometheus', () => {
    const { problems, facts } = run()
    expect(problems).toEqual([])
    expect(facts.services).toHaveLength(3)
    expect(facts.retention).toEqual({ time: '15d', size: '' })
    expect(facts.prunes).toBe(0)
  })

  it('зелёный на настоящем репозитории', () => {
    const { problems } = audit(process.cwd())
    expect(problems).toEqual([])
  })

  it('раскрывает якорь и читает лимиты, а не только слово logging', () => {
    expect(getLogging(composeFixture(), 'app')).toEqual({
      driver: 'json-file',
      maxSize: '10m',
      maxFile: '3',
      source: 'default-logging',
    })
  })

  it('принимает лимиты, выписанные в сервисе без якоря', () => {
    const inline = composeFixture({ anchor: false, appLogging: '' })
    const withInline = inline.replace(
      '  app:\n    image: swiftmatch-app\n',
      '  app:\n    image: swiftmatch-app\n    logging:\n      driver: json-file\n      options:\n        max-size: "5m"\n        max-file: "2"\n',
    )
    expect(getLogging(withInline, 'app')).toEqual({ driver: 'json-file', maxSize: '5m', maxFile: '2', source: 'inline' })
  })

  it('перечисляет все сервисы верхнего уровня, а не только app и nginx', () => {
    expect(getServiceNames(composeFixture())).toEqual(['prometheus', 'app', 'nginx'])
    expect(getServiceNames(fs.readFileSync(path.join(process.cwd(), 'docker-compose.yml'), 'utf8'))).toEqual([
      'prometheus',
      'grafana',
      'db',
      'redis',
      'app',
      'nginx',
    ])
  })

  it('понимает единицы размера', () => {
    expect(parseSize('10m')).toBe(10 * 1024 * 1024)
    expect(parseSize('"1g"')).toBe(1024 ** 3)
    expect(parseSize('512k')).toBe(512 * 1024)
    expect(parseSize('10 MB')).toBe(null)
    expect(parseSize('')).toBe(null)
  })
})

describe('compose-logging-audit: логи без лимита', () => {
  it('ловит сервис без logging: вообще', () => {
    expect(problemsOf({ compose: { appLogging: '' } })).toContain('у сервиса app нет logging:')
  })

  it('ловит logging у одного сервиса и отсутствие у соседнего', () => {
    expect(problemsOf({ compose: { nginxLogging: '' } })).toContain('у сервиса nginx нет logging:')
  })

  it('ловит driver, отличный от json-file', () => {
    expect(problemsOf({ compose: { anchorDriver: 'none' } })).toContain('driver «none»')
  })

  it('ловит отсутствие max-size', () => {
    expect(problemsOf({ compose: { anchorMaxSize: '' } })).toContain('нет max-size')
  })

  it('ловит отсутствие max-file', () => {
    expect(problemsOf({ compose: { anchorMaxFile: '' } })).toContain('нет max-file')
  })

  it('ловит ссылку на несуществующий якорь — лимита фактически нет', () => {
    const problems = problemsOf({ compose: { appLogging: 'logging: *unknown-anchor' } })
    expect(problems).toContain('у сервиса app нет logging:')
  })

  it('ловит max-size больше 100 МБ — это не лимит', () => {
    expect(problemsOf({ compose: { anchorMaxSize: '500m' } })).toContain('больше 100 МБ')
  })

  it('ловит max-file больше 10 — файлы снова складываются в гигабайты', () => {
    expect(problemsOf({ compose: { anchorMaxFile: '20' } })).toContain('max-file=20')
  })
})

describe('compose-logging-audit: том Prometheus', () => {
  it('ловит отсутствие retention — том растёт без ограничения', () => {
    expect(problemsOf({ compose: { prometheusRetention: false } })).toContain('нет --storage.tsdb.retention')
  })

  it('принимает ограничение только по размеру', () => {
    expect(getAnchors(composeFixture())).toHaveProperty('default-logging')
    const withSize = composeFixture().replace(
      "      - '--storage.tsdb.retention.time=15d'",
      "      - '--storage.tsdb.retention.size=2GB'",
    )
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), withSize)
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'deploy.yml'), deployFixture())
    expect(audit(dir).problems).toEqual([])
  })
})

describe('compose-logging-audit: очистка диска, уносящая откат', () => {
  it('ловит docker system prune -a в деплое', () => {
    const problems = problemsOf({ deploy: { prune: 'docker system prune -af' } })
    expect(problems).toContain('docker system prune')
    expect(problems).toContain(':rollback')
  })

  it('ловит docker image prune -a — исчезает цель отката', () => {
    expect(problemsOf({ deploy: { prune: 'docker image prune -a -f' } })).toContain('docker image prune -a')
  })

  it('ловит docker volume prune — уносит db_data и uploads_data', () => {
    expect(problemsOf({ deploy: { prune: 'docker volume prune -f' } })).toContain('docker volume prune')
  })

  it('не ругается на безопасную чистку dangling-образов без -a', () => {
    expect(problemsOf({ deploy: { prune: 'docker image prune -f' } })).toEqual('')
  })

  it('не падает на комментарии, где prune объяснён, — пояснение не исполняется', () => {
    expect(problemsOf({ deploy: { prune: '# нельзя: docker system prune -a уносит :rollback' } })).toEqual('')
  })
})
