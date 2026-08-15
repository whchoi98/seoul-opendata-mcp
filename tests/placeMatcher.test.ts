import { describe, it, expect } from 'vitest'
import { HOTSPOTS } from '../src/data/hotspots.js'
import { searchPlace } from '../src/data/placeMatcher.js'

describe('HOTSPOTS 데이터', () => {
  it('정확히 121곳', () => expect(HOTSPOTS).toHaveLength(121))
  it('상권 지원은 정확히 82곳', () => expect(HOTSPOTS.filter(h => h.commercial)).toHaveLength(82))
  it('카테고리별 개수: 고궁5/특구7/공원33/상권28/밀집48', () => {
    const count = (c: string) => HOTSPOTS.filter(h => h.category === c).length
    expect(count('고궁·문화유산')).toBe(5)
    expect(count('관광특구')).toBe(7)
    expect(count('공원')).toBe(33)
    expect(count('발달상권')).toBe(28)
    expect(count('인구밀집지역')).toBe(48)
  })
})

describe('searchPlace', () => {
  it('정확 일치', () => expect(searchPlace('강남역').match?.name).toBe('강남역'))
  it('중점(·)/공백 무시', () => expect(searchPlace('광화문 덕수궁').match?.name).toBe('광화문·덕수궁'))
  it('별칭: 코엑스 → 강남 MICE 관광특구', () =>
    expect(searchPlace('코엑스').match?.name).toBe('강남 MICE 관광특구'))
  it('별칭: 롯데타워 → 잠실롯데타워·석촌호수', () =>
    expect(searchPlace('롯데타워').match?.name).toBe('잠실롯데타워·석촌호수'))
  it('모호한 질의(홍대)는 match=null + 후보 2개 이상', () => {
    const r = searchPlace('홍대')
    expect(r.match).toBeNull()
    expect(r.candidates.length).toBeGreaterThanOrEqual(2)
    expect(r.candidates.map(c => c.name)).toContain('홍대 관광특구')
  })
  it('유일 부분일치는 match 확정: 서울숲', () =>
    expect(searchPlace('서울숲').match?.name).toBe('서울숲공원'))
  it('불일치 시 match=null + 후보 제안', () => {
    const r = searchPlace('강남스타일거리')
    expect(r.match).toBeNull()
    expect(r.candidates.length).toBeGreaterThan(0)
  })
})
