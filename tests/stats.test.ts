import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { num } from '../src/normalize/util.js'
import { normalizeSubwayRidership, normalizeLivingPopulation, normalizeSubwayHourly, HOUR_ORDER } from '../src/normalize/stats.js'
import { rowsUpstream, callTool } from './helpers/mcp.js'

const subwayRows = unwrap('CardSubwayStatsNew', JSON.parse(readFileSync('tests/fixtures/subway_stats.json', 'utf8'))).rows
const hourlyRows = unwrap('CardSubwayTime', JSON.parse(readFileSync('tests/fixtures/subway_hourly.json', 'utf8'))).rows
const popRows = unwrap('SPOP_LOCAL_RESD_DONG', JSON.parse(readFileSync('tests/fixtures/living_pop.json', 'utf8'))).rows

describe('normalizeSubwayRidership — 매핑 동등성 (재캡처 안전)', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeSubwayRidership(subwayRows)
    expect(a.length).toBe(subwayRows.length)
    subwayRows.forEach((r: any, i: number) => {
      expect(a[i].date).toBe(r.USE_YMD ?? '')
      expect(a[i].line).toBe(r.SBWY_ROUT_LN_NM ?? '')
      expect(a[i].station).toBe(r.SBWY_STNS_NM ?? '')
      expect(a[i].boardings).toBe(num(r.GTON_TNOPE))
      expect(a[i].alightings).toBe(num(r.GTOFF_TNOPE))
    })
  })
})

describe('normalizeLivingPopulation — 매핑 동등성', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeLivingPopulation(popRows)
    popRows.forEach((r: any, i: number) => {
      expect(a[i].date).toBe(String(r.STDR_DE_ID ?? ''))
      expect(a[i].timeSlot).toBe(String(r.TMZON_PD_SE ?? ''))
      expect(a[i].dongCode).toBe(String(r.ADSTRD_CODE_SE ?? ''))
      expect(a[i].total).toBe(num(r.TOT_LVPOP_CO))
    })
  })
})

// ── tool 경로: 선택 인자는 건너뛴 자리를 공백으로 채워 서버에서 거른다 ──
describe('get_living_population — 서버 쪽 필터', () => {
  const B = ' '
  const run = async (args: Record<string, unknown>) => {
    const { fetchFn, calls } = rowsUpstream(() => ({ rows: popRows, total: 1488 }))
    const body = await callTool(fetchFn, 'get_living_population', args)
    return { body, calls }
  }

  it('dongCode만 주면 앞 두 자리를 공백으로 채워 보낸다', async () => {
    const { calls } = await run({ dongCode: '11680640' })
    expect(calls.map(c => c.path)).toEqual([[B, B, '11680640']])
  })
  it('timeSlot만 주면 date 자리를 공백으로 채운다', async () => {
    const { calls } = await run({ timeSlot: '14' })
    expect(calls.map(c => c.path)).toEqual([[B, '14']])
  })
  it('date와 dongCode만 주면 timeSlot 자리를 공백으로 채운다', async () => {
    const { calls } = await run({ date: '20260731', dongCode: '11680640' })
    expect(calls.map(c => c.path)).toEqual([['20260731', B, '11680640']])
  })
  it('인자가 없으면 경로 자리를 보내지 않는다', async () => {
    const { calls } = await run({})
    expect(calls.map(c => c.path)).toEqual([[]])
  })
  it('서버가 거른 행을 코드에서 다시 버리지 않고, 전체 건수를 함께 돌려준다', async () => {
    const { body } = await run({ dongCode: '99999999' }) // 가짜 업스트림은 조건과 무관한 행을 준다
    expect(body.data.count).toBe(Math.min(20, popRows.length))
    expect(body.data.totalCount).toBe(1488)
  })
})

describe('normalizeSubwayHourly — 매핑 동등성 (재캡처 안전)', () => {
  it('운행일 순서(04시~03시) 24칸이 원본 HR_* 필드와 일치', () => {
    expect(HOUR_ORDER).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3])
    const a = normalizeSubwayHourly(hourlyRows)
    expect(a.length).toBe(hourlyRows.length)
    hourlyRows.forEach((r: any, i: number) => {
      expect(a[i].month).toBe(String(r.USE_MM ?? ''))
      expect(a[i].line).toBe(r.SBWY_ROUT_LN_NM ?? '')
      expect(a[i].station).toBe(r.STTN ?? '')
      expect(a[i].updatedAt).toBe(String(r.JOB_YMD ?? ''))
      expect(a[i].hours.map(h => h.hour)).toEqual(HOUR_ORDER)
      a[i].hours.forEach(h => {
        expect(h.boardings).toBe(num(r[`HR_${h.hour}_GET_ON_NOPE`]))
        expect(h.alightings).toBe(num(r[`HR_${h.hour}_GET_OFF_NOPE`]))
      })
    })
  })
})

