import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { extractWeather } from '../normalize/citydata.js'
import { normalizeAir } from '../normalize/air.js'

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
      return ok({ place: r.name, ...data }, {
        source: 'OA-21285 (citydata WEATHER_STTS, 기상청 연계)',
        asOf: data.measuredAt || null,
        notes: [...(u.note ? [u.note] : [])],
        sample: ctx.client.isSample,
      })
    },
  )

  server.registerTool(
    'get_air_quality',
    {
      title: 'Real-time air quality by district',
      description:
        'Get real-time air quality (PM10/PM2.5, grade) for Seoul districts. Omit district to get all 25. ' +
        '자치구별 실시간 대기질. "오늘 강남구 미세먼지 어때?" 류 질문에 사용.',
      inputSchema: {
        district: z.string().optional().describe('자치구명 (예: "강남구") — 생략 시 25개 전체'),
      },
    },
    async ({ district }) => {
      const u = await ctx.client.getJson('RealtimeCityAir', 1, 25)
      let rows = normalizeAir(u.rows)
      if (district) rows = rows.filter(a => a.district.includes(district.replace(/구$/, '')) || a.district === district)
      return ok(
        { count: rows.length, airQuality: rows },
        {
          source: '서울시 권역별 실시간 대기환경 (RealtimeCityAir)',
          asOf: rows[0]?.measuredAt ?? null,
          notes: rows.length === 0 ? ['해당 자치구를 찾지 못했습니다. "강남구"처럼 정식 자치구명을 쓰세요.'] : [],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
