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

  it('catalog call 경로: TbPublicWifiInfo 5행', async () => {
    const u = await client.getJson('TbPublicWifiInfo', 1, 5)
    expect(u.rows.length).toBeGreaterThan(0)
  }, 20_000)
})
