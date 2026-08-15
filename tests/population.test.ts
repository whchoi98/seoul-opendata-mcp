import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizePopulation } from '../src/normalize/population.js'

const raw = unwrap('citydata_ppltn', JSON.parse(readFileSync('tests/fixtures/ppltn.json', 'utf8'))).rows[0]

describe('normalizePopulation', () => {
  it('혼잡도/인구 min·max를 숫자로 변환', () => {
    const p = normalizePopulation(raw, false)
    expect(['여유', '보통', '약간 붐빔', '붐빔']).toContain(p.congestionLevel)
    expect(typeof p.populationMin).toBe('number')
    expect(typeof p.populationMax).toBe('number')
  })
  it('성·연령 비율 매핑', () => {
    const p = normalizePopulation(raw, false)
    expect(p.malePct).not.toBeNull()
    expect(Object.keys(p.agePct)).toEqual(['0s', '10s', '20s', '30s', '40s', '50s', '60s', '70s+'])
  })
  it('includeForecast=false면 forecast 빈 배열', () => {
    expect(normalizePopulation(raw, false).forecast).toEqual([])
  })
  it('includeForecast=true면 12시간 예측 배열(FCST_YN=Y일 때)', () => {
    const p = normalizePopulation(raw, true)
    if (raw.FCST_YN === 'Y') {
      expect(p.forecast.length).toBeGreaterThan(0)
      expect(p.forecast[0]).toHaveProperty('at')
      expect(p.forecast[0]).toHaveProperty('congestionLevel')
    }
  })
})
