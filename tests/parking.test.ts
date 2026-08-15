import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeParkingLots } from '../src/normalize/parking.js'
import { num } from '../src/normalize/util.js'

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
