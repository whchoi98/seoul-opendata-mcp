import { describe, it, expect } from 'vitest'
import { storeNote } from '../../src/client/snapshotSource.js'
import { MAX_BYTES, NEGATIVE_MS, READ_TIMEOUT_MS, REVALIDATE_MS, SnapshotReader } from '../../src/store/reader.js'
import { encodeSnapshot, snapshotKey, type Snapshot } from '../../src/store/snapshot.js'
import type { SnapshotStore, StoredObject } from '../../src/store/snapshotStore.js'

const NOW = Date.parse('2026-11-21T03:00:00.000Z')
const PHARMACY = 'TbPharmacyOperateInfo'
const STATS = 'CardSubwayStatsNew'
const rows = [{ DUTYNAME: '강남온누리약국', DUTYADDR: '서울특별시 강남구 1' }, { DUTYNAME: '역삼약국', DUTYADDR: '서울특별시 강남구 2' }]

const snap = (service: string, partition: string[], r: any[], over: Partial<Snapshot> = {}): Snapshot => ({
  v: 1, service, partition, collectedAt: new Date(NOW - 3_600_000).toISOString(), totalCount: r.length, rows: r, ...over,
})

function memoryStore() {
  const objects = new Map<string, StoredObject>()
  const gets: Array<{ key: string; ifNoneMatch?: string }> = []
  const state = { fail: undefined as Error | undefined, delayMs: 0, version: 0, held: undefined as { key?: string; until: Promise<void> } | undefined }
  const store: SnapshotStore = {
    async get(key, opts) {
      gets.push({ key, ifNoneMatch: opts?.ifNoneMatch })
      if (state.delayMs > 0) await new Promise(r => setTimeout(r, state.delayMs))
      const held = state.held
      if (held && (held.key === undefined || held.key === key)) await held.until
      if (state.fail) throw state.fail
      const o = objects.get(key)
      if (!o) return undefined
      return opts?.ifNoneMatch === o.etag ? 'not-modified' : o
    },
    async put(key, body) { objects.set(key, { body, etag: `"v${++state.version}"` }) },
    async list() { return [] },
  }
  const seed = (s: Snapshot) => store.put(snapshotKey(s.service, s.partition), encodeSnapshot(s))
  /** 이후의 get(key를 주면 그 키만)을 멈춰 둔다. 돌려받은 함수를 부르면 멈춘 get이 이어서 객체를 읽는다 */
  const hold = (key?: string): (() => void) => {
    let release!: () => void
    state.held = { key, until: new Promise<void>(r => { release = r }) }
    return () => { state.held = undefined; release() }
  }
  return { store, objects, gets, state, seed, hold }
}

/** 멈춘 읽기를 풀어 준 뒤 그 읽기가 끝나 메모리에 반영될 때까지 기다린다 */
const settle = () => new Promise(r => setTimeout(r, 5))

function setup(opts: { maxBytes?: number; timeoutMs?: number } = {}) {
  const m = memoryStore()
  const clock = { t: NOW }
  const logs: string[] = []
  const reader = new SnapshotReader(m.store, { now: () => clock.t, log: l => logs.push(l), ...opts })
  return { ...m, clock, logs, reader }
}

describe('storeNote', () => {
  const hit = (over: object = {}) => ({ value: { rows: [{}], totalCount: 1 }, collectedAt: Date.parse('2026-11-20T16:30:00.000Z'), expired: false, ...over })

  it('1건 이상이면 KST 수집 날짜를 적는다', () => {
    expect(storeNote(hit(), NOW)).toBe('사전 적재 데이터(11월 21일 수집)') // UTC 20일 16:30은 KST 21일 01:30
  })
  it('기한이 지났으면 이유와 경과 일수를 적는다', () => {
    const old = hit({ collectedAt: Date.parse('2026-11-18T01:00:00.000Z'), expired: true })
    expect(storeNote(old, NOW, 'quota')).toBe('일일 API 쿼터 소진. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다')
    expect(storeNote(old, NOW, 'rate')).toBe('서울 API 호출 제한. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다')
  })
  it('0건이면 문구를 붙이지 않는다', () => {
    expect(storeNote(hit({ value: { rows: [], totalCount: 0, note: '해당하는 데이터가 없습니다 (X)' } }), NOW)).toBeUndefined()
    expect(storeNote(hit({ value: { rows: [], totalCount: 0 }, expired: true }), NOW, 'quota')).toBeUndefined()
  })
})

