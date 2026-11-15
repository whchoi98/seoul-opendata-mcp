import { describe, it, expect } from 'vitest'
import { SeoulApiClient } from '../src/client/seoulApi.js'
import { normalizePopulation } from '../src/normalize/population.js'
import { loadDotEnv } from '../src/client/env.js'

const live = process.env.RUN_LIVE === '1' ? describe : describe.skip

live('live smoke (RUN_LIVE=1)', () => {
  loadDotEnv()
  const client = new SeoulApiClient()

  it('citydata_ppltn: 광화문·덕수궁 실시간 인구', async () => {
    const u = await client.getJson('citydata_ppltn', 1, 5, ['광화문·덕수궁'])
    expect(u.rows.length).toBeGreaterThan(0)
    const p = normalizePopulation(u.rows[0], false)
    expect(['여유', '보통', '약간 붐빔', '붐빔']).toContain(p.congestionLevel)
  }, 20_000)

  it('culturalEventInfo: 경로 파라미터(CODENAME/TITLE/DATE) 순서 검증', async () => {
    const u = await client.getJson('culturalEventInfo', 1, 5, [' ', ' ', ' '])
    expect(u.rows.length).toBeGreaterThan(0)
    expect(u.rows[0]).toHaveProperty('TITLE')
  }, 20_000)

  it('CardSubwayStatsNew: 날짜 파라미터 경로 검증', async () => {
    const u = await client.getJson('CardSubwayStatsNew', 1, 5, ['20260801'])
    expect(u.rows.length).toBeGreaterThan(0)
    expect(u.rows[0]).toHaveProperty('SBWY_STNS_NM')
  }, 20_000)

  // 부동산 3종은 경로의 자리로 필터를 구분한다 — 자리 순서가 바뀌면 여기서 드러난다
  it('tbLnOpendataRtmsV: 과거 연도 + 자치구 필터 (연도 지정 시 0건이던 회귀)', async () => {
    const u = await client.getJson('tbLnOpendataRtmsV', 1, 5, ['2025', ' ', '강남구'])
    expect(u.rows.length).toBeGreaterThan(0)
    for (const r of u.rows) { expect(String(r.RCPT_YR)).toBe('2025'); expect(r.CGG_NM).toBe('강남구') }
  }, 20_000)

  it('tbLnOpendataRentV: 건물 용도는 10번째 자리', async () => {
    const u = await client.getJson('tbLnOpendataRentV', 1, 5, ['2025', ' ', '강남구', ' ', ' ', ' ', ' ', ' ', ' ', '아파트'])
    expect(u.rows.length).toBeGreaterThan(0)
    for (const r of u.rows) { expect(r.CGG_NM).toBe('강남구'); expect(r.BLDG_USG).toBe('아파트') }
  }, 20_000)

  it('IndividuallyPostedLandPriceService: 법정동 코드가 실거래가 STDG_CD와 같다', async () => {
    const land = await client.getJson('IndividuallyPostedLandPriceService', 1, 1, ['강남구', '역삼동', ' ', ' ', ' ', '2025'])
    expect(land.rows[0]).toHaveProperty('JIGA')
    const sale = await client.getJson('tbLnOpendataRtmsV', 1, 5, ['2025', ' ', '강남구', String(land.rows[0].BJDONG_CD)])
    expect(sale.rows.length).toBeGreaterThan(0)
    for (const r of sale.rows) expect(r.STDG_NM).toBe('역삼동')
  }, 20_000)

  it('catalog call 경로: TbPublicWifiInfo 5행', async () => {
    const u = await client.getJson('TbPublicWifiInfo', 1, 5)
    expect(u.rows.length).toBeGreaterThan(0)
  }, 20_000)
})
