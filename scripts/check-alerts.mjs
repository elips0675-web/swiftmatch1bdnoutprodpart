/**
 * Гейт «правила алертинга — настоящий файл, который реально загружается»
 * (этап 48; остаток свода дипсик 15.10.2026).
 *
 * Дыра, которую он закрывает. В `monitoring/` лежали только `prometheus.yml` и
 * дашборды Grafana — а дашборд показывает график, но ничего не сообщает, когда
 * график плохой: нет файла правил, нет алертов. Одного файла тоже мало, и это
 * вторая половина той же дыры: Prometheus читает только то, что перечислено в
 * `rule_files` (`monitoring/prometheus.yml`), а путь из `rule_files` должен быть
 * смонтирован в контейнер (`docker-compose.yml`). Правила, лежащие в репозитории
 * без обоих звеньев, выглядят как оповещения, но молчат.
 *
 * Три проверки:
 *
 *  1. **Файл правил разбирается и полон.** `monitoring/alerts.yml` читается
 *     строгим парсером подмножества YAML (блочные словари и списки, скаляры в
 *     трёх видах, комментарии). Всё, что вне подмножества — flow-стиль, якоря,
 *     многострочные скаляры, `---`, табы — это ошибка, а не молчаливый пропуск:
 *     иначе «не смог разобрать» превращалось бы в зелёный гейт. У каждого
 *     правила обязательны `alert`, `expr`, `for`, `labels.severity` (из
 *     `critical`/`warning`/`info`), `annotations.summary` и `description`, а
 *     имена правил не повторяются. `for` обязателен намеренно: правило без него
 *     срабатывает на первом же всплеске и учит игнорировать алерты.
 *
 *  2. **Метрики в `expr` существуют.** Имя метрики берётся из
 *     `server/src/metrics.js` — из объявлений `new client.<Type>({ name: '<x>'`
 *     (истина лежит в коде, а не в списке внутри гейта). Для гистограмм и сводок
 *     разрешены производные `_bucket`/`_sum`/`_count`, плюс встроенные метрики
 *     Prometheus (`up`, `ALERTS`, `scrape_*`). Опечатка в имени метрики — худший
 *     вид тишины: PromQL не падает, правило просто никогда не срабатывает.
 *
 *  3. **Правила подключены.** `rule_files` обязан перечислять
 *     `/etc/prometheus/alerts.yml`, а `docker-compose.yml` — монтировать туда
 *     `./monitoring/alerts.yml`. Каждый путь из `rule_files` обязан иметь
 *     соответствующий mount.
 *
 * Что гейт **не** проверяет (и не должен выдавать за проверенное): пороги и
 * длительности `for` — это продуктовое решение, а не факт кода; доставку
 * уведомлений (Alertmanager и канал в Telegram/Slack) — это внешняя
 * инфраструктура, она остаётся в списке внешних блокеров; семантику PromQL
 * целиком — только объявленность метрик.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Файл правил: путь в репозитории и путь внутри контейнера Prometheus. */
export const RULES_FILE = 'monitoring/alerts.yml'
export const RULES_MOUNT = '/etc/prometheus/alerts.yml'
export const PROMETHEUS_CONFIG = 'monitoring/prometheus.yml'
export const COMPOSE_FILE = 'docker-compose.yml'
export const METRICS_SOURCE = 'server/src/metrics.js'

/** Уровни важности правила. Вне этого списка — опечатка, а не «свой уровень». */
export const ALLOWED_SEVERITIES = ['critical', 'warning', 'info']

/**
 * Встроенные метрики Prometheus: их не объявляет код приложения, их добавляет
 * сам сервер Prometheus при скрейпе. Список закрыт и не растёт от правок кода.
 */
export const PROMETHEUS_BUILTIN_METRICS = [
  'up',
  'ALERTS',
  'ALERTS_FOR_STATE',
  'scrape_duration_seconds',
  'scrape_samples_scraped',
  'scrape_samples_post_metric_relabeling',
  'scrape_series_added',
]

/** Служебные слова PromQL: не метрики, но встречаются как идентификаторы. */
export const PROMQL_KEYWORDS = [
  'by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'bool',
  'offset', 'and', 'or', 'unless', 'inf', 'nan',
]

