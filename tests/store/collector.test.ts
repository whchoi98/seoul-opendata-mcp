import { describe, it, expect } from 'vitest'
import { SeoulApiError, type Unwrapped } from '../../src/client/response.js'
import { InMemoryLedger, keyIdOf } from '../../src/client/quota.js'
import {
  CALL_CAP_EXTRA, CALL_DELAY_MS, DAILY_SKIP_MS, PAGE, STATIC_SKIP_MS, collect, formatPlan, formatQuota, formatReport, formatStatus,
  indexExisting, planCollection, recentDates, recentMonths, remainingQuota, stationCodes, statusOf, type CollectClient,
} from '../../src/store/collector.js'
import { decodeSnapshot, encodeSnapshot, isHead, snapshotKey, type Snapshot } from '../../src/store/snapshot.js'
import type { SnapshotStore } from '../../src/store/snapshotStore.js'

const NOW = Date.parse('2026-11-21T03:00:00.000Z') // KST 11월 21일 12:00
const HOUR = 3_600_000
const DAY = 86_400_000
const PHARMACY = 'TbPharmacyOperateInfo'
const STATS = 'CardSubwayStatsNew'
const STATION = 'SearchInfoBySubwayNameService'
const FIRST_LAST = 'SearchFirstAndLastTrainbyLineServiceNew'
const TIMETABLE = 'SearchSTNTimeTableByIDService'

type Req = { service: string; start: number; end: number; path: string[] }

function fakeClient(handler: (r: Req) => Unwrapped) {
  const calls: Req[] = []
  const client: CollectClient = {
    isSample: false,
    async getJson(service, start, end, path = []) {
      const r = { service, start, end, path }
      calls.push(r)
      return handler(r)
    },
  }
  return { client, calls }
}

/** 전체 total행 가운데 요청 범위의 행. 범위를 벗어나면 서울 API처럼 "데이터 없음" */
const page = (r: Req, total: number): Unwrapped => {
  const rows = []
  for (let i = r.start; i <= Math.min(r.end, total); i++) rows.push({ i })
  return rows.length > 0 ? { rows, totalCount: total } : noData(r.service)
}
const noData = (service: string): Unwrapped => ({ rows: [], totalCount: 0, note: `해당하는 데이터가 없습니다 (${service})` })

function memoryStore() {
  const objects = new Map<string, { body: Buffer; lastModified: number }>()
  const clock = { t: NOW }
  const store: SnapshotStore = {
    async get(key) { const o = objects.get(key); return o ? { body: o.body, etag: 'e' } : undefined },
    async put(key, body) { objects.set(key, { body, lastModified: clock.t }) },
    async list(prefix) {
      return [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, lastModified: o.lastModified, size: o.body.length }))
    },
  }
  const seed = (service: string, partition: string[], rows: any[], at = NOW, totalCount = rows.length) => {
    const s: Snapshot = { v: 1, service, partition, collectedAt: new Date(at).toISOString(), totalCount, rows }
    objects.set(snapshotKey(service, partition), { body: encodeSnapshot(s), lastModified: at })
  }
  const read = (service: string, partition: string[]) => decodeSnapshot(objects.get(snapshotKey(service, partition))!.body).snapshot
  return { store, objects, clock, seed, read }
}

const run = (client: CollectClient, store: SnapshotStore, opts: Partial<Parameters<typeof collect>[2]> = {}) =>
  collect(client, store, { bundle: 'daily', now: () => NOW, delayMs: 0, ...opts })

describe('날짜와 월 후보', () => {
  it('어제(KST)부터 거꾸로 n일', () => {
    expect(recentDates(NOW, 3)).toEqual(['20261120', '20261119', '20261118'])
    expect(recentDates(Date.parse('2026-11-20T15:30:00.000Z'), 2)).toEqual(['20261120', '20261119']) // KST 21일 00:30
    expect(recentDates(Date.parse('2026-03-01T03:00:00.000Z'), 2)).toEqual(['20260228', '20260227'])
  })
  it('지난달부터 거꾸로 n개월', () => {
    expect(recentMonths(NOW, 3)).toEqual(['202610', '202609', '202608'])
    expect(recentMonths(Date.parse('2026-01-15T03:00:00.000Z'), 2)).toEqual(['202512', '202511'])
  })
})

