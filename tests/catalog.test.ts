import { describe, it, expect } from 'vitest'
import { CATALOG, searchCatalog, validateCall, exampleParams } from '../src/data/catalog.js'

describe('CATALOG 무결성', () => {
  it('정확히 52개, id 유일', () => {
    expect(CATALOG).toHaveLength(52)
    expect(new Set(CATALOG.map(e => e.id)).size).toBe(52)
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
  it('catalog의 tool 필드는 실제 TOOL_NAMES에 존재', async () => {
    const { TOOL_NAMES } = await import('../src/index.js')
    for (const e of CATALOG.filter(x => x.tool)) expect(TOOL_NAMES).toContain(e.tool!)
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
  it('부동산 3종은 정식 tool로 안내: 공시지가, 전월세', () => {
    const land = searchCatalog('공시지가')[0]
    expect(land.id).toBe('IndividuallyPostedLandPriceService')
    expect(land.tool).toBe('get_land_price')
    expect(CATALOG.find(e => e.id === 'tbLnOpendataRentV')!.tool).toBe('get_real_estate_prices')
  })
  it('추가 tool 대상 데이터셋은 정식 tool로 안내: 막차, 시간대별 승하차, 테니스장 예약, 주차 요금', () => {
    expect(searchCatalog('지하철 막차')[0].tool).toBe('get_subway_schedule')
    expect(searchCatalog('시간대별 승하차')[0]).toMatchObject({ id: 'CardSubwayTime', tool: 'get_subway_hourly_ridership' })
    expect(searchCatalog('테니스장 예약')[0]).toMatchObject({ id: 'ListPublicReservationSport', tool: 'search_public_reservations' })
    expect(searchCatalog('주차장 요금 운영시간')[0]).toMatchObject({ id: 'GetParkInfo', tool: 'get_parking' })
  })
  it('카탈로그 전용 신규 항목 검색', () => {
    const top = (q: string) => searchCatalog(q)[0]?.id
    expect(top('한파쉼터')).toBe('TbGtnCwP')
    expect(top('기후동행쉼터')).toBe('tbClicomCnt')
    expect(top('키즈카페 무료')).toBe('tnFcltySttusInfo1011')
    expect(top('응급실')).toBe('TvEmgcHospitalInfo')
    expect(top('소아 야간 진료')).toBe('mgis1708328729039Point')
    expect(top('강우량')).toBe('AiRainfallService')
    expect(top('하천 수위')).toBe('ListRiverStageService')
    expect(top('엘리베이터 운행')).toBe('SeoulMetroFaciInfo')
    expect(top('착한가격업소')).toBe('goodPrices')
    expect(top('모범업소')).toBe('ListPriceModelStoreService')
    expect(top('경로당')).toBe('OdsnBuildingInfo')
    expect(top('공중화장실')).toBe('mgisToiletPoi')
    expect(top('동물병원')).toBe('LOCALDATA_020301')
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
  // 공시지가는 필수 인자가 1번째(SIGUNGU_NM)와 6번째(YEAR)로 떨어져 있다 — 개수가 아니라 자리로 검사해야 한다
  const land = CATALOG.find(e => e.id === 'IndividuallyPostedLandPriceService')!
  it('필수 인자 자리가 비면 안내문 (개수만 맞는 호출 거부)', () => {
    expect(validateCall(land, ['강남구', '2025'])).toContain('YEAR')
    expect(validateCall(land, ['강남구', ' ', ' ', ' ', ' ', ' '])).toContain('YEAR')
    expect(validateCall(land, [' ', ' ', ' ', ' ', ' ', '2025'])).toContain('SIGUNGU_NM')
  })
  it('건너뛰는 자리를 공백으로 채우면 통과하고, 안내문은 그 방법을 알려준다', () => {
    expect(validateCall(land, ['강남구', ' ', ' ', ' ', ' ', '2025'])).toBeNull()
    expect(validateCall(land, ['강남구'])).toContain('공백')
  })
  it('선택 인자만 있는 데이터셋은 빈 params로 통과', () => {
    expect(validateCall(CATALOG.find(e => e.id === 'tbLnOpendataRtmsV')!, [])).toBeNull()
  })
})

describe('exampleParams — get_dataset_spec 호출 예시', () => {
  const byId = (id: string) => CATALOG.find(e => e.id === id)!
  it('마지막 필수 인자 자리까지 채우고, 그 사이 선택 자리는 공백으로 둔다', () => {
    expect(exampleParams(byId('IndividuallyPostedLandPriceService'))).toEqual(['강남구', ' ', ' ', ' ', ' ', '2025'])
    expect(exampleParams(byId('CardSubwayStatsNew'))).toEqual(['20260801'])
    expect(exampleParams(byId('tbLnOpendataRtmsV'))).toEqual([])
  })
  it('모든 호출 가능 항목의 예시는 validateCall을 통과한다', () => {
    for (const e of CATALOG.filter(x => x.callable)) expect(validateCall(e, exampleParams(e))).toBeNull()
  })
})
