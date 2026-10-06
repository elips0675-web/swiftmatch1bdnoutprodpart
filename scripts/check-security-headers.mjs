/**
 * Гейт «заголовки безопасности на периметре» (этап 38).
 *
 * API прикрыт `helmet()` (`server/src/index.js:87`), и на этом успокоиться
 * нельзя: helmet ставит заголовки только на **свой** ответ. Статику и
 * `index.html` отдаёт nginx, и если в нём заголовков нет — браузер получает
 * страницу приложения вообще без них. На момент написания гейта так и было:
 * в `nginx/swiftmatch.http.conf` (единственный конфиг, который едет в образ,
 * `Dockerfile:30`) не было ни одного security-заголовка.
 *
 * Четыре проверки, каждая закрывает свою дыру:
 *
 *  1. **Документы получают заголовки.** Проверяются не все `location`, а
 *     только те, что отдают документы (`root`/`try_files` **без**
 *     `proxy_pass`). `/api/` и `/uploads/` исключены сознательно: их
 *     проксирует Express, где заголовки ставит helmet (проверка 3).
 *     `location = /healthz` тоже исключён — это не документ.
 *
 *  2. **Наследование `add_header`.** Директивы `add_header` наследуются с
 *     верхнего уровня **только если на текущем уровне не объявлено ни одной**.
 *     Объявленный в `location /` `add_header Cache-Control` therefore глушит
 *     все security-заголовки `server`-блока — и снаружи это выглядит так,
 *     будто они настроены: в конфиге они есть. Ровно эта ошибка была в
 *     корневом `nginx.conf`, где все три `location` имели свой `add_header`.
 *     Merge-наследования в nginx 1.27 (`add_header_inherit merge`) нет —
 *     появился только в 1.29.3, поэтому в конфигах заголовки повторяются
 *     явно, и повторяемость проверяется.
 *
 *  3. **Прокси не остаётся без покрытия.** Исключение из проверки 1 не должно
 *     превращаться в «на эти location заголовки не нужны»: гейт сверяет, что
 *     `app.use(helmet())` есть и смонтирован **раньше** `express.static`,
 *     иначе `/uploads/` (фотографии пользователей) отдаётся совсем без
 *     заголовков, а гейт об этом молчит.
 *
 *  4. **CSP, который не работает.** `frame-ancestors`, `report-uri` и
 *     `sandbox` браузер **игнорирует** в `<meta http-equiv>`. Директива в
 *     `index.html` выглядит как защита от clickjacking, но не работает — и
 *     именно это написано комментарием в самом `index.html`. Гейт требует
 *     `X-Frame-Options` заголовком и ругается на бесполезные директивы в meta.
 *
 * Плюс к этому: `server_tokens off` (версия nginx в баннере), запрет
 * `X-XSS-Protection: 1; mode=block` (директива внедряла XSS в IE, OWASP
 * рекомендует `0`), `always` на security-заголовках (иначе на 4xx/5xx их нет),
 * HSTS только там, где есть `listen ... ssl` (HSTS на чистом HTTP — это
 * `includeSubDomains` для домена, который ещё не обслуживается по HTTPS), и
 * сверка `vercel.json` — это тоже периметр, отдающий те же заголовки.
 *
 * Блоки, которые только редиректят (`:80` → 301, ни одного `location`), из
 * проверки исключены: документов они не отдают.
 *
 * Проверка 5 — **`Dockerfile` решает, какой конфиг настоящий.** Ровно на этом
 * уже обжигались: `README.md` и `docs/AGENTS-production.md` годами требовали
 * «проверить `nginx.conf`», тогда как в образ едет
 * `nginx/swiftmatch.http.conf`, а корневой файл туда не попадает (питфолл 50).
 * Гейт читает `COPY` из web-стадии и требует, чтобы именно этот файл был
 * среди проверенных, — иначе проверка «зелёная» относится к конфигу, который
 * никто не применяет.
 *
 * Чего гейт не делает: не проверяет CSP по существу (не считает
 * `'unsafe-inline'`/`'unsafe-eval` в `script-src` находкой — это отдельная
 * работа с E2E-прогоном), не знает про CDN перед origin и не открывает сокеты.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Конфиги nginx, которые обязаны быть полными. */
