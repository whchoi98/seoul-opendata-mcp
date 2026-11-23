import { afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { unwrap } from '../src/client/response.js'
import { num } from '../src/normalize/util.js'
import {
  normalizeDistrict, normalizeRealEstate, normalizeRentDeal, normalizeLandPrice, formatLot, SEOUL_DISTRICTS,
} from '../src/normalize/realestate.js'
import { SeoulApiClient } from '../src/client/seoulApi.js'
import { buildServer } from '../src/index.js'

const fixture = (file: string, svc: string) => unwrap(svc, JSON.parse(readFileSync(`tests/fixtures/${file}`, 'utf8'))).rows
const saleRows = fixture('realestate.json', 'tbLnOpendataRtmsV')
const rentRows = fixture('realestate_rent.json', 'tbLnOpendataRentV')
const landRows = fixture('landprice.json', 'IndividuallyPostedLandPriceService')

const LAND = 'IndividuallyPostedLandPriceService'
const kst = () => new Date(Date.now() + 9 * 3_600_000)
const kstYear = () => kst().getUTCFullYear()
/** 법정동 코드 조회가 먼저 보는 공시지가 기준연도: 6월부터 올해, 그 전에는 작년 */
const lookupYear = () => (kst().getUTCMonth() + 1 >= 6 ? kstYear() : kstYear() - 1)

describe('normalizeDistrict', () => {
  it('서울 25개 자치구를 전체 이름으로 맞춘다', () => {
    expect(SEOUL_DISTRICTS).toHaveLength(25)
    expect(normalizeDistrict('강남')).toBe('강남구')
    expect(normalizeDistrict('강남구')).toBe('강남구')
    expect(normalizeDistrict(' 중 ')).toBe('중구')
    expect(normalizeDistrict('서울특별시 송파구')).toBe('송파구')
    expect(normalizeDistrict('서울 마포')).toBe('마포구')
  })
  it('서울 자치구가 아니면 null', () => {
    expect(normalizeDistrict('부산')).toBeNull()
    expect(normalizeDistrict('강남구청')).toBeNull()
    expect(normalizeDistrict('')).toBeNull()
  })
})

describe('normalizeRealEstate (매매) — 매핑 동등성', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeRealEstate(saleRows)
    expect(a.length).toBe(saleRows.length)
    saleRows.forEach((r: any, i: number) => {
      expect(a[i].year).toBe(String(r.RCPT_YR ?? ''))
      expect(a[i].district).toBe(r.CGG_NM ?? '')
      expect(a[i].dong).toBe(r.STDG_NM ?? '')
      expect(a[i].building).toBe(r.BLDG_NM ?? '')
      expect(a[i].amount).toBe(num(r.THING_AMT))
      expect(a[i].area).toBe(num(r.ARCH_AREA))
      expect(a[i].landArea).toBe(num(r.LAND_AREA))
      expect(a[i].floor).toBe(num(r.FLR))
      expect(a[i].contractDate).toBe(String(r.CTRT_DAY ?? ''))
      expect(a[i].use).toBe(r.BLDG_USG ?? '')
      expect(a[i].buildYear).toBe(String(r.ARCH_YR ?? ''))
      expect(a[i].dealMethod).toBe(r.DCLR_SE ?? '')
      expect(a[i].rightType).toBe(r.RGHT_SE ?? '')
      expect(a[i].cancelDate).toBe(String(r.RTRCN_DAY ?? ''))
    })
  })
})

describe('normalizeRentDeal (전월세) — 매핑 동등성', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeRentDeal(rentRows)
    expect(a.length).toBe(rentRows.length)
    rentRows.forEach((r: any, i: number) => {
      expect(a[i].year).toBe(String(r.RCPT_YR ?? ''))
      expect(a[i].district).toBe(r.CGG_NM ?? '')
      expect(a[i].dong).toBe(r.STDG_NM ?? '')
      expect(a[i].building).toBe(r.BLDG_NM ?? '')
      expect(a[i].rentType).toBe(r.RENT_SE ?? '')
      expect(a[i].deposit).toBe(num(r.GRFE))
      expect(a[i].monthlyRent).toBe(num(r.RTFE))
      expect(a[i].area).toBe(num(r.RENT_AREA))
      expect(a[i].floor).toBe(num(r.FLR))
      expect(a[i].contractDate).toBe(String(r.CTRT_DAY ?? ''))
      expect(a[i].contractPeriod).toBe(r.CTRT_PRD ?? '')
      expect(a[i].use).toBe(r.BLDG_USG ?? '')
      expect(a[i].buildYear).toBe(String(r.ARCH_YR ?? ''))
      expect(a[i].contractType).toBe(r.NEW_UPDT_YN ?? '')
      expect(a[i].renewalRightUsed).toBe(String(r.CTRT_UPDT_USE_YN ?? '').trim() !== '')
      expect(a[i].prevDeposit).toBe(num(r.BFR_GRFE))
      expect(a[i].prevMonthlyRent).toBe(num(r.BFR_RTFE))
    })
  })
  it('갱신요구권 표시(○)는 true로 바꾼다', () => {
    expect(normalizeRentDeal([{ CTRT_UPDT_USE_YN: '○' }])[0].renewalRightUsed).toBe(true)
    expect(normalizeRentDeal([{ CTRT_UPDT_USE_YN: '' }])[0].renewalRightUsed).toBe(false)
  })
})

