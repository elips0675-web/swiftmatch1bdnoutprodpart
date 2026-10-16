#!/usr/bin/env node
/**
 * Тесты гейта «миграции на отставшей БД» (`npm run check:migrations-lag`).
 *
 * Проверяет структуру шага (тест выполняется в CI с живым MySQL) и логику
 * `decide` на фейках. Логика критична: аудита зелёного при отставшей БД быть
 * не должно; аудит обязан краснеть и называть читаемый кодом столбец
 * как `COLUMN_MISSING_IN_CODE`. Тест также ловит протухшие заголовки/поведение
 * гейта (напр., запрет «зелёного гейта по построению»).
 */

import { describe, it, expect } from 'vitest'

import {
  parseMigrationColumns,
  migrationSteps,
  decide,
} from './migrations-lag-audit.mjs'

describe('parseMigrationColumns — парсер ADD COLUMN с учётом нескольких ALTER внутри файла', () => {
  it('видит один ADD COLUMN', () => {
    const sql = "ALTER TABLE user_profiles ADD COLUMN show_online TINYINT(1) NOT NULL DEFAULT 0 AFTER last_seen;"
    const cols = parseMigrationColumns(sql)
    expect(cols).toEqual([{ table: 'user_profiles', column: 'show_online' }])
  })

  it('видит несколько ADD COLUMN в одном ALTER TABLE (не только первый)', () => {
    const sql = "ALTER TABLE subscriptions\n  ADD COLUMN provider ENUM('stripe','revenuecat') NULL AFTER user_id,\n  ADD COLUMN provider_subscription_id VARCHAR(255) NULL AFTER provider,\n  ADD COLUMN status ENUM('active','canceled','expired','trialing') NULL AFTER provider_subscription_id,\n  ADD COLUMN current_period_end DATETIME NULL AFTER status;"
    const cols = parseMigrationColumns(sql)
    expect(cols.map(c => c.column)).toEqual([
      'provider',
      'provider_subscription_id',
      'status',
      'current_period_end',
    ])
    expect(cols.every(c => c.table === 'subscriptions')).toBe(true)
  })

  it('видит несколько ALTER TABLE в одном файле (идемпотентный паттерн с IF)', () => {
    const sql = "'ALTER TABLE feature_flags ADD COLUMN hangout_relations_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER activity_privacy_enabled;'\n--\n'ALTER TABLE feature_flags ADD COLUMN user_watches_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER hangout_relations_enabled;'"
    const cols = parseMigrationColumns(sql)
    expect(cols).toEqual([
      { table: 'feature_flags', column: 'hangout_relations_enabled' },
      { table: 'feature_flags', column: 'user_watches_enabled' },
    ])
  })

  it('не собирает MODIFY COLUMN', () => {
    const sql = "ALTER TABLE user_profiles MODIFY COLUMN location POINT NOT NULL;"
    expect(parseMigrationColumns(sql)).toEqual([])
  })
})

describe('migrationSteps — берёт только миграции с ADD COLUMN', () => {
  it('реальный список в базе содержит миграции с ADD COLUMN (структурная проверка)', () => {
    const steps = migrationSteps()
    expect(steps.length).toBeGreaterThan(0)
    for (const s of steps) {
      expect(s.file).toMatch(/^\d{3}_.*\.sql$/)
      expect(Array.isArray(s.columns)).toBe(true)
      expect(s.columns.length).toBeGreaterThan(0)
    }
  })
})

