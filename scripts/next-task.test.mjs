import { describe, expect, it } from 'vitest'
import {
  buildCard,
  classifySection,
  extractFiles,
  gatesFor,
  listRows,
  parseBacklog,
  pickTask,
  resolveBarePaths,
  walkInventory,
} from './next-task.mjs'

const FIXTURE = [
  '# Что доделать — бэклог',
  '',
  '## ⏳ Ждёт действий пользователя (ключи / внешние сервисы)',
  '',
  '### Ключи и секреты',
  '',
  '- **ENV-01:** `server/.env` — реальные ключи (`refuseMockPayment`, `server/src/routes/premium.js`).',
  '- **ENV-04:** ключ VAPID скомпрометирован — решение владельца, `server/src/push.js`.',
  '',
  '## 🟡 P2 — nice-to-have',
  '',
  '### CI-01: подтвердить зелёный прогон (проверено 21.10.2026)',
  '',
  'Остаток: подтверждение за владельцем, детали `docs/backlog-p0-p1.md`.',
  '',
  '### COV-03: серверное покрытие — остаток (закрыт Stage 162, 22.10.2026)',
  '',
  '### DEPS-02: moderate в prod-зависимостях — риск принят (проверено 20.10.2026)',
  '',
  'Факт: 2 moderate (`server/package.json`).',
  '',
  '### TEST-06: живой Redis (проверено 20.10.2026, сужено)',
  '',
  'Остаток — admin-роут поверх живого Redis (`server/src/routes/admin/queues.js`).',
  '',
  '## 🟢 P3 — бэклог',
  '',
  '### Гигиена HEAD (проверено 26.10.2026)',
  '',
  '- **QA-01: предупреждения ESLint (проверено 26.10.2026).** Правило стоит в `eslint.config.js:58`, худший файл — `src/pages/chats.tsx` (14), ещё `src/test/hangouts.test.tsx` (10).',
  '- **ADV-01: пункт без цитаты кода.** Просто текст без путей и строк.',
  '- **TEST-06: тот же пункт, но с точной строкой (проверено 20.10.2026).** `server/src/routes/admin/queues.js:12`.',
  '',
  '## ✅ Принятые решения (не пересматривать)',
  '',
  '- **DEPS-02 — оставить `bull@4.16.5`:** решение зафиксировано, `server/package.json`.',
  '',
  '## ❌ Не брать (снято факт-чеком)',
  '',
  '- **OLD-01: не делать.** `src/legacy.ts` удалён.',
  '',
  '## Очередь этапов (кандидаты, порядок — как в этом файле)',
  '',
  '1. **Живое доказательство (зависит от владельца):** ENV-01..04, AND-01/02, CI-01.',
  '2. **Покрытие ядра — продолжение (COV-02).** Остаток — `server/src/index.js` и `server/src/seed.js`.',
  '3. **Юридические тексты — решение владельца (LEGAL-01).** Текст в `src/pages/legal-privacy.tsx`.',
  '',
  '## Правила работы с журналами и бэклогом',
  '',
  '- Правило, не пункт: `README.md`.',
].join('\n')

const byId = (items, id) => items.find((item) => item.id === id)

describe('classifySection', () => {
  it('различает приоритеты, очередь и блокеры', () => {
    expect(classifySection('🟡 P2 — nice-to-have')).toEqual({ skip: false, priority: 2 })
    expect(classifySection('🟢 P3 — бэклог, брать после P0–P2')).toEqual({ skip: false, priority: 3 })
    expect(classifySection('Очередь этапов (кандидаты)')).toEqual({ skip: false, queue: true, priority: 4 })
    expect(classifySection('⏳ Ждёт действий пользователя (ключи / внешние сервисы)')).toEqual({ skip: false, blocked: true, priority: 9 })
  })

  it('не путает P3-диапазон в заголовке с приоритетом P0', () => {
    expect(classifySection('P3 — хвост после P0–P2').priority).toBe(3)
  })

  it('пропускает разделы, которые не являются задачами', () => {
    expect(classifySection('✅ Принятые решения (дозапись 20.10.2026)').skip).toBe(true)
    expect(classifySection('❌ Не брать (консенсус аудитов)').skip).toBe(true)
    expect(classifySection('Правила работы с журналами и бэклогом').skip).toBe(true)
  })
})

