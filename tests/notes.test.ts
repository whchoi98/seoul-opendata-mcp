// 스펙 §4.4 회귀: 클라이언트가 붙인 안내(쿼터 경고, 쿼터 소진, stale 캐시 경과)가 성공 응답의 notes까지 살아남는지
// tool 호출 전체 경로로 검사한다. 단건 호출(getJson/getXml/getSubway) tool이 대상이다.
import { describe, it, expect } from 'vitest'
import { InMemoryLedger, keyIdOf } from '../src/client/quota.js'
import { fixtureUpstream, callTool } from './helpers/mcp.js'

const FIXTURES = {
  citydata_ppltn: 'ppltn.json',
  citydata_cmrcl: 'cmrcl.json',
  citydata: 'citydata.xml',
  RealtimeCityAir: 'air.json',
  realtimeStationArrival: 'subway.json',
}

const PLACE = '광화문·덕수궁' // 픽스처 캡처 장소, 상권 지원 장소

const CASES: Array<[tool: string, args: Record<string, unknown>]> = [
  ['get_population', { place: PLACE }],
  ['get_commercial_activity', { place: PLACE }],
  ['get_disaster_alerts', { place: PLACE }],
  ['get_air_quality', {}],
  ['get_subway_arrivals', { station: '강남' }],
]

async function ledgerAt(used: number, limit: number) {
  const ledger = new InMemoryLedger(limit)
  for (let i = 0; i < used; i++) await ledger.increment(keyIdOf('K'))
  return ledger
}

describe('단건 호출 tool — 쿼터 80% 경고가 notes에 남는다', () => {
  it.each(CASES)('%s', async (tool, args) => {
    const { fetchFn } = fixtureUpstream(FIXTURES)
    const body = await callTool(fetchFn, tool, args, { ledger: await ledgerAt(8, 10) })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(body.notes.some((n: string) => n.includes('쿼터 80%'))).toBe(true)
  })
})

describe('단건 호출 tool — 쿼터 소진(콜드 캐시)이면 소진 안내를 남기고 "없음"으로 단정하지 않는다', () => {
  it.each(CASES)('%s', async (tool, args) => {
    const { fetchFn } = fixtureUpstream(FIXTURES)
    const body = await callTool(fetchFn, tool, args, { ledger: await ledgerAt(1, 1) })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(body.notes.some((n: string) => n.includes('쿼터') && n.includes('소진'))).toBe(true)
  })

  it('get_disaster_alerts는 응답을 못 받았을 때 "수신된 재난문자가 없다"고 쓰지 않는다', async () => {
    const { fetchFn } = fixtureUpstream(FIXTURES)
    const body = await callTool(fetchFn, 'get_disaster_alerts', { place: PLACE }, { ledger: await ledgerAt(1, 1) })
    expect(body.notes.join(' ')).not.toContain('긴급재난문자가 없습니다')
  })

  it('get_air_quality는 응답을 못 받았을 때 자치구 이름을 탓하지 않는다', async () => {
    const { fetchFn } = fixtureUpstream(FIXTURES)
    const body = await callTool(fetchFn, 'get_air_quality', { district: '강남구' }, { ledger: await ledgerAt(1, 1) })
    expect(body.notes.join(' ')).not.toContain('자치구를 찾지 못했습니다')
  })
})

describe('정상 응답의 빈 결과 안내는 그대로 유지된다', () => {
  it('get_disaster_alerts: 응답은 왔지만 문자가 없으면 "없습니다" 안내', async () => {
    const { fetchFn } = fixtureUpstream(FIXTURES)
    const body = await callTool(fetchFn, 'get_disaster_alerts', { place: PLACE })
    expect(body.data.count).toBe(0)
    expect(body.notes.join(' ')).toContain('긴급재난문자가 없습니다')
  })

  it('get_air_quality: 응답은 왔지만 자치구가 없으면 이름 확인 안내', async () => {
    const { fetchFn } = fixtureUpstream(FIXTURES)
    const body = await callTool(fetchFn, 'get_air_quality', { district: '없는구' })
    expect(body.data.count).toBe(0)
    expect(body.notes.join(' ')).toContain('자치구를 찾지 못했습니다')
  })
})
