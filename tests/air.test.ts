import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeAir } from '../src/normalize/air.js'
import { num } from '../src/normalize/util.js'

const rows = unwrap('RealtimeCityAir', JSON.parse(readFileSync('tests/fixtures/air.json', 'utf8'))).rows

describe('normalizeAir', () => {
  it('자치구/권역/등급 매핑', () => {
    const a = normalizeAir(rows)[0]
    expect(a.district).toBeTruthy()
    expect(a.region).toBeTruthy()
    expect(['좋음', '보통', '나쁨', '매우나쁨', '']).toContain(a.grade)
  })
  it('PM 수치 숫자화', () => {
    const a = normalizeAir(rows)[0]
    expect(a.pm10 === null || typeof a.pm10 === 'number').toBe(true)
  })
  it('모든 필드가 원본 행과 매핑 일치', () => {
    const airQualities = normalizeAir(rows)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const a = airQualities[i]
      expect(a.region).toBe(r.SAREA_NM ?? '')
      expect(a.district).toBe(r.MSRSTN_NM ?? '')
      expect(a.pm10).toBe(num(r.PM))
      expect(a.pm25).toBe(num(r.FPM))
      expect(a.ozone).toBe(num(r.OZON))
      expect(a.no2).toBe(num(r.NTDX))
      expect(a.co).toBe(num(r.CBMX))
      expect(a.so2).toBe(num(r.SPDX))
      expect(a.grade).toBe(r.CAI_GRD ?? '')
      expect(a.index).toBe(num(r.CAI_IDX))
      expect(a.mainPollutant).toBe(r.CRST_SBSTN ?? '')
      expect(a.measuredAt).toBe(String(r.MSRMT_DT ?? ''))
    }
  })
})
