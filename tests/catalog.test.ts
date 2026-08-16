import { describe, it, expect } from 'vitest'
import { CATALOG, searchCatalog, validateCall } from '../src/data/catalog.js'

describe('CATALOG 무결성', () => {
  it('정확히 28개, id 유일', () => {
    expect(CATALOG).toHaveLength(28)
    expect(new Set(CATALOG.map(e => e.id)).size).toBe(28)
  })
  it('카테고리는 6종만', () => {
    const cats = new Set(CATALOG.map(e => e.category))
    expect([...cats].sort()).toEqual(['교통·이동', '문화·여가', '보건·복지', '부동산·경제', '생활·인구', '안전·환경'])
  })
  it('required 파라미터는 example 필수', () => {
    for (const e of CATALOG) for (const p of e.pathParams) if (p.required) expect(p.example.length).toBeGreaterThan(0)
  })
  it('callable=false 항목은 tool 안내 필수', () => {
    for (const e of CATALOG.filter(x => !x.callable)) expect(e.tool).toBeTruthy()
  })
  it('XML 전용은 AccInfo, LIVE_DST_MESSAGE(파생), citydata뿐', () => {
    expect(CATALOG.filter(e => e.responseType === 'xml').map(e => e.id).sort()).toEqual(['AccInfo', 'LIVE_DST_MESSAGE', 'citydata'])
  })
})

describe('searchCatalog', () => {
  it('키워드로 관련 항목 상위 반환: 와이파이', () => {
    expect(searchCatalog('와이파이')[0].id).toBe('TbPublicWifiInfo')
  })
  it('정식 tool 있는 항목 검색: 지하철 승하차', () => {
    const top = searchCatalog('지하철 승하차')[0]
    expect(top.id).toBe('CardSubwayStatsNew')
    expect(top.tool).toBe('get_subway_ridership')
  })
  it('무관 키워드는 빈 배열 또는 낮은 관련 후보', () => {
    expect(searchCatalog('zzzz없는키워드')).toHaveLength(0)
  })
})

describe('validateCall', () => {
  const subway = CATALOG.find(e => e.id === 'CardSubwayStatsNew')!
  const disaster = CATALOG.find(e => e.id === 'LIVE_DST_MESSAGE')!
  it('required 누락 시 안내문', () => {
    expect(validateCall(subway, [])).toContain('USE_YMD')
  })
  it('required 충족 시 null', () => {
    expect(validateCall(subway, ['20260801'])).toBeNull()
  })
  it('callable=false는 tool 안내', () => {
    expect(validateCall(disaster, [])).toContain('get_disaster_alerts')
  })
})
