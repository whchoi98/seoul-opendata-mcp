import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeSubwayRidership, normalizeLivingPopulation } from '../normalize/stats.js'

export function registerStatsTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_subway_ridership',
    {
      title: 'Daily subway ridership statistics',
      description:
        'Get per-station daily subway boarding/alighting counts for a date (data available up to ~2-4 days ago). ' +
        '지하철 역별 일별 승하차 인원. "강남역 하루 승객 몇 명?" 류 질문에 사용.',
      inputSchema: {
        date: z.string().regex(/^\d{8}$/).describe('사용일자 YYYYMMDD (오늘 데이터는 없음 — 보통 2~4일 전까지 제공)'),
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
            '배치 통계 — 보통 2~4일 전 데이터까지 제공됩니다.',
            ...(rows.length === 0 ? ['해당 날짜 데이터가 없습니다. 더 이전 날짜로 시도하세요.'] : []),
            ...(u.note ? [u.note] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
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
        timeSlot: z.string().regex(/^\d{2}$/).optional().describe('시간대 00~23 (date와 함께 사용)'),
        dongCode: z.string().optional().describe('행정동코드 8자리 (date, timeSlot과 함께 사용)'),
        limit: z.number().int().min(1).max(100).optional().describe('최대 건수 (기본 20)'),
      },
    },
    async ({ date, timeSlot, dongCode, limit }) => {
      // 경로 파라미터는 앞에서부터 연속 지정된 것까지만 사용 (API 위치 기반)
      const path: string[] = []
      if (date) { path.push(date); if (timeSlot) { path.push(timeSlot); if (dongCode) path.push(dongCode) } }
      const n = limit ?? 20
      const u = await ctx.client.getJson('SPOP_LOCAL_RESD_DONG', 1, Math.max(n, 100), path)
      let rows = normalizeLivingPopulation(u.rows)
      if (dongCode && path.length < 3) rows = rows.filter(r => r.dongCode === dongCode)
      if (timeSlot && path.length < 2) rows = rows.filter(r => r.timeSlot === timeSlot)
      return ok(
        { count: rows.length, population: rows.slice(0, n) },
        {
          source: '생활인구 행정동 (SPOP_LOCAL_RESD_DONG)',
          notes: ['배치 통계(약 5일 지연). 대용량이므로 date/timeSlot/dongCode로 좁혀 조회하세요.', ...(u.note ? [u.note] : [])],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