export const NGINX_FILES = ['nginx/swiftmatch.http.conf', 'nginx/swiftmatch.conf', 'nginx.conf']

/**
 * Заголовки, обязательные для любого документа.
 *
 * `X-Frame-Options` — потому что `frame-ancestors` через `<meta>` не работает
 * (проверка 4), а без него страницу можно завернуть в iframe.
 */
export const REQUIRED_HEADERS = [
  { name: 'X-Content-Type-Options', why: 'снижает риск подмены типа ответа (MIME sniffing)', test: (v) => /^nosniff$/i.test(v) },
  { name: 'X-Frame-Options', why: 'защита от clickjacking: frame-ancestors через <meta> не работает', test: (v) => /^(deny|sameorigin)$/i.test(v) },
  {
    name: 'Referrer-Policy',
    why: 'не утекает Referer на сторонние домены',
    // Любая осмысленная политика подходит, кроме unsafe-url: он отдаёт
    // стороннему домену полный URL вместе с query-строкой, где у нас
    // бывают токены и коды восстановления пароля.
    test: (v) => v.trim().length > 0 && !/unsafe-url/i.test(v),
  },
  {
    name: 'Permissions-Policy',
    why: 'явно гасит неиспользуемые браузерные API',
    // `add_header Permissions-Policy ""` проходит проверку «непустое», но не
    // выключает ничего: политика обязана перечислять фичи (`camera=()`).
    test: (v) => /=/.test(v),
  },
]

/** HSTS — только для серверов, которые реально слушают TLS. */
export const HSTS_HEADER = {
  name: 'Strict-Transport-Security',
  why: 'браузер не откатится на HTTP даже после ввода домара руками',
  test: (v) => /max-age\s*=\s*\d+/i.test(v),
}

/** Директивы CSP, которые в `<meta http-equiv>` браузером игнорируются. */
export const META_IGNORED_CSP = ['frame-ancestors', 'report-uri', 'sandbox']

/* ------------------------------------------------------------------ */
/* Разбор конфига nginx                                               */
/* ------------------------------------------------------------------ */

/**
 * Убрать комментарии `#` до конца строки, не трогая `#` внутри кавычек.
 *
 * Регуляркой по всему файлу нельзя: значение заголовка может содержать `#`
 * (например, `default-src 'self' https://site/#/app`), и молчаливое обрезание
 * даст заголовок, которого на сервере нет.
 */
export function stripComments(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return lines
    .map((line) => {
      let quote = null
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]
        if (quote) {
          if (ch === quote) quote = null
          continue
        }
        if (ch === '"' || ch === "'") {
          quote = ch
          continue
        }
        if (ch === '\\') {
          i += 1
          continue
        }
        if (ch === '#') return line.slice(0, i)
      }
      return line
    })
    .join('\n')
}

/**
 * Разбить аргументы директивы на токены, уважая кавычки.
 *
 * Нужно, чтобы отличить `add_header X "SAMEORIGIN" always` от
 * `add_header X "SAMEORIGIN always"` — во втором случае `always` часть
 * значения, и её нельзя выкинуть.
 */
export function tokenizeArgs(args) {
  const tokens = []
  let cur = ''
  let quote = null
  let quoted = false
  const flush = () => {
    if (cur || quoted) tokens.push({ value: cur, quoted })
    cur = ''
    quoted = false
  }
  for (const ch of args) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      quoted = true
      continue
    }
    if (/\s/.test(ch)) {
      flush()
      continue
    }
    cur += ch
  }
  flush()
  return tokens
}

function makeBlock(type, args, line) {
  return { type, args, line, directives: [], children: [] }
}

