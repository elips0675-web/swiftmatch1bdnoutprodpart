import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseUniqueIndex,
  collectJsFiles,
  findOrderByIssues,
} from '../../../scripts/order-by-audit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SRC = path.join(ROOT, 'server', 'src')
const schema = fs.readFileSync(path.join(ROOT, 'database', 'mysql_schema.sql'), 'utf8')

/**
 * Гейт ищет SQL внутри строковых литералов, поэтому «голый» SQL в файл
 * записать нельзя: он не найдётся, и тест с ожиданием 0 пройдёт вхолостую.
 * auditSql оборачивает запрос так, как он выглядит в коде; auditSource
 * принимает произвольный исходник — для проверок на не-SQL литералы.
 */
function auditSource(source, name = 'probe.js') {
  const dir = fs.mkdtempSync(path.join(ROOT, '.orderby-probe-'))
  try {
    fs.writeFileSync(path.join(dir, name), source, 'utf8')
    return findOrderByIssues(schema, [path.join(dir, name)])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function auditSql(sql) {
  return auditSource(`const rows = await pool.query(\n  \`${sql}\`,\n  [a, b],\n)\n`)
}

describe('order-by-audit: разбор схемы', () => {
  const scope = parseUniqueIndex(schema)

  it('находит PRIMARY KEY и UNIQUE-ключи', () => {
    expect(scope.pk.get('users')).toEqual(['id'])
    expect(scope.unique.get('users')).toContain('email')
    expect(scope.globalUnique.has('id')).toBe(true)
  })

  it('собирает все колонки таблицы — они нужны для проверки неоднозначности', () => {
    expect(scope.all.get('user_photos')).toContain('id')
    expect(scope.all.get('user_photos')).toContain('created_at')
    expect(scope.all.get('user_profiles')).toContain('id')
  })

  it('пропускает __tests__ и node_modules при обходе', () => {
    const files = collectJsFiles(SRC).map(f => f.replace(/\\/g, '/'))
    expect(files.some(f => f.includes('/__tests__/'))).toBe(false)
    expect(files.length).toBeGreaterThan(20)
  })
})

describe('order-by-audit: ловит недетерминированную пагинацию', () => {
  it('ORDER BY по неуникальному столбцу с LIMIT — дефект', () => {
    const issues = auditSource(
      "const r = await pool.query('SELECT id, title FROM hangouts WHERE status = ? ORDER BY created_at DESC LIMIT ?', [s, l])",
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('нет уникального замыкателя')
  })

  it('тот же запрос с замыкателем по PK — чисто', () => {
    const issues = auditSql(
      'SELECT id, title FROM hangouts WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    expect(issues).toHaveLength(0)
  })

  it('замыкатель по имени колонки, а не по позиции: префикс обязателен, но термин может быть сложным', () => {
    // `(CASE WHEN x THEN 1 ELSE 0 END), id` — последний термин id, первый
    // содержит скобки и запятую, поэтому сплиттер по глубине обязан уцелеть.
    const issues = auditSql(
      'SELECT h.id FROM hangouts h ORDER BY (CASE WHEN h.boosted = 1 THEN 0 ELSE 1 END), id DESC LIMIT ?',
    )
    expect(issues).toHaveLength(0)
  })

  it('замыкатель с префиксом чужой таблицы не проходит: id из JOIN не делает строку уникальной', () => {
    // Термин оканчивается на `up.id`, но ORDER BY сортирует по id профиля —
    // по строке hangouts это не замыкатель. Гейт должен ругаться.
    const issues = auditSql(
      'SELECT h.id, up.display_name FROM hangouts h JOIN user_profiles up ON up.id = h.user_id ORDER BY h.created_at DESC, up.id DESC LIMIT ?',
    )
    expect(issues).toHaveLength(1)
  })

  it('составной ORDER BY проверяет последний термин, а не первый', () => {
    const withLast = auditSql(
      'SELECT h.id FROM hangouts h ORDER BY (h.boosted = 1) DESC, h.event_date ASC, h.id ASC LIMIT ?',
    )
    expect(withLast).toHaveLength(0)
    const withFirstOnly = auditSql(
      'SELECT h.id FROM hangouts h ORDER BY h.id ASC, h.event_date ASC LIMIT ?',
    )
    expect(withFirstOnly).toHaveLength(1)
  })

  it('уникальный столбец не из PRIMARY KEY тоже закрывает пагинацию', () => {
    const issues = auditSql(
      "SELECT id, email FROM users WHERE role = ? ORDER BY created_at DESC, email DESC LIMIT ?",
    )
    expect(issues).toHaveLength(0)
  })

  it('без LIMIT не ругается: там страниц нет, порядок только «дёргается»', () => {
    const issues = auditSql('SELECT id, title FROM hangouts ORDER BY created_at DESC')
    expect(issues).toHaveLength(0)
  })
})

describe('order-by-audit: не ложит на агрегаты', () => {
  it('ORDER BY по ключу GROUP BY — пропуск, строк там нет', () => {
    const issues = auditSql(
      'SELECT DATE(created_at) as day, COUNT(*) as total FROM users GROUP BY day ORDER BY day LIMIT 30',
    )
    expect(issues).toHaveLength(0)
  })

  it('ORDER BY по колонке, которой нет среди ключей GROUP BY, — дефект', () => {
    // Сортировка по city, который стоит в GROUP BY, но не объявлен алиасом
    // через AS. Именно этот вид ловит правило «ключ GROUP BY»: правило
    // «алиас SELECT» тут не срабатывает, так что снятие первого не
    // остаётся незамеченным за счёт второго.
    const issues = auditSql(
      'SELECT city, COUNT(*) as n FROM user_profiles GROUP BY city ORDER BY city DESC LIMIT 10',
    )
    expect(issues).toHaveLength(0)
  })

  it('ORDER BY по агрегату через алиас — пропуск', () => {
    const issues = auditSql(
      'SELECT city as name, COUNT(*) as value FROM user_profiles GROUP BY city ORDER BY value DESC LIMIT 10',
    )
    expect(issues).toHaveLength(0)
  })

  it('ORDER BY с вызовом агрегата в терме — пропуск', () => {
    const issues = auditSql(
      'SELECT city, COUNT(*) as n FROM user_profiles GROUP BY city ORDER BY COUNT(id) DESC LIMIT 10',
    )
    expect(issues).toHaveLength(0)
  })

  it('ORDER BY с вызовом агрегата, у которого за термом нет столбца-идентификатора', () => {
    // MAX(title) — последнее слово не резолвится в PK, пропуск держится
    // только на правиле «последний термин — агрегат».
    const issues = auditSql(
      'SELECT city, MAX(title) as top_title FROM hangouts GROUP BY city ORDER BY MAX(title) DESC LIMIT 10',
    )
    expect(issues).toHaveLength(0)
  })
})

describe('order-by-audit: неоднозначный столбец', () => {
  it('непрефиксованный id при двух таблицах в FROM — 500 в рантайме', () => {
    const issues = auditSql(
      'SELECT p.id, up.display_name FROM user_photos p JOIN user_profiles up ON up.id = p.user_id ORDER BY p.created_at DESC, id DESC LIMIT ?',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('неоднозначный столбец «id»')
    expect(issues[0].reason).toContain('user_photos')
  })

  it('с префиксом той же таблицы — чисто', () => {
    const issues = auditSql(
      'SELECT p.id FROM user_photos p JOIN user_profiles up ON up.id = p.user_id ORDER BY p.created_at DESC, p.id DESC LIMIT ?',
    )
    expect(issues).toHaveLength(0)
  })

  it('при интерполированном FROM столбец без префикса непроверяем — гейт говорит об этом, а не молчит', () => {
    const issues = auditSource(
      'const sql = `SELECT ${cols} ${fromClause} WHERE x = ? ORDER BY created_at DESC, id DESC LIMIT ?`',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('интерполяцией')
  })

  it('при интерполированном FROM замыкатель всё равно должен быть уникальным — иначе пропуск', () => {
    // Раз FROM не резолвится, гейт сверяет имя столбца по всей схеме. `id` есть
    // почти везде и проходит, а `created_at` не уникален ни в одной таблице —
    // такой замыкатель не спасает от дублей между страницами.
    const issues = auditSource(
      'const sql = `SELECT ${cols} ${fromClause} WHERE x = ? ORDER BY up.id DESC, up.created_at DESC LIMIT ?`',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('нет уникального замыкателя')
  })
})

describe('order-by-audit: динамическая сортировка', () => {
  it('ORDER BY целиком из переменной без замыкателя — дефект', () => {
    const issues = auditSource('const sql = `SELECT id FROM users ORDER BY ${sortCol} LIMIT 20`')
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('динамический')
  })

  it('динамический столбец + явный замыкатель — чисто', () => {
    const issues = auditSource('const sql = `SELECT u.id FROM users u ORDER BY ${sortCol} ${sortDir}, u.id ${sortDir} LIMIT 20`')
    expect(issues).toHaveLength(0)
  })
})

describe('order-by-audit: главная таблица задаёт строку результата', () => {
  it('замыкатель на PK присоединённой таблицы не проходит: две строки главной дадут один id', () => {
    // ORDER BY по id профиля формально уникален, но несколько hangouts одного
    // пользователя дадут одинаковый up.id — между страницами поедут дубли.
    const issues = auditSql(
      'SELECT h.id, up.display_name FROM hangouts h JOIN user_profiles up ON up.id = h.user_id ORDER BY h.created_at DESC, up.id DESC LIMIT ?',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('нет уникального замыкателя')
  })

  it('скалярный подзапрос в SELECT не делается главной таблицей', () => {
    // FROM стоит после COALESCE((SELECT s.tier FROM subscriptions s ...)).
    // Если бы главной считалась subscriptions, замыкатель u.id отвергся бы
    // как «не её столбец» — то есть гейт врал бы на корректном запросе.
    const issues = auditSql(
      "SELECT u.id, COALESCE((SELECT s.tier FROM subscriptions s WHERE s.user_id = u.id), 'free') as tier FROM users u ORDER BY u.created_at DESC, u.id DESC LIMIT 20",
    )
    expect(issues).toHaveLength(0)
  })

  it('подзапрос в списке полей не создаёт ложной неоднозначности id', () => {
    const issues = auditSql(
      'SELECT u.id, (SELECT COUNT(*) FROM hangouts h WHERE h.user_id = u.id) as n FROM users u ORDER BY u.created_at DESC, u.id DESC LIMIT 20',
    )
    expect(issues).toHaveLength(0)
  })

  it('составной PK главной таблицы закрывается только обоими столбцами', () => {
    // hangout_chats: PRIMARY KEY (hangout_id, response_id). Один столбец PK
    // строку не различает, поэтому нужен хвост из обоих.
    const partial = auditSql(
      'SELECT hc.chat_id FROM hangout_chats hc JOIN hangouts h ON h.id = hc.hangout_id WHERE hc.chat_id = ? ORDER BY h.created_at DESC, hc.hangout_id ASC LIMIT 1',
    )
    expect(partial).toHaveLength(1)
    expect(partial[0].reason).toContain('нет уникального замыкателя')
  })

  it('составной PK, покрытый хвостом терминов, — чисто', () => {
    const issues = auditSql(
      'SELECT hc.chat_id FROM hangout_chats hc JOIN hangouts h ON h.id = hc.hangout_id WHERE hc.chat_id = ? ORDER BY h.created_at DESC, h.id DESC, hc.hangout_id ASC, hc.response_id ASC LIMIT 1',
    )
    expect(issues).toHaveLength(0)
  })
})

describe('order-by-audit: не берёт не-SQL за запрос', () => {
  it('regex-литерал с кавычками и слешем не считается SQL', () => {
    const issues = auditSource('if (/[<>"\'`;\\\\]/.test(v)) return bad("SELECT 1 FROM x ORDER BY y")')
    expect(issues).toHaveLength(0)
  })

  it('а вот настоящий SELECT с кавычками внутри — находится', () => {
    const issues = auditSource("const q = `SELECT id FROM hangouts WHERE status = 'active' ORDER BY created_at DESC LIMIT 5`")
    expect(issues).toHaveLength(1)
  })
})

describe('order-by-audit: текущий код проекта чист', () => {
  it('ни одного пагинируемого ORDER BY без замыкателя', () => {
    const issues = findOrderByIssues(schema, collectJsFiles(SRC))
    const detail = issues.map(i => `${i.file}:${i.line} ${i.reason}`).join('; ')
    expect(issues, detail).toHaveLength(0)
  })

  it('проверено не меньше 25 мест — гейт не «молчит потому что ничего не нашёл»', () => {
    const files = collectJsFiles(SRC)
    const all = files.flatMap(f => {
      const src = fs.readFileSync(f, 'utf8')
      return [...src.matchAll(/ORDER\s+BY[\s\S]{0,200}?LIMIT/gi)]
    })
    expect(all.length).toBeGreaterThanOrEqual(25)
  })
})
