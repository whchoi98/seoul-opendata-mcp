import { describe, it, expect } from 'vitest'
import { InMemoryLedger } from '../../src/client/quota.js'
import type { Unwrapped } from '../../src/client/response.js'
import type { CollectClient } from '../../src/store/collector.js'
import type { SnapshotStore } from '../../src/store/snapshotStore.js'
import { runDaily, type Deps } from '../../infra/lambda/collect.js'

function deps(handler: (service: string) => Unwrapped): Deps & { logs: string[]; objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>()
  const logs: string[] = []
  const store: SnapshotStore = {
    async get(key) { const body = objects.get(key); return body ? { body } : undefined },
    async put(key, body) { objects.set(key, body) },
    async list() { return [...objects.keys()].map(key => ({ key, lastModified: Date.now(), size: 1 })) },
  }
  const client: CollectClient = { isSample: false, async getJson(service) { return handler(service) } }
  return { client, store, keys: ['RAWKEYONE1234'], ledger: new InMemoryLedger(1000), log: l => logs.push(l), delayMs: 0, logs, objects }
}

describe('수집 Lambda', () => {
  it('매일 묶음을 받아 저장하고 호출 수와 저장 수를 돌려준다', async () => {
    const d = deps(() => ({ rows: [{ a: 1 }], totalCount: 1 }))
    const out = await runDaily(d)
    expect(out.saved).toBeGreaterThanOrEqual(31) // 전체 12종과 머리 19종, 그리고 공개된 날짜 파티션
    expect(out.calls).toBeGreaterThanOrEqual(out.saved)
    expect(d.objects.has('TbPharmacyOperateInfo/_all.json.gz')).toBe(true)
    expect(d.logs.join('\n')).toContain('[daily] 수집 결과')
  })

  it('실패가 있으면 던져서 Lambda 호출을 실패로 남긴다', async () => {
    const d = deps(() => ({ rows: [], totalCount: 0, note: '일일 API 쿼터(1000회)가 소진되어 새 데이터를 가져올 수 없습니다.' }))
    await expect(runDaily(d)).rejects.toThrow('소진되어')
    expect(d.objects.size).toBe(0)
  })

  it('로그에 원문 키가 없다', async () => {
    const d = deps(() => ({ rows: [{ a: 1 }], totalCount: 1 }))
    await runDaily(d)
    expect(d.logs.join('\n')).toContain('RAWK…(masked)')
    expect(d.logs.join('\n')).not.toContain('RAWKEYONE1234')
  })
})
