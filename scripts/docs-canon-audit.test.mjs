/**
 * Тесты гейта раскладки документации (`npm run check:docs`).
 *
 * Гейт защищает от повторения конкретной беды этапа 32: правила проекта жили
 * в трёх файлах, и самый длинный из них (`Промты.txt`, 70 КБ) предлагал сделать
 * `adminAuth` пассивным — то есть прямо разрешал снимать защиту `/api/admin`.
 * Такая ошибка не ломает сборку и не падает ни на одном тесте: это правка
 * текста. Значит, ловить её обязан отдельный гейт, и он обязан ловить её
 * **до** того, как файл снова станет источником правил.
 *
 * Тесты ниже фиксируют границу в обе стороны:
 *   • «плохо» — баннер пропал, вернулся раздел-правило, вернулся раздел-идея,
 *     ссылка битая, раздел вырезан, в доке запрещённая формулировка, архив не
 *     помечен, гейт не вызывается из workflow, шаг гейта `continue-on-error`;
 *   • «хорошо» — текущее состояние репозитория проходит гейт целиком, а
 *     журналы с цитатами неверного правила остаются зелёными по исключению.
 *
 * Отдельно закрыт регресс с регуляркой ссылок: `\w` в JS — это только
 * `[A-Za-z0-9_]`, поэтому ссылка на `test/ИНВЕНТАРЬ-ТЕСТОВ.md` или
 * `docs/AGENTS-*.md` с кириллицей не проверялась бы вообще — гейт был бы
 * зелёным на битых ссылках.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PROMPTS_INDEX,
  ROADMAP_FILE,
  ARCHIVE_FILE,
  NPM_SCRIPT,
  GATE_SCRIPT,
  FORBIDDEN_EXEMPT_FILES,
  MOVED_SECTIONS,
  ROADMAP_MIN_TOTAL_LINES,
  FILE_LINK_RE,
  collectPromptsFindings,
  collectRoadmapFindings,
  collectForbiddenFindings,
  collectArchiveFindings,
  collectWiringFindings,
  collectTrackedDocs,
  getJobBlock,
  getStepBlock,
  blockAllowsFailure,
  jobAllowsFailure,
  audit,
} from './docs-canon-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const alwaysExists = () => true
const ids = list => list.map(f => f.id)

describe('Промты.txt — указатель, а не источник правил', () => {
  it('текущий файл проходит проверки', () => {
    const { findings } = collectPromptsFindings(read(PROMPTS_INDEX), { fileExists: alwaysExists })
    expect(findings).toEqual([])
  })

  it('без шапки «больше не источник правил» — находка', () => {
    const { findings } = collectPromptsFindings('# Промты\n\n## 5. Pre-flight Checklist\n', { fileExists: alwaysExists })
    expect(ids(findings)).toContain('prompts-banner')
  })

  it('вернувшийся раздел-правило 0–20 — находка', () => {
    const text = read(PROMPTS_INDEX) + '\n## 5. Playwright E2E\n\nописание\n'
    const { findings } = collectPromptsFindings(text, { fileExists: alwaysExists })
    expect(ids(findings)).toContain('prompts-rule-section')
    expect(findings.find(f => f.id === 'prompts-rule-section').line).toBeGreaterThan(10)
  })

  it('обе границы диапазона правил ловятся: 0 и 20', () => {
    for (const num of [0, 20]) {
      const { findings } = collectPromptsFindings(read(PROMPTS_INDEX) + `\n## ${num}. раздел\n`, { fileExists: alwaysExists })
      expect(ids(findings), `раздел ${num}`).toContain('prompts-rule-section')
    }
  })

  it('вернувшийся раздел-идея 21–34 — находка', () => {
    const { findings } = collectPromptsFindings(read(PROMPTS_INDEX) + '\n## 33. Production Launch Playbook\n', { fileExists: alwaysExists })
    expect(ids(findings)).toContain('prompts-moved-section')
  })

  it('битая ссылка из таблицы канона — находка', () => {
    const exists = rel => fs.existsSync(path.join(ROOT, rel))
    const { findings } = collectPromptsFindings(read(PROMPTS_INDEX).replace('docs/AGENTS-workflow.md', 'docs/AGENTS-workflaw.md'), { fileExists: exists })
    expect(ids(findings)).toContain('canon-link')
    expect(findings.find(f => f.id === 'canon-link').text).toContain('docs/AGENTS-workflaw.md')
  })

  it('на реальном файле все ссылки таблицы канона существуют', () => {
    const exists = rel => fs.existsSync(path.join(ROOT, rel))
    const { links, findings } = collectPromptsFindings(read(PROMPTS_INDEX), { fileExists: exists })
    const real = links.filter(l => !l.startsWith('test/'))
    expect(real.length).toBeGreaterThan(10)
    expect(real.filter(l => !exists(l))).toEqual([])
    expect(findings).toEqual([])
  })

  it('проверка существования идёт по переданному fileExists, а не по факту', () => {
    const { findings } = collectPromptsFindings(read(PROMPTS_INDEX), { fileExists: () => false })
    expect(ids(findings).filter(id => id === 'canon-link').length).toBeGreaterThan(5)
  })

  it('ссылка на зеркало test/ из MIRROR_FILES не требует существования (его нет в CI)', () => {
    const { findings } = collectPromptsFindings(read(PROMPTS_INDEX), { fileExists: () => false })
    expect(ids(findings).filter(id => id === 'canon-link').length).toBeGreaterThan(5)
    expect(findings.every(f => !f.text.includes('test/ИНВЕНТАРЬ-ТЕСТОВ.md'))).toBe(true)
  })

  it('ссылка на зеркало, которого нет в MIRROR_FILES, — находка (её не проверит никто)', () => {
    const { findings } = collectPromptsFindings(read(PROMPTS_INDEX).replace('test/ИНВЕНТАРЬ-ТЕСТОВ.md', 'test/НОВЫЙ.md'), { fileExists: alwaysExists })
    expect(ids(findings)).toContain('canon-mirror-unknown')
  })

  it('регулярка ссылок ловит кириллицу и .js (регресс на \\w)', () => {
    const found = [...`см. \`test/ИНВЕНТАРЬ-ТЕСТОВ.md\`, \`server/src/index.js\`, \`docs/AGENTS.md\`` .matchAll(FILE_LINK_RE)].map(m => m[1])
    expect(found).toEqual(['test/ИНВЕНТАРЬ-ТЕСТОВ.md', 'server/src/index.js', 'docs/AGENTS.md'])
  })

  it('ссылка без директории тоже проверяется (chats.tsx, а не только src/pages/chats.tsx)', () => {
    const { links } = collectPromptsFindings(read(PROMPTS_INDEX), { fileExists: alwaysExists })
    expect(links).not.toContain('chats.tsx')
    expect(links).toContain('src/pages/chats.tsx')
  })
})

describe('docs/product-roadmap.md — идеи не потеряны', () => {
  it('текущий файл проходит проверки', () => {
    const { findings } = collectRoadmapFindings(read(ROADMAP_FILE))
    expect(findings).toEqual([])
  })

  it('потерянный заголовок раздела — находка с номером', () => {
    const gutted = read(ROADMAP_FILE).split(/\r?\n/).filter(l => !/^## 34\./.test(l)).join('\n')
    const { findings } = collectRoadmapFindings(gutted)
    expect(ids(findings)).toContain('roadmap-missing-section')
    expect(findings.find(f => f.id === 'roadmap-missing-section').text).toContain('34')
  })

  it('вырезанное содержимое раздела — находка (тело раздела, а не только заголовок)', () => {
    const lines = read(ROADMAP_FILE).split(/\r?\n/)
    const from = lines.findIndex(l => /^## 25\./.test(l))
    const to = lines.findIndex((l, i) => i > from && /^## \d{1,2}\.\s/.test(l))
    const gutted = [...lines.slice(0, from + 1), '- пункт', ...lines.slice(to)].join('\n')
    const { findings } = collectRoadmapFindings(gutted)
    expect(ids(findings)).toContain('roadmap-thin-section')
    expect(findings.find(f => f.id === 'roadmap-thin-section').text).toContain('25')
  })

  it('потеря больше половины файла — находка по общему числу непустых строк', () => {
    const half = read(ROADMAP_FILE).split(/\r?\n/).filter((_, i) => i < 200).join('\n')
    const { findings } = collectRoadmapFindings(half)
    expect(ids(findings)).toContain('roadmap-thin-total')
  })

  it('раздел-правило в файле идей — находка', () => {
    const { findings } = collectRoadmapFindings(read(ROADMAP_FILE) + '\n## 3. Аудит связки Админка\n\nтекст\n')
    expect(ids(findings)).toContain('roadmap-rule-section')
  })

  it('все 14 разделов присутствуют и по факту непустые', () => {
    const text = read(ROADMAP_FILE)
    for (const num of MOVED_SECTIONS) {
      expect(new RegExp(`^##\\s+${num}\\.\\s`, 'm').test(text), `раздел ${num}`).toBe(true)
    }
    expect(text.split(/\r?\n/).filter(l => l.trim()).length).toBeGreaterThanOrEqual(ROADMAP_MIN_TOTAL_LINES)
  })
})

describe('запрещённые формулировки в отслеживаемых .md/.txt', () => {
  it('нормативное «adminAuth … passive» — находка', () => {
    const docs = [{ path: 'docs/x.md', text: 'Правило: `adminAuth` middleware остаётся passive и вызывает next().\n' }]
    expect(ids(collectForbiddenFindings(docs))).toContain('admin-auth-passive')
  })

  it('то же в другом регистре и через дефис — тоже находка', () => {
    const docs = [{ path: 'docs/x.md', text: 'adminAuth - passive mode\n' }]
    expect(ids(collectForbiddenFindings(docs))).toContain('admin-auth-passive')
  })

  it('перенос строки между словами НЕ ловится (честная граница регулярки)', () => {
    const docs = [{ path: 'docs/x.md', text: 'adminAuth\nостаётся passive\n' }]
    expect(collectForbiddenFindings(docs)).toEqual([])
  })

  it('журналы с цитатой неверного правила — исключение, гейт зелёный', () => {
    for (const file of FORBIDDEN_EXEMPT_FILES) {
      const docs = [{ path: file, text: 'требовали «`adminAuth` остаётся passive» — исправлено\n' }]
      expect(collectForbiddenFindings(docs), file).toEqual([])
    }
  })

  it('«Zod 4» в любом регистре и с дефисом — находка', () => {
    for (const text of ['| React Hook Form | 7 | + Zod 4 валидация |', 'zod 4 стоит', 'Zod-4 обязателен']) {
      expect(ids(collectForbiddenFindings([{ path: 'project-context.md', text }])), text).toContain('zod-version-claim')
    }
  })

  it('текущие отслеживаемые документы чисты', () => {
    const { docs } = collectTrackedDocs(ROOT)
    expect(collectForbiddenFindings(docs)).toEqual([])
  })

  it('файлы, отсутствующие в дереве, дают skip, а не исключение (чужие удаления в рабочем дереве)', () => {
    const { docs, missing } = collectTrackedDocs(ROOT)
    expect(missing.length).toBeGreaterThan(0)
    expect(docs.every(d => fs.existsSync(path.join(ROOT, d.path)))).toBe(true)
  })
})

describe('context.txt помечен как архивный срез', () => {
  it('текущий файл проходит проверки', () => {
    expect(collectArchiveFindings(read(ARCHIVE_FILE))).toEqual([])
  })

  it('без пометки «ИСТОРИЧЕСКИЙ СРЕЗ» в первых строках — находка', () => {
    const text = read(ARCHIVE_FILE).replace(/^> \*\*ИСТОРИЧЕСКИЙ СРЕЗ/m, '> **Срез')
    expect(ids(collectArchiveFindings(text))).toContain('archive-banner')
  })

  it('пометка ниже шестой строки не считается шапкой', () => {
    const text = Array.from({ length: 8 }, () => '').join('\n') + '\nИСТОРИЧЕСКИЙ СРЕЗ 26.09.2026 project-context.md\n'
    expect(ids(collectArchiveFindings(text))).toContain('archive-banner')
  })

  it('без даты среза — находка', () => {
    const text = read(ARCHIVE_FILE).replace(/26\.09\.2026/g, 'сентябрь')
    expect(ids(collectArchiveFindings(text))).toContain('archive-date')
  })

  it('без ссылки на канон — находка', () => {
    const text = read(ARCHIVE_FILE).replace(/project-context\.md/g, 'README.md')
    expect(ids(collectArchiveFindings(text))).toContain('archive-canon')
  })
})

describe('гейт кого-то зовёт', () => {
  const ok = () => {
    const pkg = JSON.parse(read('package.json'))
    return { pkgJson: pkg, ciYaml: read('.github/workflows/ci.yml'), deployYaml: read('.github/workflows/deploy.yml') }
  }

  it('текущие workflow и package.json проходят', () => {
    expect(collectWiringFindings(ok())).toEqual([])
  })

  it('без скрипта в package.json — находка', () => {
    const { pkgJson, ciYaml, deployYaml } = ok()
    delete pkgJson.scripts[NPM_SCRIPT]
    expect(ids(collectWiringFindings({ pkgJson, ciYaml, deployYaml }))).toContain('wiring-npm')
  })

  it('скрипт есть, но указывает не на гейт — находка', () => {
    const { pkgJson, ciYaml, deployYaml } = ok()
    pkgJson.scripts[NPM_SCRIPT] = 'node scripts/что-то-другое.mjs'
    const f = collectWiringFindings({ pkgJson, ciYaml, deployYaml })
    expect(ids(f)).toContain('wiring-npm-target')
  })

  it('workflow без вызова гейта — находка', () => {
    const { pkgJson, deployYaml } = ok()
    const f = collectWiringFindings({ pkgJson, ciYaml: 'name: CI\njobs:\n  a:\n    steps:\n      - run: npm test\n', deployYaml })
    expect(ids(f)).toContain('wiring-ci')
  })

  it('переименованная джоба в ci.yml — находка (подстрока check:docs осталась бы)', () => {
    const { pkgJson, deployYaml } = ok()
    const f = collectWiringFindings({ pkgJson, ciYaml: read('.github/workflows/ci.yml').replace(/^ {2}docs-canon:$/m, '  docs-canon-off:'), deployYaml })
    expect(ids(f)).toContain('wiring-ci-job')
  })

  it('вызов гейта спрятан в другую джобу ci.yml — находка', () => {
    const { pkgJson, deployYaml } = ok()
    const ci = read('.github/workflows/ci.yml')
      .replace(/^ {2}docs-canon:$/m, '  build:')
      .replace(/\n {6}docs-canon:$/m, '\n  docs-canon:')
    const f = collectWiringFindings({ pkgJson, ciYaml: ci, deployYaml })
    expect(ids(f)).toContain('wiring-ci-job')
  })

  it('continue-on-error в шаге ДО run: (шаг назван через name:) — находка', () => {
    const { pkgJson } = ok()
    const soft = yaml => yaml.replace('      - run: npm run check:docs', '      - name: Docs canon\n        continue-on-error: true\n        run: npm run check:docs')
    const f = collectWiringFindings({ pkgJson, ciYaml: soft(read('.github/workflows/ci.yml')), deployYaml: soft(read('.github/workflows/deploy.yml')) })
    expect(ids(f)).toContain('wiring-ci-step-soft')
    expect(ids(f)).toContain('wiring-deploy-soft')
  })

  it('continue-on-error у постороннего шага внутри джобы гейта не придирается', () => {
    const { pkgJson, deployYaml } = ok()
    const ci = read('.github/workflows/ci.yml').replace('      - run: npm run check:docs', '      - name: Setup\n        continue-on-error: true\n        run: echo setup\n      - run: npm run check:docs')
    expect(collectWiringFindings({ pkgJson, ciYaml: ci, deployYaml })).toEqual([])
  })

  it('continue-on-error ПОСЛЕ run: — тоже находка (ключ YAML может стоять в любом порядке)', () => {
    const { pkgJson, ciYaml } = ok()
    const soft = yaml => yaml.replace('      - run: npm run check:docs', '      - run: npm run check:docs\n        continue-on-error: true')
    const f = collectWiringFindings({ pkgJson, ciYaml, deployYaml: soft(read('.github/workflows/deploy.yml')) })
    expect(ids(f)).toContain('wiring-deploy-soft')
  })

  it('if: false на джобе гейта — находка (джоба есть, но никогда не идёт)', () => {
    const { pkgJson, deployYaml } = ok()
    const ci = read('.github/workflows/ci.yml').replace(/^ {2}docs-canon:$/m, '  docs-canon:\n    if: false')
    const f = collectWiringFindings({ pkgJson, ciYaml: ci, deployYaml })
    expect(ids(f)).toContain('wiring-ci-soft')
  })

  it('continue-on-error у соседнего шага не придирается', () => {
    const yaml = '      - continue-on-error: true\n      - run: npm test\n      - run: npm run check:docs\n'
    expect(getStepBlock(yaml, 'check:docs')).not.toContain('continue-on-error')
    expect(blockAllowsFailure(getStepBlock(yaml, 'check:docs'))).toBe(false)
  })

  it('блок джобы читается по отступу, а не до следующей строки с дефисом', () => {
    const yaml = ['jobs:', '  docs-canon:', '    steps:', '      - run: npm run check:docs', '  other:', '    steps:', '      - run: npm test'].join('\n')
    const job = getJobBlock(yaml, 'docs-canon')
    expect(job).toContain('npm run check:docs')
    expect(job).not.toContain('npm test')
    expect(getJobBlock(yaml, 'нет-такой')).toBeNull()
  })

  it('continue-on-error на уровне джобы и на уровне соседнего шага различаются', () => {
    const jobSoft = ['  docs-canon:', '    continue-on-error: true', '    steps:', '      - run: npm run check:docs'].join('\n')
    const stepSoft = ['  docs-canon:', '    steps:', '      - continue-on-error: true', '        run: npm run check:docs'].join('\n')
    expect(jobAllowsFailure(jobSoft)).toBe(true)
    expect(jobAllowsFailure(stepSoft)).toBe(false)
    expect(blockAllowsFailure(getStepBlock(stepSoft, 'check:docs'))).toBe(true)
  })

  it('npm-скрипт и файл гейта совпадают', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts[NPM_SCRIPT]).toContain(GATE_SCRIPT)
  })
})

describe('интеграция на реальном репозитории', () => {
  it('audit() на текущем дереве — без находок', () => {
    const { findings } = audit(ROOT)
    expect(findings).toEqual([])
  })
})