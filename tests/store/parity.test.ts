import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unwrap } from '../../src/client/response.js'
import { SnapshotReader } from '../../src/store/reader.js'
import { encodeSnapshot, snapshotKey } from '../../src/store/snapshot.js'
import { DirectoryStore } from '../../src/store/snapshotStore.js'
import { callTool, rowsUpstream, type Call } from '../helpers/mcp.js'

const PHARMACY = 'TbPharmacyOperateInfo'
const SPORT = 'ListPublicReservationSport'
const STATION = 'SearchInfoBySubwayNameService'
const FIRST_LAST = 'SearchFirstAndLastTrainbyLineServiceNew'
const TIMETABLE = 'SearchSTNTimeTableByIDService'

const fixture = (svc: string, file: string) => unwrap(svc, JSON.parse(readFileSync(`tests/fixtures/${file}`, 'utf8'))).rows
const pharmacyRows = fixture(PHARMACY, 'pharmacy.json')
const sportRows = fixture(SPORT, 'reservation.json')
const stationRows = fixture(STATION, 'subway_station.json')
const firstLastRows = fixture(FIRST_LAST, 'subway_firstlast.json')
const timetableRows = fixture(TIMETABLE, 'subway_timetable.json')

// 강남(2호선, 역 코드 0222)의 자료를 픽스처 행으로 만든다. 하행 첫차와 막차는 일부러 비워 0건 경로도 지나게 한다
const gangnam = { ...stationRows[0], STATION_NM: '강남', STATION_CD: '0222', LINE_NUM: '02호선' }
const DATA: Array<{ service: string; partition: string[]; rows: any[] }> = [
  { service: PHARMACY, partition: [], rows: pharmacyRows },
  { service: SPORT, partition: [], rows: sportRows },
  { service: STATION, partition: [], rows: [...stationRows, gangnam] },
  { service: FIRST_LAST, partition: ['2호선', '1', '1'], rows: [...firstLastRows.filter((r: any) => r.SUBW_CD !== '0222'), { ...firstLastRows[0], SUBW_CD: '0222' }] },
  { service: FIRST_LAST, partition: ['2호선', '2', '1'], rows: firstLastRows.filter((r: any) => r.SUBW_CD !== '0222').map((r: any) => ({ ...r, UPLN_DNLN: '2' })) },
  { service: TIMETABLE, partition: ['0222', '1', '1'], rows: timetableRows },
  { service: TIMETABLE, partition: ['0222', '1', '2'], rows: timetableRows.map((r: any) => ({ ...r, INOUT_TAG: '2' })) },
]

// 서울 API의 자리별 동작을 손으로 적은 표. src/store/rules.ts를 쓰지 않는다
type Slot = ['partition'] | ['eq' | 'contains', string]
const SEMANTICS: Record<string, Slot[]> = {
  [PHARMACY]: [['contains', 'DUTYADDR'], ['contains', 'DUTYNAME']],
  [SPORT]: [['contains', 'MINCLASSNM']],
  [STATION]: [['eq', 'STATION_NM']],
  [FIRST_LAST]: [['partition'], ['partition'], ['partition'], ['eq', 'SUBW_CD'], ['eq', 'OTSD_CD']],
  [TIMETABLE]: [['partition'], ['partition'], ['partition']],
}

function upstream(c: Call): { rows: any[]; total: number } {
  const slots = SEMANTICS[c.svc]
  if (!slots) throw new Error(`동등성 테스트에 없는 서비스: ${c.svc}`)
  const values = c.path.map(v => v.trim())
  const partition = values.filter((_, i) => slots[i]?.[0] === 'partition').join('|')
  const data = DATA.find(d => d.service === c.svc && d.partition.join('|') === partition)?.rows ?? []
  const filtered = data.filter(row => slots.every((slot, i) => {
    const value = values[i] ?? ''
    if (slot[0] === 'partition' || value === '') return true
    const cell = String(row[slot[1]] ?? '').trim()
    return slot[0] === 'eq' ? cell === value : cell.includes(value)
  }))
  return { rows: filtered.slice(c.start - 1, c.end), total: filtered.length }
}