describe('normalizeLandPrice (개별공시지가) — 매핑 동등성', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeLandPrice(landRows)
    expect(a.length).toBe(landRows.length)
    landRows.forEach((r: any, i: number) => {
      expect(a[i].year).toBe(String(r.YEAR ?? ''))
      expect(a[i].district).toBe(r.SIGUNGU_NM ?? '')
      expect(a[i].dong).toBe(r.BJDONG_NM ?? '')
      expect(a[i].lotNumber).toBe(formatLot(r.PILGI_CD, r.BONBEON, r.BUBEON))
      expect(a[i].landType).toBe(r.PILGI_NM ?? '')
      expect(a[i].pricePerSqm).toBe(num(r.JIGA))
      expect(a[i].baseDate).toBe(r.BASE_MON ?? '')
      expect(a[i].pnu).toBe(`${r.SIGUNGU_CD}${r.BJDONG_CD}${r.PILGI_CD}${r.BONBEON}${r.BUBEON}`)
      expect(a[i].pnu).toMatch(/^\d{19}$/)
    })
  })
  it('지번 표기: 앞자리 0 제거, 부번 0 생략, 산 필지 접두어', () => {
    expect(formatLot('1', '0633', '0007')).toBe('633-7')
    expect(formatLot('1', '0737', '0000')).toBe('737')
    expect(formatLot('2', '0012', '0003')).toBe('산12-3')
    expect(formatLot('1', '', '')).toBe('')
  })
  it('PNU 구성 요소가 빠지면 빈 문자열', () => {
    expect(normalizeLandPrice([{ SIGUNGU_CD: '11680', BONBEON: '0737' }])[0].pnu).toBe('')
  })
})

// ── tool 경로 전체 검증: 실제 McpServer ↔ Client(in-memory), 업스트림만 가짜 ──

type Call = { svc: string; start: number; end: number; path: string[] }
type Reply = { rows: any[]; total?: number }

function upstream(handler: (c: Call) => Reply) {
  const calls: Call[] = []
  const fetchFn = vi.fn(async (url: string) => {
    // http://host/{key}/json/{svc}/{start}/{end}/{...path}
    const [, , svc, s, e, ...path] = new URL(url).pathname.split('/').slice(1).map(decodeURIComponent)
    const call = { svc, start: Number(s), end: Number(e), path }
    calls.push(call)
    const r = handler(call)
    const body = r.rows.length === 0
      ? { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } }
      : { [svc]: { list_total_count: r.total ?? r.rows.length, RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다' }, row: r.rows } }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return { fetchFn, calls }
}

async function callTool(fetchFn: unknown, name: string, args: Record<string, unknown>) {
  const client = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as typeof fetch, retryDelayMs: 0 })
  const server = buildServer(client)
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 'realestate-test', version: '0' })
  await Promise.all([server.connect(st), mcp.connect(ct)])
  const res = await mcp.callTool({ name, arguments: args })
  return JSON.parse((res.content as Array<{ type: string; text: string }>)[0].text)
}

const B = ' '
const landRow = (code: string, name: string) => ({ ...landRows[0], BJDONG_CD: code, BJDONG_NM: name })

