import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeSubwayRidership, normalizeLivingPopulation, normalizeSubwayHourly, type HourCount } from '../normalize/stats.js'
import { lineInput, stationNameCandidates } from '../normalize/subwaySchedule.js'
import { isNoData, type Unwrapped } from '../client/response.js'
import { positionalPath } from './path.js'
import { kstDaysAgo, kstMonthsAgo } from './kst.js'

const total = (h: HourCount) => (h.boardings ?? 0) + (h.alightings ?? 0)
const byTotal = (hours: HourCount[]) => hours.map(h => ({ hour: h.hour, total: total(h) }))

// 일별 승하차의 제공 범위. 2026-11-24 서울 API 확인: 3일 전(11월 21일)까지 있고, 3월 1일부터 있으며 2월 26일은 없다
const RIDERSHIP_RANGE_NOTE = '배치 통계입니다. 보통 3일 전 날짜까지 올라오고, 서울 API는 최근 약 9개월 치만 제공합니다.'
const RECENT_DAYS = 5
const OLD_DAYS = 260

/** 날짜에 행이 하나도 없을 때의 안내. 최근이면 집계 전, 오래됐으면 제공 기간 밖이라 권할 방향이 반대다 */
function emptyDateNote(date: string): string {
  const days = kstDaysAgo(date)
  if (days < 0) return '미래 날짜입니다. 지난 날짜로 조회하세요.'
  if (days <= RECENT_DAYS) return '아직 집계되지 않은 날짜입니다. 더 이전 날짜로 시도하세요.'
  if (days >= OLD_DAYS) return '서울 API가 제공하지 않는 오래된 날짜입니다. 더 최근 날짜로 시도하세요.'
  return '해당 날짜 데이터가 없습니다. 앞뒤 날짜로 시도하세요.'
}

