import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import {
  lineLabel, formatHms, normalizeSubwayStations, normalizeFirstLast, normalizeTimetable, DIRECTION, DAY,
} from '../src/normalize/subwaySchedule.js'
import { rowsUpstream, callTool } from './helpers/mcp.js'

const fixture = (svc: string, file: string) => unwrap(svc, JSON.parse(readFileSync(`tests/fixtures/${file}`, 'utf8'))).rows
const stationRows = fixture('SearchInfoBySubwayNameService', 'subway_station.json')
const firstLastRows = fixture('SearchFirstAndLastTrainbyLineServiceNew', 'subway_firstlast.json')
const timetableRows = fixture('SearchSTNTimeTableByIDService', 'subway_timetable.json')

describe('lineLabel', () => {
  it('앞자리 0을 떼고 나머지 노선명은 그대로 둔다', () => {
    expect(lineLabel('02호선')).toBe('2호선')
    expect(lineLabel('2호선')).toBe('2호선')
    expect(lineLabel('경의선')).toBe('경의선')
    expect(lineLabel('')).toBe('')
  })
})

describe('formatHms', () => {
  it('HHMMSS와 HH:MM:SS를 HH:MM으로, 24시 이후는 다음 날로 표시한다', () => {
    expect(formatHms('053600')).toEqual({ time: '05:36', nextDay: false })
    expect(formatHms('05:35:30')).toEqual({ time: '05:35', nextDay: false })
    expect(formatHms('244630')).toEqual({ time: '00:46', nextDay: true })
    expect(formatHms('24:09:30')).toEqual({ time: '00:09', nextDay: true })
  })
  it('비었거나 형식이 다르면 null', () => {
    expect(formatHms('')).toBeNull()
    expect(formatHms(undefined)).toBeNull()
    expect(formatHms('abc')).toBeNull()
  })
})

describe('normalizeSubwayStations — 매핑 동등성 (재캡처 안전)', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeSubwayStations(stationRows)
    expect(a.length).toBe(stationRows.length)
    stationRows.forEach((r: any, i: number) => {
      expect(a[i].code).toBe(String(r.STATION_CD ?? ''))
      expect(a[i].name).toBe(r.STATION_NM ?? '')
      expect(a[i].line).toBe(lineLabel(String(r.LINE_NUM ?? '')))
      expect(a[i].externalCode).toBe(String(r.FR_CODE ?? ''))
    })
  })
})

describe('normalizeFirstLast — 매핑 동등성 (재캡처 안전)', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeFirstLast(firstLastRows)
    expect(a.length).toBe(firstLastRows.length)
    firstLastRows.forEach((r: any, i: number) => {
      expect(a[i].line).toBe(lineLabel(String(r.SBWY_ROUT_LN ?? '')))
      expect(a[i].direction).toBe(DIRECTION[String(r.UPLN_DNLN)] ?? '')
      expect(a[i].day).toBe(DAY[String(r.DOW)] ?? '')
      expect(a[i].stationCode).toBe(String(r.SUBW_CD ?? ''))
      expect(a[i].station).toBe(r.STTN ?? '')
      expect(a[i].first).toEqual(formatHms(r.FSTT_HRM) && { ...formatHms(r.FSTT_HRM), from: r.FSTT_DPTRE_STTN ?? '', to: r.FSTT_ARVL_STTN ?? '' })
      expect(a[i].last).toEqual(formatHms(r.LSTTM_HRM) && { ...formatHms(r.LSTTM_HRM), from: r.LSTTM_DPTRE_STTN ?? '', to: r.LSTTM_ARVL_STTN ?? '' })
    })
  })
})

describe('normalizeTimetable — 매핑 동등성 (재캡처 안전)', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeTimetable(timetableRows)
    expect(a.length).toBe(timetableRows.length)
    timetableRows.forEach((r: any, i: number) => {
      expect(a[i].trainNo).toBe(String(r.TRAIN_NO ?? ''))
      expect(a[i].departs).toBe(formatHms(r.LEFTTIME)?.time ?? '')
      expect(a[i].nextDay).toBe(formatHms(r.LEFTTIME)?.nextDay ?? false)
      expect(a[i].origin).toBe(r.SUBWAYSNAME ?? '')
      expect(a[i].destination).toBe(r.SUBWAYENAME ?? '')
      expect(a[i].direction).toBe(DIRECTION[String(r.INOUT_TAG)] ?? '')
    })
  })
})

