import { describe, it, expect } from 'vitest'
import { InMemoryLedger, kstDayKey, keyIdOf } from '../src/client/quota.js'

describe('kstDayKey', () => {
  it('UTC 15:30 = KST 다음날 00:30', () => {
    const t = Date.UTC(2026, 7, 19, 15, 30) // 2026-08-19 15:30 UTC → KST 08-20
    expect(kstDayKey(() => t)).toBe('20260820')
  })
})

describe('keyIdOf', () => {
  it('원문 키를 포함하지 않는 8자 해시', () => {
    const id = keyIdOf('SECRETKEY123')
    expect(id).toHaveLength(8)
    expect('SECRETKEY123').not.toContain(id)
  })
})

describe('InMemoryLedger', () => {
  it('키별·일별 독립 카운트와 ratio', async () => {
    let t = Date.UTC(2026, 7, 19, 0, 0)
    const l = new InMemoryLedger(10, () => t)
    await l.increment('a'); await l.increment('a'); await l.increment('b')
    expect((await l.status('a'))).toMatchObject({ used: 2, limit: 10, ratio: 0.2 })
    expect((await l.status('b')).used).toBe(1)
    t += 86_400_000 // 다음 날 → 카운터 리셋
    expect((await l.status('a')).used).toBe(0)
  })

  it('QUOTA_DAILY_LIMIT이 숫자가 아니면 기본값 1000으로 폴백', async () => {
    const prev = process.env.QUOTA_DAILY_LIMIT
    process.env.QUOTA_DAILY_LIMIT = 'abc'
    try {
      const l = new InMemoryLedger()
      const before = await l.status('x')
      expect(before).toMatchObject({ used: 0, limit: 1000, ratio: 0 })
      await l.increment('x')
      const after = await l.status('x')
      expect(after).toMatchObject({ used: 1, limit: 1000, ratio: 0.001 })
    } finally {
      if (prev === undefined) delete process.env.QUOTA_DAILY_LIMIT
      else process.env.QUOTA_DAILY_LIMIT = prev
    }
  })
})