describe('get_real_estate_prices — 서버 쪽 필터', () => {
  it('year와 district를 경로 파라미터로 보내고 구 이름을 전체 이름으로 맞춘다', async () => {
    const { fetchFn, calls } = upstream(() => ({ rows: saleRows, total: 6282 }))
    const body = await callTool(fetchFn, 'get_real_estate_prices', { year: '2025', district: '강남' })
    expect(calls).toEqual([{ svc: 'tbLnOpendataRtmsV', start: 1, end: 100, path: ['2025', B, '강남구'] }])
    expect(body.data.dealType).toBe('sale')
    expect(body.data.totalCount).toBe(6282)
    expect(body.data.count).toBe(Math.min(10, saleRows.length))
  })

  it('조건이 없으면 경로 파라미터 없이 최신순으로 받는다', async () => {
    const { fetchFn, calls } = upstream(() => ({ rows: saleRows }))
    await callTool(fetchFn, 'get_real_estate_prices', {})
    expect(calls[0].path).toEqual([])
  })

  it('매매: building은 9번째, buildingUse는 11번째 자리', async () => {
    const { fetchFn, calls } = upstream(() => ({ rows: saleRows }))
    await callTool(fetchFn, 'get_real_estate_prices', { district: '강남구', building: '래미안', buildingUse: '아파트' })
    expect(calls[0].path).toEqual([B, B, '강남구', B, B, B, B, B, '래미안', B, '아파트'])
  })

  it('전월세: 다른 서비스와 파라미터 순서(buildingUse 10번째)를 쓴다', async () => {
    const { fetchFn, calls } = upstream(() => ({ rows: rentRows }))
    const body = await callTool(fetchFn, 'get_real_estate_prices', { dealType: 'rent', year: '2026', district: '강남구', building: '타워팰리스', buildingUse: '아파트' })
    expect(calls).toEqual([{ svc: 'tbLnOpendataRentV', start: 1, end: 100, path: ['2026', B, '강남구', B, B, B, B, B, '타워팰리스', '아파트'] }])
    expect(body.data.dealType).toBe('rent')
    expect(body.data.deals[0]).toHaveProperty('deposit')
  })

  it('dong은 법정동 코드로 바꿔 서버에서 거른다(공시지가 서비스로 코드 조회)', async () => {
    const { fetchFn, calls } = upstream(c => c.svc === LAND ? { rows: [landRow('10100', '역삼동')] } : { rows: saleRows })
    const body = await callTool(fetchFn, 'get_real_estate_prices', { district: '강남구', dong: '역삼동', year: '2025' })
    expect(calls[0]).toEqual({ svc: LAND, start: 1, end: 1, path: ['강남구', '역삼동', B, B, B, String(lookupYear())] })
    expect(calls[1]).toEqual({ svc: 'tbLnOpendataRtmsV', start: 1, end: 100, path: ['2025', B, '강남구', '10100'] })
    expect(body.data.dong).toBe('역삼동')
  })

  describe('법정동 코드를 찾는 공시지가 기준연도', () => {
    afterEach(() => vi.useRealTimers())
    const lookupYears = async (now: string, publishedFrom = 0) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(now))
      const { fetchFn, calls } = upstream(c => {
        if (c.svc !== LAND) return { rows: saleRows }
        return Number(c.path[5]) <= publishedFrom || publishedFrom === 0 ? { rows: [landRow('10100', '역삼동')] } : { rows: [] }
      })
      const body = await callTool(fetchFn, 'get_real_estate_prices', { district: '강남구', dong: '역삼동' })
      return { years: calls.filter(c => c.svc === LAND).map(c => c.path[5]), body }
    }

    it('6월부터는 올해 자료를 먼저 본다(사전 적재 저장소가 받아 둔 연도)', async () => {
      expect((await lookupYears('2026-11-23T03:00:00.000Z')).years).toEqual(['2026'])
      expect((await lookupYears('2026-05-31T15:00:00.000Z')).years).toEqual(['2026']) // KST 6월 1일 00:00
    })

    it('5월까지는 작년 자료를 먼저 본다(올해 자료는 4월 말에 공시된다)', async () => {
      expect((await lookupYears('2026-05-31T14:59:59.000Z')).years).toEqual(['2025'])
      expect((await lookupYears('2026-01-10T03:00:00.000Z')).years).toEqual(['2025'])
    })

    it('먼저 본 연도에 자료가 없으면 다른 연도로 한 번 더 찾는다', async () => {
      const late = await lookupYears('2026-06-10T03:00:00.000Z', 2025) // 6월인데 올해 자료가 아직 없다
      expect(late.years).toEqual(['2026', '2025'])
      expect(late.body.data.dong).toBe('역삼동')
    })
  })

  it('행정동 이름(역삼1동)이 법정동으로 안 잡히면 숫자를 떼고 한 번 더 찾는다', async () => {
    const { fetchFn, calls } = upstream(c => {
      if (c.svc !== LAND) return { rows: saleRows }
      return c.path[1] === '역삼동' ? { rows: [landRow('10100', '역삼동')] } : { rows: [] }
    })
    const body = await callTool(fetchFn, 'get_real_estate_prices', { district: '강남구', dong: '역삼1동' })
    expect(calls.filter(c => c.svc === LAND).map(c => c.path[1])).toEqual(['역삼1동', '역삼동'])
    expect(calls.at(-1)!.path[3]).toBe('10100')
    expect(body.data.dong).toBe('역삼동')
    expect(body.notes.some((n: string) => n.includes('역삼1동') && n.includes('역삼동'))).toBe(true)
  })

  it('법정동을 못 찾으면 실거래가를 호출하지 않고 안내한다', async () => {
    const { fetchFn, calls } = upstream(c => c.svc === LAND ? { rows: [] } : { rows: saleRows })
    const body = await callTool(fetchFn, 'get_real_estate_prices', { district: '강남구', dong: '없는동' })
    expect(calls.every(c => c.svc === LAND)).toBe(true)
    expect(body.data.deals).toEqual([])
    expect(body.notes.some((n: string) => n.includes('없는동'))).toBe(true)
  })

  it('district 없이 dong만 주면 최신 500건 안에서 이름으로 거른다', async () => {
    const target = saleRows[0].STDG_NM
    const { fetchFn, calls } = upstream(() => ({ rows: saleRows }))
    const body = await callTool(fetchFn, 'get_real_estate_prices', { dong: target })
    expect(calls).toEqual([{ svc: 'tbLnOpendataRtmsV', start: 1, end: 500, path: [] }])
    expect(body.data.deals.every((d: any) => d.dong.includes(target))).toBe(true)
  })

  it('해제된 매매 거래는 기본으로 빼고, includeCancelled=true면 포함한다', async () => {
    const rows = [{ ...saleRows[0], RTRCN_DAY: '20260901' }, ...saleRows.slice(1)]
    const { fetchFn } = upstream(() => ({ rows }))
    const excluded = await callTool(fetchFn, 'get_real_estate_prices', {})
    expect(excluded.data.deals.some((d: any) => d.cancelDate)).toBe(false)
    expect(excluded.notes.some((n: string) => n.includes('해제된 거래 1건'))).toBe(true)
    const included = await callTool(fetchFn, 'get_real_estate_prices', { includeCancelled: true })
    expect(included.data.deals[0].cancelDate).toBe('20260901')
  })

  it('rentType은 최신 500건 안에서 거른다', async () => {
    const { fetchFn, calls } = upstream(() => ({ rows: rentRows }))
    const body = await callTool(fetchFn, 'get_real_estate_prices', { dealType: 'rent', rentType: '월세' })
    expect(calls[0].end).toBe(500)
    expect(body.data.deals.length).toBeGreaterThan(0)
    expect(body.data.deals.every((d: any) => d.rentType === '월세')).toBe(true)
  })

  it('서울 자치구가 아니면 업스트림을 호출하지 않는다', async () => {
    const { fetchFn } = upstream(() => ({ rows: saleRows }))
    const body = await callTool(fetchFn, 'get_real_estate_prices', { district: '부산' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(body.data.deals).toEqual([])
    expect(body.notes[0]).toContain('부산')
  })
})

