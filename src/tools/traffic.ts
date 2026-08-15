import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { normalizeArrivals } from '../normalize/subway.js'
import { normalizeBikeStations, haversineM } from '../normalize/bike.js'
import { normalizeParkingLots } from '../normalize/parking.js'
import { extractRoadTraffic } from '../normalize/citydata.js'

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

  server.registerTool(
    'get_parking',
    {
      title: 'Public parking availability',
      description:
        'Get real-time available spaces in Seoul public parking lots, filtered by place/district keyword matched against lot name and address. ' +
        '공영주차장 실시간 주차 가능 면수 (실시간 연계 122곳 한정). "종로 주차 자리 있어?" 류 질문에 사용.',
      inputSchema: {
        query: z.string().describe('장소/자치구 키워드 (예: "종로", "세종로", "강남")'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ query, limit }) => {
      const rows = await ctx.client.fetchAll('GetParkingInfo', { max: 1000, pageSize: 1000 })
      const lots = normalizeParkingLots(rows).filter(p => p.name.includes(query) || p.address.includes(query))
      return ok(
        { count: lots.length, lots: lots.slice(0, limit ?? 10) },
        {
          source: '서울시 공영주차장 실시간 (GetParkingInfo)',
          notes: [
            '실시간 연계 주차장(약 122곳)만 현재 주차대수를 제공합니다.',
            ...(lots.length === 0 ? ['조건에 맞는 주차장이 없습니다. 자치구명으로 넓혀보세요.'] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )

  server.registerTool(
    'get_road_traffic',
    {
      title: 'Road traffic & incidents around a hotspot',
      description:
        'Get average road speed, congestion message, and accident/control incidents around a Seoul hotspot. ' +
        '핫스팟 주변 도로소통·사고통제 현황. "광화문 근처 길 막혀?" 류 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getXml('citydata', 1, 5, [r.name])
      const data = extractRoadTraffic(u.rows[0] ?? {})
      return ok({ place: r.name, ...data }, { source: 'OA-21285 (citydata ROAD_TRAFFIC_STTS)', asOf: data.measuredAt || null, sample: ctx.client.isSample })
    },
  )
}
