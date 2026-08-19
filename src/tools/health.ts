import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizePharmacies } from '../normalize/health.js'

export function registerHealthTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'find_pharmacies',
    {
      title: 'Find pharmacies with operating hours',
      description:
        'Find Seoul pharmacies by district or name keyword, with per-day operating hours. ' +
        '약국 위치·전화·요일별 운영시간. "강남구 약국 몇 시까지 해?" 류 질문에 사용.',
      inputSchema: {
        district: z.string().optional().describe('자치구/주소 키워드 (예: "강남구", "역삼동")'),
        name: z.string().optional().describe('약국명 키워드'),
        limit: z.number().int().min(1).max(50).optional().describe('최대 건수 (기본 10)'),
      },
    },
    async ({ district, name, limit }) => {
      const { rows, note } = await ctx.client.fetchAll('TbPharmacyOperateInfo', { max: 1000, pageSize: 1000 })
      let list = normalizePharmacies(rows)
      if (district) list = list.filter(p => p.address.includes(district))
      if (name) list = list.filter(p => p.name.includes(name))
      return ok(
        { count: list.length, pharmacies: list.slice(0, limit ?? 10) },
        {
          source: '약국 운영정보 (TbPharmacyOperateInfo)',
          notes: [
            '최근 1,000건 내 필터 결과입니다 — district로 좁혀 조회하세요.',
            ...(note ? [note] : []),
            ...(list.length === 0 ? ['조건에 맞는 약국이 없습니다.'] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
