import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeBikeStations, haversineM } from '../src/normalize/bike.js'
import { num } from '../src/normalize/util.js'

const rows = unwrap('bikeList', JSON.parse(readFileSync('tests/fixtures/bike.json', 'utf8'))).rows

describe('normalizeBikeStations', () => {
  it('대여소 필드 매핑', () => {
    const s = normalizeBikeStations(rows)[0]
    expect(s.name).toBeTruthy()
    expect(typeof s.available).toBe('number')
    expect(typeof s.lat).toBe('number')
  })
  it('모든 필드가 원본 행과 매핑 일치', () => {
    const stations = normalizeBikeStations(rows)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const s = stations[i]
      expect(s.id).toBe(r.stationId ?? '')
      expect(s.name).toBe(r.stationName ?? '')
      expect(s.available).toBe(num(r.parkingBikeTotCnt))
      expect(s.racks).toBe(num(r.rackTotCnt))
      expect(s.ratePct).toBe(num(r.shared))
      expect(s.lat).toBe(num(r.stationLatitude))
      expect(s.lng).toBe(num(r.stationLongitude))
    }
  })
})

describe('haversineM', () => {
  it('서울시청→강남역 약 8.4km(±1km)', () => {
    const d = haversineM(37.5663, 126.9779, 37.4979, 127.0276)
    expect(d).toBeGreaterThan(7_400)
    expect(d).toBeLessThan(9_400)
  })
})