describe('extractFiles', () => {
  it('собирает пути и номера строк, дедуплицирует', () => {
    const files = extractFiles('Правило `eslint.config.js:58`, файл `src/pages/chats.tsx` и снова `src/pages/chats.tsx` (14)')
    expect(files).toEqual([
      { path: 'eslint.config.js', lines: '58' },
      { path: 'src/pages/chats.tsx', lines: '' },
    ])
  })

  it('предпочитает вхождение со строкой', () => {
    const files = extractFiles('`server/src/push.js` и `server/src/push.js:41`')
    expect(files).toEqual([{ path: 'server/src/push.js', lines: '41' }])
  })

  it('не считает путём упоминание без расширения', () => {
    expect(extractFiles('Просто `server` без файла')).toEqual([])
  })
})

describe('resolveBarePaths', () => {
  const inventory = [
    'server/src/__tests__/admin-queues.test.js',
    'server/src/queues.js',
    'scripts/queues.js',
    'src/pages/chats.tsx',
  ]

  it('достраивает путь по уникальному имени файла', () => {
    expect(resolveBarePaths([{ path: 'admin-queues.test.js', lines: '12' }], inventory)).toEqual([
      { path: 'server/src/__tests__/admin-queues.test.js', lines: '12', resolved: true },
    ])
  })

  it('не трогает путь, у которого уже есть каталог', () => {
    const file = { path: 'src/pages/chats.tsx', lines: '41' }
    expect(resolveBarePaths([file], inventory)).toEqual([file])
  })

  it('оставляет имя как есть, если совпадений нет или их несколько', () => {
    expect(resolveBarePaths([{ path: 'queues.js', lines: '' }], inventory)).toEqual([{ path: 'queues.js', lines: '' }])
    expect(resolveBarePaths([{ path: 'missing.ts', lines: '' }], inventory)).toEqual([{ path: 'missing.ts', lines: '' }])
  })
})

describe('walkInventory', () => {
  it('обходит репозиторий и пропускает зеркала, сборку и node_modules', () => {
    const inventory = walkInventory(process.cwd())
    expect(inventory).toContain('package.json')
    expect(inventory.some((file) => file.startsWith('node_modules/'))).toBe(false)
    expect(inventory.some((file) => file.startsWith('test/'))).toBe(false)
    expect(inventory.some((file) => file.startsWith('src/'))).toBe(true)
  })
})

describe('parseBacklog', () => {
  const items = parseBacklog(FIXTURE)

  it('находит пункты-списки и пункты-заголовки', () => {
    const ids = items.map((item) => item.id)
    expect(ids).toContain('QA-01')
    expect(ids).toContain('CI-01')
    expect(ids).toContain('ENV-01')
    expect(ids).toContain('COV-02')
    expect(ids).toContain('LEGAL-01')
    expect(ids).toContain('ADV-01')
  })

  it('не берёт пункты из разделов «Принятые решения» и «Не брать»', () => {
    const ids = items.map((item) => item.id)
    expect(ids).not.toContain('OLD-01')
    expect(items.filter((item) => item.id === 'DEPS-02')).toHaveLength(1)
  })

  it('сохраняет номер строки, дату проверки и цитату кода', () => {
    const qa = byId(items, 'QA-01')
    expect(qa.line).toBe(30)
    expect(qa.verified).toBe('26.10.2026')
    expect(qa.evidence).toBe('file:line')
    expect(qa.files.map((file) => file.path)).toContain('src/pages/chats.tsx')
    expect(qa.priority).toBe(3)
  })

  it('наследует приоритет раздела, если подзаголовок без метки P', () => {
    const env = byId(items, 'ENV-01')
    expect(env.priority).toBe(9)
    expect(env.status).toBe('blocked')
  })

  it('ставит статусы blocked / closed / decision / no-evidence / ready', () => {
    expect(byId(items, 'ENV-04').status).toBe('blocked')
    expect(byId(items, 'CI-01').status).toBe('blocked')
    expect(byId(items, 'LEGAL-01').status).toBe('blocked')
    expect(byId(items, 'COV-03').status).toBe('closed')
    expect(byId(items, 'DEPS-02').status).toBe('decision')
    expect(byId(items, 'ADV-01').status).toBe('no-evidence')
    expect(byId(items, 'QA-01').status).toBe('ready')
    expect(byId(items, 'COV-02').status).toBe('ready')
  })

  it('дедуплицирует ID, оставляя вхождение с цитатой file:line', () => {
    const test06 = items.filter((item) => item.id === 'TEST-06')
    expect(test06).toHaveLength(1)
    expect(test06[0].line).toBe(32)
    expect(test06[0].evidence).toBe('file:line')
  })

  it('пункт без путей остаётся, но без цитаты кода', () => {
    const adv = byId(items, 'ADV-01')
    expect(adv.evidence).toBe('none')
    expect(adv.files).toEqual([])
  })
})

