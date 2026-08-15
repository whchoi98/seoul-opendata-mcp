import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { searchPlace } from '../data/placeMatcher.js'
import { HOTSPOTS } from '../data/hotspots.js'

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
}
