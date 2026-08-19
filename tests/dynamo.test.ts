import { describe, it, expect, vi } from 'vitest'
import { DynamoDbCache, DynamoDbLedger, type DocClientLike } from '../src/client/dynamo.js'
import { HARD_TTL_MS } from '../src/client/cache.js'

const fakeDoc = (): DocClientLike & { items: Map<string, any> } => {
  const items = new Map<string, any>()
  return {
    items,
    async get({ Key }: any) { return { Item: items.get(Key.pk) } },
    async put({ Item }: any) { items.set(Item.pk, Item) },
    async update({ Key, ExpressionAttributeValues }: any) {
      const cur = items.get(Key.pk) ?? { pk: Key.pk, used: 0 }
      cur.used += ExpressionAttributeValues[':one']
      items.set(Key.pk, cur)
      return { Attributes: cur }
    },
  }
}

describe('DynamoDbCache', () => {
  it('set 후 get 왕복 + expireAt은 storedAt+HARD_TTL(초)', async () => {
    const doc = fakeDoc()
    const c = new DynamoDbCache(doc, 'T')
    await c.set('u1', { value: { rows: [1] } as any, storedAt: 1_000_000, softTtlMs: 300_000 })
    const item = doc.items.get('u1')
    expect(item.expireAt).toBe(Math.floor((1_000_000 + HARD_TTL_MS) / 1000))
    const e = await c.get('u1')
    expect(e!.value.rows[0]).toBe(1)
    expect(e!.softTtlMs).toBe(300_000)
  })
  it('380KB 초과 entry는 set을 생략', async () => {
    const doc = fakeDoc()
    const c = new DynamoDbCache(doc, 'T')
    const big = { value: { rows: ['x'.repeat(400_000)] } as any, storedAt: 0, softTtlMs: 1000 }
    await c.set('big', big)
    expect(doc.items.has('big')).toBe(false)
  })
})

describe('DynamoDbLedger', () => {
  it('increment 누적 + status + 키·일별 pk 분리', async () => {
    const doc = fakeDoc()
    let t = Date.UTC(2026, 7, 19, 0, 0)
    const l = new DynamoDbLedger(doc, 'T', 10, () => t)
    await l.increment('abc'); await l.increment('abc')
    expect((await l.status('abc'))).toMatchObject({ used: 2, ratio: 0.2 })
    expect([...doc.items.keys()][0]).toMatch(/^quota#abc#\d{8}$/)
  })
})

describe('maybeAttachL2', () => {
  it('CACHE_TABLE_NAME 미설정이면 false (aws-sdk 미로드 경로)', async () => {
    delete process.env.CACHE_TABLE_NAME
    const { maybeAttachL2 } = await import('../src/client/dynamo.js')
    const { SeoulApiClient } = await import('../src/client/seoulApi.js')
    expect(await maybeAttachL2(new SeoulApiClient({ apiKey: 'K', fetchFn: vi.fn() as any }))).toBe(false)
  })
})