describe('indexExisting', () => {
  it('서비스별로 파티션 키와 수정 시각을 묶고 형식이 다른 키는 버린다', () => {
    const idx = indexExisting([
      { key: 'A/_all.json.gz', lastModified: 1, size: 1 },
      { key: 'B/20261116.json.gz', lastModified: 2, size: 1 },
      { key: 'B/20261117.json.gz', lastModified: 3, size: 1 },
      { key: 'stray.txt', lastModified: 4, size: 1 },
    ])
    expect([...idx.keys()]).toEqual(['A', 'B'])
    expect(idx.get('B')!.get('20261117')).toBe(3)
    expect(idx.get('A')!.get('_all')).toBe(1)
  })
})

describe('planCollection', () => {
  it('빈 저장소의 매일 묶음은 35종, 예상 144회다', async () => {
    const { store } = memoryStore()
    const plans = await planCollection(store, { bundle: 'daily', now: NOW })
    expect(plans).toHaveLength(35)
    // 전체 42 + 머리 19 + 일별 승하차 14+10 + 버스 1+10 + 시간대별 3+2 + 생활인구 3x11+10
    expect(plans.reduce((n, p) => n + p.estimated, 0)).toBe(144)
    expect(plans.find(p => p.service === STATS)).toMatchObject({ mode: 'scan', count: 14 })
    expect(plans.find(p => p.service === STATS)!.partitions).toHaveLength(24)
    expect(plans.find(p => p.service === 'CardSubwayTime')!.partitions).toEqual([['202610'], ['202609'], ['202608'], ['202607'], ['202606']])
  })

  it('정적 묶음은 첫차와 막차 54개와 시간표다. 역 코드 스냅샷이 없으면 300개 역으로 어림한다', async () => {
    const { store } = memoryStore()
    const plans = await planCollection(store, { bundle: 'static', now: NOW })
    expect(plans.map(p => p.service)).toEqual([FIRST_LAST, TIMETABLE])
    expect(plans[0].partitions).toHaveLength(54)
    expect(plans[0].partitions[0]).toEqual(['1호선', '1', '1'])
    expect(plans[0].estimated).toBe(54)
    expect(plans[1]).toMatchObject({ needsStations: true, estimated: 1801 })
  })

  it('--days는 날짜 파티션 세 종의 개수만 바꾼다', async () => {
    const { store } = memoryStore()
    const plans = await planCollection(store, { bundle: 'daily', now: NOW, days: 2 })
    const count = (id: string) => plans.find(p => p.service === id)!.count
    expect([count(STATS), count('SPOP_LOCAL_RESD_DONG'), count('CardBusStatisticsServiceNew')]).toEqual([2, 2, 2])
    expect(count('CardSubwayTime')).toBe(3)
  })

  it('--only는 그 서비스만 남기고, 규칙 표에 없는 이름은 거부한다', async () => {
    const { store } = memoryStore()
    expect((await planCollection(store, { bundle: 'daily', now: NOW, only: [PHARMACY, 'GetParkInfo'] })).map(p => p.service)).toEqual([PHARMACY, 'GetParkInfo'])
    expect(await planCollection(store, { bundle: 'daily', now: NOW, only: [TIMETABLE] })).toEqual([]) // 다른 묶음
    await expect(planCollection(store, { bundle: 'daily', now: NOW, only: ['citydata'] })).rejects.toThrow('규칙 표에 없는 서비스: citydata')
  })
})

