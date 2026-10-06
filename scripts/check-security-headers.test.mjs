/**
 * Тесты гейта `scripts/check-security-headers.mjs` (этап 38).
 *
 * Проверки идут на temp-фикстурах: гейт читает реальные `nginx/*.conf`,
 * `Dockerfile`, `index.html` и `server/src/index.js`, а трогать репозиторий
 * из теста нельзя — иначе «зелёный» тест означал бы, что тест сломал прод.
 *
 * Отдельно проверяется, что гейт зелёный на настоящем репозитории. Гейт,
 * который красный на текущем коде, бесполезен; гейт, который зелёный по
 * построению (например, всегда возвращает 0), — тем более: именно его мы и
 * закрываем, а «проверка формы» вместо самой проверки — известный класс
 * бесполезного теста.
 *
 * Отдельно проверяется и обратное: каждый набор заголовков, который гейт
 * считает достаточным, обязан быть отвергнут, если из него убрать любой
 * заголовок. Иначе достаточно одного заголовка на все случаи, а REQUIRED
 * превращается в декорацию.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  REQUIRED_HEADERS,
  HSTS_HEADER,
  NGINX_FILES,
  addHeadersOf,
  audit,
  auditDockerfile,
  auditHelmetOrder,
  auditIndexHtml,
  auditNginxFile,
  auditVercel,
  documentLocations,
  effectiveHeaders,
  isRedirectOnlyServer,
  parseNginx,
  servesTls,
  stripComments,
  tokenizeArgs,
} from './check-security-headers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SEC = [
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header X-Frame-Options "SAMEORIGIN" always;',
  'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
  'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
].join('\n  ')

const HSTS = 'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;'

/**
 * Минимальный конфиг: заголовки на уровне server, документ отдаётся
 * `location /` без своего `add_header` — то есть наследует их.
 */
function conf({ locationBody = '', serverExtra = '', listen = 'listen 80;', withSecurity = true } = {}) {
  return `server {
  ${listen}
  server_name _;
  root /usr/share/nginx/html;
  ${withSecurity ? SEC : ''}
  ${serverExtra}
  location / {
    index index.html;
    try_files $uri $uri/ /index.html;
    ${locationBody}
  }
}
`
}

let tmp

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-headers-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/**
 * Копия файлов репозитория во временный каталог.
 *
 * `path.join` с абсолютным вторым аргументом на Windows даёт
 * `C:\tmp\tmp\repo\C:\tmp\tmp\repo` — отсюда `mkdir` с `ENOENT`. Путь
 * приводится к относительному явно.
 */