export function registerStatsTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_subway_ridership',
    {
      title: 'Daily subway ridership statistics',
      description:
        'Get per-station daily subway boarding/alighting counts for a date (available from about 9 months back up to ~3 days ago). ' +
        '지하철 역별 일별 승하차 인원. "강남역 하루 승객 몇 명?" 류 질문에 사용.',
      inputSchema: {
        date: z.string().regex(/^\d{8}$/).describe('사용일자 YYYYMMDD (보통 3일 전까지 올라오고, 약 9개월보다 오래된 날짜는 없음)'),
        station: z.string().optional().describe('역명 필터 (부분일치, 예: "강남")'),
        line: z.string().optional().describe('호선 필터 (부분일치, 예: "2호선")'),
        limit: z.number().int().min(1).max(100).optional().describe('최대 건수 (기본 20)'),
      },
    },
    async ({ date, station, line, limit }) => {
      const u = await ctx.client.getJson('CardSubwayStatsNew', 1, 1000, [date])
      let rows = normalizeSubwayRidership(u.rows)
      if (station) rows = rows.filter(r => r.station.includes(station.replace(/역$/, '')))
      if (line) rows = rows.filter(r => r.line.includes(line))
      return ok(
        { date, count: rows.length, ridership: rows.slice(0, limit ?? 20) },
        {
          source: '지하철 일별 승하차 (CardSubwayStatsNew)', asOf: date,
          notes: [
            RIDERSHIP_RANGE_NOTE,
            // 응답 행이 있는데 걸러서 비었으면 조건 문제다. 응답을 못 받았으면(쿼터 소진 등) 날짜를 탓하지 않는다
            ...(rows.length > 0 ? []
              : u.rows.length > 0 ? ['해당 날짜에 조건에 맞는 역이 없습니다. station은 "강남"처럼 역 이름만, line은 "2호선"처럼 적어 보세요.']
              : isNoData(u) ? [emptyDateNote(date)] : []),
            ...(u.note ? [u.note] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )

  server.registerTool(
    'get_subway_hourly_ridership',
    {
      title: 'Hourly subway ridership by station',
      description:
        'Get monthly boarding/alighting counts by hour (04-03h) for a Seoul subway station, with the busiest and quietest hours. ' +
        '지하철 역별 시간대별 승하차 인원(월 합계)과 붐비는·한산한 시간대. "홍대입구역 몇 시에 덜 붐벼?" 류 질문에 사용.',
      inputSchema: {
        station: z.string().describe('역명 (예: "강남", "서울역", "홍대입구")'),
        line: z.string().optional().describe('호선 (예: "2호선") — 생략하면 그 역의 모든 노선'),
        month: z.string().regex(/^\d{6}$/).optional().describe('사용월 YYYYMM (기본: 최근 제공월. 매월 초에 지난달 자료가 올라옵니다)'),
      },
    },
    async ({ station, line, month }) => {
      const months = month ? [month] : [kstMonthsAgo(1), kstMonthsAgo(2)]
      const lineName = line ? lineInput(line) : undefined
      let u: Unwrapped = { rows: [], totalCount: 0 }
      let used = months[0]
      let name = station.trim()
      search: for (const candidate of stationNameCandidates(station)) {
        for (const m of months) {
          u = await ctx.client.getJson('CardSubwayTime', 1, 20, positionalPath([m, lineName, candidate]))
          if (u.rows.length > 0 || !isNoData(u)) { used = m; name = candidate; break search }
        }
      }
      const rows = normalizeSubwayHourly(u.rows)
      const lines = rows.map(r => {
        const counted = byTotal(r.hours)
        const daytime = counted.filter(h => h.hour >= 6 && h.hour <= 23 && h.total > 0)
        return {
          line: r.line,
          station: r.station,
          hours: r.hours.map(h => ({ ...h, total: total(h) })),
          busiestHours: [...counted].sort((a, b) => b.total - a.total).slice(0, 3),
          quietestHours: [...daytime].sort((a, b) => a.total - b.total).slice(0, 3),
        }
      })
      return ok({ month: used, station: name, lines }, {
        source: '지하철 호선별 역별 시간대별 승하차 인원 (CardSubwayTime)',
        asOf: rows[0]?.updatedAt || null,
        notes: [
          '그 달 전체 합계입니다(하루 평균은 그 달 일수로 나누세요). 혼잡도가 아니라 카드 승하차 인원입니다. hour 8은 08~09시입니다.',
          ...(u.note && !isNoData(u) ? [u.note] : []),
          ...(rows.length === 0 && isNoData(u) ? [`${months.join(', ')} 데이터가 없습니다. 역명(예: "강남", "서울역")이나 month를 바꿔 보세요.`] : []),
        ],
        sample: ctx.client.isSample,
      })
    },
  )

  server.registerTool(
    'get_living_population',
    {
      title: 'Living population by administrative dong',
      description:
        'Get de-facto (living) population estimates by administrative dong and hour. ' +
        '행정동·시간대별 생활인구 통계. 실시간 아님 — 실시간 혼잡은 get_population 사용.',
      inputSchema: {
        date: z.string().regex(/^\d{8}$/).optional().describe('기준일자 YYYYMMDD (약 5일 지연)'),
        timeSlot: z.string().regex(/^\d{2}$/).optional().describe('시간대 00~23'),
        dongCode: z.string().optional().describe('행정동코드 8자리 (예: "11680640")'),
        limit: z.number().int().min(1).max(100).optional().describe('최대 건수 (기본 20)'),
      },
    },
    async ({ date, timeSlot, dongCode, limit }) => {
      // 세 인자 모두 서버에서 거른다. 건너뛴 자리는 positionalPath가 공백으로 채운다
      const path = positionalPath([date, timeSlot, dongCode])
      const n = limit ?? 20
      const u = await ctx.client.getJson('SPOP_LOCAL_RESD_DONG', 1, 100, path)
      const rows = normalizeLivingPopulation(u.rows)
      return ok(
        { count: rows.length, totalCount: u.totalCount, population: rows.slice(0, n) },
        {
          source: '생활인구 행정동 (SPOP_LOCAL_RESD_DONG)',
          notes: ['배치 통계(약 5일 지연). 대용량이므로 date/timeSlot/dongCode로 좁혀 조회하세요.', ...(u.note ? [u.note] : [])],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
