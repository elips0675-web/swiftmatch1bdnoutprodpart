import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  audit,
  findUploadStaticDir,
  findUploadWriteDir,
  getAppNamedVolumeMounts,
  getDeclaredVolumes,
} from '../../../scripts/deploy-persistence-audit.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const UPLOAD_JS = "const UPLOAD_DIR = path.resolve(__dirname, '../../uploads')\n"
const INDEX_STATIC = "app.use('/uploads', express.static(path.join(__dirname, '../uploads')))\n"

const COMPOSE_WITHOUT_VOLUME = `services:
  app:
    build:
      context: .
      target: server
    ports:
      - "3002:3002"
    mem_limit: 512m
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
volumes:
  db_data:
  redis_data:
`

const COMPOSE_WITH_VOLUME = `services:
  app:
    build:
      context: .
      target: server
    ports:
      - "3002:3002"
    mem_limit: 512m
    volumes:
      - uploads_data:/app/server/uploads
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
  nginx:
    build:
      context: .
      target: web
    ports:
      - "8080:80"
volumes:
  db_data:
  redis_data:
  uploads_data:
`

function makeFixture({ compose = COMPOSE_WITHOUT_VOLUME, upload = UPLOAD_JS, index = INDEX_STATIC } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistence-audit-'))
  fs.mkdirSync(path.join(dir, 'server/src/routes'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'server/src/routes/upload.js'), `import path from 'path'\n${upload}`)
  fs.writeFileSync(path.join(dir, 'server/src/index.js'), `import path from 'path'\n${index}`)
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), compose)
  return dir
}

let fixture

afterEach(() => {
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true })
  fixture = null
})

describe('deploy-persistence-audit: вывод пути из кода', () => {
  it('UPLOAD_DIR из upload.js разрешается в /app/server/uploads', () => {
    fixture = makeFixture()
    expect(findUploadWriteDir(fixture)).toBe('/app/server/uploads')
  })

  it('express.static из index.js разрешается в тот же каталог', () => {
    fixture = makeFixture()
    expect(findUploadStaticDir(fixture)).toBe('/app/server/uploads')
  })

  it('разная глубина ../../ и ../ даёт один каталог, а не два', () => {
    fixture = makeFixture()
    expect(findUploadWriteDir(fixture)).toBe(findUploadStaticDir(fixture))
  })

  it('если развести пути записи и отдачи — гейт падает', () => {
    fixture = makeFixture({ index: "app.use('/uploads', express.static(path.join(__dirname, '../static')))\n" })
    const { problems } = audit(fixture)
    expect(problems.some((p) => p.includes('никогда не откроются'))).toBe(true)
  })
})

describe('deploy-persistence-audit: compose', () => {
  it('прежний compose без volume проваливает гейт (это и был P0 #37)', () => {
    fixture = makeFixture()
    const { problems } = audit(fixture)
    expect(problems.some((p) => p.includes('не смонтирован в сервис app'))).toBe(true)
  })

  it('volume, смонтированный по нужному пути, проходит', () => {
    fixture = makeFixture({ compose: COMPOSE_WITH_VOLUME })
    expect(audit(fixture).problems).toEqual([])
  })

  it('том, не объявленный в разделе volumes:, не засчитывается', () => {
    fixture = makeFixture({ compose: COMPOSE_WITH_VOLUME.replace('  uploads_data:\n', '') })
    const { problems } = audit(fixture)
    expect(problems.some((p) => p.includes('не объявлен в разделе volumes:'))).toBe(true)
  })

  it('volume на другом пути не спасает', () => {
    fixture = makeFixture({
      compose: COMPOSE_WITH_VOLUME.replace('/app/server/uploads', '/app/other'),
    })
    const { problems } = audit(fixture)
    expect(problems.some((p) => p.includes('не смонтирован в сервис app'))).toBe(true)
  })

  it('тома соседнего сервиса не считаются томами app', () => {
    const compose = `services:
  app:
    build:
      context: .
    env_file:
      - .env
  nginx:
    build:
      context: .
    volumes:
      - uploads_data:/app/server/uploads
volumes:
  uploads_data:
`
    fixture = makeFixture({ compose })
    expect(getAppNamedVolumeMounts(compose)).toEqual([])
    expect(audit(fixture).problems.some((p) => p.includes('не смонтирован в сервис app'))).toBe(true)
  })

  it('bind-mount в каталог репозитория не засчитывается: его вытер бы rsync --delete', () => {
    const compose = `services:
  app:
    build:
      context: .
    volumes:
      - ./server/uploads:/app/server/uploads
    env_file:
      - .env
volumes:
  db_data:
`
    fixture = makeFixture({ compose })
    expect(audit(fixture).problems.some((p) => p.includes('не смонтирован в сервис app'))).toBe(true)
  })

  it('раздел volumes: читается', () => {
    const declared = getDeclaredVolumes(COMPOSE_WITH_VOLUME)
    expect([...declared].sort()).toEqual(['db_data', 'redis_data', 'uploads_data'])
  })
})

describe('deploy-persistence-audit: репозиторий целиком', () => {
  it('реальный docker-compose проходит гейт', () => {
    expect(audit(REPO_ROOT).problems).toEqual([])
  })

  it('реальные пути записи и отдачи совпадают', () => {
    expect(findUploadWriteDir(REPO_ROOT)).toBe(findUploadStaticDir(REPO_ROOT))
  })

  it('реальный compose монтирует этот каталог', () => {
    expect(getAppNamedVolumeMounts(fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8')))
      .toEqual([{ name: 'uploads_data', target: '/app/server/uploads' }])
  })
})