// ── tool 경로: 역 검색 → 노선별 첫차·막차(방향 2개) → 선택적 시간표 ──
describe('get_subway_schedule tool', () => {
  afterEach(() => { vi.useRealTimers() })

  const FL = 'SearchFirstAndLastTrainbyLineServiceNew'
  const TT = 'SearchSTNTimeTableByIDService'
  const ST = 'SearchInfoBySubwayNameService'
  const upstream = (opts: { stationFor?: (name: string) => any[]; timetable?: any[] } = {}) =>
    rowsUpstream(c => {
      if (c.svc === ST) return { rows: (opts.stationFor ?? (n => (n === '서울역' ? stationRows : [])))(c.path[0]) }
      if (c.svc === FL) {
        const [line, dir, dow, code] = c.path
        return { rows: [{ ...firstLastRows[0], SBWY_ROUT_LN: line, UPLN_DNLN: dir, DOW: dow, SUBW_CD: code }] }
      }
      if (c.svc === TT) return { rows: opts.timetable ?? timetableRows }
      return { rows: [] }
    })
  const paths = (calls: Array<{ svc: string; path: string[] }>, svc: string) => calls.filter(c => c.svc === svc).map(c => c.path).sort()

  it('1~9호선만 방향 2개씩 조회하고, 지원하지 않는 노선은 notes로 알린다', async () => {
    const { fetchFn, calls } = upstream()
    const body = await callTool(fetchFn, 'get_subway_schedule', { station: '서울역', day: 'weekday' })
    expect(paths(calls, FL)).toEqual([['1호선', '1', '1', '0150'], ['1호선', '2', '1', '0150'], ['4호선', '1', '1', '0426'], ['4호선', '2', '1', '0426']])
    expect(body.data.lines.map((l: any) => l.line).sort()).toEqual(['1호선', '4호선'])
    expect(body.data.lines[0].directions).toHaveLength(2)
    expect(body.notes.join(' ')).toContain('경의선')
    expect(body.notes.join(' ')).toContain('공항철도')
  })

  it('역명이 맞지 않으면 "역"을 붙이거나 떼서 다시 찾는다', async () => {
    const { fetchFn, calls } = upstream()
    const body = await callTool(fetchFn, 'get_subway_schedule', { station: '서울', day: 'weekday', line: '4호선' })
    expect(calls.filter(c => c.svc === ST).map(c => c.path[0])).toEqual(['서울', '서울역'])
    expect(body.data.station).toBe('서울역')
    expect(paths(calls, FL)).toEqual([['4호선', '1', '1', '0426'], ['4호선', '2', '1', '0426']])
  })

  it('역을 못 찾으면 첫차·막차를 조회하지 않고 안내한다', async () => {
    const { fetchFn, calls } = upstream({ stationFor: () => [] })
    const body = await callTool(fetchFn, 'get_subway_schedule', { station: '없는역이름' })
    expect(calls.some(c => c.svc === FL)).toBe(false)
    expect(body.data.lines).toEqual([])
    expect(body.notes.join(' ')).toContain('역을 찾지 못했습니다')
  })

  it('includeTimetable이면 after 이후 열차만 돌려주고 자정 넘은 열차는 nextDay로 표시한다', async () => {
    const timetable = ['23:40:00', '23:55:00', '24:10:30'].map((t, i) => ({ ...timetableRows[0], TRAIN_NO: String(i), LEFTTIME: t }))
    const { fetchFn, calls } = upstream({ timetable })
    const body = await callTool(fetchFn, 'get_subway_schedule', { station: '서울역', line: '1호선', day: 'saturday', includeTimetable: true, after: '23:50' })
    expect(paths(calls, TT)).toEqual([['0150', '2', '1'], ['0150', '2', '2']])
    const t = body.data.lines[0].directions[0].timetable
    expect(t.map((x: any) => [x.departs, x.nextDay])).toEqual([['23:55', false], ['00:10', true]])
  })

  it('day를 생략하면 KST 기준 운행일(새벽 4시 전은 전날)로 요일을 정한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-21T01:00:00Z')) // KST 토요일 10:00
    const sat = upstream()
    await callTool(sat.fetchFn, 'get_subway_schedule', { station: '서울역', line: '1호선' })
    expect(paths(sat.calls, FL)[0][2]).toBe('2')

    vi.setSystemTime(new Date('2026-11-20T16:30:00Z')) // KST 토요일 01:30 → 금요일 운행
    const late = upstream()
    await callTool(late.fetchFn, 'get_subway_schedule', { station: '서울역', line: '1호선' })
    expect(paths(late.calls, FL)[0][2]).toBe('1')
  })
})