function copyRepoFiles(dest) {
  for (const rel of ['Dockerfile', 'index.html', 'vercel.json', ...NGINX_FILES, 'server/src/index.js']) {
    const target = path.join(dest, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  }
  return dest
}

/* ------------------------------------------------------------------ */

describe('разбор конфига nginx', () => {
  it('убирает комментарий, но не трогает # внутри кавычек', () => {
    const text = [
      'server {',
      '  add_header Content-Security-Policy "default-src \'self\' https://site/#/app";',
      '  # это комментарий',
      '}',
    ].join('\n')
    const out = stripComments(text)
    expect(out).toContain('https://site/#/app')
    expect(out).not.toContain('это комментарий')
  })

  it('различает always как флаг и always внутри значения', () => {
    expect(tokenizeArgs('X "v" always').at(-1)).toEqual({ value: 'always', quoted: false })
    expect(tokenizeArgs('X "v always"').at(-1)).toEqual({ value: 'v always', quoted: true })

    const block = parseNginx('server {\n  add_header X "v" always;\n  add_header Y "v always";\n}')
    const headers = addHeadersOf(block.children[0])
    expect(headers.get('x')).toMatchObject({ value: 'v', always: true })
    expect(headers.get('y')).toMatchObject({ value: 'v always', always: false })
  })

  it('помнит номер строки директивы', () => {
    const block = parseNginx('server {\n\n  add_header X "v" always;\n}')
    expect(addHeadersOf(block.children[0]).get('x').line).toBe(3)
  })

  it('видит ssl в listen и различает его с http2', () => {
    const block = parseNginx('server {\n  listen 443 ssl http2;\n}')
    expect(servesTls(block.children[0])).toBe(true)
    const block2 = parseNginx('server {\n  listen 80;\n}')
    expect(servesTls(block2.children[0])).toBe(false)
  })

  it('не путает upstream-блок с server-блоком', () => {
    const block = parseNginx('upstream api {\n  server app:3002;\n  keepalive 64;\n}\nserver {\n  listen 80;\n}\n')
    expect(block.children.map((c) => c.type)).toEqual(['upstream', 'server'])
  })
})

/* ------------------------------------------------------------------ */

describe('наследование add_header', () => {
  it('location без своего add_header наследует server-блок', () => {
    const block = parseNginx(conf({}))
    const server = block.children[0]
    const { headers, inherited } = effectiveHeaders(server, documentLocations(server)[0])
    expect(inherited).toBe(true)
    expect(headers.get('x-frame-options').value).toBe('SAMEORIGIN')
  })

  it('свой add_header в location обнуляет ВСЕ server-заголовки, а не только добавляет', () => {
    // Это поведение nginx, а не опечатка гейта: если бы гейт наследовал
    // «поверх», он бы проверял конфиг, которого не существует.
    const block = parseNginx(conf({ locationBody: 'add_header Cache-Control "no-store" always;' }))
    const server = block.children[0]
    const { headers, inherited } = effectiveHeaders(server, documentLocations(server)[0])
    expect(inherited).toBe(false)
    expect(headers.size).toBe(1)
    expect(headers.has('x-frame-options')).toBe(false)
  })

  it('отбирает только location, отдающие документы', () => {
    const block = parseNginx(`server {
  listen 80;
  location / {
    try_files $uri /index.html;
  }
  location /assets/ {
    try_files $uri =404;
  }
  location /api/ {
    proxy_pass http://api;
  }
  location = /healthz {
    return 200 'ok';
  }
}`)
    expect(documentLocations(block.children[0]).map((l) => l.args)).toEqual(['/', '/assets/'])
  })

  it('узнаёт редирект-only сервер и не требует от него заголовков', () => {
    const redirect = parseNginx('server {\n  listen 80;\n  return 301 https://$host$request_uri;\n}')
    expect(isRedirectOnlyServer(redirect.children[0])).toBe(true)
    const real = parseNginx('server {\n  listen 80;\n  return 200 "ok";\n}')
    expect(isRedirectOnlyServer(real.children[0])).toBe(false)
  })
})

/* ------------------------------------------------------------------ */

describe('проверка nginx-конфига', () => {
  it('на полном наборе с server_tokens — ни одной находки', () => {
    expect(auditNginxFile({ file: 'x.conf', text: `server_tokens off;\n${conf({})}` }).problems).toEqual([])
  })

  it('без server_tokens ровно одна находка, и именно про server_tokens', () => {
    const { problems } = auditNginxFile({ file: 'x.conf', text: conf({}) })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('server_tokens')
  })

  it('ловит server_tokens on, а не только отсутствие директивы', () => {
    const { problems } = auditNginxFile({ file: 'x.conf', text: `server_tokens on;\n${conf({})}` })
    expect(problems.some((p) => p.includes('server_tokens'))).toBe(true)
  })

  it('ловит потерю заголовков из-за своего add_header в location', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /usr/share/nginx/html;
  ${SEC}
  location / {
    try_files $uri /index.html;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
  }
}
`
    const { problems } = auditNginxFile({ file: 'x.conf', text })
    const mentions = problems.filter((p) => p.includes('НЕ наследует'))
    expect(mentions).toHaveLength(1)
    for (const header of REQUIRED_HEADERS) {
      expect(problems.some((p) => p.includes(`нет заголовка ${header.name}`))).toBe(true)
    }
  })

  it('не считает /api/ и /uploads/ документами: их отвечает Express с helmet', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /usr/share/nginx/html;
  ${SEC}
  location / {
    try_files $uri /index.html;
  }
  location /api/ {
    proxy_pass http://api;
  }
  location /uploads/ {
    proxy_pass http://api;
  }
}
`
    const { problems } = auditNginxFile({ file: 'x.conf', text })
    expect(problems).toHaveLength(0)
  })

  it('требует HSTS только на сервере с listen ... ssl', () => {
    const tls = auditNginxFile({
      file: 'x.conf',
      text: `server_tokens off;\nserver {\n  listen 443 ssl;\n  root /html;\n  ${SEC}\n  location / {\n    try_files $uri /index.html;\n  }\n}\n`,
    })
    expect(tls.problems.some((p) => p.includes(HSTS_HEADER.name))).toBe(true)

    const tlsWith = auditNginxFile({
      file: 'x.conf',
      text: `server_tokens off;\nserver {\n  listen 443 ssl;\n  root /html;\n  ${SEC}\n  ${HSTS}\n  location / {\n    try_files $uri /index.html;\n  }\n}\n`,
    })
    expect(tlsWith.problems).toHaveLength(0)

    const plain = auditNginxFile({ file: 'x.conf', text: `server_tokens off;\n${conf({})}` })
    expect(plain.problems.some((p) => p.includes(HSTS_HEADER.name))).toBe(false)
  })

  it('требует always: без него заголовка нет на 4xx/5xx', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /html;
  add_header X-Content-Type-Options "nosniff";
  add_header X-Frame-Options "SAMEORIGIN";
  add_header Referrer-Policy "strict-origin-when-cross-origin";
  add_header Permissions-Policy "camera=()" ;
  location / { try_files $uri /index.html; }
}
`
    const { problems } = auditNginxFile({ file: 'x.conf', text })
    const withoutAlways = problems.filter((p) => p.includes('без "always"'))
    expect(withoutAlways).toHaveLength(REQUIRED_HEADERS.length)
  })

  it('ловит неверное значение nosniff', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /html;
  ${SEC}
  add_header X-Content-Type-Options "sniff" always;
  location / { try_files $uri /index.html; }
}
`
    const { problems } = auditNginxFile({ file: 'x.conf', text })
    expect(problems.some((p) => p.includes('X-Content-Type-Options = "sniff"'))).toBe(true)
  })

  it('ловит устаревшую X-XSS-Protection: 1; mode=block', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /html;
  ${SEC}
  add_header X-XSS-Protection "1; mode=block" always;
  location / { try_files $uri /index.html; }
}
`
    const { problems } = auditNginxFile({ file: 'x.conf', text })
    expect(problems.some((p) => p.includes('X-XSS-Protection'))).toBe(true)
  })

  it('принимает X-XSS-Protection: 0', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /html;
  ${SEC}
  add_header X-XSS-Protection "0" always;
  location / { try_files $uri /index.html; }
}
`
    expect(auditNginxFile({ file: 'x.conf', text }).problems).toHaveLength(0)
  })

  it('по именам заголовков не зависит от регистра', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /html;
  add_header x-content-type-options "nosniff" always;
  add_header X-FRAME-OPTIONS "DENY" always;
  add_header referrer-policy "no-referrer" always;
  add_header PERMISSIONS-POLICY "camera=()" always;
  location / { try_files $uri /index.html; }
}
`
    expect(auditNginxFile({ file: 'x.conf', text }).problems).toHaveLength(0)
  })

  it('минус любой один заголовок из REQUIRED_HEADERS — находка', () => {
    // Если бы гейт проверял «хоть что-то одно», лишние строки в REQUIRED были
    // бы декорацией. Минус по очереди: это доказывает, что список читается
    // целиком, а не по первому совпадению.
    for (const header of REQUIRED_HEADERS) {
      const text = `server_tokens off;