/**
 * Убирает комментарий: `#` вне строкового литерала. Экранирование внутри
 * кавычек не поддержано намеренно — в нашем формате его нет, а молча
 * «понять» чужой экранированный `#` гейт не пытается.
 */
export function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '#') return line.slice(0, i)
  }
  return line
}

/** Скаляр: снимает парные кавычки, plain-значение возвращает как есть. */
export function parseScalar(raw) {
  const s = raw.trim()
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1)
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1)
  return s
}

/**
 * Разбирает «ключ: значение». Возвращает `null`, если это не пара — тогда
 * вызывающая сторона решает, скаляр это или ошибка. Ключ обязан быть простым
 * идентификатором: сложные ключи в наших файлах — признак чужого формата.
 * Значение с `:` внутри требует кавычек (`expr: 'a: b'`), иначе первое `: `
 * разорвало бы строку не там.
 */
export function splitKv(text) {
  let cut = text.indexOf(': ')
  if (cut === -1) {
    if (!text.endsWith(':')) return null
    cut = text.length - 1
  }
  const key = text.slice(0, cut).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return null
  return { key, value: parseScalar(text.slice(cut + 1)) }
}

/**
 * Разбор файла правил строго под наш формат (отступы 0/2/4/6/8/10). Любая
 * строка другой формы — ошибка: гейт обязан краснеть на непонятном, а не
 * пропускать правило, которое не смог прочитать.
 */
export function parseRuleFile(text) {
  const errors = []
  const groups = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let group = null
  let rule = null
  let sub = null
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const raw = stripComment(lines[i])
    if (raw.trim() === '') continue
    const indent = raw.length - raw.trimStart().length
    const body = raw.trim()
    const err = (msg) => errors.push(`${lineNo}: ${msg}`)

    if (indent === 0) {
      if (body !== 'groups:') err(`на верхнем уровне ожидалось «groups:», получено «${body}»`)
      group = null
      rule = null
      sub = null
      continue
    }
    if (indent === 2) {
      if (!body.startsWith('- ')) { err(`ожидалось «- name: …», получено «${body}»`); continue }
      const kv = splitKv(body.slice(2))
      if (!kv || kv.key !== 'name') { err(`ожидалось «- name: …», получено «${body}»`); continue }
      if (kv.value === '') { err('группа без имени'); continue }
      group = { name: kv.value, rules: [], line: lineNo }
      groups.push(group)
      rule = null
      sub = null
      continue
    }
    if (indent === 4) {
      if (body !== 'rules:') { err(`ожидалось «rules:», получено «${body}»`); continue }
      if (!group) err('«rules:» вне группы')
      continue
    }
    if (indent === 6) {
      if (!body.startsWith('- ')) { err(`ожидалось «- alert: …», получено «${body}»`); continue }
      const kv = splitKv(body.slice(2))
      if (!kv || kv.key !== 'alert') { err(`ожидалось «- alert: …», получено «${body}»`); continue }
      if (!group) { err(`правило «${kv.value}» вне группы`); continue }
      rule = { alert: kv.value, expr: null, for: null, labels: {}, annotations: {}, line: lineNo }
      group.rules.push(rule)
      sub = null
      continue
    }
    if (indent === 8) {
      const kv = splitKv(body)
      if (!kv) { err(`не пара «ключ: значение»: «${body}»`); continue }
      if (!rule) { err(`поле «${kv.key}» вне правила`); continue }
      if (kv.key === 'labels' || kv.key === 'annotations') {
        if (kv.value !== '') { err(`«${kv.key}:» ожидался вложенный блок`); continue }
        sub = kv.key
        continue
      }
      if (kv.key === 'expr' || kv.key === 'for') {
        rule[kv.key] = kv.value
        sub = null
        continue
      }
      err(`неизвестное поле правила «${kv.key}»`)
      continue
    }
    if (indent === 10) {
      const kv = splitKv(body)
      if (!kv) { err(`не пара «ключ: значение»: «${body}»`); continue }
      if (!rule || !sub) { err(`поле «${kv.key}» вне labels/annotations`); continue }
      rule[sub][kv.key] = kv.value
      continue
    }
    err(`неожиданный отступ ${indent}`)
  }
  return { groups, errors }
}

