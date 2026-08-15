import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeCommercial } from '../src/normalize/commercial.js'

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
