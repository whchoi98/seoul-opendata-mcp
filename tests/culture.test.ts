import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeEvents, filterEvents } from '../src/normalize/culture.js'

const rows = unwrap('culturalEventInfo', JSON.parse(readFileSync('tests/fixtures/culture.json', 'utf8'))).rows

describe('normalizeEvents', () => {
  it('행사 필드 매핑 + 날짜 YYYY-MM-DD 절단', () => {
    const e = normalizeEvents(rows)[0]
    expect(e.title).toBeTruthy()
    expect(e.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('isFree: 무료 표기 감지', () => {
    const free = normalizeEvents([{ USE_FEE: '무료', STRTDATE: '2026-01-01 00:00:00.0', END_DATE: '2026-01-02 00:00:00.0' }])[0]
    expect(free.isFree).toBe(true)
  })
})

describe('filterEvents', () => {
  const evts = normalizeEvents([
    { GUNAME: '강동구', TITLE: 'A', STRTDATE: '2026-12-24 00:00:00.0', END_DATE: '2026-12-24 00:00:00.0', USE_FEE: '10000원' },
    { GUNAME: '마포구', TITLE: 'B', STRTDATE: '2026-08-01 00:00:00.0', END_DATE: '2026-08-31 00:00:00.0', USE_FEE: '' },
  ])
  it('자치구 필터', () => expect(filterEvents(evts, { district: '마포구' })).toHaveLength(1))
  it('기간 겹침 필터: 8월 중순 조회 시 B만', () =>
    expect(filterEvents(evts, { from: '2026-08-10', to: '2026-08-20' }).map(e => e.title)).toEqual(['B']))
  it('freeOnly: 요금 빈 문자열/무료만', () =>
    expect(filterEvents(evts, { freeOnly: true }).map(e => e.title)).toEqual(['B']))

  describe('boundary overlap regression cases', () => {
    it('경계 겹침: startDate === f.to 일 때 포함', () => {
      const evt = normalizeEvents([{ TITLE: 'C', STRTDATE: '2026-08-20 00:00:00.0', END_DATE: '2026-08-25 00:00:00.0' }])[0]
      expect(filterEvents([evt], { from: '2026-08-10', to: '2026-08-20' })).toHaveLength(1)
    })
    it('경계 겹침: endDate === f.from 일 때 포함', () => {
      const evt = normalizeEvents([{ TITLE: 'D', STRTDATE: '2026-08-01 00:00:00.0', END_DATE: '2026-08-10 00:00:00.0' }])[0]
      expect(filterEvents([evt], { from: '2026-08-10', to: '2026-08-20' })).toHaveLength(1)
    })
    it('완전 비겹침: endDate < from 일 때 제외', () => {
      const evt = normalizeEvents([{ TITLE: 'E', STRTDATE: '2026-08-01 00:00:00.0', END_DATE: '2026-08-09 00:00:00.0' }])[0]
      expect(filterEvents([evt], { from: '2026-08-10', to: '2026-08-20' })).toHaveLength(0)
    })
    it('빈 날짜 통과: empty startDate/endDate는 date 필터를 회피', () => {
      const evt = normalizeEvents([{ TITLE: 'F', STRTDATE: '', END_DATE: '' }])[0]
      expect(filterEvents([evt], { from: '2026-08-10', to: '2026-08-20' })).toHaveLength(1)
    })
  })
})

describe('normalizeEvents - fixture mapping equality', () => {
  it('raw fixture 행 → normalized 필드 매핑 검증', () => {
    const normalized = normalizeEvents(rows)
    expect(normalized.length).toBeGreaterThan(0)

    normalized.forEach((e, idx) => {
      const raw = rows[idx]
      // 필드별 매핑 검증
      expect(e.category).toBe(raw.CODENAME ?? '')
      expect(e.district).toBe(raw.GUNAME ?? '')
      expect(e.title).toBe(raw.TITLE ?? '')
      expect(e.period).toBe(raw.DATE ?? '')
      expect(e.startDate).toBe((String(raw.STRTDATE ?? '')).slice(0, 10))
      expect(e.endDate).toBe((String(raw.END_DATE ?? '')).slice(0, 10))
      expect(e.place).toBe(raw.PLACE ?? '')
      expect(e.fee).toBe((String(raw.USE_FEE ?? '')).trim())
      expect(e.link).toBe(raw.ORG_LINK ?? raw.HMPG_ADDR ?? '')
    })
  })
})
