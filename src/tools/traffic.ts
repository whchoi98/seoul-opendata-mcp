import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { normalizeArrivals } from '../normalize/subway.js'
import { normalizeBikeStations, haversineM } from '../normalize/bike.js'
import { normalizeParkingLots, normalizeParkInfo, uniqueByCode } from '../normalize/parking.js'
import {
  DIRECTION, DAY, lineInput, stationNameCandidates, normalizeSubwayStations, normalizeFirstLast, normalizeTimetable,
  type SubwayStation,
} from '../normalize/subwaySchedule.js'
import { isNoData } from '../client/response.js'
import { positionalPath } from './path.js'
import { kstHHMM, serviceDayType } from './kst.js'

const STATION_SEARCH = 'SearchInfoBySubwayNameService'
const FIRST_LAST = 'SearchFirstAndLastTrainbyLineServiceNew'
const TIMETABLE = 'SearchSTNTimeTableByIDService'
const DAY_CODE = { weekday: '1', saturday: '2', holiday: '3' } as const
const NUMBERED_LINE = /^[1-9]호선$/ // 첫차·막차와 시간표 서비스는 1~9호선만 데이터를 준다

/** 'HH:MM'을 시간표 비교 키로. 새벽 4시 전은 전날 운행의 24시 이후 표기(예: 00:30 → 24:30)와 맞춘다 */
const timeKey = (hhmm: string) => {
  const h = Number(hhmm.slice(0, 2))
  return h < 4 ? `${h + 24}:${hhmm.slice(3, 5)}` : hhmm
}
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
          notes: u.note ? [u.note] : data.length === 0 ? ['도착 정보 없음 — 역명을 확인하세요 (예: "강남", "홍대입구")'] : [],
          sample: ctx.client.isSample,
        },
      )
    },
  )

  server.registerTool(
    'get_subway_schedule',
    {
      title: 'Subway first/last train and timetable',
      description:
        'Get first and last train times (both directions) for a Seoul subway station on lines 1-9, with an optional timetable of upcoming departures. ' +
        '지하철역 첫차·막차 시간과 역별 시간표(1~9호선). "고덕역 막차 몇 시야?" 류 질문에 사용. 실시간 도착은 get_subway_arrivals 사용.',
      inputSchema: {
        station: z.string().describe('지하철역명 (예: "강남", "서울역", "고덕")'),
        line: z.string().optional().describe('호선 (예: "2호선"). 생략하면 그 역의 1~9호선 전체'),
        day: z.enum(['weekday', 'saturday', 'holiday']).optional().describe('요일 구분 (기본: 오늘 운행일, 일요일은 holiday). 공휴일에는 holiday로 지정'),
        includeTimetable: z.boolean().optional().describe('시간표(다음 열차 목록) 포함 여부 (기본 false)'),
        after: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('시간표 시작 시각 HH:MM (기본: day 생략 시 지금, 지정 시 첫차부터)'),
        limit: z.number().int().min(1).max(30).optional().describe('방향별 시간표 건수 (기본 5)'),
      },
    },
    async ({ station, line, day, includeTimetable, after, limit }) => {
      const source = '서울시 지하철 첫차·막차, 역별 시간표 (SearchFirstAndLastTrainbyLineServiceNew, SearchSTNTimeTableByIDService)'
      let found: SubwayStation[] = []
      let name = station.trim()
      let searchNote: string | undefined
      for (const candidate of stationNameCandidates(station)) {
        const u = await ctx.client.getJson(STATION_SEARCH, 1, 20, [candidate])
        searchNote = isNoData(u) ? undefined : u.note
        if (u.rows.length > 0) { found = normalizeSubwayStations(u.rows); name = candidate; break }
        if (searchNote) break // 쿼터 소진 등 — 다른 이름으로 다시 찾아도 같다
      }
      if (found.length === 0) {
        return ok({ station: name, lines: [] }, {
          source,
          notes: [searchNote ?? '역을 찾지 못했습니다. 역명을 확인하세요 (예: "강남", "서울역", "홍대입구").'],
          sample: ctx.client.isSample,
        })
      }

      const wanted = line ? found.filter(s => s.line === lineInput(line)) : found
      const supported = wanted.filter(s => NUMBERED_LINE.test(s.line))
      const unsupported = wanted.filter(s => !NUMBERED_LINE.test(s.line)).map(s => s.line)
      const dow = DAY_CODE[day ?? serviceDayType()]
      const from = includeTimetable ? timeKey(after ?? (day ? '04:00' : kstHHMM())) : null
      const n = limit ?? 5
      const notes = new Set<string>()

      const lines = await Promise.all(supported.map(async s => ({
        line: s.line,
        stationCode: s.code,
        directions: await Promise.all(['1', '2'].map(async dir => {
          const u = await ctx.client.getJson(FIRST_LAST, 1, 5, [s.line, dir, dow, s.code])
          if (u.note && !isNoData(u)) notes.add(u.note)
          const fl = normalizeFirstLast(u.rows)[0]
          const entry: Record<string, unknown> = { direction: DIRECTION[dir], first: fl?.first ?? null, last: fl?.last ?? null }
          if (from) {
            const t = await ctx.client.getJson(TIMETABLE, 1, 500, [s.code, dow, dir])
            if (t.note && !isNoData(t)) notes.add(t.note)
            const upcoming = t.rows
              .filter(r => String(r.LEFTTIME ?? '').slice(0, 5) >= from)
              .sort((a, b) => String(a.LEFTTIME).localeCompare(String(b.LEFTTIME)))
            entry.timetable = normalizeTimetable(upcoming.slice(0, n))
          }
          return entry
        })),
      })))

      if (line && wanted.length === 0) notes.add(`${name}역에는 ${lineInput(line)}이 없습니다. 이 역의 노선: ${found.map(s => s.line).join(', ')}`)
      if (unsupported.length > 0) notes.add(`첫차·막차와 시간표는 1~9호선만 제공합니다. 제외한 노선: ${unsupported.join(', ')}`)
      if (!day) notes.add('요일은 오늘 운행일 기준입니다. 공휴일이면 day: "holiday"로 다시 조회하세요.')
      notes.add('nextDay: true는 자정을 넘긴 시각(다음 날 새벽)입니다.')
      return ok({ station: name, day: DAY[dow], lines }, { source, notes: [...notes], sample: ctx.client.isSample })
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
      const { rows, note } = await ctx.client.fetchAll('bikeList', { max: 3000, pageSize: 1000 })
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
        {
          source: 'OA-15493 (bikeList)',
          notes: [
            ...(note ? [note] : []),
            ...(stations.length === 0 ? ['조건에 맞는 대여소가 없습니다. 키워드를 줄여보세요.'] : []),
          ],
          sample: ctx.client.isSample,
        },
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
        includeNonRealtime: z.boolean().optional().describe('실시간 연계가 없는 공영주차장의 요금·운영시간 안내(otherLots)도 함께 조회 (기본 true)'),
      },
    },
    async ({ query, limit, includeNonRealtime }) => {
      const n = limit ?? 10
      const { rows, note } = await ctx.client.fetchAll('GetParkingInfo', { max: 1000, pageSize: 1000 })
      const realtime = normalizeParkingLots(rows)
      const lots = realtime.filter(p => p.name.includes(query) || p.address.includes(query))
      const data: Record<string, unknown> = { count: lots.length, lots: lots.slice(0, n) }
      const notes = ['실시간 연계 주차장(약 122곳)만 현재 주차대수를 제공합니다.', ...(note ? [note] : [])]
      let otherCount = 0
      if (includeNonRealtime ?? true) {
        // 안내 서비스는 1번 자리 ADDR(주소 부분일치)로 서버에서 거른다. 같은 주차장이 여러 행으로 와서 코드로 중복을 없앤다
        const u = await ctx.client.getJson('GetParkInfo', 1, 1000, positionalPath([query]))
        const realtimeCodes = new Set(realtime.map(p => p.code))
        const others = uniqueByCode(normalizeParkInfo(u.rows)).filter(p => !realtimeCodes.has(p.code))
        otherCount = others.length
        data.otherCount = otherCount
        data.otherLots = others.slice(0, n)
        notes.push('otherLots는 실시간 연계가 없는 공영주차장의 요금·운영시간 안내입니다(주소로 검색, 현재 주차대수 없음).')
        if (u.note && !isNoData(u)) notes.push(u.note)
        if (u.totalCount > u.rows.length) notes.push(`안내 데이터 ${u.totalCount.toLocaleString('ko-KR')}행 중 앞 ${u.rows.length.toLocaleString('ko-KR')}행만 받았습니다. 동 이름처럼 좁은 주소로 조회하세요.`)
      }
      if (lots.length === 0 && otherCount === 0) notes.push('조건에 맞는 주차장이 없습니다. 자치구명으로 넓혀보세요.')
      return ok(data, {
        source: '서울시 공영주차장 실시간 (GetParkingInfo), 공영주차장 안내 (GetParkInfo)',
        notes,
        sample: ctx.client.isSample,
      })
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
      return ok({ place: r.name, ...data }, {
        source: 'OA-21285 (citydata ROAD_TRAFFIC_STTS)',
        asOf: data.measuredAt || null,
        notes: [...(u.note ? [u.note] : [])],
        sample: ctx.client.isSample,
      })
    },
  )
}