describe('decide — логика гейта на фейках', () => {
  const mkStep = (file, cols) => ({ file, columns: cols.map(c => ({ table: c.table, column: c.column })) })
  const mkAudit = (rc, out = '') => ({ rc, out })
  const base = mkAudit(0, 'OK')

  it('базовый аудит красный → проблема', async () => {
    const codeReads = new Map()
    const { problems } = await decide({
      baseline: mkAudit(1, 'schema drift found'),
      steps: [mkStep('001_a.sql', [{ table: 't', column: 'c' }])],
      codeReads,
      runAudit: async () => mkAudit(0, 'OK'),
      dropColumns: async () => [{ table: 't', column: 'c' }],
      rebuild: async () => {},
    })
    expect(problems.some(p => p.includes('дрейф-аудит красный'))).toBe(true)
  })

  it('после пересборки аудит остался красным → причинная краснота отмечается', async () => {
    let audits = [mkAudit(1, 'COLUMN_MISSING_IN_CODE c')]
    const codeReads = new Map([['t', new Set(['c'])]])
    const { problems } = await decide({
      baseline: base,
      steps: [mkStep('010_x.sql', [{ table: 't', column: 'c' }])],
      codeReads,
      runAudit: async () => audits.shift() || mkAudit(1, 'bad'),
      dropColumns: async () => [{ table: 't', column: 'c' }],
      rebuild: async () => {},
    })
    // после rebuild() runAudit вернёт bad — в нашем случае мы подменили порядок? В коде: первый runAudit после drop → audits[0]=red (rc=1), codeRead есть → named найдётся (line 141), красный шаг зафиксируется. Затем rebuild(), runAudit() даёт bad (rc=1) → добавляется проблема «после пересборки… аудит остался красным».
    expect(problems.some(p => p.includes('после пересборки'))).toBe(true)
  })

  it('код читает пропавший столбец, но аудит зелёный при отставшей БД → ловим (питфолл 99)', async () => {
    const codeReads = new Map([['users', new Set(['profile_activity_enabled'])]])
    const steps = [mkStep('054_x.sql', [{ table: 'users', column: 'profile_activity_enabled' }])]
    const audits = [mkAudit(0, 'OK')] // green while DB missing the column
    const { problems, facts } = await decide({
      baseline: base,
      steps,
      codeReads,
      runAudit: async () => audits.shift() || mkAudit(0, 'OK'),
      dropColumns: async () => [{ table: 'users', column: 'profile_activity_enabled' }],
      rebuild: async () => {},
    })
    expect(problems.some(p => p.includes('дрейф-аудит зелёный — живой 500 был бы невидим'))).toBe(true)
    expect(facts.checked).toBe(1)
  })

  it('аудит красный, но не называет COLUMN_MISSING_IN_CODE по читаемому столбцу → сигнал не про код', async () => {
    const codeReads = new Map([['t', new Set(['c'])]])
    const { problems } = await decide({
      baseline: base,
      steps: [mkStep('010_x.sql', [{ table: 't', column: 'c' }])],
      codeReads,
      runAudit: async () => mkAudit(1, 'OTHER ERROR: something else'),
      dropColumns: async () => [{ table: 't', column: 'c' }],
      rebuild: async () => {},
    })
    expect(problems.some(p => p.includes('не назвал читаемый кодом столбец'))).toBe(true)
  })

  it('аудит красный и называет COLUMN_MISSING_IN_CODE по читаемому столбцу → красный шаг фиксируется', async () => {
    const codeReads = new Map([['t', new Set(['c'])]])
    let audits = [mkAudit(1, '[COLUMN_MISSING_IN_CODE] c\nOTHER')]
    const { problems, facts } = await decide({
      baseline: base,
      steps: [mkStep('010_x.sql', [{ table: 't', column: 'c' }])],
      codeReads,
      runAudit: async () => audits.shift() || mkAudit(0, 'OK'),
      dropColumns: async () => [{ table: 't', column: 'c' }],
      rebuild: async () => {},
    })
    expect(facts.redStep).toMatch(/010_x\.sql/)
    expect(problems.length).toBe(0)
  })

  it('ни один шаг не дал красного шага, но baseline зелёный → запрещаем зелёный по построению', async () => {
    const codeReads = new Map()
    const steps = [mkStep('010_x.sql', [{ table: 't', column: 'c' }])]
    let audits = [mkAudit(0, 'OK')]
    const { problems, facts } = await decide({
      baseline: base,
      steps,
      codeReads,
      runAudit: async () => audits.shift() || mkAudit(0, 'OK'),
      dropColumns: async () => [{ table: 't', column: 'c' }],
      rebuild: async () => {},
    })
    expect(facts.checked).toBe(1)
    expect(problems.some(p => p.includes('ни на одном из 1 проверенных шагов'))).toBe(true)
  })

  it('ни один шаг не проверен (dropColumns не сумел снять ни одного столбца) → зелёный по построению', async () => {
    const { problems, facts } = await decide({
      baseline: base,
      steps: [mkStep('010_x.sql', [{ table: 't', column: 'c' }])],
      codeReads: new Map(),
      runAudit: async () => mkAudit(0, 'OK'),
      dropColumns: async () => [],
      rebuild: async () => {},
    })
    expect(facts.checked).toBe(0)
    expect(problems.some(p => p.includes('ни один шаг не проверен'))).toBe(true)
  })

  it('пропущенный шаг помечается skipped, но обход продолжается', async () => {
    const codeReads = new Map([['t2', new Set(['c2'])]])
    const steps = [
      mkStep('001_skip.sql', [{ table: 't1', column: 'c1' }]),
      mkStep('002_hit.sql', [{ table: 't2', column: 'c2' }]),
    ]
    let audits = [mkAudit(1, '[COLUMN_MISSING_IN_CODE] c2')]
    let drops = [[{ table: 't2', column: 'c2' }], []]
    const { problems, facts } = await decide({
      baseline: base,
      steps,
      codeReads,
      runAudit: async () => audits.shift() || mkAudit(0, 'OK'),
      dropColumns: async () => drops.shift() || [],
      rebuild: async () => {},
    })
    expect(facts.skipped.length).toBe(1)
    expect(facts.checked).toBe(1)
    expect(facts.redStep).toMatch(/002_hit\.sql/)
    expect(problems.length).toBe(0)
  })
})