describe('pickTask', () => {
  const items = parseBacklog(FIXTURE)

  it('по умолчанию отдаёт приоритетный готовый пункт с цитатой кода', () => {
    expect(pickTask(items).id).toBe('QA-01')
  })

  it('не отдаёт блокеры без явного флага', () => {
    expect(pickTask(items, { id: 'ENV-01' })).toBe(null)
    expect(pickTask(items, { id: 'ENV-01', includeBlocked: true }).id).toBe('ENV-01')
  })

  it('исключает пункты без цитаты кода, пока не разрешено', () => {
    expect(pickTask(items, { id: 'ADV-01' })).toBe(null)
    expect(pickTask(items, { id: 'ADV-01', allowNoEvidence: true }).id).toBe('ADV-01')
  })

  it('никогда не отдаёт закрытые пункты и принятые решения', () => {
    expect(pickTask(items, { id: 'COV-03', includeBlocked: true })).toBe(null)
    expect(pickTask(items, { id: 'DEPS-02', includeBlocked: true })).toBe(null)
    expect(pickTask(items, { includeBlocked: true }).id).toBe('QA-01')
  })

  it('фильтрует по разделу очереди и по ID', () => {
    expect(pickTask(items, { queueOnly: true }).id).toBe('COV-02')
    expect(pickTask(items, { id: 'cov-02', includeBlocked: true }).id).toBe('COV-02')
    expect(pickTask(items, { id: 'NOPE-01' })).toBe(null)
  })

  it('--local берёт готовый пункт с ограниченным числом файлов', () => {
    const picked = pickTask(items, { local: true })
    expect(picked.id).toBe('QA-01')
    expect(picked.files.length).toBeLessThanOrEqual(3)
    expect(picked.status).toBe('ready')
  })

  it('детерминирован: два вызова дают один результат', () => {
    const first = pickTask(parseBacklog(FIXTURE))
    const second = pickTask(parseBacklog(FIXTURE))
    expect(first.id).toBe(second.id)
    expect(first.line).toBe(second.line)
  })
})

describe('gatesFor', () => {
  const items = parseBacklog(FIXTURE)

  it('для фронтового файла требует eslint, typecheck и тест', () => {
    const gates = gatesFor(byId(items, 'QA-01'))
    expect(gates).toContain('npx.cmd eslint <изменённые файлы>')
    expect(gates).toContain('npm.cmd run typecheck')
    expect(gates).toContain('npm.cmd test -- <тест затронутого файла>')
    expect(gates).toContain('npm.cmd run retent:check')
  })

  it('для серверного файла добавляет N+1, для docs — check:docs', () => {
    expect(gatesFor(byId(items, 'COV-02'))).toContain('npm.cmd run check:n-plus-one')
    expect(gatesFor(byId(items, 'CI-01'))).toContain('npm.cmd run check:docs')
  })
})

describe('buildCard', () => {
  const items = parseBacklog(FIXTURE)

  it('содержит ID, источник, статус, срез и готовый промпт', () => {
    const card = buildCard(byId(items, 'QA-01'))
    expect(card).toContain('ЗАДАЧА: QA-01')
    expect(card).toContain('Источник: Что доделать.txt:30')
    expect(card).toContain('Статус: готова')
    expect(card).toContain('СРЕЗ ДЛЯ ОДНОГО ПОДХОДА')
    expect(card).toContain('ПРОМПТ ДЛЯ АГЕНТА')
    expect(card).toContain('никакого any')
  })

  it('для принятого решения честно пишет, что это не задача', () => {
    expect(buildCard(byId(items, 'DEPS-02'))).toContain('Статус: принятое решение, не задача')
  })
})

describe('listRows', () => {
  it('отдаёт по строке на каждый пункт с флагами', () => {
    const rows = listRows(parseBacklog(FIXTURE))
    const qa = rows.find((row) => row.id === 'QA-01')
    expect(qa.status).toBe('ready')
    expect(qa.evidence).toBe('file:line')
    expect(qa.files).toBe(3)
    expect(rows.find((row) => row.id === 'ENV-01').status).toBe('blocked')
    expect(rows.find((row) => row.id === 'COV-02').queue).toBe(true)
  })
})
