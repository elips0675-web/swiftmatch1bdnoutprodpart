/**
 * Тесты гейта `scripts/dependency-audit.mjs` — обе дыры (объявлено, но не
 * используется / используется, но не объявлено) плюс гигиена allowlist.
 *
 * Фикстуры намеренно держат импорты внутри строк и комментариев: гейт берёт
 * спецификаторы из AST, поэтому «пакет, упомянутый в JSDoc или в строковом
 * примере теста» не должен считаться зависимостью. Ровно на этом гейт и ловил
 * себя на этапе 31, пока спецификаторы искались регуляркой по тексту.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT,
  auditDependencies,
  auditRepository,
  findSpecifiers,
  packageNameOf,
  parseAllowlist,
} from './dependency-audit.mjs'

function scope(manifest, files) {
  return {
    scopes: [
      {
        manifestPath: 'package.json',
        manifest,
        files: Object.entries(files).map(([file, text]) => ({ file, text })),
      },
    ],
  }
}

const GOOD_ROOT = {
  dependencies: { react: '^18.3.1', 'mysql2': '^3.23.1' },
  devDependencies: { vitest: '^2.0.0', typescript: '^5.5.0' },
}

const GOOD_FILES = {
  'src/app.ts': "import React from 'react'\nimport mysql from 'mysql2/promise'\n",
  'vite.config.ts': "import ts from 'typescript'\n",
  'src/app.test.ts': "import { it } from 'vitest'\n",
}

function types(findings) {
  return findings.map((f) => f.type).sort()
}

describe('packageNameOf', () => {
  it('схлопывает подпуть до имени пакета', () => {
    expect(packageNameOf('mysql2/promise')).toBe('mysql2')
    expect(packageNameOf('@scope/pkg/deep/path')).toBe('@scope/pkg')
    expect(packageNameOf('react')).toBe('react')
  })
})

describe('findSpecifiers', () => {
  it('берёт import, re-export, динамический import, require и vi.mock', () => {
    const hits = findSpecifiers(
      'src/x.ts',
      [
        "import React from 'react'",
        "export { a } from '@scope/pkg'",
        "const m = await import('lazy-lib')",
        "const c = require('common-lib')",
        "vi.mock('@test/mock')",
        "import x = require('ts-lib')",
      ].join('\n'),
    )
    expect(hits.map((h) => h.name).sort()).toEqual([
      '@scope/pkg',
      '@test/mock',
      'common-lib',
      'lazy-lib',
      'react',
      'ts-lib',
    ])
  })

  it('не считает импортом упоминание в комментарии или в строке', () => {
    const hits = findSpecifiers(
      'src/x.ts',
      [
        '/** Раньше тут был `import x from "ghost-pkg"`. */',
        "const sample = \"import y from 'another-ghost'\"",
        '// import z from "third-ghost"',
        "import real from 'real-pkg'",
      ].join('\n'),
    )
    expect(hits.map((h) => h.name)).toEqual(['real-pkg'])
  })

  it('игнорирует node_modules, встроенные модули и локальные пути', () => {
    const hits = findSpecifiers(
      'src/x.ts',
      [
        "import fs from 'node:fs'",
        "import path from 'path'",
        "import a from './local'",
        "import b from '@/shims/next-link'",
        "import c from '~/thing'",
      ].join('\n'),
    )
    expect(hits).toEqual([])
  })

  it('указывает номер строки', () => {
    const hits = findSpecifiers(
      'src/x.ts',
      ['// nothing', "import x from 'p-with-line'"].join('\n'),
    )
    expect(hits[0].line).toBe(2)
  })
})

describe('auditDependencies: чистое состояние', () => {
  it('не даёт замечаний, когда всё объявлено и используется', () => {
    expect(auditDependencies(scope(GOOD_ROOT, GOOD_FILES))).toEqual([])
  })
})

describe('auditDependencies: используется, но не объявлено', () => {
  it('ловит необъявленный импорт и указывает файл и строку', () => {
    const findings = auditDependencies(
      scope(GOOD_ROOT, { ...GOOD_FILES, 'src/hook.ts': "import x from 'ghost-pkg'\n" }),
    )
    expect(types(findings)).toEqual(['undeclared-import'])
    expect(findings[0].detail).toContain('ghost-pkg')
    expect(findings[0].detail).toContain('src/hook.ts:1')
  })

  it('ловит необъявленный подпуть по имени пакета', () => {
    const findings = auditDependencies(
      scope(GOOD_ROOT, { ...GOOD_FILES, 'src/db.ts': "import x from 'ghost-db/promise'\n" }),
    )
    expect(types(findings)).toEqual(['undeclared-import'])
    expect(findings[0].detail).toContain('"ghost-db"')
  })

  it('различает половины: зависимость соседнего package.json — тоже замечание', () => {
    const findings = auditDependencies({
      scopes: [
        {
          manifestPath: 'server/package.json',
          manifest: { dependencies: { express: '^4.0.0' } },
          files: [
            {
              file: 'server/src/a.js',
              text: "import 'react'\nimport express from 'express'\n",
            },
          ],
        },
      ],
    })
    expect(types(findings)).toEqual(['undeclared-import'])
    expect(findings[0].detail).toContain('server/package.json')
  })

  it('диапазон devDependencies считается объявленным', () => {
    const findings = auditDependencies(
      scope(GOOD_ROOT, { ...GOOD_FILES, 'src/vitest.setup.ts': "import 'vitest'\n" }),
    )
    expect(findings).toEqual([])
  })
})

