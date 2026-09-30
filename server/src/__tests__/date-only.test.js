import { describe, it, expect } from 'vitest'
import { dateOnly } from '../date-only.js'

describe('dateOnly: DATE-колонка не должна уезжать на сутки', () => {
  it('Date из mysql2 (локальная зона) превращается в YYYY-MM-DD', () => {
    const d = new Date(2001, 7, 10)
    expect(dateOnly(d)).toBe('2001-08-10')
  })

  it('уже строка YYYY-MM-DD остаётся как есть', () => {
    expect(dateOnly('1995-06-15')).toBe('1995-06-15')
  })

  it('ISO-строка обрезается до даты, а не до локальной копии', () => {
    expect(dateOnly('2001-08-09T20:00:00.000Z')).toBe('2001-08-09')
  })

  it('null и undefined остаются null (не "Invalid Date")', () => {
    expect(dateOnly(null)).toBe(null)
    expect(dateOnly(undefined)).toBe(null)
  })

  it('битый Date не превращается в "Invalid Date"', () => {
    expect(dateOnly(new Date('nope'))).toBe(null)
  })

  it('число и объект без даты не ломают ответ', () => {
    expect(dateOnly(42)).toBe(null)
    expect(dateOnly({})).toBe(null)
  })
})
