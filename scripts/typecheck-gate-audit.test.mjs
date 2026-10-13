import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TYPECHECK_SCRIPT,
  REQUIRED_PROJECT_FLAGS,
  parseJsonc,
  checkTypecheckScript,
  findTscRunLines,
  checkWorkflow,
  checkProjectConfig,
} from './typecheck-gate-audit.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let fixture

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typecheck-gate-'))
  return dir
}

afterEach(() => {
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true })
  fixture = null
})

describe('check:typecheck: гейт не проверяет ноль файлов (P3 #37)', () => {
  it('npm-скрипт, собирающий оба проекта с -p и --noEmit, проходит', () => {
    const result = checkTypecheckScript('tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit')
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('голый `tsc --noEmit` (баг P3 #37: корневой tsconfig.json с "files": []) — падение', () => {
    const result = checkTypecheckScript('tsc --noEmit')
    expect(result.ok).toBe(false)
    for (const flag of REQUIRED_PROJECT_FLAGS) {
      expect(result.problems.some((p) => p.includes(flag))).toBe(true)
    }
  })

  it('скрипт с одним проектом вместо двух — падение', () => {
    const result = checkTypecheckScript('tsc -p tsconfig.app.json --noEmit')
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('-p tsconfig.node.json'))).toBe(true)
  })

  it('скрипт без --noEmit — падение', () => {
    const result = checkTypecheckScript('tsc -p tsconfig.app.json -p tsconfig.node.json')
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('--noEmit'))).toBe(true)
  })

  it('отсутствующий скрипт — падение', () => {
    const result = checkTypecheckScript('')
    expect(result.ok).toBe(false)
  })
})

describe('check:typecheck: workflow не возвращается к голому tsc', () => {
  it('run-строка `npx tsc --noEmit` — падение с указанием строки', () => {
    const workflow = 'jobs:\n  lint:\n    steps:\n      - run: npm ci\n      - run: npx tsc --noEmit\n'
    const result = checkWorkflow(workflow, 'ci.yml')
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('ci.yml:5'))).toBe(true)
    expect(result.problems.some((p) => p.includes('npm run typecheck'))).toBe(true)
  })

  it('`npm run typecheck` без голого tsc — проходит', () => {
    const workflow = 'jobs:\n  lint:\n    steps:\n      - run: npm ci\n      - run: npm run typecheck\n'
    const result = checkWorkflow(workflow, 'ci.yml')
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('`tsc -p tsconfig.app.json` с указанием проекта не считается голым вызовом', () => {
    const workflow = 'jobs:\n  lint:\n    steps:\n      - run: npm run typecheck\n      - run: npx tsc -p tsconfig.app.json --noEmit\n'
    const result = checkWorkflow(workflow, 'ci.yml')
    expect(result.ok).toBe(true)
  })

  it('findTscRunLines видит и tsc, и typecheck', () => {
    const workflow = '- run: npx tsc --noEmit\n- run: npm run typecheck\n- run: npm run lint\n'
    const lines = findTscRunLines(workflow)
    expect(lines.length).toBe(2)
    expect(lines[0].cmd).toBe('npx tsc --noEmit')
    expect(lines[1].cmd).toBe('npm run typecheck')
  })
})

describe('check:typecheck: include проектов покрывает реальные файлы', () => {
  it('parseJsonc снимает комментарии, но не режет `/*` внутри строк (paths "@/*")', () => {
    const text = '{ "files": [], "compilerOptions": { "paths": { "@/*": ["./src/*"] } } } // end\n/* block */'
    const config = parseJsonc(text)
    expect(config.files).toEqual([])
    expect(config.compilerOptions.paths['@/*']).toEqual(['./src/*'])
  })

  it('пустой include — падение', () => {
    const result = checkProjectConfig('tsconfig.app.json', { include: [] }, REPO_ROOT)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('include пуст'))).toBe(true)
  })

  it('files: [] без include — падение', () => {
    const result = checkProjectConfig('tsconfig.app.json', { files: [], include: [] }, REPO_ROOT)
    expect(result.ok).toBe(false)
  })

  it('include на каталог с реальными файлами — проходит', () => {
    fixture = makeFixture()
    fs.writeFileSync(path.join(fixture, 'index.ts'), 'export const x = 1\n')
    const result = checkProjectConfig('tsconfig.app.json', { include: ['.'] }, fixture)
    expect(result.ok).toBe(true)
  })

  it('include на несуществующий путь — падение', () => {
    fixture = makeFixture()
    const result = checkProjectConfig('tsconfig.app.json', { include: ['no-such-dir'] }, fixture)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('несуществующие пути'))).toBe(true)
  })
})

describe('check:typecheck: реальный репозиторий не в регрессии', () => {
  it('package.json: scripts.typecheck собирает оба проекта с -p и --noEmit', () => {
    const pkg = parseJsonc(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    const result = checkTypecheckScript(pkg.scripts[TYPECHECK_SCRIPT])
    expect(result.ok).toBe(true)
    expect(pkg.scripts[TYPECHECK_SCRIPT]).not.toBe('tsc --noEmit')
  })

  it('ci.yml и deploy.yml вызывают npm run typecheck и не содержат голого tsc', () => {
    for (const name of ['ci.yml', 'deploy.yml']) {
      const text = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8')
      const result = checkWorkflow(text, name)
      expect(result.ok, `${name}: ${result.problems.join('; ')}`).toBe(true)
    }
  })

  it('оба проекта из scripts.typecheck существуют и их include покрывает файлы', () => {
    for (const configName of ['tsconfig.app.json', 'tsconfig.node.json']) {
      const config = parseJsonc(fs.readFileSync(path.join(REPO_ROOT, configName), 'utf8'))
      const result = checkProjectConfig(configName, config, REPO_ROOT)
      expect(result.ok, `${configName}: ${result.problems.join('; ')}`).toBe(true)
    }
  })
})