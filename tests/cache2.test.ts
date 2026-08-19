import { describe, it, expect, vi } from 'vitest'
import { InMemoryCache, CompositeCache, HARD_TTL_MS, type CacheBackend, type CacheEntry } from '../src/client/cache.js'

const U = (tag: string) => ({ rows: [{ tag }], totalCount: 1, raw: null }) as any

const fakeBackend = (store = new Map<string, CacheEntry>()): CacheBackend & { store: Map<string, CacheEntry> } => ({
  store,
  async get(k) { return store.get(k) },
  async set(k, e) { store.set(k, e) },
})

describe('InMemoryCache', () => {
  it('hard TTL(24h) 초과 항목은 get에서 제거', async () => {
    let t = 1_000_000
    const c = new InMemoryCache(() => t)
    await c.set('k', { value: U('a'), storedAt: t, softTtlMs: 1000 })
    t += HARD_TTL_MS + 1
    expect(await c.get('k')).toBeUndefined()
  })
})

describe('CompositeCache', () => {
  it('soft 이내는 fresh, 초과~hard 이내는 stale', async () => {
    let t = 0
    const cc = new CompositeCache(new InMemoryCache(() => t), undefined, () => t)
    await cc.set('k', U('a'), 300_000)
    expect((await cc.get('k'))!.freshness).toBe('fresh')
    t = 300_001
    expect((await cc.get('k'))!.freshness).toBe('stale')
  })
  it('L1 미스·L2 히트 시 L1으로 승격', async () => {
    let t = 0
    const l1 = fakeBackend(); const l2 = fakeBackend()
    await l2.set('k', { value: U('b'), storedAt: 0, softTtlMs: 1000 })
    const cc = new CompositeCache(l1, l2, () => t)
    expect((await cc.get('k'))!.entry.value.rows[0].tag).toBe('b')
    expect(l1.store.has('k')).toBe(true)
  })
  it('L2 get/set 예외는 무시되고 L1으로 폴백', async () => {
    const broken: CacheBackend = { async get() { throw new Error('ddb down') }, async set() { throw new Error('ddb down') } }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cc = new CompositeCache(new InMemoryCache(() => 0), broken, () => 0)
    await expect(cc.set('k', U('a'), 1000)).resolves.toBeUndefined()
    await expect(cc.get('k')).resolves.toBeTruthy()
    spy.mockRestore()
  })
  it('setL2로 뒤늦게 L2를 붙일 수 있다', async () => {
    const cc = new CompositeCache(new InMemoryCache(() => 0), undefined, () => 0)
    const l2 = fakeBackend()
    cc.setL2(l2)
    await cc.set('k', U('a'), 1000)
    expect(l2.store.has('k')).toBe(true)
  })
})
