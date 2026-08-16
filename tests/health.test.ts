import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizePharmacies } from '../src/normalize/health.js'

const rows = unwrap('TbPharmacyOperateInfo', JSON.parse(readFileSync('tests/fixtures/pharmacy.json', 'utf8'))).rows

describe('normalizePharmacies — 매핑 동등성 (재캡처 안전)', () => {
  it('이름/주소/전화 매핑 일치', () => {
    const a = normalizePharmacies(rows)
    expect(a.length).toBe(rows.length)
    rows.forEach((r: any, i: number) => {
      expect(a[i].name).toBe(r.DUTYNAME ?? '')
      expect(a[i].address).toBe(r.DUTYADDR ?? '')
      expect(a[i].tel).toBe(r.DUTYTEL1 ?? '')
    })
  })
  it('요일별 운영시간: 월요일 키 존재, HHMM-HHMM 형식 또는 빈 문자열', () => {
    const a = normalizePharmacies(rows)
    expect(a[0].hours).toHaveProperty('월')
    expect(a[0].hours['월']).toMatch(/^(\d{4}-\d{4}|)$/)
  })
})
