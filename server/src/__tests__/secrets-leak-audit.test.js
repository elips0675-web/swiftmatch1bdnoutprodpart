import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  audit,
  checkDockerignorePatterns,
  checkRsyncExcludes,
  findContextSecrets,
  findIncludedNoiseDirs,
  findRsyncSecretGaps,
  isExcluded,
  parseDockerignore,
  SECRET_FILE_SAMPLES,
} from '../../../scripts/secrets-leak-audit.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// Прежние версии файлов — те, что были в репозитории до этапа 20.
const OLD_DOCKERIGNORE = `node_modules
dist
.git
*.md
.env
.env.local
test-results
playwright-report
e2e
docs
monitoring
k6
android
.vite
.DS_Store
*.tsbuildinfo
*.log
`

const FIXED_DOCKERIGNORE = `${OLD_DOCKERIGNORE}
**/.env
**/.env.*
**/*.secret
**/*-secret
**/*.pem
**/*.key
**/uploads
`

const OLD_RSYNC = '  switches: -avz --delete --exclude node_modules --exclude .git --exclude test-results --exclude playwright-report --exclude e2e/.auth'

// Строка после этапа 20: исключает пять шаблонов, но не дев-секрет и не
// варианты `.env.*` — дыра N8, закрытая этапом 35.
const RSYNC_AFTER_STAGE_20 = "  switches: -avz --delete --exclude node_modules --exclude .git --exclude .env --exclude '*.secret' --exclude '*.pem' --exclude '*.key' --exclude '*.p12' --exclude uploads"

const NEW_RSYNC = "  switches: -avz --delete --exclude node_modules --exclude .git --exclude test-results --exclude playwright-report --exclude e2e/.auth --exclude .env --exclude '.env.*' --exclude '*.secret' --exclude '*-secret' --exclude '*.pem' --exclude '*.key' --exclude '*.p12' --exclude '*.pfx' --exclude 'id_*' --exclude uploads"

function makeFixture(dockerignore, rsync) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-audit-'))
  fs.writeFileSync(path.join(dir, '.dockerignore'), dockerignore)
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.github/workflows/deploy.yml'), rsync + '\n')
  fs.writeFileSync(path.join(dir, 'server/.env'), 'JWT_SECRET=real-one\n')
  fs.writeFileSync(path.join(dir, 'server/.jwt-dev-secret'), 'a'.repeat(64))
  fs.writeFileSync(path.join(dir, 'server/.env.example'), 'JWT_SECRET=change-me\n')
  fs.writeFileSync(path.join(dir, '.env'), 'JWT_SECRET=root\n')
  fs.writeFileSync(path.join(dir, 'server/index.js'), '// код\n')
  return dir
}

let fixture

beforeEach(() => {
  fixture = makeFixture(OLD_DOCKERIGNORE, OLD_RSYNC)
})

afterEach(() => {
  fs.rmSync(fixture, { recursive: true, force: true })
})

describe('secrets-leak-audit: контекст образа', () => {
  it('находит server/.env и server/.jwt-dev-secret при прежнем .dockerignore', () => {
    const leaks = findContextSecrets(fixture)
    expect(leaks).toContain('server/.env')
    expect(leaks).toContain('server/.jwt-dev-secret')
  })

  it('прежний .dockerignore не считает .env.example секретом (он и должен ехать в репо)', () => {
    expect(findContextSecrets(fixture)).not.toContain('server/.env.example')
  })

  it('после добавления **/.env, **/*.secret и **/*-secret утечек не остаётся', () => {
    fs.writeFileSync(path.join(fixture, '.dockerignore'), FIXED_DOCKERIGNORE)
    expect(findContextSecrets(fixture)).toEqual([])
  })

  it('обычные файлы проекта секретами не считаются', () => {
    fs.writeFileSync(path.join(fixture, '.dockerignore'), FIXED_DOCKERIGNORE)
    const leaks = findContextSecrets(fixture)
    expect(leaks).not.toContain('server/index.js')
  })
})

describe('secrets-leak-audit: обязательные правила .dockerignore', () => {
  it('прежний файл не проходит проверку наличия правил', () => {
    expect(checkDockerignorePatterns(fixture).sort()).toEqual(
      [
        '**/.env',
        '**/.env.*',
        '**/*-secret',
        '**/*.key',
        '**/*.pem',
        '**/*.secret',
        '**/dist',
        '**/node_modules',
      ].sort(),
    )
  })

  it('актуальный файл репозитория проходит', () => {
    expect(checkDockerignorePatterns(REPO_ROOT)).toEqual([])
  })
})

