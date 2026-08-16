import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { searchPlace } from '../data/placeMatcher.js'
import { HOTSPOTS } from '../data/hotspots.js'
import { extractSnapshot, extractDisasterAlerts } from '../normalize/citydata.js'

export function registerCommonTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'search_place',
    {
      title: 'Search Seoul hotspot places',
      description:
        'Resolve a free-form place name to one of Seoul\'s 121 official real-time hotspots. Use FIRST when the user mentions a Seoul location. ' +
        '자연어 장소명을 서울 실시간 도시데이터 핫스팟 121곳에 매칭합니다.',
      inputSchema: {
        query: z.string().describe('장소명 (예: "강남역", "홍대", "코엑스", "Gangnam")'),
      },
    },
    async ({ query }) => {
      const { match, candidates } = searchPlace(query)
      return ok(
        {
          match,
          candidates,
          totalHotspots: HOTSPOTS.length,
          hint: match
            ? undefined
            : candidates.length
              ? '여러 후보가 있습니다. 사용자 의도에 맞는 name을 골라 다른 tool의 place 인자로 쓰세요.'
              : '일치하는 핫스팟이 없습니다. 실시간 데이터는 121개 주요 장소만 지원합니다.',
        },
        { source: 'built-in hotspots.ts (매뉴얼 V8.5 표 2-2)', sample: ctx.client.isSample },
      )
    },
  )

  server.registerTool(
    'get_city_snapshot',
    {
      title: 'One-shot city snapshot of a hotspot',
      description:
        'Get a combined snapshot (population/congestion + weather + road + top events) of a Seoul hotspot in ONE call. Prefer this for broad "how is X right now?" questions. ' +
        '핫스팟 종합 현황 1회 요약. "지금 홍대 어때?" 같은 포괄 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getXml('citydata', 1, 5, [r.name])
      const data = extractSnapshot(u.rows[0] ?? {})
      return ok(data, {
        source: 'OA-21285 (citydata)',
        asOf: data.population.measuredAt || null,
        notes: ['인구는 약 15분 지연. 세부 분야는 개별 tool로 조회하세요.', ...(u.note ? [u.note] : [])],
        sample: ctx.client.isSample,
      })
    },
  )

  server.registerTool(
    'get_disaster_alerts',
    {
      title: 'Emergency disaster alerts near a hotspot',
      description:
        'Get recent emergency disaster text alerts (긴급재난문자) issued for a Seoul hotspot area. ' +
        '핫스팟 지역 긴급재난문자. "지금 재난문자 온 거 있어?" 류 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getXml('citydata', 1, 5, [r.name])
      const alerts = extractDisasterAlerts(u.rows[0] ?? {})
      return ok(
        { place: r.name, count: alerts.length, alerts },
        {
          source: 'OA-21285 (citydata LIVE_DST_MESSAGE, 행정안전부 연계)',
          notes: alerts.length === 0 ? ['현재 이 지역에 수신된 긴급재난문자가 없습니다.'] : [],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
