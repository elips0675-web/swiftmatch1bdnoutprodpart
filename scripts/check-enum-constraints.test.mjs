/**
 * Тесты гейта `scripts/check-enum-constraints.mjs` (этап 37, N4).
 *
 * Все проверки идут на temp-фикстурах: гейт читает `database/mysql_schema.sql`
 * и `server/src`, а трогать репозиторий из теста нельзя — иначе «зелёный» тест
 * означал бы, что тест сломал проект. Отдельно проверяется, что гейт зелёный на
 * настоящем репозитории: гейт, который красный на текущем коде, бесполезен,
 * а гейт, который зелёный по построению, — тем более (связь списка с ENUM
 * строится по словам имени, и без проверки на реальном коде легко получить
 * связь со случайной таблицей).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  audit,
  auditNamedLists,
  auditRangeCoverage,
  auditValidatorBounds,
  colMatchesName,
  countCrossFileUsage,
  findCodeRangeValidators,
  findEnumLiteralMismatches,
  findNamedLists,
  findTableMentionLines,
  hasRangeGuard,
  parseSchema,
  singular,
  wordsOf,
} from './check-enum-constraints.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const SCHEMA_HEAD = [
  'CREATE TABLE IF NOT EXISTS `user_profiles` (',
  '  `id` int unsigned NOT NULL AUTO_INCREMENT,',
  '  `age` int DEFAULT NULL,',
  '  `height` int DEFAULT NULL,',
  "  `gender` enum('male','female','other') NOT NULL DEFAULT 'male',",
  '  CONSTRAINT `user_profiles_chk_1` CHECK ((`age` >= 16) and (`age` <= 120)),',
  '  CONSTRAINT `user_profiles_chk_2` CHECK (((`height` >= 100) and (`height` <= 250))),',
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB;',
  '',
  'CREATE TABLE IF NOT EXISTS `partner_offers` (',
  '  `id` int unsigned NOT NULL AUTO_INCREMENT,',
  "  `category` enum('cinema','restaurant') NOT NULL,",
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB;',
  '',
  'CREATE TABLE IF NOT EXISTS `hangout_reviews` (',
  '  `id` int unsigned NOT NULL AUTO_INCREMENT,',
  "  `tag` enum('punctual','fun') DEFAULT NULL,",
  '  CONSTRAINT `hangout_reviews_chk_1` CHECK ((`rating` between 1 and 5)),',
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB;',
  '',
].join('\n')

let dir = null

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enum-gate-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  dir = null
})

function fixture(files = {}) {
  fs.mkdirSync(path.join(dir, 'database'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'server', 'src', 'routes'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'database/mysql_schema.sql'), SCHEMA_HEAD)
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
  }
  return dir
}

describe('parseSchema', () => {
  it('вытаскивает ENUM-колонки с именем таблицы', () => {
    const { enums } = parseSchema(SCHEMA_HEAD)
    expect([...enums.keys()].sort()).toEqual([
      'hangout_reviews.tag',
      'partner_offers.category',
      'user_profiles.gender',
    ])
    expect(enums.get('user_profiles.gender')).toEqual(['male', 'female', 'other'])
  })

  it('вытаскивает диапазон из CHECK с двумя сравнениями', () => {
    const { ranges } = parseSchema(SCHEMA_HEAD)
    const age = ranges.find((r) => r.col === 'age')
    expect(age).toMatchObject({ table: 'user_profiles', min: 16, max: 120 })
    const height = ranges.find((r) => r.col === 'height')
    expect(height).toMatchObject({ table: 'user_profiles', min: 100, max: 250 })
  })

  it('вытаскивает диапазон из CHECK ... BETWEEN', () => {
    const { ranges } = parseSchema(SCHEMA_HEAD)
    expect(ranges.find((r) => r.col === 'rating')).toMatchObject({ table: 'hangout_reviews', min: 1, max: 5 })
  })

  it('CHECK без диапазона (id = 1) диапазоном не считается', () => {
    const schema = [
      'CREATE TABLE `feature_flags` (',
      '  `id` int NOT NULL,',
      "  CONSTRAINT `feature_flags_chk_1` CHECK ((`id` = 1))",
      ') ENGINE=InnoDB;',
    ].join('\n')
    expect(parseSchema(schema).ranges).toEqual([])
  })

  it('CHECK на две разные колонки не превращается в один диапазон', () => {
    const schema = [
      'CREATE TABLE `t` (',
      '  `a` int,',
      '  `b` int,',
      '  CONSTRAINT `t_chk_1` CHECK ((`a` >= 1) and (`b` <= 5))',
      ') ENGINE=InnoDB;',
    ].join('\n')
    expect(parseSchema(schema).ranges).toEqual([])
  })

  it('таблица закрывается на ) ENGINE=, а не только на );', () => {
    const schema = [
      'CREATE TABLE `a` (',
      "  `s` enum('x') NOT NULL,",
      ') ENGINE=InnoDB;',
      'CREATE TABLE `b` (',
      "  `s` enum('y') NOT NULL,",
      ') ENGINE=InnoDB;',
    ].join('\n')
    expect([...parseSchema(schema).enums.keys()]).toEqual(['a.s', 'b.s'])
  })

  it('CRLF-файл читается так же, как LF', () => {
    const { enums, ranges } = parseSchema(SCHEMA_HEAD.replace(/\n/g, '\r\n'))
    expect(enums.size).toBe(3)
    expect(ranges.length).toBe(3)
  })
})

describe('findCodeRangeValidators', () => {
  it('находит границы intField и номер строки', () => {
    const src = "const payload = {\n  age: intField(req.body.age, 'age', { min: 16, max: 120 }),\n}\n"
    expect(findCodeRangeValidators(src, 'a.js')).toEqual([
      { file: 'a.js', col: 'age', min: 16, max: 120, line: 2 },
    ])
  })

  it('валидатор без max или без min не считается диапазоном', () => {
    const src = "intField(x, 'age', { min: 16 })\nintField(y, 'height', { max: 250 })\n"
    expect(findCodeRangeValidators(src, 'a.js')).toEqual([])
  })
})

describe('auditValidatorBounds (код не шире схемы)', () => {
  const ranges = [{ table: 'user_profiles', col: 'age', min: 16, max: 120 }]

  it('валидатор шире CHECK — находка', () => {
    const v = [{ file: 'p.js', line: 10, col: 'age', min: 0, max: 200 }]
    const problems = auditValidatorBounds(v, ranges)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('разрешает 0..200')
    expect(problems[0]).toContain('схема требует 16..120')
  })

  it('валидатор уже CHECK — не находка (лишняя проверка не вредит)', () => {
    const v = [{ file: 'p.js', line: 10, col: 'age', min: 18, max: 100 }]
    expect(auditValidatorBounds(v, ranges)).toEqual([])
  })

  it('валидатор без ограничения в схеме не проверяется', () => {
    const v = [{ file: 'p.js', line: 10, col: 'incognito', min: 0, max: 1 }]
    expect(auditValidatorBounds(v, ranges)).toEqual([])
  })
})

describe('hasRangeGuard', () => {
  it('находит ручную проверку обеих границ в одной строке', () => {
    const src = 'if (parsedRating < 1 || parsedRating > 5) return res.status(400)\n'
    expect(hasRangeGuard(src, { col: 'rating', min: 1, max: 5 })).toBe('ручная проверка')
  })

  it('находит проверку в обратном порядке', () => {
    const src = 'if (x > 5 || x < 1) return bad()\n'
    expect(hasRangeGuard(src, { col: 'rating', min: 1, max: 5 })).toBe('ручная проверка')
  })

  it('находит intField с теми же границами', () => {
    const src = "age: intField(rawAge, 'age', { min: 16, max: 120 }),\n"
    expect(hasRangeGuard(src, { col: 'age', min: 16, max: 120 })).toBe('intField')
  })

  it('intField с другими границами покрытием не считается', () => {
    const src = "age: intField(rawAge, 'age', { min: 0, max: 200 }),\n"
    expect(hasRangeGuard(src, { col: 'age', min: 16, max: 120 })).toBeNull()
  })

  it('одна граница вместо обеих — не покрытие', () => {
    const src = 'if (x > 5) return bad()\n'
    expect(hasRangeGuard(src, { col: 'rating', min: 1, max: 5 })).toBeNull()
  })

  it('границы из другой строки не склеиваются', () => {
    const src = 'if (a > 5) {}\nconst unrelated = 1\nif (b < 1) {}\n'
    expect(hasRangeGuard(src, { col: 'rating', min: 1, max: 5 })).toBeNull()
  })
})

describe('auditRangeCoverage', () => {
  const ranges = [{ table: 'hangout_reviews', col: 'rating', min: 1, max: 5 }]

  it('CHECK без проверки в пишущем файле — находка с именем файла', () => {
    const files = new Map([
      ['server/src/routes/hangouts.js', "await pool.query('INSERT INTO hangout_reviews (rating) VALUES (?)', [r])\n"],
    ])
    const problems = auditRangeCoverage(ranges, files)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('hangout_reviews.rating')
    expect(problems[0]).toContain('server/src/routes/hangouts.js')
  })

  it('покрытая ручной проверкой колонка — не находка', () => {
    const files = new Map([
      ['server/src/routes/hangouts.js', 'if (p < 1 || p > 5) return bad()\nINSERT INTO hangout_reviews (rating) VALUES (?)\n'],
    ])
    expect(auditRangeCoverage(ranges, files)).toEqual([])
  })

  it('таблицу никто не пишет — находки нет', () => {
    const files = new Map([['server/src/routes/hangouts.js', 'SELECT * FROM hangout_reviews\n']])
    expect(auditRangeCoverage(ranges, files)).toEqual([])
  })

  it('файл, который только читает таблицу с CHECK, не обязан проверять диапазон', () => {
    const files = new Map([
      ['server/src/routes/feed.js', 'const rows = await pool.query("SELECT rating FROM hangout_reviews WHERE id = ?", [id])\n'],
    ])
    expect(auditRangeCoverage(ranges, files)).toEqual([])
  })
})

describe('findNamedLists', () => {
  it('берёт список строк', () => {
    const src = "const validTags = ['punctual', 'fun']\n"
    expect(findNamedLists(src, 'a.js')).toEqual([
      { file: 'a.js', name: 'validTags', values: ['punctual', 'fun'], line: 1 },
    ])
  })

  it('массив объектов не является белым списком значений', () => {
    const src = "const TIERS = [{ id: 'plus' }, { id: 'gold' }]\n"
    expect(findNamedLists(src, 'a.js')).toEqual([])
  })

  it('список из одного значения не берётся', () => {
    expect(findNamedLists("const ONLY = ['a']\n", 'a.js')).toEqual([])
  })

  it('смешанный массив (строка + число) не берётся', () => {
    expect(findNamedLists("const MIXED = ['a', 1]\n", 'a.js')).toEqual([])
  })
})

describe('связка списка с колонкой', () => {
  it('wordsOf понимает camelCase, snake_case и склонности', () => {
    expect(wordsOf('validTags')).toContain('tag')
    expect(wordsOf('HANGOUT_CATEGORIES')).toContain('category')
    expect(wordsOf('OFFER_CATEGORIES')).toContain('offer')
  })

  it('colMatchesName ловит имя внутри имени колонки', () => {
    expect(colMatchesName('conversion_type', 'type')).toBe(true)
    expect(colMatchesName('tag', 'validTags')).toBe(true)
    expect(colMatchesName('category', 'HANGOUT_CATEGORIES')).toBe(true)
    expect(colMatchesName('gender', 'OFFER_CATEGORIES')).toBe(false)
  })

  it('singular не ломает слова на «ss»', () => {
    expect(singular('status')).toBe('status')
    expect(singular('address')).toBe('address')
    expect(singular('categories')).toBe('category')
  })

  it('mention берёт и чтение, и запись, а writesOnly — только запись', () => {
    const src = 'SELECT * FROM likes\nINSERT INTO hangout_reviews (tag) VALUES (?)\n'
    expect([...findTableMentionLines(src).keys()].sort()).toEqual(['hangout_reviews', 'likes'])
    expect([...findTableMentionLines(src, { writesOnly: true }).keys()]).toEqual(['hangout_reviews'])
  })
})

describe('auditNamedLists', () => {
  const { enums } = parseSchema(SCHEMA_HEAD)
  const offers = 'server/src/routes/admin/partners.js'

  it('список, которого нет в ENUM связанной таблицы, — находка', () => {
    const text = `const OFFER_CATEGORIES = ['cinema', 'spa', 'bar']\nawait pool.query('UPDATE partner_offers SET category = ?', [OFFER_CATEGORIES[0]])\n`
    const { problems } = auditNamedLists(findNamedLists(text, offers), new Map([[offers, text]]), enums)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('spa|bar')
  })

  it('тот же список, синхронный с ENUM, — не находка', () => {
    const text = `const OFFER_CATEGORIES = ['cinema', 'restaurant']\nawait pool.query('UPDATE partner_offers SET category = ?', [OFFER_CATEGORIES[0]])\n`
    const { problems, linked } = auditNamedLists(findNamedLists(text, offers), new Map([[offers, text]]), enums)
    expect(linked).toHaveLength(1)
    expect(problems).toEqual([])
  })

  it('список с теми же словами, но у другой таблицы, не связывается', () => {
    const text = `const HANGOUT_CATEGORIES = ['cinema', 'restaurant']\nawait pool.query('INSERT INTO hangout_reviews (tag) VALUES (?)', [HANGOUT_CATEGORIES[0]])\n`
    const { problems, linked } = auditNamedLists(findNamedLists(text, 'server/src/routes/hangouts.js'), new Map([['server/src/routes/hangouts.js', text]]), enums)
    expect(linked).toEqual([])
    expect(problems).toEqual([])
  })

  it('список, объявленный и неиспользуемый, — находка', () => {
    const text = `const validTags = ['punctual', 'fun']\nawait pool.query('INSERT INTO hangout_reviews (tag) VALUES (?)', [t])\n`
    const { problems } = auditNamedLists(findNamedLists(text, 'server/src/routes/hangouts.js'), new Map([['server/src/routes/hangouts.js', text]]), enums)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('нигде не используется')
  })

  it('использование из другого файла (экспорт) снимает находку «мёртвый список»', () => {
    const decl = `export const CHANNELS = ['inApp', 'push']\n`
    const consumer = "import { CHANNELS } from './x.js'\nres.json({ channels: CHANNELS })\n"
    const files = new Map([
      ['server/src/notification-prefs.js', decl],
      ['server/src/routes/notifications.js', consumer],
    ])
    const lists = findNamedLists(decl, 'server/src/notification-prefs.js')
    expect(countCrossFileUsage(lists, files).get('CHANNELS')).toBe(2)
    const { problems } = auditNamedLists(lists, files, enums)
    expect(problems).toEqual([])
  })

  it('список, из которого код пишет в ENUM-колонку, связывается и проверяется', () => {
    const text = `const validTags = ['punctual', 'no_show']\nawait pool.query('INSERT INTO hangout_reviews (tag) VALUES (?)', [validTags[0]])\n`
    const { problems, linked } = auditNamedLists(findNamedLists(text, 'server/src/routes/hangouts.js'), new Map([['server/src/routes/hangouts.js', text]]), enums)
    expect(linked).toHaveLength(1)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('no_show')
  })
})

describe('findEnumLiteralMismatches', () => {
  const { enums } = parseSchema(SCHEMA_HEAD)

  it('литерал в INSERT, которого нет в ENUM, — находка', () => {
    const src = "await pool.query(\"INSERT INTO partner_offers (category) VALUES ('bar')\")\n"
    const { rows } = findEnumLiteralMismatches(src, 'a.js', enums)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ table: 'partner_offers', col: 'category', value: 'bar', kind: 'INSERT' })
  })

  it('тот же литерал из ENUM — не находка', () => {
    const src = "await pool.query(\"INSERT INTO partner_offers (category) VALUES ('cinema')\")\n"
    expect(findEnumLiteralMismatches(src, 'a.js', enums).rows).toEqual([])
  })

  it('плейсхолдер не проверяется — значение приходит из кода проверок', () => {
    const src = "await pool.query('INSERT INTO partner_offers (category) VALUES (?)', [c])\n"
    expect(findEnumLiteralMismatches(src, 'a.js', enums).rows).toEqual([])
  })

  it('литерал в UPDATE SET проверяется', () => {
    const src = "await pool.query(\"UPDATE partner_offers SET category = 'nope' WHERE id = ?\", [id])\n"
    const { rows } = findEnumLiteralMismatches(src, 'a.js', enums)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'UPDATE', value: 'nope' })
  })

  it('колонка не ENUM — литерал не проверяется', () => {
    const src = "await pool.query(\"UPDATE partner_offers SET title = 'nope' WHERE id = ?\", [id])\n"
    expect(findEnumLiteralMismatches(src, 'a.js', enums).rows).toEqual([])
  })

  it('INSERT в таблицу без ENUM не даёт находок', () => {
    const src = "await pool.query(\"INSERT INTO users (name) VALUES ('x')\")\n"
    expect(findEnumLiteralMismatches(src, 'a.js', enums).rows).toEqual([])
  })
})

describe('audit на фикстуре', () => {
  it('чистая фикстура даёт ноль находок', () => {
    const root = fixture({
      'server/src/routes/profile.js':
        "const age = intField(rawAge, 'age', { min: 16, max: 120 })\n" +
        "const height = intField(rawHeight, 'height', { min: 100, max: 250 })\n" +
        "await pool.query(\"INSERT INTO user_profiles (gender) VALUES ('male')\")\n",
      'server/src/routes/hangouts.js':
        'if (parsedRating < 1 || parsedRating > 5) return bad()\n' +
        "await pool.query('INSERT INTO hangout_reviews (rating) VALUES (?)', [parsedRating])\n",
    })
    expect(audit(root).problems).toEqual([])
  })

  it('валидатор шире CHECK даёт ровно одну находку и факты считаются', () => {
    const root = fixture({
      'server/src/routes/profile.js': "const height = intField(raw, 'height', { min: 0, max: 250 })\n",
    })
    const { problems, facts } = audit(root)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('height')
    expect(facts.enumColumns).toBe(3)
    expect(facts.rangeChecks).toBe(3)
    expect(facts.validators).toBe(1)
  })

  it('непокрытый CHECK даёт находку', () => {
    const root = fixture({
      'server/src/routes/hangouts.js': "await pool.query('INSERT INTO hangout_reviews (rating) VALUES (?)', [r])\n",
    })
    const problems = audit(root).problems
    expect(problems.some((p) => p.includes('rating') && p.includes('не проверяется кодом'))).toBe(true)
  })

  it('тесты в __tests__ не участвуют: сломанный валидатор там не считается', () => {
    const root = fixture({
      'server/src/__tests__/profile.test.js': "intField(x, 'height', { min: 0, max: 9999 })\n",
    })
    expect(audit(root).problems).toEqual([])
  })
})

describe('audit на настоящем репозитории', () => {
  it('код репозитория не имеет расхождений со схемой', () => {
    const { problems, facts } = audit(REPO_ROOT)
    expect(problems).toEqual([])
    expect(facts.enumColumns).toBeGreaterThan(30)
    expect(facts.rangeChecks).toBeGreaterThanOrEqual(3)
    expect(facts.validators).toBeGreaterThan(0)
    expect(facts.linkedLists).toBeGreaterThan(0)
  })
})
