import { describe, it, expect, vi } from 'vitest'
import { InMemoryCache, CompositeCache, HARD_TTL_MS, type CacheBackend, type CacheEntry } from '../src/client/cache.js'

const U = (tag: string) => ({ rows: [{ tag }], totalCount: 1 }) as any

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

  it('maxEntries를 넘으면 가장 오래 쓰이지 않은 항목부터 제거한다 (LRU)', async () => {
    const c = new InMemoryCache(() => 0, HARD_TTL_MS, 2)
    await c.set('a', { value: U('a'), storedAt: 0, softTtlMs: 1000 })
    await c.set('b', { value: U('b'), storedAt: 0, softTtlMs: 1000 })
    await c.get('a') // a를 최근 사용으로 갱신 → 다음 제거 대상은 b
    await c.set('c', { value: U('c'), storedAt: 0, softTtlMs: 1000 })
    expect(await c.get('b')).toBeUndefined()
    expect(await c.get('a')).toBeTruthy()
    expect(await c.get('c')).toBeTruthy()
  })

  it('기본 상한은 MAX_L1_ENTRIES다', async () => {
    const { MAX_L1_ENTRIES } = await import('../src/client/cache.js')
    const c = new InMemoryCache(() => 0)
    for (let i = 0; i <= MAX_L1_ENTRIES; i++) await c.set(`k${i}`, { value: U(String(i)), storedAt: 0, softTtlMs: 1000 })
    expect(await c.get('k0')).toBeUndefined()
    expect(await c.get(`k${MAX_L1_ENTRIES}`)).toBeTruthy()
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
