import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { extractWeather } from '../normalize/citydata.js'

export function registerEnvironmentTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_weather',
    {
      title: 'Weather & fine dust at a hotspot',
      description:
        'Get current temperature, precipitation, fine dust (PM10/PM2.5), UV, sunrise/sunset and weather warnings for a Seoul hotspot. ' +
        '핫스팟 기준 날씨·미세먼지·기상특보. "지금 여의도 날씨 어때?" 류 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getXml('citydata', 1, 5, [r.name])
      const data = extractWeather(u.rows[0] ?? {})
      return ok({ place: r.name, ...data }, { source: 'OA-21285 (citydata WEATHER_STTS, 기상청 연계)', asOf: data.measuredAt || null, sample: ctx.client.isSample })
    },
  )
}
