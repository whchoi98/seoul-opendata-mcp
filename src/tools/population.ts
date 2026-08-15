import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { resolvePlace } from './resolve.js'
import { normalizePopulation } from '../normalize/population.js'
import { HOTSPOTS } from '../data/hotspots.js'
import { normalizeCommercial } from '../normalize/commercial.js'

const DELAY_NOTE = '실시간 인구는 통신사 집계·보정으로 약 15분 지연됩니다.'

export function registerPopulationTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'get_population',
    {
      title: 'Real-time population & congestion',
      description:
        'Get real-time population, congestion level (여유/보통/약간 붐빔/붐빔), demographics, and optional 12-hour AI forecast for a Seoul hotspot. ' +
        '서울 핫스팟의 실시간 인구·혼잡도·성연령 비율·12시간 예측을 조회합니다. "지금 강남역 혼잡해?" 류 질문에 사용.',
      inputSchema: {
        place: z.string().describe('핫스팟 장소명 (search_place로 확정한 name 권장)'),
        includeForecast: z.boolean().optional().describe('향후 12시간 인구 예측 포함 여부 (기본 false)'),
      },
    },
    async ({ place, includeForecast }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const u = await ctx.client.getJson('citydata_ppltn', 1, 5, [r.name])
      if (u.rows.length === 0) {
        return ok({ place: r.name, data: null }, { source: 'OA-21778 (citydata_ppltn)', notes: [u.note ?? '데이터 없음'], sample: ctx.client.isSample })
      }
      const data = normalizePopulation(u.rows[0], includeForecast ?? false)
      return ok(data, { source: 'OA-21778 (citydata_ppltn)', asOf: data.measuredAt, notes: [DELAY_NOTE], sample: ctx.client.isSample })
    },
  )

  server.registerTool(
    'get_commercial_activity',
    {
      title: 'Real-time commercial (card payment) activity',
      description:
        'Get real-time card-payment based commercial activity level (한산한→분주한 4 levels) and per-industry breakdown for a Seoul hotspot (82 supported places). ' +
        '신한카드 실시간 결제 기반 상권 현황. "지금 성수동 장사 잘돼?" 류 질문에 사용.',
      inputSchema: { place: z.string().describe('핫스팟 장소명 (상권은 82곳만 지원)') },
    },
    async ({ place }) => {
      const r = resolvePlace(place, ctx)
      if ('early' in r) return r.early
      const spot = HOTSPOTS.find(h => h.name === r.name)!
      if (!spot.commercial) {
        const nearby = HOTSPOTS.filter(h => h.commercial && h.category === spot.category).slice(0, 5).map(h => h.name)
        return ok(
          { place: r.name, supported: false, alternatives: nearby },
          { source: 'OA-22385 (citydata_cmrcl)', notes: ['이 장소는 상권 데이터 미지원(82곳 한정)입니다. alternatives에서 인접 후보를 안내하세요.'], sample: ctx.client.isSample },
        )
      }
      const u = await ctx.client.getJson('citydata_cmrcl', 1, 5, [r.name])
      if (u.rows.length === 0) {
        return ok({ place: r.name, data: null }, { source: 'OA-22385 (citydata_cmrcl)', notes: [u.note ?? '데이터 없음'], sample: ctx.client.isSample })
      }
      const data = normalizeCommercial(u.rows[0])
      return ok({ place: r.name, ...data }, {
        source: 'OA-22385 (citydata_cmrcl)', asOf: data.measuredAt,
        notes: ['신한카드 내국인 결제 기준, 약 15분 지연. 전수 데이터가 아니므로 절대액이 아닌 평소 대비 수준으로 해석하세요.'],
        sample: ctx.client.isSample,
      })
    },
  )
}