// ── tool 경로: USE_MM/호선/역 자리로 서버에서 거르고, 최근 제공월을 찾아간다 ──
describe('get_subway_hourly_ridership tool', () => {
  afterEach(() => { vi.useRealTimers() })
  const B = ' '
  const gangnam = { ...hourlyRows[0], USE_MM: '202610', SBWY_ROUT_LN_NM: '2호선', STTN: '강남' }
  const run = async (args: Record<string, unknown>, has: (path: string[]) => boolean = () => true) => {
    const { fetchFn, calls } = rowsUpstream(c => ({ rows: has(c.path) ? [gangnam] : [] }))
    const body = await callTool(fetchFn, 'get_subway_hourly_ridership', args)
    return { body, paths: calls.map(c => c.path) }
  }

  it('month, line, station을 자리 순서대로 보낸다', async () => {
    expect((await run({ month: '202610', line: '2호선', station: '강남' })).paths).toEqual([['202610', '2호선', '강남']])
    expect((await run({ month: '202610', station: '강남' })).paths).toEqual([['202610', B, '강남']])
  })
  it('month를 생략하면 지난달부터, 비어 있으면 그 전달을 조회한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T03:00:00Z'))
    const { paths, body } = await run({ station: '강남' }, p => p[0] === '202609')
    expect(paths).toEqual([['202610', B, '강남'], ['202609', B, '강남']])
    expect(body.data.month).toBe('202609')
  })
  it('역명이 맞지 않으면 "역"을 떼거나 붙여 다시 찾는다', async () => {
    const { paths } = await run({ month: '202610', station: '강남역' }, p => p[2] === '강남')
    expect(paths).toEqual([['202610', B, '강남역'], ['202610', B, '강남']])
  })
  it('가장 붐비는 시간대와 한산한 시간대(06~23시)를 3개씩 계산한다', async () => {
    const row: any = { ...gangnam }
    for (const h of HOUR_ORDER) { row[`HR_${h}_GET_ON_NOPE`] = 100; row[`HR_${h}_GET_OFF_NOPE`] = 0 }
    Object.assign(row, { HR_8_GET_OFF_NOPE: 900, HR_18_GET_ON_NOPE: 800, HR_9_GET_OFF_NOPE: 500, HR_10_GET_ON_NOPE: 1, HR_14_GET_ON_NOPE: 2, HR_22_GET_ON_NOPE: 3, HR_4_GET_ON_NOPE: 0 })
    const { fetchFn } = rowsUpstream(() => ({ rows: [row] }))
    const body = await callTool(fetchFn, 'get_subway_hourly_ridership', { month: '202610', station: '강남' })
    const line = body.data.lines[0]
    expect(line.busiestHours.map((h: any) => h.hour)).toEqual([8, 18, 9])
    expect(line.quietestHours.map((h: any) => h.hour)).toEqual([10, 14, 22])
  })
  it('데이터가 없으면 다른 달이나 역명을 안내한다', async () => {
    const { body } = await run({ month: '202610', station: '없는역' }, () => false)
    expect(body.data.lines).toEqual([])
    expect(body.notes.join(' ')).toContain('데이터가 없습니다')
  })
})

// ── tool 경로: 날짜가 비었을 때 이유에 맞는 안내를 한다 ──
// 2026-11-24 서울 API 확인: 11월 21일(3일 전)까지 있고, 3월 1일부터 있으며 2월 26일은 없다
describe('get_subway_ridership — 빈 결과 안내', () => {
  afterEach(() => { vi.useRealTimers() })
  const gangnam = { ...subwayRows[0], SBWY_ROUT_LN_NM: '2호선', SBWY_STNS_NM: '강남' }
  const run = async (args: Record<string, unknown>, rows: any[] = []) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-24T15:00:00+09:00'))
    const { fetchFn } = rowsUpstream(() => ({ rows }))
    const body = await callTool(fetchFn, 'get_subway_ridership', args)
    return body.notes.join(' ') as string
  }

  it('최근 날짜면 아직 집계 전이라고 안내한다', async () => {
    const notes = await run({ date: '20261123' })
    expect(notes).toContain('아직 집계되지 않은 날짜')
    expect(notes).toContain('더 이전 날짜')
  })

  it('오래된 날짜면 제공 기간 밖이라고 안내하고 더 이전 날짜를 권하지 않는다', async () => {
    const notes = await run({ date: '20251224' })
    expect(notes).toContain('최근 약 9개월')
    expect(notes).not.toContain('더 이전 날짜')
  })

  it('미래 날짜는 미래라고 안내한다', async () => {
    expect(await run({ date: '20261201' })).toContain('미래 날짜')
  })

  it('그 사이 날짜가 비면 앞뒤 날짜를 권한다', async () => {
    const notes = await run({ date: '20260801' })
    expect(notes).toContain('해당 날짜 데이터가 없습니다. 앞뒤 날짜로 시도하세요.')
  })

  it('날짜에는 데이터가 있는데 역이나 호선 조건에 맞는 행이 없으면 날짜가 아니라 조건을 안내한다', async () => {
    const notes = await run({ date: '20261120', station: '없는역' }, [gangnam])
    expect(notes).toContain('조건에 맞는 역이 없습니다')
    expect(notes).not.toContain('해당 날짜 데이터가 없습니다')
  })

  it('행이 있으면 빈 결과 안내를 붙이지 않는다', async () => {
    const notes = await run({ date: '20261120', station: '강남' }, [gangnam])
    expect(notes).not.toContain('없습니다')
    expect(notes).toContain('약 9개월')   // 제공 범위는 늘 알린다
  })
})