server {
  listen 80;
  root /html;
  ${SEC}
  location / { try_files $uri /index.html; }
}
`
      const broken = text
        .split('\n')
        .filter((l) => !l.includes(`add_header ${header.name} `))
        .join('\n')
      expect(broken).not.toBe(text)
      const { problems } = auditNginxFile({ file: 'x.conf', text: broken })
      expect(problems.some((p) => p.includes(`нет заголовка ${header.name}`))).toBe(true)
    }
  })

  it('минус HSTS на TLS-сервере — находка', () => {
    const text = `server_tokens off;
server {
  listen 443 ssl;
  root /html;
  ${SEC}
  location / { try_files $uri /index.html; }
}
`
    expect(auditNginxFile({ file: 'x.conf', text }).problems.some((p) => p.includes('нет заголовка Strict-Transport-Security'))).toBe(true)
  })

  it('ловит Referrer-Policy: unsafe-url — он отдаёт полный URL с токенами', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /html;
  ${SEC}
  add_header Referrer-Policy "unsafe-url" always;
  location / { try_files $uri /index.html; }
}
`
    expect(auditNginxFile({ file: 'x.conf', text }).problems.some((p) => p.includes('unsafe-url'))).toBe(true)
  })

  it('ловит пустую Permissions-Policy: она не выключает ничего', () => {
    const text = `server_tokens off;
server {
  listen 80;
  root /html;
  ${SEC}
  add_header Permissions-Policy "strict" always;
  location / { try_files $uri /index.html; }
}
`
    expect(auditNginxFile({ file: 'x.conf', text }).problems.some((p) => p.includes('Permissions-Policy'))).toBe(true)
  })

  it('server без location с документом — это находка, а не тишина', () => {
    const { problems } = auditNginxFile({
      file: 'x.conf',
      text: `server_tokens off;\nserver {\n  listen 80;\n  location /api/ {\n    proxy_pass http://api;\n  }\n}\n`,
    })
    expect(problems.some((p) => p.includes('не отдаёт ни одного документа'))).toBe(true)
  })

  it('файл без server_blocks — это находка, а не зелёный пустой обход', () => {
    const { problems } = auditNginxFile({ file: 'x.conf', text: 'server_tokens off;\nlimit_req_zone $x zone=z:1m rate=1r/s;\n' })
    expect(problems.some((p) => p.includes('нет ни одного server-блока'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

describe('проверка vercel.json', () => {
  it('зелёный на полном наборе', () => {
    const values = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=()',
    }
    const json = JSON.stringify({
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
            ...REQUIRED_HEADERS.map((h) => ({ key: h.name, value: values[h.name] })),
          ],
        },
      ],
    })
    expect(auditVercel(json).problems).toHaveLength(0)
  })

  it('ловит Permissions-Policy без перечисления фич — такая политика ничего не гасит', () => {
    const json = JSON.stringify({
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'Referrer-Policy', value: 'no-referrer' },
            { key: 'Permissions-Policy', value: 'strict' },
          ],
        },
      ],
    })
    expect(auditVercel(json).problems.some((p) => p.includes('Permissions-Policy'))).toBe(true)
  })

  it('ловит отсутствие заголовка в правиле для /(.*)', () => {
    const json = JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }] })
    const { problems } = auditVercel(json)
    expect(problems.some((p) => p.includes('X-Content-Type-Options'))).toBe(true)
  })

  it('отсутствие headers — находка, а не «нечего проверять»', () => {
    expect(auditVercel('{}').problems.length).toBeGreaterThan(0)
  })

  it('битый JSON — находка, а не исключение', () => {
    expect(auditVercel('{ oops').problems.some((p) => p.includes('не разбирается'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

describe('проверка index.html', () => {
  it('ловит frame-ancestors в meta — директиву, которую браузер игнорирует', () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-ancestors 'none'">`
    const { problems } = auditIndexHtml(html)
    expect(problems.some((p) => p.includes('frame-ancestors'))).toBe(true)
  })

  it('ловит report-uri и sandbox в meta', () => {
    for (const directive of ['report-uri /csp', 'sandbox allow-scripts']) {
      const html = `<meta http-equiv='Content-Security-Policy' content="default-src 'self'; ${directive}">`
      expect(auditIndexHtml(html).problems.some((p) => p.includes(directive.split(' ')[0]))).toBe(true)
    }
  })

  it('не ругается на обычный meta-CSP', () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: https:">`
    expect(auditIndexHtml(html).problems).toHaveLength(0)
  })

  it('отсутствие meta-CSP — не находка (CSP может приходить заголовком)', () => {
    expect(auditIndexHtml('<html><head><title>x</title></head></html>').problems).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */

describe('проверка helmet (исключение proxy_pass location из гейта nginx)', () => {
  const withHelmet = ['app.use(cors())', 'app.use(helmet())', "app.use('/uploads', express.static('/data'))"].join('\n')

  it('зелёный, когда helmet смонтирован раньше express.static', () => {
    expect(auditHelmetOrder(withHelmet).problems).toHaveLength(0)
  })

  it('ловит отсутствие helmet: тогда исключённые из проверки location не прикрыты', () => {
    const { problems } = auditHelmetOrder("app.use('/uploads', express.static('/data'))")
    expect(problems.some((p) => p.includes('нет app.use(helmet())'))).toBe(true)
  })

  it('ловит express.static раньше helmet', () => {
    const text = ["app.use('/uploads', express.static('/data'))", 'app.use(helmet())'].join('\n')
    expect(auditHelmetOrder(text).problems.some((p) => p.includes('раньше helmet'))).toBe(true)
  })

  it('ловит helmet(), у которого аргументы стёрли', () => {
    // `app.use(helmet({ contentSecurityPolicy: false }))` не ловится этим
    // шаблоном намеренно: это другая находка. А вот `app.use(helmet)` без
    // скобок — опечатка, которая тихо отключает заголовки.
    expect(auditHelmetOrder('app.use(helmet)').problems.some((p) => p.includes('нет app.use(helmet())'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

describe('проверка Dockerfile', () => {
  it('зелёный, когда в образ едет проверяемый конфиг', () => {
    const text = 'FROM nginx:1.27-alpine AS web\nCOPY nginx/swiftmatch.http.conf /etc/nginx/conf.d/default.conf\n'
    const { problems, shipped } = auditDockerfile(text, NGINX_FILES)
    expect(problems).toHaveLength(0)
    expect(shipped).toEqual(['nginx/swiftmatch.http.conf'])
  })

  it('ловит конфиг, который едет в образ, но не проверяется гейтом', () => {
    // Питфолл 50: README требовал «проверить nginx.conf», пока в образ ехал
    // swiftmatch.http.conf. Гейт обязан заметить такой разрыв.
    const text = 'FROM nginx AS web\nCOPY nginx/other.conf /etc/nginx/conf.d/default.conf\n'
    expect(auditDockerfile(text, NGINX_FILES).problems.some((p) => p.includes('nginx/other.conf'))).toBe(true)
  })

  it('COPY не в /etc/nginx/ — конфиг не приехал, это находка', () => {
    expect(auditDockerfile('FROM nginx AS web\nCOPY dist /usr/share/nginx/html\n', NGINX_FILES).problems.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */

describe('гейт на настоящем репозитории', () => {
  it('зелёный на текущих конфигах (гейт, красный на своём же коде, бесполезен)', () => {
    const { problems } = audit(ROOT)
    expect(problems).toEqual([])
  })

  it('факты непустые: гейт действительно что-то проверил', () => {
    const { facts } = audit(ROOT)
    expect(facts.nginxFiles).toBe(NGINX_FILES.length)
    expect(facts.documents).toBeGreaterThan(0)
    expect(facts.tlsServers).toBeGreaterThan(0)
    expect(facts.shipped).toEqual(['nginx/swiftmatch.http.conf'])
    expect(facts.helmet).toBeGreaterThan(0)
  })

  it('красный, если из репозитория убрать заголовок из конфига, который едет в образ', () => {
    // Сквозная проверка на копии репозитория: подтверждает, что гейт ловит
    // откат, а не только расхождение в temp-фикстуре.
    const copy = copyRepoFiles(path.join(tmp, 'repo'))
    const target = path.join(copy, 'nginx/swiftmatch.http.conf')
    const stripped = fs
      .readFileSync(target, 'utf8')
      .split('\n')
      .filter((l) => !l.includes('X-Frame-Options'))
      .join('\n')
    fs.writeFileSync(target, stripped, 'utf8')

    const { problems } = audit(copy)
    expect(problems.some((p) => p.includes('X-Frame-Options'))).toBe(true)
  })

  it('красный, если из репозитория убрать helmet', () => {
    const copy = copyRepoFiles(path.join(tmp, 'repo-no-helmet'))
    const target = path.join(copy, 'server/src/index.js')
    fs.writeFileSync(
      target,
      fs.readFileSync(target, 'utf8').split('\n').filter((l) => !l.includes('app.use(helmet())')).join('\n'),
      'utf8',
    )
    expect(audit(copy).problems.some((p) => p.includes('helmet'))).toBe(true)
  })
})