/**
 * Разобрать конфиг в дерево блоков.
 *
 * Свой парсер, а не регулярка по тексту: нужно знать, в каком блоке объявлена
 * директива и на какой строке — без этого проверка наследования (2) не
 * отличит `add_header` уровня `server` от `add_header` уровня `location`.
 *
 * @param {string} text исходник конфига
 */
export function parseNginx(text) {
  const src = stripComments(text)
  const root = makeBlock('root', '', 0)
  const stack = [root]
  let i = 0
  let line = 1

  while (i < src.length) {
    const ch = src[i]
    if (ch === '\n') {
      line += 1
      i += 1
      continue
    }
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '}') {
      if (stack.length > 1) stack.pop()
      i += 1
      continue
    }
    if (ch === ';') {
      i += 1
      continue
    }

    let name = ''
    while (i < src.length && !/[\s;{]/.test(src[i])) {
      name += src[i]
      i += 1
    }
    const startLine = line
    let args = ''
    let openBrace = false
    let quote = null
    while (i < src.length) {
      const c = src[i]
      if (c === '\n') {
        line += 1
        if (!quote) args += ' '
        i += 1
        continue
      }
      if (quote) {
        args += c
        if (c === quote) quote = null
        i += 1
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        args += c
        i += 1
        continue
      }
      if (c === '\\') {
        args += c + (src[i + 1] ?? '')
        i += 2
        continue
      }
      if (c === ';' || c === '{') {
        openBrace = c === '{'
        i += 1
        break
      }
      args += c
      i += 1
    }

    const parent = stack[stack.length - 1]
    if (openBrace) {
      const block = makeBlock(name, args.trim(), startLine)
      parent.children.push(block)
      stack.push(block)
    } else {
      parent.directives.push({ name, args: args.trim(), line: startLine })
    }
  }

  return root
}

export function collectServers(block, acc = []) {
  for (const child of block.children) {
    if (child.type === 'server') acc.push(child)
    collectServers(child, acc)
  }
  return acc
}

function walkLocations(block, acc = []) {
  for (const child of block.children) {
    if (child.type === 'location') acc.push(child)
    walkLocations(child, acc)
  }
  return acc
}

export function directiveNames(block) {
  return new Set(block.directives.map((d) => d.name))
}

/**
 * `add_header`-ы блока: карта `имя → {name, value, always, line}`.
 * Ключ в карте — имя в нижнем регистре: регистр заголовка не значим, а в
 * конфигах он плавает (`X-Frame-Options` и `x-frame-options` — один заголовок).
 */
export function addHeadersOf(block) {
  const out = new Map()
  for (const d of block.directives) {
    if (d.name !== 'add_header') continue
    const tokens = tokenizeArgs(d.args)
    if (tokens.length < 2) continue
    const last = tokens[tokens.length - 1]
    const always = !last.quoted && last.value.toLowerCase() === 'always'
    const valueTokens = always ? tokens.slice(0, -1) : tokens
    const headerName = valueTokens[0].value
    const value = valueTokens
      .slice(1)
      .map((t) => t.value)
      .join(' ')
    if (!headerName) continue
    out.set(headerName.toLowerCase(), { name: headerName, value, always, line: d.line })
  }
  return out
}

/** Слушает ли сервер TLS: `listen 443 ssl` / `listen 443 ssl http2`. */
export function servesTls(server) {
  return server.directives.some((d) => {
    if (d.name !== 'listen') return false
    const tokens = tokenizeArgs(d.args)
    return tokens.some((t) => !t.quoted && t.value.toLowerCase() === 'ssl')
  })
}

/**
 * location, отдающий документы: есть `root`/`try_files` и нет `proxy_pass`.
 *
 * `/uploads/` и `/api/` отсеиваются `proxy_pass` — их отвечает Express.
 */
export function documentLocations(server) {
  return walkLocations(server).filter((loc) => {
    const names = directiveNames(loc)
    if (names.has('proxy_pass')) return false
    return names.has('root') || names.has('try_files')
  })
}

