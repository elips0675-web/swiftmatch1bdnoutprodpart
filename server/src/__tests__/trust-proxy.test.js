import { describe, it, expect } from 'vitest'
import { resolveTrustProxy } from '../trust-proxy.js'

describe('resolveTrustProxy', () => {
  it('по умолчанию доверяет приватным подсетям (nginx в docker)', () => {
    expect(resolveTrustProxy(undefined)).toBe('uniquelocal')
    expect(resolveTrustProxy(null)).toBe('uniquelocal')
    expect(resolveTrustProxy('')).toBe('uniquelocal')
    expect(resolveTrustProxy('   ')).toBe('uniquelocal')
  })

  it('явное отключение: false/off/0', () => {
    expect(resolveTrustProxy('false')).toBe(false)
    expect(resolveTrustProxy('FALSE')).toBe(false)
    expect(resolveTrustProxy('off')).toBe(false)
    expect(resolveTrustProxy('0')).toBe(false)
  })

  it('true/on — приватные подсети, а не «любой прокси»', () => {
    expect(resolveTrustProxy('true')).toBe('uniquelocal')
    expect(resolveTrustProxy('ON')).toBe('uniquelocal')
  })

  it('число хопов', () => {
    expect(resolveTrustProxy('1')).toBe(1)
    expect(resolveTrustProxy('2')).toBe(2)
    expect(resolveTrustProxy(' 3 ')).toBe(3)
  })

  it('нечисловые и неположительные значения не дают «доверять всем»', () => {
    expect(resolveTrustProxy('-1')).toBe(false)
    expect(resolveTrustProxy('1.5')).toBe(false)
    expect(resolveTrustProxy('00')).toBe(false)
  })

  it('IP/CIDR/пресет передаются в express как есть', () => {
    expect(resolveTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8')
    expect(resolveTrustProxy('loopback')).toBe('loopback')
    expect(resolveTrustProxy('172.20.0.0/16, 10.0.0.0/8')).toBe('172.20.0.0/16, 10.0.0.0/8')
  })
})
