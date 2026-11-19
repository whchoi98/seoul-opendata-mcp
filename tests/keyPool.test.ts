import { describe, it, expect } from 'vitest'
import { KeyPool, parseKeys, maskKey, SAMPLE_KEY } from '../src/client/keyPool.js'
import { InMemoryLedger, keyIdOf } from '../src/client/quota.js'

const statusOf = (ledger: InMemoryLedger) => (id: string) => ledger.status(id)

describe('parseKeys', () => {
  it('쉼표로 나누고 공백을 자르며 빈 항목과 중복을 지운다', () => {
    expect(parseKeys(' K1, K2 ,,K1 ')).toEqual(['K1', 'K2'])
  })

  it('키가 없으면 샘플 키 하나를 돌려준다', () => {
    expect(parseKeys(undefined)).toEqual([SAMPLE_KEY])
    expect(parseKeys('')).toEqual([SAMPLE_KEY])
    expect(parseKeys(' , ')).toEqual([SAMPLE_KEY])
  })
})

describe('maskKey', () => {
  it('앞 4자만 남기고 sample은 그대로 둔다', () => {
    expect(maskKey('SECRETKEY123')).toBe('SECR…(masked)')
    expect(maskKey('sample')).toBe('sample')
  })
})

describe('KeyPool', () => {
  it('샘플 키 하나일 때만 isSample', () => {
    expect(new KeyPool(['sample']).isSample).toBe(true)
    expect(new KeyPool(['K1']).isSample).toBe(false)
    expect(new KeyPool(['K1', 'sample']).isSample).toBe(false)
  })

  it('빈 목록으로는 만들 수 없다', () => {
    expect(() => new KeyPool([])).toThrow()
  })

  it('목록 순서에서 처음 만나는 한도 미만 키를 고른다', async () => {
    const ledger = new InMemoryLedger(2)
    await ledger.increment(keyIdOf('K1'))
    await ledger.increment(keyIdOf('K1'))
    const picked = await new KeyPool(['K1', 'K2', 'K3']).pick(statusOf(ledger))
    expect(picked).toMatchObject({ exhausted: false, key: 'K2', keyId: keyIdOf('K2') })
  })

  it('풀 상태는 모든 키의 사용량과 한도를 더한 값이다', async () => {
    const ledger = new InMemoryLedger(5)
    for (let i = 0; i < 4; i++) {
      await ledger.increment(keyIdOf('K1'))
      await ledger.increment(keyIdOf('K2'))
    }
    const picked = await new KeyPool(['K1', 'K2']).pick(statusOf(ledger))
    expect(picked.pool).toEqual({ used: 8, limit: 10, ratio: 0.8 })
  })

  it('모든 키가 한도에 닿으면 exhausted', async () => {
    const ledger = new InMemoryLedger(1)
    await ledger.increment(keyIdOf('K1'))
    await ledger.increment(keyIdOf('K2'))
    const picked = await new KeyPool(['K1', 'K2']).pick(statusOf(ledger))
    expect(picked).toEqual({ exhausted: true, pool: { used: 2, limit: 2, ratio: 1 } })
  })

  it('쿨다운 중인 키는 건너뛰고, 시간이 지나면 다시 고른다', async () => {
    let t = 0
    const ledger = new InMemoryLedger(10)
    const pool = new KeyPool(['K1', 'K2'], () => t)
    pool.cooldown('K1', 600_000)
    expect(await pool.pick(statusOf(ledger))).toMatchObject({ key: 'K2' })
    t = 599_999
    expect(await pool.pick(statusOf(ledger))).toMatchObject({ key: 'K2' })
    t = 600_000
    expect(await pool.pick(statusOf(ledger))).toMatchObject({ key: 'K1' })
  })

  it('쿨다운 중인 키도 풀 합계에는 들어간다', async () => {
    const ledger = new InMemoryLedger(10)
    await ledger.increment(keyIdOf('K1'))
    const pool = new KeyPool(['K1', 'K2'], () => 0)
    pool.cooldown('K1', 1000)
    expect((await pool.pick(statusOf(ledger))).pool).toEqual({ used: 1, limit: 20, ratio: 0.05 })
  })

  it('고를 수 있는 키가 모두 쿨다운 중이면 exhausted', async () => {
    const pool = new KeyPool(['K1'], () => 0)
    pool.cooldown('K1', 1000)
    expect(await pool.pick(statusOf(new InMemoryLedger(10)))).toMatchObject({ exhausted: true })
  })
})