/**
 * Редирект-only сервер: вообще ни одного `location`, на своём уровне `return`
 * с кодом 3xx/4xx. Такой блок (`:80` → 301 на https) документов не отдаёт, и
 * требовать от него заголовки бессмысленно — он отвечает до того, как до
 * содержимого дойдёт дело.
 */
export function isRedirectOnlyServer(server) {
  if (walkLocations(server).length > 0) return false
  return server.directives.some((d) => {
    if (d.name !== 'return') return false
    const code = /^([1-5]\d\d)\b/.exec(d.args.trim())
    return Boolean(code) && code[1][0] !== '2'
  })
}

/**
 * Действующие заголовки документа.
 *
 * Наследование `add_header` в nginx устроено так: директивы верхнего уровня
 * наследуются, **только если на текущем уровне не объявлено ни одной
 * `add_header`**. Собственный `add_header Cache-Control` в `location /`
 * therefore обнуляет все заголовки `server`-блока целиком.
 */
export function effectiveHeaders(server, location) {
  const own = addHeadersOf(location)
  if (own.size > 0) return { headers: own, inherited: false }
  return { headers: addHeadersOf(server), inherited: true }
}

/* ------------------------------------------------------------------ */
/* Проверка nginx-конфига                                              */
/* ------------------------------------------------------------------ */

/**
 * @param {{file: string, text: string}} input
 * @returns {{problems: string[], facts: object}}
 */
export function auditNginxFile({ file, text }) {
  const root = parseNginx(text)
  const servers = collectServers(root)
  const problems = []
  const facts = { servers: 0, documents: 0, tlsServers: 0 }

  if (!/^\s*server_tokens\s+off\s*;/m.test(text)) {
    problems.push(
      `${file}: нет "server_tokens off" — баннер nginx отдаёт версию сервера. Директива на уровне server в этом файле не наследуется в http-контекст, нужен на верхнем уровне файла.`,
    )
  }

  if (servers.length === 0) {
    problems.push(
      `${file}: в файле нет ни одного server-блока — заголовки проверять не на чем. Если конфиг переехал или это include-фрагмент, добавь его в NGINX_FILES явно.`,
    )
  }

  for (const server of servers) {
    if (isRedirectOnlyServer(server)) continue
    facts.servers += 1
    const tls = servesTls(server)
    if (tls) facts.tlsServers += 1
    const required = tls ? [...REQUIRED_HEADERS, HSTS_HEADER] : REQUIRED_HEADERS

    const locations = documentLocations(server)
    if (locations.length === 0) {
      problems.push(
        `${file}:${server.line}: server-блок не отдаёт ни одного документа (нет location с root/try_files без proxy_pass) — заголовки проверить не на чем.`,
      )
      continue
    }

    for (const location of locations) {
      facts.documents += 1
      const { headers, inherited } = effectiveHeaders(server, location)
      const where = `${file}:${location.line}: location "${location.args}"`

      if (!inherited) {
        const own = [...headers.values()]
          .map((h) => h.name)
          .filter((n) => !['cache-control', 'content-type', 'etag', 'expires', 'last-modified'].includes(n.toLowerCase()))
        if (own.length === 0) {
          problems.push(
            `${where}: блок объявляет свои add_header, поэтому НЕ наследует security-заголовки server-блока (nginx наследует add_header только когда на уровне их нет ни одного), а своих не добавляет — документ отдаётся без защиты.`,
          )
        }
      }

      for (const header of required) {
        const found = headers.get(header.name.toLowerCase())
        if (!found) {
          problems.push(`${where}: нет заголовка ${header.name} — ${header.why}.`)
          continue
        }
        if (!header.test(found.value)) {
          problems.push(
            `${where}: ${header.name} = "${found.value}" — значение не проходит проверку (${header.why}).`,
          )
        }
        if (!found.always) {
          problems.push(
            `${where}: ${header.name} без "always" — на 4xx/5xx nginx не добавит заголовок, и проверка отчёта об ошибке отдаст страницу без него.`,
          )
        }
      }

      const xss = headers.get('x-xss-protection')
      if (xss && xss.value.trim() !== '0') {
        problems.push(
          `${where}: X-XSS-Protection = "${xss.value}" — директива устарела и в старых IE сама вносила XSS; OWASP рекомендует значение 0.`,
        )
      }
    }
  }

  return { problems, facts }
}