/** Структурные требования к разобранным правилам. */
export function validateRules(groups) {
  const problems = []
  const names = new Set()
  if (groups.length === 0) problems.push('в файле нет ни одной группы правил')
  for (const g of groups) {
    if (g.rules.length === 0) problems.push(`группа «${g.name}» без правил — имя есть, а правил нет`)
    for (const r of g.rules) {
      const where = `правило «${r.alert || '?'}» (строка ${r.line})`
      if (!r.alert) { problems.push(`${where}: нет имени alert`); continue }
      if (names.has(r.alert)) problems.push(`${where}: имя повторяется`)
      names.add(r.alert)
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(r.alert)) problems.push(`${where}: имя не подходит под ^[A-Za-z][A-Za-z0-9_]*$`)
      if (!r.expr) problems.push(`${where}: нет expr`)
      if (!r.for) problems.push(`${where}: нет for — правило сработает на первом всплеске`)
      const severity = r.labels.severity
      if (!severity) problems.push(`${where}: нет labels.severity`)
      else if (!ALLOWED_SEVERITIES.includes(severity)) {
        problems.push(`${where}: severity «${severity}» вне ${ALLOWED_SEVERITIES.join('/')}`)
      }
      if (!r.annotations.summary) problems.push(`${where}: нет annotations.summary`)
      if (!r.annotations.description) problems.push(`${where}: нет annotations.description`)
    }
  }
  return problems
}

/**
 * Имена метрик, которые встречаются в выражении как ссылки (не функции).
 *
 * Пошагово: убираются строковые литералы (значения меток), содержимое фигурных
 * скобок (метки), группирующие скобки (`by (le)`), длительности (`[5m]`) и
 * числа (`0.95`, `1e9`). Остаются идентификаторы; те, за которыми идёт `(`, —
 * функции, их пропускаем, как и служебные слова PromQL.
 */
export function metricsInExpr(expr) {
  if (typeof expr !== 'string' || expr.trim() === '') return []
  let s = expr
  s = s.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""')
  s = s.replace(/\{[^{}]*\}/g, '')
  s = s.replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^()]*\)/g, '')
  s = s.replace(/\b\d+(?:\.\d+)?(?:ms|s|m|h|d|w|y)\b/g, ' ')
  s = s.replace(/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, ' ')
  const out = []
  const re = /[A-Za-z_:][A-Za-z0-9_:]*/g
  let m
  while ((m = re.exec(s)) !== null) {
    const name = m[0]
    if (/^\s*\(/.test(s.slice(re.lastIndex))) continue
    if (PROMQL_KEYWORDS.includes(name)) continue
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/**
 * Объявленные в коде метрики приложения. Читается источник, а не список внутри
 * гейта: формат `new client.<Type>({` + `name: '<x>'` — тот же, что в
 * `server/src/metrics.js`. Если формат изменится, совпадений станет меньше
 * порога, и гейт скажет об этом прямо, а не позеленеет на пустом множестве.
 */
export function appMetricList(source) {
  const out = []
  const re = /new client\.(Counter|Gauge|Histogram|Summary)\(\{\s*\n\s*name:\s*'([a-z][a-z0-9_]*)'/g
  let m
  while ((m = re.exec(source)) !== null) out.push({ type: m[1].toLowerCase(), name: m[2] })
  return out
}

/** Допустимые имена метрик: объявленные в коде, их производные и встроенные. */
export function allowedMetricNames(appMetrics) {
  const set = new Set(PROMETHEUS_BUILTIN_METRICS)
  for (const metric of appMetrics) {
    set.add(metric.name)
    if (metric.type === 'histogram' || metric.type === 'summary') {
      set.add(`${metric.name}_bucket`)
      set.add(`${metric.name}_sum`)
      set.add(`${metric.name}_count`)
    }
  }
  return set
}

/** Пути из блока `rule_files` в конфиге Prometheus. */
export function ruleFilePaths(text) {
  const out = []
  let inBlock = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const clean = stripComment(line)
    if (/^rule_files:\s*$/.test(clean.trim())) { inBlock = true; continue }
    if (!inBlock) continue
    const item = clean.match(/^\s*-\s*(\S+)\s*$/)
    if (item) { out.push(item[1]); continue }
    if (clean.trim() === '') continue
    inBlock = false
  }
  return out
}

/**
 * Монтирования из docker-compose: `./<repo-путь>:<путь-в-контейнере>` → Map.
 * Именованные тома и хостовые абсолютные пути пропускаются — они не про нас.
 */
export function composeMounts(text) {
  const mounts = new Map()
  const re = /^\s*-\s*\.\/([^\s:]+):(\/[^\s:]+)/gm
  let m
  while ((m = re.exec(text)) !== null) mounts.set(m[1], m[2])
  return mounts
}

/** Все проверки вместе; принимает текст файлов, чтобы быть чистой функцией. */
export function auditAlerts({ ruleText, prometheusText, composeText, metricsSource }) {
  const problems = []
  const { groups, errors } = parseRuleFile(ruleText)
  problems.push(...errors)
  problems.push(...validateRules(groups))

  const appMetrics = appMetricList(metricsSource)
  if (appMetrics.length < 5) {
    problems.push(`${METRICS_SOURCE}: распознано ${appMetrics.length} объявлений метрик — парсер перестал понимать формат «new client.<Type>({ name: '<x>'»`)
  }
  const allowed = allowedMetricNames(appMetrics)
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!rule.expr) continue
      const used = metricsInExpr(rule.expr)
      if (used.length === 0) {
        problems.push(`правило «${rule.alert}»: в expr не найдено ни одной метрики`)
        continue
      }
      for (const name of used) {
        if (!allowed.has(name)) {
          problems.push(`правило «${rule.alert}»: метрика «${name}» не объявлена в ${METRICS_SOURCE} — правило никогда не сработает`)
        }
      }
    }
  }

  const ruleFiles = ruleFilePaths(prometheusText)
  if (!ruleFiles.includes(RULES_MOUNT)) {
    problems.push(`${PROMETHEUS_CONFIG}: rule_files не перечисляет ${RULES_MOUNT} — файл правил лежит, но Prometheus его не читает`)
  }
  const mounts = composeMounts(composeText)
  const targets = new Set(mounts.values())
  for (const target of ruleFiles) {
    if (!targets.has(target)) {
      problems.push(`${COMPOSE_FILE}: путь ${target} из rule_files не смонтирован в контейнер prometheus — Prometheus не найдёт файл`)
    }
  }
  if (mounts.get(RULES_FILE) !== RULES_MOUNT) {
    problems.push(`${COMPOSE_FILE}: нет монтирования ./${RULES_FILE} → ${RULES_MOUNT}`)
  }

  return problems
}

