import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeCommercial } from '../src/normalize/commercial.js'
import { suggestCommercialAlternatives } from '../src/tools/population.js'
import { HOTSPOTS } from '../src/data/hotspots.js'

const raw = unwrap('citydata_cmrcl', JSON.parse(readFileSync('tests/fixtures/cmrcl.json', 'utf8'))).rows[0]

describe('normalizeCommercial', () => {
  it('상권 4단계 레벨과 결제 수치', () => {
    const c = normalizeCommercial(raw)
    expect(['한산한', '보통', '바쁜', '분주한']).toContain(c.level)
    expect(typeof c.paymentCount).toBe('number')
  })
  it('업종별 배열 매핑', () => {
    const c = normalizeCommercial(raw)
    expect(c.categories.length).toBeGreaterThan(0)
    expect(c.categories[0]).toHaveProperty('large')
    expect(c.categories[0]).toHaveProperty('level')
    expect(typeof c.categories[0].merchantCount).toBe('number')
  })
})

describe('suggestCommercialAlternatives', () => {
  it('공원 미지원 장소는 발달상권·관광특구 폴백 제안', () => {
    const park = HOTSPOTS.find(h => h.name === '남산공원')!
    expect(park.category).toBe('공원')
    expect(park.commercial).toBe(false)

    const alternatives = suggestCommercialAlternatives(park)
    expect(alternatives.length).toBeGreaterThan(0)
    expect(alternatives.length).toBeLessThanOrEqual(5)

    // 모든 제안이 상업 지역이어야 함
    alternatives.forEach(name => {
      const spot = HOTSPOTS.find(h => h.name === name)
      expect(spot?.commercial).toBe(true)
      expect(['발달상권', '관광특구']).toContain(spot?.category)
    })
  })

  it('인구밀집 비지원 장소는 같은 카테고리 제안', () => {
    const dense = HOTSPOTS.find(h => h.name === '삼각지역')!
    expect(dense.category).toBe('인구밀집지역')
    expect(dense.commercial).toBe(false)

    const alternatives = suggestCommercialAlternatives(dense)
    expect(alternatives.length).toBeGreaterThan(0)
    expect(alternatives.length).toBeLessThanOrEqual(5)

    // 모든 제안이 같은 카테고리여야 함
    alternatives.forEach(name => {
      const spot = HOTSPOTS.find(h => h.name === name)
      expect(spot?.category).toBe('인구밀집지역')
      expect(spot?.commercial).toBe(true)
    })
  })
})