const STORE_NOTE = /^사전 적재 데이터\(\d+월 \d+일 수집\)$/

describe('저장소 응답과 서울 API 응답의 동등성', () => {
  let dir: string
  let reader: SnapshotReader

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'seoul-parity-'))
    const store = new DirectoryStore(dir)
    for (const d of DATA) {
      await store.put(snapshotKey(d.service, d.partition), encodeSnapshot({
        v: 1, service: d.service, partition: d.partition, collectedAt: new Date().toISOString(), totalCount: d.rows.length, rows: d.rows,
      }))
    }
    reader = new SnapshotReader(store, { log: () => {} })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  async function both(name: string, args: Record<string, unknown>) {
    const live = rowsUpstream(upstream)
    const liveBody = await callTool(live.fetchFn, name, args)
    const stored = rowsUpstream(upstream)
    const storeBody = await callTool(stored.fetchFn, name, args, { store: reader })
    expect(live.calls.length).toBeGreaterThan(0)
    expect(stored.calls).toEqual([]) // 저장소가 모든 요청에 답했다
    expect(storeBody.data).toEqual(liveBody.data)
    expect(storeBody.source).toBe(liveBody.source)
    expect(storeBody.notes.filter((n: string) => !STORE_NOTE.test(n))).toEqual(liveBody.notes)
    return { liveBody, storeBody }
  }

  it('find_pharmacies: 인자 없음, 자치구, 약국명', async () => {
    const all = await both('find_pharmacies', {})
    expect(all.storeBody.data.count).toBe(pharmacyRows.length)
    expect(all.storeBody.notes.some((n: string) => STORE_NOTE.test(n))).toBe(true)
    const district = String(pharmacyRows[0].DUTYADDR).split(' ')[1] // 픽스처 첫 행의 자치구
    const byDistrict = await both('find_pharmacies', { district })
    expect(byDistrict.storeBody.data.count).toBeGreaterThan(0)
    const byName = await both('find_pharmacies', { name: String(pharmacyRows[0].DUTYNAME).slice(0, 3) })
    expect(byName.storeBody.data.count).toBeGreaterThan(0)
  })

  it('find_pharmacies: 조건에 맞는 약국이 없으면 양쪽 모두 같은 "데이터 없음" 안내만 있다', async () => {
    const none = await both('find_pharmacies', { name: '세상에없는약국이름' })
    expect(none.storeBody.data.count).toBe(0)
    expect(none.storeBody.notes).toEqual(none.liveBody.notes)
    expect(none.storeBody.notes.join(' ')).toContain('해당하는 데이터가 없습니다 (TbPharmacyOperateInfo)')
  })

  it('search_public_reservations: 분야 전체와 소분류', async () => {
    const all = await both('search_public_reservations', { category: 'sports', limit: 50 })
    expect(all.storeBody.data.count).toBe(sportRows.length)
    const sub = await both('search_public_reservations', { category: 'sports', subcategory: String(sportRows[0].MINCLASSNM) })
    expect(sub.storeBody.data.count).toBeGreaterThan(0)
  })

  it('get_subway_schedule: 역 찾기, 첫차와 막차, 시간표', async () => {
    const r = await both('get_subway_schedule', { station: '강남', day: 'weekday', includeTimetable: true, after: '05:00', limit: 3 })
    const line = r.storeBody.data.lines[0]
    expect(line.line).toBe('2호선')
    expect(line.stationCode).toBe('0222')
    expect(line.directions[0].first).not.toBeNull()
    expect(line.directions[1].first).toBeNull() // 하행은 0건: "데이터 없음"으로 읽혀 안내가 붙지 않는다
    expect(line.directions[0].timetable.length).toBeGreaterThan(0)
    expect(r.storeBody.notes.some((n: string) => STORE_NOTE.test(n))).toBe(true)
  })
})
