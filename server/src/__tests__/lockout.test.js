vi.hoisted(() => {
  delete process.env.REDIS_URL
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isLocked, recordFailure, recordSuccess, _resetLockout } from '../lockout.js'

beforeEach(() => {
  _resetLockout()
})

describe('account lockout', () => {
  it('returns null when key never failed', async () => {
    expect(await isLocked('a@test.com')).toBeNull()
  })

  it('does not lock below threshold', async () => {
    await recordFailure('a@test.com')
    await recordFailure('a@test.com')
    await recordFailure('a@test.com')
    expect(await isLocked('a@test.com')).toBeNull()
  })

  it('locks after max consecutive failures', async () => {
    for (let i = 0; i < 5; i++) await recordFailure('a@test.com')
    const minutes = await isLocked('a@test.com')
    expect(minutes).toBeGreaterThanOrEqual(14)
    expect(minutes).toBeLessThanOrEqual(15)
  })

  it('keys are isolated per email', async () => {
    for (let i = 0; i < 5; i++) await recordFailure('a@test.com')
    expect(await isLocked('b@test.com')).toBeNull()
  })

  it('success resets the counter', async () => {
    await recordFailure('a@test.com')
    await recordFailure('a@test.com')
    await recordFailure('a@test.com')
    await recordSuccess('a@test.com')
    for (let i = 0; i < 4; i++) await recordFailure('a@test.com')
    expect(await isLocked('a@test.com')).toBeNull()
  })

  it('is case-insensitive by caller convention (key normalized upstream)', async () => {
    for (let i = 0; i < 5; i++) await recordFailure('A@TEST.COM')
    expect(await isLocked('A@TEST.COM')).not.toBeNull()
  })
})
