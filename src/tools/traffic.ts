import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeArrivals } from '../normalize/subway.js'
import { normalizeBikeStations, haversineM } from '../normalize/bike.js'

export function registerTrafficTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_subway_arrivals',
    {
      title: 'Real-time subway arrivals',
      description:
        'Get real-time subway train arrivals for a Seoul station. Pass the station name WITHOUT the "역" suffix if possible (e.g. "강남"). ' +
        '지하철역 실시간 도착 정보. "2호선 강남역 열차 언제 와?" 류 질문에 사용.',
      inputSchema: {
        station: z.string().describe('지하철역명 (예: "강남", "서울역"은 "서울")'),
        limit: z.number().int().min(1).max(30).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ station, limit }) => {
      const name = station.replace(/역$/, '') || station
      const u = await ctx.client.getSubway('realtimeStationArrival', 0, limit ?? 10, [name])
      const data = normalizeArrivals(u.rows)
      return ok(
        { station: name, arrivals: data },
        {
          source: '서울시 지하철 실시간 도착정보 (swopenapi)',
          notes: data.length === 0 ? [u.note ?? '도착 정보 없음 — 역명을 확인하세요 (예: "강남", "홍대입구")'] : [],
          sample: ctx.client.isSample,
        },
      )
    },
  )

  server.registerTool(
    'get_bike_stations',
    {
      title: 'Ttareungi (Seoul bike) station availability',
      description:
        'Find Seoul public bike (따릉이) stations by name keyword and/or coordinates, with real-time available bike counts. ' +
        '따릉이 대여소 실시간 잔여 대수. 장소 기반은 대여소 이름 키워드 매칭으로 동작 (예: query="강남역").',
      inputSchema: {
        query: z.string().optional().describe('대여소 이름 키워드 (예: "망원", "강남역")'),
        lat: z.number().optional().describe('중심 위도 (radiusM와 함께 사용)'),
        lng: z.number().optional().describe('중심 경도'),
        radiusM: z.number().optional().describe('반경 미터 (기본 500)'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ query, lat, lng, radiusM, limit }) => {
      if (!query && (lat == null || lng == null)) {
        return ok(
          { stations: [], hint: 'query(대여소 이름 키워드) 또는 lat+lng 중 하나는 필요합니다.' },
          { source: 'OA-15493 (bikeList)', sample: ctx.client.isSample },
        )
      }
      const rows = await ctx.client.fetchAll('bikeList', { max: 3000, pageSize: 1000 })
      let stations = normalizeBikeStations(rows)
      if (query) stations = stations.filter(s => s.name.includes(query))
      if (lat != null && lng != null) {
        stations = stations
          .map(s => ({ ...s, distanceM: s.lat != null && s.lng != null ? Math.round(haversineM(lat, lng, s.lat, s.lng)) : Infinity }))
          .filter(s => (s.distanceM ?? Infinity) <= (radiusM ?? 500))
          .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
      }
      return ok(
        { count: stations.length, stations: stations.slice(0, limit ?? 10) },
        { source: 'OA-15493 (bikeList)', notes: stations.length === 0 ? ['조건에 맞는 대여소가 없습니다. 키워드를 줄여보세요.'] : [], sample: ctx.client.isSample },
      )
    },
  )
}
