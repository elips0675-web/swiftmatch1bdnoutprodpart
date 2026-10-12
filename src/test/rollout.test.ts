import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getRolloutBucket, tokenUserId } from '@/lib/rollout'

const token = vi.hoisted(() => ({ value: 'not-a-jwt' }))

vi.mock('@/lib/token', () => ({
  getToken: () => token.value,
}))

describe('getRolloutBucket', () => {
  it('deterministic and within 0..99', () => {
    const ids = [1, 7, 42, 999, 123456789, 'abc123']
    for (const id of ids) {
      const first = getRolloutBucket(id)
      expect(getRolloutBucket(id)).toBe(first)
      expect(first).toBeGreaterThanOrEqual(0)
      expect(first).toBeLessThan(100)
    }
  })

  it('spreads user ids across buckets', () => {
    const buckets = new Set(Array.from({ length: 200 }, (_, i) => getRolloutBucket(i + 1)))
    expect(buckets.size).toBeGreaterThan(1)
  })

  it('anonymous (null/undefined) — bucket 0', () => {
    expect(getRolloutBucket(null)).toBe(0)
    expect(getRolloutBucket(undefined)).toBe(0)
  })
})

describe('tokenUserId', () => {
  beforeEach(() => {
    token.value = 'not-a-jwt'
  })

  it('returns null for non-JWT token', () => {
    expect(tokenUserId()).toBeNull()
  })

  it('decodes userId from JWT payload', () => {
    token.value = `h.${btoa(JSON.stringify({ userId: 42, role: 'user' }))}.s`
    expect(tokenUserId()).toBe(42)
  })

  it('decodes numeric-string userId', () => {
    token.value = `h.${btoa(JSON.stringify({ userId: '7' }))}.s`
    expect(tokenUserId()).toBe(7)
  })
})