function main() {
  const root = process.argv[2] || ROOT
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

  const problems = []
  for (const rel of [RULES_FILE, PROMETHEUS_CONFIG, COMPOSE_FILE, METRICS_SOURCE]) {
    if (!fs.existsSync(path.join(root, rel))) problems.push(`${rel}: файла нет — гейт на него рассчитывал`)
  }
  if (problems.length > 0) {
    console.error('')
    for (const p of problems) console.error(`FAIL: ${p}`)
    console.error(`\nИтог: ${problems.length} расхождений — правила алертинга проверить нельзя.`)
    return 1
  }

  problems.push(...auditAlerts({
    ruleText: read(RULES_FILE),
    prometheusText: read(PROMETHEUS_CONFIG),
    composeText: read(COMPOSE_FILE),
    metricsSource: read(METRICS_SOURCE),
  }))

  const { groups } = parseRuleFile(read(RULES_FILE))
  const rules = groups.flatMap((g) => g.rules)
  const bySeverity = ALLOWED_SEVERITIES
    .map((s) => `${s}: ${rules.filter((r) => r.labels.severity === s).length}`)
    .join(', ')
  console.log(`групп: ${groups.length}, правил: ${rules.length} (${bySeverity})`)
  console.log(`метрик в ${METRICS_SOURCE}: ${appMetricList(read(METRICS_SOURCE)).length}`)
  console.log(`rule_files: ${ruleFilePaths(read(PROMETHEUS_CONFIG)).join(', ') || '(нет)'}`)

  if (problems.length === 0) {
    console.log('\nИтог: правила алертинга разобраны, метрики объявлены в коде, файл подключён и смонтирован.')
    return 0
  }
  console.error('')
  for (const p of problems) console.error(`FAIL: ${p}`)
  console.error(`\nИтог: ${problems.length} расхождений — алерты не сработают или сработают не на то.`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
