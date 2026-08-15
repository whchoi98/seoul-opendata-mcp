import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeBikeStations, haversineM } from '../src/normalize/bike.js'

const rows = unwrap('bikeList', JSON.parse(readFileSync('tests/fixtures/bike.json', 'utf8'))).rows

describe('normalizeBikeStations', () => {
  it('대여소 필드 매핑', () => {
    const s = normalizeBikeStations(rows)[0]
    expect(s.name).toBeTruthy()
    expect(typeof s.available).toBe('number')
    expect(typeof s.lat).toBe('number')
  })
})

describe('haversineM', () => {
  it('서울시청→강남역 약 8.4km(±1km)', () => {
    const d = haversineM(37.5663, 126.9779, 37.4979, 127.0276)
    expect(d).toBeGreaterThan(7_400)
    expect(d).toBeLessThan(9_400)
  })
})