describe('secrets-leak-audit: rsync не должен стирать прод-.env и везти секреты', () => {
  it('прежняя строка rsync не исключает ни .env, ни uploads (прод-.env удаляется --delete)', () => {
    const missing = checkRsyncExcludes(OLD_RSYNC)
    expect(missing).toContain('.env')
    expect(missing).toContain('uploads')
  })

  it('строка после этапа 20 держала 5 шаблонов и пропускала 7 классов секретов', () => {
    expect(findRsyncSecretGaps(RSYNC_AFTER_STAGE_20)).toEqual([
      '.env.local',
      '.env.production',
      '.env.development',
      '.jwt-dev-secret',
      'tls.pfx',
      'id_rsa',
      'id_ed25519',
    ])
  })

  it('строка без единого секретного исключения пропускает все образцы', () => {
    expect(findRsyncSecretGaps(OLD_RSYNC).length).toBe(SECRET_FILE_SAMPLES.length)
  })

  it('исправленная строка rsync проходит по обоим каналам', () => {
    expect(checkRsyncExcludes(NEW_RSYNC)).toEqual([])
    expect(findRsyncSecretGaps(NEW_RSYNC)).toEqual([])
  })

  it('актуальный deploy.yml репозитория проходит', () => {
    const deployYml = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/deploy.yml'), 'utf8')
    expect(checkRsyncExcludes(deployYml)).toEqual([])
    expect(findRsyncSecretGaps(deployYml)).toEqual([])
  })

  it('audit() отдаёт находки нового канала, а не молчит на старой строке', () => {
    const dir = makeFixture(FIXED_DOCKERIGNORE, OLD_RSYNC)
    try {
      const result = audit(dir)
      expect(result.rsyncSecretGaps).toContain('.jwt-dev-secret')
      expect(result.rsyncSecretGaps).toContain('.env')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('secrets-leak-audit: матчер правил (docker-семантика, не rsync)', () => {
  it('паттерн без слеша матчит ТОЛЬКО корневой путь — как в Docker, не как в rsync', () => {
    const rules = parseDockerignore('.env')
    expect(isExcluded('.env', false, rules)).toBe(true)
    expect(isExcluded('server/.env', false, rules)).toBe(false)
  })

  it('именно эта асимметрия была причиной P0-C: без **/ секрет уезжает в образ', () => {
    fs.writeFileSync(path.join(fixture, '.dockerignore'), '.env\n')
    expect(findContextSecrets(fixture)).toContain('server/.env')
  })

  it('**/node_modules исключает вложенный каталог, node_modules — нет', () => {
    expect(isExcluded('server/node_modules', true, parseDockerignore('node_modules'))).toBe(false)
    expect(isExcluded('server/node_modules', true, parseDockerignore('**/node_modules'))).toBe(true)
  })

  it('*.md не исключает вложенный docs/файл', () => {
    expect(isExcluded('docs/AGENTS.md', false, parseDockerignore('*.md'))).toBe(false)
  })

  it('паттерн со слешем матчит только свой путь', () => {
    const rules = parseDockerignore('e2e/.auth')
    expect(isExcluded('e2e/.auth', true, rules)).toBe(true)
    expect(isExcluded('server/e2e/.auth', true, rules)).toBe(false)
  })

  it('правило с `/` на конце действует только на каталоги', () => {
    const rules = parseDockerignore('uploads/')
    expect(isExcluded('uploads', true, rules)).toBe(true)
    expect(isExcluded('uploads', false, rules)).toBe(false)
  })

  it('последнее правило побеждает: `!` возвращает файл в контекст', () => {
    const rules = parseDockerignore('**/*.key\n!server/public.key')
    expect(isExcluded('a.key', false, rules)).toBe(true)
    expect(isExcluded('server/public.key', false, rules)).toBe(false)
  })

  it('каталог под исключённым родителем тянет за собой содержимое', () => {
    fs.mkdirSync(path.join(fixture, 'server/uploads'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'server/uploads/photo.jpg'), 'x')
    fs.writeFileSync(
      path.join(fixture, '.dockerignore'),
      FIXED_DOCKERIGNORE,
    )
    expect(findContextSecrets(fixture)).toEqual([])
  })
})

describe('secrets-leak-audit: мусор в контексте образа', () => {
  it('прежний node_modules пропускает вложенный server/node_modules в образ', () => {
    fs.mkdirSync(path.join(fixture, 'server/node_modules/sharp'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'server/node_modules/sharp/index.js'), '// x')
    fs.writeFileSync(path.join(fixture, '.dockerignore'), OLD_DOCKERIGNORE)
    expect(findIncludedNoiseDirs(fixture)).toContain('server/node_modules')
  })

  it('с **/node_modules вложенный каталог исключён', () => {
    fs.mkdirSync(path.join(fixture, 'server/node_modules/sharp'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'server/node_modules/sharp/index.js'), '// x')
    fs.writeFileSync(path.join(fixture, '.dockerignore'), OLD_DOCKERIGNORE + '\n**/node_modules\n')
    expect(findIncludedNoiseDirs(fixture)).toEqual([])
  })

  it('реальный репозиторий: node_modules/dist в контекст не попадают', () => {
    expect(findIncludedNoiseDirs(REPO_ROOT)).toEqual([])
  })
})

describe('secrets-leak-audit: репозиторий целиком', () => {
  it('audit() на реальном репозитории не находит утечек', () => {
    const result = audit(REPO_ROOT)
    expect(result.dockerignoreMissing).toEqual([])
    expect(result.contextSecrets).toEqual([])
    expect(result.includedNoiseDirs).toEqual([])
    expect(result.rsyncMissing).toEqual([])
  })
})
