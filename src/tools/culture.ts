import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizeEvents, filterEvents } from '../normalize/culture.js'

export function registerCultureTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'search_cultural_events',
    {
      title: 'Search Seoul cultural events',
      description:
        'Search Seoul cultural events (concerts, exhibitions, festivals) by keyword/category/district/date-range/free-only. ' +
        '서울시 문화행사 검색. "이번 주말 마포구 무료 공연 있어?" 류 질문에 사용.',
      inputSchema: {
        keyword: z.string().optional().describe('행사명 키워드 (API TITLE 검색)'),
        category: z.string().optional().describe('분류 (예: 콘서트, 전시/미술, 축제-문화/예술)'),
        district: z.string().optional().describe('자치구 (예: 마포구)'),
        from: z.string().optional().describe('기간 시작 YYYY-MM-DD'),
        to: z.string().optional().describe('기간 끝 YYYY-MM-DD'),
        freeOnly: z.boolean().optional().describe('무료만'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 15)'),
      },
    },
    async ({ keyword, category, district, from, to, freeOnly, limit }) => {
      // 경로 파라미터: /{CODENAME}/{TITLE}/{DATE} — 생략은 공백 한 칸
      const path = [category ?? ' ', keyword ?? ' ', ' ']
      const u = await ctx.client.getJson('culturalEventInfo', 1, 500, path)
      const events = filterEvents(normalizeEvents(u.rows), { district, from, to, freeOnly })
      return ok(
        { count: events.length, events: events.slice(0, limit ?? 15) },
        {
          source: 'OA-15486 (culturalEventInfo)',
          notes: [
            '서버에서 category/keyword로 1차 검색 후 최대 500건 내에서 자치구·기간·무료 필터를 적용했습니다.',
            ...(u.note ? [u.note] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