/* ------------------------------------------------------------------ */
/* Проверка остальных периметров                                       */
/* ------------------------------------------------------------------ */

/**
 * `vercel.json` — тот же периметр, те же заголовки. Проверяется отдельно от
 * nginx: это другой деплой, и «закрыли nginx» ничего не говорит о нём.
 */
export function auditVercel(text) {
  const problems = []
  let config
  try {
    config = JSON.parse(text)
  } catch (err) {
    return { problems: [`vercel.json: не разбирается как JSON (${err.message})`] }
  }
  const rules = Array.isArray(config.headers) ? config.headers : []
  if (rules.length === 0) {
    return { problems: ['vercel.json: нет ни одного правила headers — деплой отдаёт документы без заголовков.'] }
  }
  const bySource = new Map(rules.map((r) => [r.source, r]))
  const applied = bySource.get('/(.*)')
  const headers = new Map(
    (applied?.headers || []).map((h) => [String(h.key).toLowerCase(), String(h.value)]),
  )
  for (const header of [...REQUIRED_HEADERS, HSTS_HEADER]) {
    const value = headers.get(header.name.toLowerCase())
    if (value === undefined) {
      problems.push(`vercel.json: в правиле для "/(.*)" нет заголовка ${header.name} — ${header.why}.`)
      continue
    }
    if (!header.test(value)) {
      problems.push(`vercel.json: ${header.name} = "${value}" — значение не проходит проверку (${header.why}).`)
    }
  }
  return { problems }
}

/**
 * `index.html`: CSP в `<meta>` не поддерживает часть директив, и такая
 * директива — мёртвый текст, который читается как работающая защита.
 */
