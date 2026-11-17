import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeParkingLots, normalizeParkInfo, uniqueByCode } from '../src/normalize/parking.js'
import { rowsUpstream, callTool } from './helpers/mcp.js'
import { num } from '../src/normalize/util.js'

const infoRows = unwrap('GetParkInfo', JSON.parse(readFileSync('tests/fixtures/parkinfo.json', 'utf8'))).rows
const rows = unwrap('GetParkingInfo', JSON.parse(readFileSync('tests/fixtures/parking.json', 'utf8'))).rows

describe('normalizeParkingLots', () => {
  it('가용면수 = 전체 - 현재 (둘 다 있을 때)', () => {
    const p = normalizeParkingLots(rows).find(x => x.totalSpaces != null && x.occupied != null)
    if (p) expect(p.available).toBe(p.totalSpaces! - p.occupied!)
  })
  it('이름/주소 매핑', () => {
    const p = normalizeParkingLots(rows)[0]
    expect(p.name).toBeTruthy()
    expect(p.address).toBeTruthy()
  })
  it('모든 필드가 원본 행과 매핑 일치', () => {
    const lots = normalizeParkingLots(rows)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const p = lots[i]
      expect(p.code).toBe(String(r.PKLT_CD ?? ''))
      expect(p.name).toBe(r.PKLT_NM ?? '')
      expect(p.address).toBe(r.ADDR ?? '')
      expect(p.totalSpaces).toBe(num(r.TPKCT))
      expect(p.occupied).toBe(num(r.NOW_PRK_VHCL_CNT))
      expect(p.available).toBe(
        num(r.TPKCT) != null && num(r.NOW_PRK_VHCL_CNT) != null
          ? num(r.TPKCT)! - num(r.NOW_PRK_VHCL_CNT)!
          : null,
      )
      expect(p.realtimeYn).toBe(String(r.PRK_STTS_YN ?? ''))
      expect(p.baseFee).toBe(num(r.BSC_PRK_CRG))
      expect(p.baseMinutes).toBe(num(r.BSC_PRK_HR))
      expect(p.updatedAt).toBe(r.NOW_PRK_VHCL_UPDT_TM ?? '')
    }
  })
})

describe('normalizeParkInfo — 매핑 동등성 (재캡처 안전)', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeParkInfo(infoRows)
    expect(a.length).toBe(infoRows.length)
    const hours = (b: any, e: any) => (b && e ? `${b}-${e}` : '')
    infoRows.forEach((r: any, i: number) => {
      expect(a[i].code).toBe(String(r.PKLT_CD ?? ''))
      expect(a[i].name).toBe(r.PKLT_NM ?? '')
      expect(a[i].address).toBe(r.ADDR ?? '')
      expect(a[i].kind).toBe(r.PKLT_KND_NM ?? '')
      expect(a[i].operation).toBe(r.OPER_SE_NM ?? '')
      expect(a[i].tel).toBe(r.TELNO ?? '')
      expect(a[i].totalSpaces).toBe(num(r.TPKCT))
      expect(a[i].paid).toBe(r.CHGD_FREE_NM ?? '')
      expect(a[i].nightFreeOpen).toBe(r.NGHT_FREE_OPN_YN === 'Y')
      expect(a[i].weekdayHours).toBe(hours(r.WD_OPER_BGNG_TM, r.WD_OPER_END_TM))
      expect(a[i].weekendHours).toBe(hours(r.WE_OPER_BGNG_TM, r.WE_OPER_END_TM))
      expect(a[i].saturdayFee).toBe(r.SAT_CHGD_FREE_NM ?? '')
      expect(a[i].holidayFee).toBe(r.LHLDY_NM ?? '')
      expect(a[i].baseFee).toBe(num(r.PRK_CRG))
      expect(a[i].baseMinutes).toBe(num(r.PRK_HM))
      expect(a[i].addFee).toBe(num(r.ADD_CRG))
      expect(a[i].addMinutes).toBe(num(r.ADD_UNIT_TM_MNT))
      expect(a[i].dailyMax).toBe(num(r.DLY_MAX_CRG))
      expect(a[i].monthlyPass).toBe(num(r.MNTL_CMUT_CRG))
      expect(a[i].realtimeStatus).toBe(r.PRK_NOW_INFO_PVSN_YN_NM ?? '')
      expect(a[i].lat).toBe(num(r.LAT))
      expect(a[i].lng).toBe(num(r.LOT))
    })
  })
  it('uniqueByCode는 코드별 첫 행만 남긴다', () => {
    const a = normalizeParkInfo([infoRows[0], { ...infoRows[0], PKLT_NM: '중복' }, infoRows[1]])
    expect(uniqueByCode(a).map(p => p.name)).toEqual([infoRows[0].PKLT_NM, infoRows[1].PKLT_NM])
  })
})

// ── tool 경로: 실시간 주차장 + 실시간 미연계 공영주차장 안내(GetParkInfo, 주소 서버 필터) ──
describe('get_parking tool — 공영주차장 안내 병합', () => {
  const realtime = { ...rows[0], PKLT_CD: 'R1', PKLT_NM: '세종로 공영주차장(시)', ADDR: '종로구 세종로 80-1' }
  const info = (code: string, name: string) => ({ ...infoRows[0], PKLT_CD: code, PKLT_NM: name, ADDR: '종로구 어딘가' })
  const run = async (args: Record<string, unknown>) => {
    const { fetchFn, calls } = rowsUpstream(c =>
      c.svc === 'GetParkingInfo' ? { rows: [realtime] } : { rows: [info('R1', '세종로 공영주차장(시)'), info('N1', '신문로'), info('N1', '신문로'), info('N2', '세운상가')] })
    const body = await callTool(fetchFn, 'get_parking', args)
    return { body, calls }
  }

  it('안내 서비스에는 query를 주소 자리로 보내고, 실시간 주차장과 중복 행은 뺀다', async () => {
    const { body, calls } = await run({ query: '종로' })
    expect(calls.filter(c => c.svc === 'GetParkInfo').map(c => c.path)).toEqual([['종로']])
    expect(body.data.lots.map((p: any) => p.code)).toEqual(['R1'])
    expect(body.data.otherCount).toBe(2)
    expect(body.data.otherLots.map((p: any) => p.code)).toEqual(['N1', 'N2'])
    expect(body.notes.join(' ')).toContain('otherLots')
  })
  it('includeNonRealtime: false면 안내 서비스를 부르지 않는다', async () => {
    const { body, calls } = await run({ query: '종로', includeNonRealtime: false })
    expect(calls.some(c => c.svc === 'GetParkInfo')).toBe(false)
    expect(body.data).not.toHaveProperty('otherLots')
  })
})