describe('collect', () => {
  it('전체 스냅샷은 1,000행씩 끝 페이지까지 받아 한 번에 쓴다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => page(r, 2500))
    const report = await run(client, m.store, { only: [PHARMACY] })
    expect(calls.map(c => [c.start, c.end])).toEqual([[1, 1000], [1001, 2000], [2001, 3000]])
    expect(calls.every(c => c.path.length === 0)).toBe(true)
    const s = m.read(PHARMACY, [])
    expect(s.rows).toHaveLength(2500)
    expect(s.rows[2499]).toEqual({ i: 2500 })
    expect(s.totalCount).toBe(2500)
    expect(s.collectedAt).toBe(new Date(NOW).toISOString())
    expect(report).toMatchObject({ started: true, ok: true, calls: 3 })
    expect(report.results).toEqual([{ service: PHARMACY, saved: 1, skipped: 0, empty: 0, calls: 3, warnings: [] }])
  })

  it('머리 스냅샷은 첫 1,000행과 전체 건수만 받는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => page(r, 814_076))
    await run(client, m.store, { only: ['ListNecessariesPricesService'] })
    expect(calls).toHaveLength(1)
    const s = m.read('ListNecessariesPricesService', [])
    expect(s.rows).toHaveLength(PAGE)
    expect(s.totalCount).toBe(814_076)
    expect(isHead(s)).toBe(true)
  })

  it('매일 묶음의 스냅샷은 수집한 지 1시간 이내면 건너뛴다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], [{ old: 1 }], NOW - DAILY_SKIP_MS + 1)
    m.seed('GetParkInfo', [], [{ old: 1 }], NOW - DAILY_SKIP_MS)
    const { client, calls } = fakeClient(r => page(r, 3))
    const report = await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] })
    expect(calls.map(c => c.service)).toEqual(['GetParkInfo'])
    expect(m.read(PHARMACY, []).rows).toEqual([{ old: 1 }])
    expect(report.results[0]).toMatchObject({ service: PHARMACY, saved: 0, skipped: 1, calls: 0 })
  })

  it('날짜 파티션은 어제부터 거꾸로 가며 없는 날짜만 받고, 공개 전 날짜는 저장하지 않는다', async () => {
    const m = memoryStore()
    m.seed(STATS, ['20261116'], [{ USE_YMD: '20261116' }], NOW - 5 * DAY)
    const { client, calls } = fakeClient(r => (r.path[0] <= '20261117' ? page(r, 616) : noData(r.service)))
    const report = await run(client, m.store, { only: [STATS], days: 3 })
    // 20, 19, 18일은 공개 전. 17일을 받고, 16일은 이미 있고, 15일을 받으면 3개가 찬다
    expect(calls.map(c => c.path[0])).toEqual(['20261120', '20261119', '20261118', '20261117', '20261115'])
    expect([...m.objects.keys()].sort()).toEqual(['20261115', '20261116', '20261117'].map(d => `${STATS}/${d}.json.gz`))
    expect(m.read(STATS, ['20261117'])).toMatchObject({ partition: ['20261117'], totalCount: 616 })
    expect(report.results[0]).toMatchObject({ saved: 2, skipped: 1, empty: 3, calls: 5 })
    expect(report.ok).toBe(true)
  })

  it('공개된 날짜가 없으면 개수에 10일을 더한 만큼만 거슬러 올라가고 실패로 보지 않는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => noData(r.service))
    const report = await run(client, m.store, { only: [STATS], days: 3 })
    expect(calls).toHaveLength(13)
    expect(m.objects.size).toBe(0)
    expect(report).toMatchObject({ ok: true })
    expect(report.results[0]).toMatchObject({ saved: 0, empty: 13 })
  })

  it('정적 묶음의 스냅샷은 수집한 지 7일 이내면 건너뛴다', async () => {
    const m = memoryStore()
    m.seed(FIRST_LAST, ['1호선', '1', '1'], [{ a: 1 }], NOW - STATIC_SKIP_MS + 1)
    m.seed(FIRST_LAST, ['1호선', '1', '2'], [{ a: 1 }], NOW - STATIC_SKIP_MS)
    const { client, calls } = fakeClient(r => page(r, 51))
    const report = await run(client, m.store, { bundle: 'static', only: [FIRST_LAST] })
    expect(calls).toHaveLength(53)
    expect(calls.some(c => c.path.join('_') === '1호선_1_1')).toBe(false)
    expect(calls[0].path).toEqual(['1호선', '1', '2'])
    expect(report.results[0]).toMatchObject({ saved: 53, skipped: 1 })
  })

  it('시간표는 역 코드 스냅샷의 1~9호선 역마다 요일 3종, 방향 2종을 받는다', async () => {
    const m = memoryStore()
    m.seed(STATION, [], [
      { STATION_CD: '0222', LINE_NUM: '02호선' }, { STATION_CD: '0150', LINE_NUM: '01호선' },
      { STATION_CD: '1251', LINE_NUM: '경의선' }, { STATION_CD: '0222', LINE_NUM: '02호선' }, { STATION_CD: '../x', LINE_NUM: '03호선' },
    ])
    // 형식에 맞지 않는 코드는 파티션을 만들 때 걸러진다
    expect(await stationCodes(m.store)).toEqual(['../x', '0150', '0222'])
    const { client, calls } = fakeClient(r => page(r, 239))
    const report = await run(client, m.store, { bundle: 'static', only: [TIMETABLE] })
    expect(calls).toHaveLength(12)
    expect(calls.map(c => c.path.join('_')).slice(0, 7)).toEqual(['0150_1_1', '0150_1_2', '0150_2_1', '0150_2_2', '0150_3_1', '0150_3_2', '0222_1_1'])
    expect(m.objects.has(`${TIMETABLE}/0222_3_2.json.gz`)).toBe(true)
    expect(report.results[0]).toMatchObject({ saved: 12 })
  })

  it('역 코드 스냅샷이 없으면 먼저 받은 뒤 시간표를 받는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => (r.service === STATION
      ? { rows: [{ STATION_CD: '0222', LINE_NUM: '02호선' }], totalCount: 1 }
      : page(r, 10)))
    const report = await run(client, m.store, { bundle: 'static', only: [TIMETABLE] })
    expect(calls[0]).toMatchObject({ service: STATION, path: [] })
    expect(calls).toHaveLength(7)
    expect(m.objects.has(`${STATION}/_all.json.gz`)).toBe(true)
    expect(report.results[0].warnings.join(' ')).toContain('역 코드 스냅샷')
  })

  it('한 데이터셋이 SeoulApiError로 실패하면 이전 스냅샷을 그대로 두고 다음 데이터셋으로 넘어간다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], [{ old: 1 }], NOW - 2 * HOUR)
    const before = m.objects.get(`${PHARMACY}/_all.json.gz`)!.body
    const { client } = fakeClient(r => {
      if (r.service === PHARMACY && r.start > 1) throw new SeoulApiError('TIMEOUT', '응답 시간 초과(15초) (key=ABCD…(masked))')
      return page(r, 2500)
    })
    const report = await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] })
    expect(m.objects.get(`${PHARMACY}/_all.json.gz`)!.body).toBe(before)
    expect(m.read('GetParkInfo', []).rows).toHaveLength(2500)
    expect(report.ok).toBe(false)
    expect(report.aborted).toBeUndefined()
    expect(report.results[0]).toMatchObject({ service: PHARMACY, saved: 0, calls: 2 })
    expect(report.results[0].error).toContain('응답 시간 초과')
    expect(report.results[1]).toMatchObject({ service: 'GetParkInfo', saved: 1 })
  })

  it('쿼터 소진이나 호출 제한 응답을 받으면 실패로 처리하고 실행을 끝낸다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(() => ({ rows: [], totalCount: 0, note: '일일 API 쿼터(3000회)가 소진되어 새 데이터를 가져올 수 없습니다. 내일 자정(KST) 이후 재시도하세요.' }))
    const report = await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] })
    expect(calls).toHaveLength(1)
    expect(report.ok).toBe(false)
    expect(report.aborted).toContain('소진되어')
    expect(report.results).toHaveLength(1)
    expect(m.objects.size).toBe(0)
  })

  it('받은 행이 전체 건수보다 적으면 경고를 내고 그대로 저장한다(머리 스냅샷이 된다)', async () => {
    const m = memoryStore()
    const { client } = fakeClient(r => (r.start === 1 ? { rows: Array.from({ length: 1000 }, (_, i) => ({ i })), totalCount: 2500 } : noData(r.service)))
    const report = await run(client, m.store, { only: [PHARMACY] })
    expect(isHead(m.read(PHARMACY, []))).toBe(true)
    expect(report.results[0].warnings[0]).toContain('2500행 중 1000행')
    expect(report.ok).toBe(true)
  })

  it('수집을 시작하면 먼저 데이터셋별 예상 호출 수를 보여 준다. 시작하지 않으면 로그를 남기지 않는다', async () => {
    const m = memoryStore()
    const { client } = fakeClient(r => page(r, 3))
    const lines: string[] = []
    const report = await run(client, m.store, { only: [PHARMACY], remaining: 100, log: l => lines.push(l) })
    expect(lines).toEqual([formatPlan(report), `${PHARMACY}: 저장 1, 건너뜀 0, 데이터 없음 0, 호출 1`])
    expect(lines[0]).toContain(`${PHARMACY}: 받을 스냅샷 1개, 건너뜀 0개, 예상 6회`)
    expect(lines[0]).toContain('남은 한도 합계: 100회')
    const quiet: string[] = []
    const empty = memoryStore()
    expect(await run(client, empty.store, { only: [PHARMACY], dryRun: true, log: l => quiet.push(l) })).toMatchObject({ started: false })
    expect(await run(client, empty.store, { only: [PHARMACY], remaining: 5, log: l => quiet.push(l) })).toMatchObject({ started: false })
    expect(quiet).toEqual([])
  })

  it('실제 호출 수가 예상 상한의 2배에 10회를 더한 값에 닿으면 실행을 끝내고, 그 데이터셋은 쓰지 않는다', async () => {
    const m = memoryStore()
    const fullPage = Array.from({ length: PAGE }, (_, i) => ({ i }))
    // 공영주차장 안내의 전체 건수가 규칙 표의 가정(3페이지)보다 훨씬 크다
    const { client, calls } = fakeClient(r => (r.service === 'GetParkInfo' ? { rows: fullPage, totalCount: 900_000_000 } : page(r, 3)))
    const report = await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] })
    expect(report.estimated).toBe(9)
    const cap = 2 * 9 + 10
    expect(report.calls).toBe(cap)
    expect(CALL_CAP_EXTRA).toBe(10)
    expect(calls).toHaveLength(cap)
    expect(report.aborted).toBe(`호출 ${cap}회가 예상 상한 9회의 2배를 넘어 중단했습니다. 규칙 표의 스냅샷당 호출 수를 확인하세요`)
    expect(report.ok).toBe(false)
    // 호출 수는 실행 전체로 센다: 약국 1회 + 공영주차장 27회
    expect(report.results).toMatchObject([{ service: PHARMACY, saved: 1, calls: 1 }, { service: 'GetParkInfo', saved: 0, calls: cap - 1 }])
    expect(m.objects.has(`GetParkInfo/_all.json.gz`)).toBe(false)
    expect(m.objects.has(`${PHARMACY}/_all.json.gz`)).toBe(true)
  })

  it('예상 호출 수가 남은 한도를 넘으면 --force 없이는 시작하지 않는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => page(r, 3))
    const blocked = await run(client, m.store, { only: [PHARMACY], remaining: 5 })
    expect(blocked).toMatchObject({ started: false, ok: false, estimated: 6 })
    expect(blocked.reason).toContain('--force')
    expect(calls).toHaveLength(0)
    const forced = await run(client, m.store, { only: [PHARMACY], remaining: 5, force: true })
    expect(forced).toMatchObject({ started: true, ok: true })
    expect(calls).toHaveLength(1)
  })

  it('--dry-run은 계획만 만들고 서울 API를 부르지 않는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => page(r, 3))
    const report = await run(client, m.store, { dryRun: true })
    expect(report).toMatchObject({ started: false, ok: true, estimated: 144 })
    expect(calls).toHaveLength(0)
    expect(m.objects.size).toBe(0)
    expect(formatPlan(report)).toContain('예상 호출 합계(상한): 144회')
  })

  it('샘플 키로는 수집하지 않는다', async () => {
    const m = memoryStore()
    const { client } = fakeClient(r => page(r, 3))
    await expect(collect({ ...client, isSample: true }, m.store, { bundle: 'daily' })).rejects.toThrow('샘플 키')
  })

  it('호출 사이 간격의 기본값은 200ms다', () => {
    expect(CALL_DELAY_MS).toBe(200)
  })
})