export function auditIndexHtml(text) {
  const problems = []
  const meta = /<meta\s[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/i.exec(text)
  if (!meta) return { problems }

  const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(meta[0])
  const value = (content?.[1] ?? content?.[2] ?? '')
    .toLowerCase()
    .replace(/[{};]/g, ' ')

  for (const directive of META_IGNORED_CSP) {
    if (new RegExp(`(?:^|\\s)${directive}\\s`).test(value)) {
      problems.push(
        `index.html: директива "${directive}" в <meta http-equiv="Content-Security-Policy"> браузером игнорируется — она выглядит как защита, но не работает. Её место в HTTP-заголовке.`,
      )
    }
  }
  return { problems }
}

/**
 * Исключение location'ов с `proxy_pass` из проверки 1 оплачивается тем, что
 * Express действительно прикрыт helmet — и не «сначала static, потом helmet».
 */
export function auditHelmetOrder(text) {
  const problems = []
  const lines = text.split('\n')
  const lineOf = (re) => lines.findIndex((l) => re.test(l)) + 1

  const helmet = lineOf(/app\.use\(\s*helmet\s*\(\s*\)/)
  if (helmet === 0) {
    problems.push(
      'server/src/index.js: нет app.use(helmet()) — заголовки на /api и /uploads полностью не выставляются, а гейт nginx их оттуда исключил.',
    )
    return { problems, facts: { helmet: 0, static: 0 } }
  }
  const statics = lines
    .map((l, idx) => ({ line: idx + 1, text: l }))
    .filter((l) => /express\.static\s*\(/.test(l.text))
  for (const s of statics) {
    if (s.line < helmet) {
      problems.push(
        `server/src/index.js:${s.line}: express.static смонтирован раньше helmet (строка ${helmet}) — файлы отдаются без заголовков.`,
      )
    }
  }
  return { problems, facts: { helmet, static: statics.length } }
}

/**
 * `Dockerfile` решает, какой конфиг nginx настоящий.
 *
 * Гейт проверяет все `NGINX_FILES`, но зелёный по второстепенному конфигу —
 * ровно та ошибка, из-за которой `README.md` требовал «проверить `nginx.conf`»,
 * пока в образ ехал `nginx/swiftmatch.http.conf` (питфолл 50). Поэтому
 * отдельно требуется: файл из `COPY` web-стадии обязан быть в списке.
 */
export function auditDockerfile(text, knownFiles) {
  const problems = []
  const copies = [...text.matchAll(/^\s*COPY\s+(.+)$/gim)]
    .map((m) => m[1])
    .filter((args) => args.includes('/etc/nginx/'))
  if (copies.length === 0) {
    problems.push(
      'Dockerfile: не найден ни один COPY в /etc/nginx/ — непонятно, какой конфиг nginx попадает в образ. Разбирать такой гейт не о чем.',
    )
    return { problems, shipped: [] }
  }
  const shipped = []
  for (const args of copies) {
    const tokens = args.split(/\s+/)
    for (const token of tokens) {
      if (!token.includes('nginx')) continue
      if (token.startsWith('/') || token.includes(':')) continue
      shipped.push(token.replace(/\\/g, '/'))
    }
  }
  const unique = [...new Set(shipped)]
  for (const file of unique) {
    if (!knownFiles.includes(file)) {
      problems.push(
        `Dockerfile: в образ копируется "${file}", а гейт этот файл не проверяет — конфиг в контейнере может быть без заголовков, а гейт останется зелёным по остальным файлам.`,
      )
    }
  }
  return { problems, shipped: unique }
}

/* ------------------------------------------------------------------ */
/* Сборка                                                              */
/* ------------------------------------------------------------------ */

export function audit(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
  const problems = []
  const facts = { nginxFiles: 0, documents: 0, tlsServers: 0 }

  const known = []
  for (const file of NGINX_FILES) {
    const full = path.join(root, file)
    if (!fs.existsSync(full)) {
      problems.push(`${file}: файла нет — конфиг удалён или переименован, а гейт на него рассчитывал.`)
      continue
    }
    known.push(file)
    const res = auditNginxFile({ file, text: read(file) })
    problems.push(...res.problems)
    facts.nginxFiles += 1
    facts.documents += res.facts.documents
    facts.tlsServers += res.facts.tlsServers
  }

  const docker = auditDockerfile(read('Dockerfile'), known)
  problems.push(...docker.problems)
  facts.shipped = docker.shipped

  const vercelPath = path.join(root, 'vercel.json')
  if (fs.existsSync(vercelPath)) {
    problems.push(...auditVercel(fs.readFileSync(vercelPath, 'utf8')).problems)
    facts.vercel = true
  }

  problems.push(...auditIndexHtml(read('index.html')).problems)

  const helmet = auditHelmetOrder(read(path.join('server', 'src', 'index.js')))
  problems.push(...helmet.problems)
  facts.helmet = helmet.facts.helmet

  return { facts, problems }
}

function main() {
  const root = process.argv[2] || ROOT
  const { facts, problems } = audit(root)

  console.log(`nginx-конфигов проверено: ${facts.nginxFiles}, документов под заголовками: ${facts.documents} (из них TLS-серверов: ${facts.tlsServers})`)
  console.log(`в образ едет: ${(facts.shipped || []).join(', ') || '(не определено)'}`)
  console.log(`helmet в server/src/index.js: строка ${facts.helmet}${facts.vercel ? '; vercel.json проверен' : ''}`)

  if (problems.length === 0) {
    console.log('\nИтог: документы получают заголовки на всех периметрах, ни один не теряет их из-за наследования add_header.')
    return 0
  }
  console.error('')
  for (const p of problems) console.error(`FAIL: ${p}`)
  console.error(`\nИтог: ${problems.length} расхождений между конфигурацией и тем, что реально уходит клиенту.`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}