describe('get_land_price', () => {
  it('지번을 본번과 부번으로 나눠 보낸다', async () => {
    const { fetchFn, calls } = upstream(() => ({ rows: landRows.slice(0, 1) }))
    const body = await callTool(fetchFn, 'get_land_price', { district: '강남', dong: '역삼동', lotNumber: '633-7', year: '2025' })
    expect(calls).toEqual([{ svc: LAND, start: 1, end: 10, path: ['강남구', '역삼동', '633', '7', B, '2025'] }])
    expect(body.data.year).toBe('2025')
    expect(body.data.parcels[0].pricePerSqm).toBe(num(landRows[0].JIGA))
    expect(body.data.parcels[0].lotNumber).toBe('633-7')
  })

  it('year를 생략하면 올해를 찾고, 아직 공시 전이면 작년 자료로 답한다', async () => {
    const thisYear = String(kstYear()), lastYear = String(kstYear() - 1)
    const { fetchFn, calls } = upstream(c => c.path[5] === thisYear ? { rows: [] } : { rows: landRows })
    const body = await callTool(fetchFn, 'get_land_price', { district: '강남구', dong: '역삼동' })
    expect(calls.map(c => c.path[5])).toEqual([thisYear, lastYear])
    expect(body.data.year).toBe(lastYear)
    expect(body.notes.some((n: string) => n.includes(thisYear))).toBe(true)
    expect(body.notes.some((n: string) => n.includes('해당하는 데이터가 없습니다'))).toBe(false)
  })

  it('lotNumber만 있고 dong이 없으면 호출하지 않는다', async () => {
    const { fetchFn } = upstream(() => ({ rows: landRows }))
    const body = await callTool(fetchFn, 'get_land_price', { district: '강남구', lotNumber: '737' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(body.notes[0]).toContain('dong')
  })

  it('필지가 limit보다 많으면 좁히라고 안내한다', async () => {
    const { fetchFn } = upstream(() => ({ rows: landRows, total: 6192 }))
    const body = await callTool(fetchFn, 'get_land_price', { district: '강남구', dong: '역삼동', year: '2025' })
    expect(body.data.totalCount).toBe(6192)
    expect(body.notes.some((n: string) => n.includes('lotNumber'))).toBe(true)
  })
})
