import { describe, it, expect } from 'vitest'
import { buildProductMetrics, PRODUCT_METRIC_TARGETS } from '../product-metrics.js'

function byKey(result, key) {
  return result.metrics.find((m) => m.key === key)
}

describe('buildProductMetrics', () => {
  it('цели заданы владельцем и не меняются молча', () => {
    expect(PRODUCT_METRIC_TARGETS).toEqual({
      like_rate: { target: 40, direction: 'min' },
      match_rate: { target: 20, direction: 'min' },
      d7_retention: { target: 15, direction: 'min' },
      first_message_hours: { target: 24, direction: 'max' },
    })
  })

  it('пустые счётчики — четыре метрики unknown, без деления на ноль', () => {
    const result = buildProductMetrics()
    expect(result.cohort).toEqual({ registered: 0, liked: 0, matched: 0, messaged: 0, d7Cohort: 0 })
    expect(result.metrics).toHaveLength(4)
    expect(result.metrics.every((m) => m.value === null && m.status === 'unknown')).toBe(true)
  })

  it('проценты округляются до одного знака, время — до десятых часа', () => {
    const result = buildProductMetrics({
      registered: 3,
      liked: 1,
      matched: 1,
      d7Cohort: 7,
      d7Retained: 3,
      messaged: 2,
      avgSeconds: 3599,
    })
    expect(byKey(result, 'like_rate').value).toBe(33.3)
    expect(byKey(result, 'match_rate').value).toBe(33.3)
    expect(byKey(result, 'd7_retention').value).toBe(42.9)
    expect(byKey(result, 'first_message_hours').value).toBe(1)
  })

  it('нижняя граница: ровно цель — ok, на десятые ниже — warn', () => {
    const onTarget = buildProductMetrics({ registered: 10, liked: 4, matched: 2, d7Cohort: 20, d7Retained: 3 })
    expect(byKey(onTarget, 'like_rate')).toMatchObject({ value: 40, status: 'ok' })
    expect(byKey(onTarget, 'match_rate')).toMatchObject({ value: 20, status: 'ok' })
    expect(byKey(onTarget, 'd7_retention')).toMatchObject({ value: 15, status: 'ok' })

    const below = buildProductMetrics({ registered: 1000, liked: 399, matched: 199, d7Cohort: 1000, d7Retained: 149 })
    expect(byKey(below, 'like_rate').value).toBe(39.9)
    expect(byKey(below, 'like_rate').status).toBe('warn')
    expect(byKey(below, 'match_rate').value).toBe(19.9)
    expect(byKey(below, 'match_rate').status).toBe('warn')
    expect(byKey(below, 'd7_retention').value).toBe(14.9)
    expect(byKey(below, 'd7_retention').status).toBe('warn')
  })

  it('верхняя граница: ровно 24 ч — ok, даже 24.01 ч уже warn (статус по точному значению)', () => {
    const onTarget = buildProductMetrics({ registered: 1, liked: 1, matched: 1, messaged: 1, avgSeconds: 86400 })
    expect(byKey(onTarget, 'first_message_hours')).toMatchObject({ value: 24, status: 'ok' })

    const above = buildProductMetrics({ registered: 1, liked: 1, matched: 1, messaged: 1, avgSeconds: 86401 })
    expect(byKey(above, 'first_message_hours').value).toBe(24)
    expect(byKey(above, 'first_message_hours').status).toBe('warn')

    const tooSlow = buildProductMetrics({ registered: 1, liked: 1, matched: 1, messaged: 1, avgSeconds: 90000 })
    expect(byKey(tooSlow, 'first_message_hours')).toMatchObject({ value: 25, status: 'warn' })
  })

  it('показ округляется, но статус не становится зелёным из-за округления', () => {
    const result = buildProductMetrics({ registered: 2000, liked: 799, matched: 1 })
    expect(byKey(result, 'like_rate').value).toBe(40)
    expect(byKey(result, 'like_rate').status).toBe('warn')
  })

  it('нет отправленных сообщений или кривое среднее — метрика unknown, а не 0', () => {
    expect(byKey(buildProductMetrics({ messaged: 0, avgSeconds: 600 }), 'first_message_hours').value).toBeNull()
    expect(byKey(buildProductMetrics({ messaged: 5, avgSeconds: null }), 'first_message_hours').value).toBeNull()
    expect(byKey(buildProductMetrics({ messaged: 5, avgSeconds: 'abc' }), 'first_message_hours').value).toBeNull()
    expect(byKey(buildProductMetrics({ messaged: 5, avgSeconds: -1 }), 'first_message_hours').value).toBeNull()
    expect(byKey(buildProductMetrics({ messaged: 5, avgSeconds: -1 }), 'first_message_hours').status).toBe('unknown')
  })

  it('строковые счётчики из SQL приводятся к числам, а не склеиваются', () => {
    const result = buildProductMetrics({ registered: '200', liked: '90', matched: '50', d7Cohort: '100', d7Retained: '18' })
    expect(result.cohort.registered).toBe(200)
    expect(byKey(result, 'like_rate').value).toBe(45)
    expect(byKey(result, 'd7_retention').value).toBe(18)
  })

  it('единицы и направление цели отдаются клиенту вместе с метрикой', () => {
    const result = buildProductMetrics({ registered: 1, liked: 1, matched: 1, messaged: 1, avgSeconds: 60 })
    expect(result.metrics.map((m) => [m.key, m.unit, m.direction])).toEqual([
      ['like_rate', '%', 'min'],
      ['match_rate', '%', 'min'],
      ['d7_retention', '%', 'min'],
      ['first_message_hours', 'h', 'max'],
    ])
  })
})
