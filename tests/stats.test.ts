import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { num } from '../src/normalize/util.js'
import { normalizeSubwayRidership, normalizeLivingPopulation, normalizeRealEstate } from '../src/normalize/stats.js'

const subwayRows = unwrap('CardSubwayStatsNew', JSON.parse(readFileSync('tests/fixtures/subway_stats.json', 'utf8'))).rows
const popRows = unwrap('SPOP_LOCAL_RESD_DONG', JSON.parse(readFileSync('tests/fixtures/living_pop.json', 'utf8'))).rows
const rtmsRows = unwrap('tbLnOpendataRtmsV', JSON.parse(readFileSync('tests/fixtures/realestate.json', 'utf8'))).rows

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

describe('normalizeRealEstate — 매핑 동등성', () => {
  it('모든 필드가 원본 행과 일치', () => {
    const a = normalizeRealEstate(rtmsRows)
    rtmsRows.forEach((r: any, i: number) => {
      expect(a[i].year).toBe(String(r.RCPT_YR ?? ''))
      expect(a[i].district).toBe(r.CGG_NM ?? '')
      expect(a[i].dong).toBe(r.STDG_NM ?? '')
      expect(a[i].amount).toBe(num(r.THING_AMT))
    })
  })
})