describe('auditDependencies: объявлено, но не используется', () => {
  it('ловит мёртвую runtime-зависимость', () => {
    const findings = auditDependencies(
      scope(
        { dependencies: { react: '^18.3.1', zod: '^4.4.3' } },
        { 'src/app.ts': "import React from 'react'\n" },
      ),
    )
    expect(types(findings)).toEqual(['unused-runtime-dependency'])
    expect(findings[0].detail).toContain('zod')
  })

  it('не трогает неиспользуемые devDependencies (их вызывают как CLI)', () => {
    const findings = auditDependencies(
      scope(
        { dependencies: {}, devDependencies: { eslint: '^9.0.0', prettier: '^3.0.0' } },
        { 'src/app.ts': 'export const a = 1\n' },
      ),
    )
    expect(findings).toEqual([])
  })

  it('использование только в тесте считается использованием', () => {
    const findings = auditDependencies(
      scope(
        { dependencies: { '@capacitor/push-notifications': '^8.1.2' } },
        { 'src/a.test.ts': "vi.mock('@capacitor/push-notifications')\n" },
      ),
    )
    expect(findings).toEqual([])
  })
})

describe('parseAllowlist', () => {
  it('пустой файл или отсутствие файла не считаются ошибкой', () => {
    expect(parseAllowlist(undefined).problems).toEqual([])
    expect(parseAllowlist({}).problems).toEqual([])
  })

  it('ругается на неструктурированный файл', () => {
    expect(types(parseAllowlist({ entries: 'nope' }).problems)).toEqual([
      'allowlist-malformed',
    ])
  })

  it('требует непустую причину', () => {
    const { problems } = parseAllowlist({
      entries: [{ package: 'native-plugin', reason: '   ' }],
    })
    expect(types(problems)).toEqual(['allowlist-missing-reason'])
  })

  it('ловит дубль записи', () => {
    const { problems } = parseAllowlist({
      entries: [
        { package: 'p', reason: 'a' },
        { package: 'p', reason: 'b' },
      ],
    })
    expect(types(problems)).toEqual(['allowlist-duplicate'])
  })
})

describe('auditDependencies: allowlist', () => {
  const allow = (entries) => ({ entries })

  it('глушит необъявленный импорт, если у записи есть причина', () => {
    const findings = auditDependencies({
      ...scope(GOOD_ROOT, { ...GOOD_FILES, 'src/k6/x.js': "import 'k6'\n" }),
      allowlistRaw: allow([{ package: 'k6', externalRuntime: true, reason: 'рантайм k6' }]),
    })
    expect(findings).toEqual([])
  })

  it('глушит мёртвую runtime-зависимость', () => {
    const findings = auditDependencies({
      ...scope(
        { dependencies: { react: '^18.3.1', 'native-plugin': '^1.0.0' } },
        { 'src/app.ts': "import React from 'react'\n" },
      ),
      allowlistRaw: allow([{ package: 'native-plugin', reason: 'подключает Gradle' }]),
    })
    expect(findings).toEqual([])
  })

  it('пустая причина остаётся замечанием, даже когда запись нужна', () => {
    const findings = auditDependencies({
      ...scope(
        { dependencies: { 'native-plugin': '^1.0.0' } },
        { 'src/app.ts': 'export const a = 1\n' },
      ),
      allowlistRaw: allow([{ package: 'native-plugin', reason: '' }]),
    })
    expect(types(findings)).toEqual(['allowlist-missing-reason'])
  })

  it('ловит протухшую запись: пакет уже импортируется', () => {
    const findings = auditDependencies({
      ...scope(GOOD_ROOT, GOOD_FILES),
      allowlistRaw: allow([{ package: 'react', reason: 'думали, что не импортируется' }]),
    })
    expect(types(findings)).toEqual(['allowlist-unused'])
    expect(findings[0].detail).toContain('уже импортируется')
  })

  it('ловит протухшую запись: пакета нет ни в одном package.json', () => {
    const findings = auditDependencies({
      ...scope(GOOD_ROOT, GOOD_FILES),
      allowlistRaw: allow([{ package: 'typo-pkg', reason: 'опечатка' }]),
    })
    expect(types(findings)).toEqual(['allowlist-unknown-package'])
  })

  it('allowlist глушит замечание по имени пакета в любой половине', () => {
    const findings = auditDependencies({
      scopes: [
        {
          manifestPath: 'package.json',
          manifest: { dependencies: { 'native-plugin': '^1.0.0' } },
          files: [],
        },
        {
          manifestPath: 'server/package.json',
          manifest: { dependencies: {} },
          files: [{ file: 'server/src/a.js', text: "import 'native-plugin'\n" }],
        },
      ],
      allowlistRaw: allow([{ package: 'native-plugin', reason: 'Gradle' }]),
    })
    expect(findings).toEqual([])
  })
})

describe('живой репозиторий', () => {
  it('целостность зависимостей держится на текущем дереве', () => {
    const findings = auditRepository()
    expect(
      findings.map((f) => `[${f.type}] ${f.detail}`),
    ).toEqual([])
  })
})

describe('подключение гейта к CI', () => {
  const readWorkflow = (name) =>
    fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8')

  it('в ci.yml есть джоба, запускающая check:deps', () => {
    const ci = readWorkflow('ci.yml')
    expect(ci).toContain('npm run check:deps')
    expect(ci).toMatch(/dependency-integrity:/)
  })

  it('в deploy.yml lint-and-typecheck запускает check:deps', () => {
    expect(readWorkflow('deploy.yml')).toContain('npm run check:deps')
  })
})