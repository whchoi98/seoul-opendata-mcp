import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { normalizePharmacies } from '../normalize/health.js'
import { positionalPath } from './path.js'

const MAX_ROWS = 1000 // 열린데이터광장 1회 요청 상한

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
      // 1번 자리 DUTYADDR(주소), 2번 자리 DUTYNAME(약국명) 모두 서버에서 부분일치로 거른다
      const u = await ctx.client.getJson('TbPharmacyOperateInfo', 1, MAX_ROWS, positionalPath([district, name]))
      let list = normalizePharmacies(u.rows)
      // 서버 필터와 같은 조건을 한 번 더 적용한다. 업스트림이 자리를 무시해도 엉뚱한 약국이 섞이지 않는다
      if (district) list = list.filter(p => p.address.includes(district.trim()))
      if (name) list = list.filter(p => p.name.includes(name.trim()))
      return ok(
        { count: list.length, totalCount: u.totalCount, pharmacies: list.slice(0, limit ?? 10) },
        {
          source: '약국 운영정보 (TbPharmacyOperateInfo)',
          notes: [
            ...(u.totalCount > u.rows.length
              ? [`조건에 맞는 약국 ${u.totalCount.toLocaleString('ko-KR')}건 중 앞 ${u.rows.length.toLocaleString('ko-KR')}건만 받았습니다. district나 name으로 좁혀 조회하세요.`]
              : []),
            ...(u.note ? [u.note] : []),
            ...(list.length === 0 && u.rows.length > 0 ? ['조건에 맞는 약국이 없습니다.'] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
