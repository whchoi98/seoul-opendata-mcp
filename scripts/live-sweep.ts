// 23개 tool 전수 라이브 스위프 — 호출당 서버 프로세스 1개, 간격 1.3초 (샘플 키 제한 회피)
import { spawnSync } from 'node:child_process'

const CALLS: Array<[string, Record<string, unknown>]> = [
  ['search_place', { query: '강남' }],
  ['get_city_snapshot', { place: '광화문' }],
  ['get_disaster_alerts', { place: '광화문' }],
  ['get_population', { place: '광화문' }],
  ['get_commercial_activity', { place: '광화문' }],
  ['get_subway_arrivals', { station: '강남' }],
  ['get_subway_schedule', { station: '서울역', includeTimetable: true, limit: 2 }],
  ['get_bike_stations', { query: '망원' }],
  ['get_parking', { query: '세종로' }],
  ['get_road_traffic', { place: '광화문' }],
  ['search_cultural_events', { district: '강동구', limit: 2 }],
  ['search_public_reservations', { category: 'sports', subcategory: '테니스장', limit: 2 }],
  ['get_air_quality', { district: '중구' }],
  ['get_weather', { place: '광화문' }],
  ['get_subway_ridership', { date: '20260801', station: '강남' }],
  ['get_subway_hourly_ridership', { station: '강남', line: '2호선' }],
  ['get_living_population', { limit: 3 }],
  ['get_real_estate_prices', { year: '2025', district: '강남구', buildingUse: '아파트', limit: 3 }],
  ['get_land_price', { district: '강남구', dong: '역삼동', lotNumber: '737', year: '2025' }],
  ['find_pharmacies', { district: '중구', limit: 3 }],
  ['search_dataset', { query: '와이파이' }],
  ['get_dataset_spec', { id: 'TbPublicWifiInfo' }],
  ['call_dataset', { id: 'TbPublicWifiInfo', limit: 3 }],
]

let ok = 0
for (const [i, [name, args]] of CALLS.entries()) {
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sweep', version: '0' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
  ].join('\n') + '\n'
  const proc = spawnSync('node', ['dist/index.js'], { input, encoding: 'utf8', timeout: 60_000 })
  const line = proc.stdout.trim().split('\n').find(l => l.includes('"id":2'))
  let verdict = '✗ 응답 없음'
  if (line) {
    const msg = JSON.parse(line)
    if (msg.result && !msg.result.isError) {
      let info = ''
      try {
        const body = JSON.parse(msg.result.content?.[0]?.text ?? '{}')
        const d = body?.data ?? {}
        const c = d.count ?? d.rows?.length ?? d.arrivals?.length ?? d.stations?.length ?? d.datasets?.length ?? d.alerts?.length
        info = c != null ? ` (count=${c})` : ''
      } catch { /* 원본이 JSON이 아니면 suffix 생략 */ }
      verdict = `✓${info}`
    } else {
      verdict = `✗ ${JSON.stringify(msg.result?.content?.[0]?.text ?? msg.error).slice(0, 60)}`
    }
  }
  if (verdict.startsWith('✓')) ok++
  console.log(`${name.padEnd(26)} ${verdict}`)
  if (i < CALLS.length - 1) await new Promise(r => setTimeout(r, 1300))
}
console.log(`\n성공 ${ok}/${CALLS.length}`)
process.exit(ok === CALLS.length ? 0 : 1)