describe('SnapshotReader', () => {
  it('상수는 스펙 §6.5와 같다', () => {
    expect(MAX_BYTES).toBe(96 * 1024 * 1024)
    expect(REVALIDATE_MS).toBe(600_000)
    expect(NEGATIVE_MS).toBe(300_000)
    expect(READ_TIMEOUT_MS).toBe(3_000)
  })

  it('스냅샷으로 답하고 10분 안의 같은 키는 다시 읽지 않는다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    const hit = await s.reader.lookup(PHARMACY, 1, 1000, [' ', '온누리'])
    expect(hit).toEqual({ value: { rows: [rows[0]], totalCount: 1 }, collectedAt: NOW - 3_600_000, expired: false })
    s.clock.t += REVALIDATE_MS - 1
    expect((await s.reader.lookup(PHARMACY, 1, 1000, []))!.value.totalCount).toBe(2)
    expect(s.gets).toEqual([{ key: 'TbPharmacyOperateInfo/_all.json.gz', ifNoneMatch: undefined }])
  })

  it('규칙이 없는 서비스와 답할 수 없는 요청은 저장소를 읽지 않는다', async () => {
    const s = setup()
    expect(await s.reader.lookup('citydata_ppltn', 1, 5, ['강남역'])).toBeUndefined()
    expect(await s.reader.lookup(STATS, 1, 1000, [])).toBeUndefined()
    expect(s.gets).toEqual([])
  })

  it('10분이 지나면 ETag 조건부 요청으로 바뀌었는지만 확인한다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, [])
    s.clock.t += REVALIDATE_MS
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.totalCount).toBe(2)
    expect(s.gets[1]).toEqual({ key: 'TbPharmacyOperateInfo/_all.json.gz', ifNoneMatch: '"v1"' })
    // 다시 수집하면 다음 재확인에서 새 내용이 나온다
    await s.seed(snap(PHARMACY, [], [rows[0]]))
    s.clock.t += REVALIDATE_MS
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.totalCount).toBe(1)
    expect(s.gets).toHaveLength(3)
  })

  it('없는 객체는 5분 동안 다시 읽지 않는다', async () => {
    const s = setup()
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    s.clock.t += NEGATIVE_MS - 1
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect(s.gets).toHaveLength(1)
    await s.seed(snap(PHARMACY, [], rows))
    s.clock.t += 1
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
    expect(s.gets).toHaveLength(2)
  })

  it('읽기 오류는 던지지 않고 5분 동안 기억하며 로그를 남긴다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    s.state.fail = Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' })
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect(s.gets).toHaveLength(1)
    expect(s.logs.some(l => l.includes('읽기 실패') && l.includes('AccessDenied'))).toBe(true)
    s.state.fail = undefined
    s.clock.t += NEGATIVE_MS
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
  })

  it('손상된 본문과 형식이 다른 스냅샷은 던지지 않고 답하지 않는다', async () => {
    const s = setup()
    await s.store.put('TbPharmacyOperateInfo/_all.json.gz', Buffer.from('not gzip'))
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    await s.store.put('CardSubwayStatsNew/20261116.json.gz', encodeSnapshot({ ...snap(STATS, ['20261116'], [{}]), v: 2 as 1 }))
    expect(await s.reader.lookup(STATS, 1, 10, ['20261116'])).toBeUndefined()
    expect(s.logs.filter(l => l.includes('읽기 실패'))).toHaveLength(2)
  })

  it('재확인 중 오류가 나면 가진 스냅샷으로 답하고 5분 뒤 다시 확인한다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, [])
    s.clock.t += REVALIDATE_MS
    s.state.fail = new Error('SlowDown')
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.totalCount).toBe(2)
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
    expect(s.gets).toHaveLength(2)
    s.clock.t += NEGATIVE_MS
    await s.reader.lookup(PHARMACY, 1, 10, [])
    expect(s.gets).toHaveLength(3)
  })

  it('재확인에서 객체가 사라졌으면 답하지 않는다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, [])
    s.objects.clear()
    s.clock.t += REVALIDATE_MS
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
  })

  it('같은 키의 동시 요청은 읽기 한 번으로 합친다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    s.state.delayMs = 10
    const hits = await Promise.all(Array.from({ length: 5 }, (_, i) => s.reader.lookup(PHARMACY, 1, 10, [' ', i % 2 ? '온누리' : '역삼'])))
    expect(hits.every(h => h?.value.totalCount === 1)).toBe(true)
    expect(s.gets).toHaveLength(1)
  })

  it('읽기가 시간 제한을 넘으면 그 요청은 넘기고, 읽기는 끝까지 해서 메모리에 둔다', async () => {
    const s = setup({ timeoutMs: 20 })
    await s.seed(snap(PHARMACY, [], rows))
    s.state.delayMs = 60
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect(s.logs.some(l => l.includes('초과'))).toBe(true)
    await new Promise(r => setTimeout(r, 80))
    s.state.delayMs = 0
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.totalCount).toBe(2)
    expect(s.gets).toHaveLength(1)
  })

  it('재확인이 시간 제한을 넘으면 가진 스냅샷으로 답한다. 늦게 끝난 읽기의 새 내용은 다음 요청부터 쓴다', async () => {
    const s = setup({ timeoutMs: 20 })
    await s.seed(snap(PHARMACY, [], rows))
    const first = await s.reader.lookup(PHARMACY, 1, 10, [])
    s.clock.t += REVALIDATE_MS
    const release = s.hold()
    const slow = await s.reader.lookup(PHARMACY, 1, 10, [])
    expect(slow).toEqual(first)
    expect(s.logs.find(l => l.includes('초과'))).toMatch(/^\[store\] 읽기 20ms 초과 TbPharmacyOperateInfo\/_all\.json\.gz — 가진 스냅샷으로 답함$/)
    // 멈춘 읽기가 끝나기 전에 다시 수집되어 새 본문을 받는다
    await s.seed(snap(PHARMACY, [], [rows[0]]))
    release()
    await settle()
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.rows).toEqual([rows[0]])
    expect(s.gets).toHaveLength(2)
  })

  it('가진 스냅샷을 재확인하는 중에 온 요청은 기다리지 않고 가진 것으로 답한다', async () => {
    const s = setup({ timeoutMs: 1_000 })
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, [])
    s.clock.t += REVALIDATE_MS
    const release = s.hold()
    const revalidating = s.reader.lookup(PHARMACY, 1, 10, [])
    const waited = new Promise(r => setTimeout(() => r('기다림'), 50))
    const second = await Promise.race([s.reader.lookup(PHARMACY, 1, 10, [' ', '역삼']), waited])
    expect(second).toEqual({ value: { rows: [rows[1]], totalCount: 1 }, collectedAt: NOW - 3_600_000, expired: false })
    expect(s.gets).toEqual([
      { key: 'TbPharmacyOperateInfo/_all.json.gz', ifNoneMatch: undefined },
      { key: 'TbPharmacyOperateInfo/_all.json.gz', ifNoneMatch: '"v1"' },
    ])
    release()
    expect((await revalidating)!.value.totalCount).toBe(2)
    expect(s.gets).toHaveLength(2)
  })

  it('재확인하는 동안 메모리에서 밀려난 스냅샷이 바뀌지 않았다고 돌아오면 크기를 다시 세어 상한을 지킨다', async () => {
    const pad = 'x'.repeat(1000)
    const days = ['20261101', '20261102', '20261103']
    const one = Buffer.byteLength(JSON.stringify(snap(STATS, [days[0]], [{ USE_YMD: days[0], pad }])))
    const s = setup({ maxBytes: one * 2 + 10 })
    for (const d of days) await s.seed(snap(STATS, [d], [{ USE_YMD: d, pad }]))
    const key = (d: string) => `${STATS}/${d}.json.gz`
    await s.reader.lookup(STATS, 1, 10, [days[0]])
    s.clock.t += REVALIDATE_MS // 0은 재확인 대상이 된다
    const release = s.hold(key(days[0]))
    const revalidating = s.reader.lookup(STATS, 1, 10, [days[0]])
    await s.reader.lookup(STATS, 1, 10, [days[1]])
    await s.reader.lookup(STATS, 1, 10, [days[2]]) // 상한 초과: 재확인 중인 0이 밀려난다
    release()
    expect((await revalidating)!.value.totalCount).toBe(1) // 바뀌지 않았다는 답으로 0을 다시 넣는다. 상한을 넘으므로 1을 버린다
    const reads = () => s.gets.filter(g => g.key !== key(days[0]) || g.ifNoneMatch === undefined).length
    expect(reads()).toBe(3)
    await s.reader.lookup(STATS, 1, 10, [days[2]])
    await s.reader.lookup(STATS, 1, 10, [days[0]])
    expect(reads()).toBe(3) // 0과 2만 메모리에 있다
    await s.reader.lookup(STATS, 1, 10, [days[1]]) // 1은 다시 읽는다. 상한을 넘으므로 가장 오래 안 쓴 2를 버린다
    expect(reads()).toBe(4)
    await s.reader.lookup(STATS, 1, 10, [days[0]])
    await s.reader.lookup(STATS, 1, 10, [days[1]])
    expect(reads()).toBe(4)
    await s.reader.lookup(STATS, 1, 10, [days[2]])
    expect(reads()).toBe(5)
    expect(s.gets.filter(g => g.ifNoneMatch !== undefined)).toEqual([{ key: key(days[0]), ifNoneMatch: '"v1"' }])
  })

  it('메모리 상한을 넘으면 오래 안 쓴 스냅샷부터 버린다', async () => {
    const pad = 'x'.repeat(1000)
    const days = ['20261101', '20261102', '20261103']
    const one = Buffer.byteLength(JSON.stringify(snap(STATS, [days[0]], [{ USE_YMD: days[0], pad }])))
    const s = setup({ maxBytes: one * 2 + 10 })
    for (const d of days) await s.seed(snap(STATS, [d], [{ USE_YMD: d, pad }]))
    await s.reader.lookup(STATS, 1, 10, [days[0]])
    await s.reader.lookup(STATS, 1, 10, [days[1]])
    await s.reader.lookup(STATS, 1, 10, [days[0]]) // 0을 다시 써서 1이 가장 오래 안 쓴 것이 된다
    await s.reader.lookup(STATS, 1, 10, [days[2]]) // 상한 초과: 1을 버린다
    expect(s.gets).toHaveLength(3)
    await s.reader.lookup(STATS, 1, 10, [days[0]])
    await s.reader.lookup(STATS, 1, 10, [days[2]])
    expect(s.gets).toHaveLength(3) // 0과 2는 메모리에 있다
    await s.reader.lookup(STATS, 1, 10, [days[1]])
    expect(s.gets).toHaveLength(4) // 1은 다시 읽는다
  })

  it('상한보다 큰 스냅샷은 보관하지 않고 그 요청에만 쓴다', async () => {
    const s = setup({ maxBytes: 10 })
    await s.seed(snap(PHARMACY, [], rows))
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
    expect(s.gets).toHaveLength(2)
  })

  it('기한이 지난 스냅샷은 allowExpired일 때만 답한다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows, { collectedAt: new Date(NOW - 8 * 86_400_000).toISOString() }))
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect((await s.reader.lookup(PHARMACY, 1, 10, [], { allowExpired: true }))!.expired).toBe(true)
  })

  it('읽을 때마다 키, 크기, 행 수, 시간, 힙을 한 줄로 남기고 요청 인자는 남기지 않는다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, ['강남구', '온누리'])
    const line = s.logs.find(l => l.includes('읽음'))!
    expect(line).toMatch(/^\[store\] 읽음 TbPharmacyOperateInfo\/_all\.json\.gz: 압축 \d+B, 원본 \d+B, 2행, \d+ms, 힙 \d+MB$/)
    expect(s.logs.join('\n')).not.toContain('온누리')
    expect(s.logs.join('\n')).not.toContain('강남구')
  })
})
