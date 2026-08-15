import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeArrivals } from '../normalize/subway.js'

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
}