describe('쿼터와 출력', () => {
  it('남은 한도를 키별로 세고 키는 마스킹해서만 보여 준다', async () => {
    const ledger = new InMemoryLedger(1000)
    for (let i = 0; i < 3; i++) await ledger.increment(keyIdOf('RAWKEYONE1234'))
    const q = await remainingQuota(['RAWKEYONE1234', 'RAWKEYTWO5678'], ledger)
    expect(q.remaining).toBe(1997)
    expect(q.keys).toEqual([{ key: 'RAWK…(masked)', used: 3, limit: 1000 }, { key: 'RAWK…(masked)', used: 0, limit: 1000 }])
    const text = formatQuota(q)
    expect(text).toContain('남은 한도 합계: 1997회')
    expect(text).not.toContain('RAWKEYONE1234')
    expect(text).not.toContain('RAWKEYTWO5678')
  })

  it('결과 표에 데이터셋별 저장, 건너뜀, 실패, 경고와 실제 호출 수가 있다', async () => {
    const m = memoryStore()
    const { client } = fakeClient(r => {
      if (r.service === 'GetParkInfo') throw new SeoulApiError('HTTP-500', 'HTTP 500 (key=ABCD…(masked))')
      return page(r, 3)
    })
    const text = formatReport(await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] }))
    expect(text).toContain(`${PHARMACY}: 저장 1, 건너뜀 0, 데이터 없음 0, 호출 1`)
    expect(text).toContain('GetParkInfo: 저장 0, 건너뜀 0, 데이터 없음 0, 호출 1, 실패: HTTP 500')
    expect(text).toContain('실제 호출 합계: 2회')
  })

  it('status는 데이터셋별 스냅샷 수, 수집 시각, 기한 내 여부를 보여 준다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], [{}], NOW - 2 * DAY)
    m.seed('ListPublicReservationSport', [], [{}], NOW - 2 * DAY)
    m.seed(STATS, ['20261116'], [{}], NOW - 100 * DAY)
    m.seed(STATS, ['20261117'], [{}], NOW - DAY)
    m.seed(FIRST_LAST, ['1호선', '1', '1'], [{}], NOW - 31 * DAY)
    m.seed(FIRST_LAST, ['1호선', '1', '2'], [{}], NOW - DAY)
    const list = await statusOf(m.store, NOW)
    expect(list).toHaveLength(37)
    const of = (id: string) => list.find(s => s.service === id)!
    expect(of(PHARMACY)).toMatchObject({ count: 1, state: '기한 내', newest: NOW - 2 * DAY })
    expect(of('ListPublicReservationSport')).toMatchObject({ count: 1, state: '기한 초과' })
    expect(of(STATS)).toMatchObject({ count: 2, state: '기한 없음', oldest: NOW - 100 * DAY, newest: NOW - DAY })
    expect(of(FIRST_LAST)).toMatchObject({ count: 2, state: '기한 초과' })
    expect(of('GetParkInfo')).toMatchObject({ count: 0, state: '없음' })
    const text = formatStatus(list)
    expect(text).toContain(`${PHARMACY}: 1개, 최근 11-19 12:00, 기한 내`)
    expect(text).toContain('GetParkInfo: 없음')
  })
})
