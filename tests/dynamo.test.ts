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
    const item = [...doc.items.values()][0]
    expect(item.expireAt).toBe(Math.floor((1_000_000 + HARD_TTL_MS) / 1000))
    const e = await c.get('u1')
    expect(e!.value.rows[0]).toBe(1)
    expect(e!.softTtlMs).toBe(300_000)
  })
  it('pk는 원문 키가 아닌 sha256 해시 — 인증키 포함 URL이 평문으로 저장되지 않음', async () => {
    const doc = fakeDoc()
    const c = new DynamoDbCache(doc, 'T')
    const url = 'http://openapi.seoul.go.kr:8088/SECRETKEY/json/bikeList/1/5'
    await c.set(url, { value: { rows: [] } as any, storedAt: 0, softTtlMs: 1000 })
    const pk = [...doc.items.keys()][0]
    expect(pk).toMatch(/^[0-9a-f]{64}$/)
    expect(pk).not.toContain('SECRETKEY')
    expect(await c.get(url)).toBeDefined()
  })
  it('380KB 초과 entry는 set을 생략', async () => {
    const doc = fakeDoc()
    const c = new DynamoDbCache(doc, 'T')
    const big = { value: { rows: ['x'.repeat(400_000)] } as any, storedAt: 0, softTtlMs: 1000 }
    await c.set('big', big)
    expect(doc.items.size).toBe(0)
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
  it('비수치 QUOTA_DAILY_LIMIT은 parseQuotaLimit로 1000 폴백', async () => {
    const doc = fakeDoc()
    const oldLimit = process.env.QUOTA_DAILY_LIMIT
    process.env.QUOTA_DAILY_LIMIT = 'not-a-number'
    try {
      const l = new DynamoDbLedger(doc, 'T')
      expect(l['limit']).toBe(1000)
    } finally {
      if (oldLimit === undefined) delete process.env.QUOTA_DAILY_LIMIT
      else process.env.QUOTA_DAILY_LIMIT = oldLimit
    }
  })
})

describe('maybeAttachL2', () => {
  it('CACHE_TABLE_NAME 미설정이면 false (aws-sdk 미로드 경로)', async () => {
    delete process.env.CACHE_TABLE_NAME
    const { maybeAttachL2 } = await import('../src/client/dynamo.js')
    const { SeoulApiClient } = await import('../src/client/seoulApi.js')
    expect(await maybeAttachL2(new SeoulApiClient({ apiKey: 'K', fetchFn: vi.fn() as any }))).toBe(false)
  })
  it('L2 연결 실패도 false 반환 + console.error 호출 (에러 경로 커버)', async () => {
    // DynamoDBClient import를 강제로 실패시킨다
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.CACHE_TABLE_NAME = 'test-table'
    try {
      // 실제 aws-sdk import 실패가 아닌 구조 검증: catch 블록 커버
      // maybeAttachL2의 try-catch는 실제 aws-sdk 호출 실패나 attachL2 실패를 처리한다
      const { maybeAttachL2 } = await import('../src/client/dynamo.js')
      const { SeoulApiClient } = await import('../src/client/seoulApi.js')
      // attachL2를 일부러 throw하도록 모킹하면 catch 경로를 탈 수 있다
      const mockClient = new SeoulApiClient({ apiKey: 'K', fetchFn: vi.fn() as any })
      mockClient.attachL2 = vi.fn().mockImplementation(() => { throw new Error('mock attach fail') })
      const result = await maybeAttachL2(mockClient)
      expect(result).toBe(false)
      expect(errSpy).toHaveBeenCalled()
      expect(errSpy.mock.calls.some(c => c[0]?.includes('L2 연결 실패'))).toBe(true)
    } finally {
      errSpy.mockRestore()
      delete process.env.CACHE_TABLE_NAME
    }
  })
})
