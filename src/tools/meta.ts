import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Ctx } from './context.js'
import { ok } from './envelope.js'
import { CATALOG, searchCatalog, validateCall, exampleParams, type DatasetEntry } from '../data/catalog.js'

export function routeFor(entry: DatasetEntry): 'getJson' | 'getXml' | 'getSubway' {
  if (entry.endpoint === 'subway') return 'getSubway'
  return entry.responseType === 'xml' ? 'getXml' : 'getJson'
}

/** swopenapi(지하철)는 0-based start, 열린데이터광장 표준은 1-based */
export function startFor(entry: DatasetEntry): number {
  return entry.endpoint === 'subway' ? 0 : 1
}

export function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 10, 1), 50)
}

const findEntry = (id: string) => CATALOG.find(e => e.id.toLowerCase() === id.toLowerCase())

export function registerMetaTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    'search_dataset',
    {
      title: 'Search the Seoul dataset catalog',
      description:
        `Search the curated catalog of ${CATALOG.length} Seoul Open Data datasets by keyword; entries with a dedicated tool point you to it. ` +
        '카탈로그에서 데이터셋을 검색합니다. 정식 tool이 없는 데이터는 call_dataset으로 호출하세요.',
      inputSchema: { query: z.string().describe('키워드 (예: "와이파이", "실거래가", "무더위쉼터")') },
    },
    async ({ query }) => {
      const hits = searchCatalog(query).map(e => ({
        id: e.id, name: e.name, category: e.category, description: e.description,
        requiredParams: e.pathParams.filter(p => p.required).map(p => p.name),
        howToCall: e.tool ? `정식 tool '${e.tool}' 사용 권장` : `call_dataset(id: '${e.id}')`,
      }))
      return ok(
        { count: hits.length, datasets: hits, hint: hits.length === 0 ? '결과 없음 — 다른 키워드로 시도하거나 get_dataset_spec으로 id를 직접 확인하세요.' : undefined },
        { source: `built-in catalog.ts (${CATALOG.length} datasets)`, sample: ctx.client.isSample },
      )
    },
  )

  server.registerTool(
    'get_dataset_spec',
    {
      title: 'Get dataset call specification',
      description:
        'Get the path parameters, response fields, and call example for a catalog dataset id. ' +
        'call_dataset 호출 전 파라미터 명세를 확인합니다.',
      inputSchema: { id: z.string().describe('카탈로그 데이터셋 id (예: "CardSubwayStatsNew")') },
    },
    async ({ id }) => {
      const e = findEntry(id)
      if (!e) {
        return ok(
          { id, found: false, candidates: searchCatalog(id).map(x => x.id) },
          { source: 'built-in catalog.ts', notes: ['미등재 id — candidates에서 고르거나 search_dataset을 사용하세요.'], sample: ctx.client.isSample },
        )
      }
      return ok(
        {
          id: e.id, name: e.name, category: e.category, responseType: e.responseType,
          pathParams: e.pathParams, sampleFields: e.sampleFields,
          dedicatedTool: e.tool ?? null, callable: e.callable,
          example: e.callable
            ? `call_dataset(id: '${e.id}', params: [${exampleParams(e).map(v => `'${v}'`).join(', ')}])`
            : `정식 tool '${e.tool}' 사용`,
        },
        { source: 'built-in catalog.ts', sample: ctx.client.isSample },
      )
    },
  )

  server.registerTool(
    'call_dataset',
    {
      title: 'Call a catalog dataset (raw fields)',
      description:
        'Invoke a catalog dataset by id and get RAW (non-normalized) rows; check get_dataset_spec first for required params. ' +
        '카탈로그 데이터셋을 직접 호출합니다. 응답은 정규화되지 않은 원본 필드입니다.',
      inputSchema: {
        id: z.string().describe('카탈로그 데이터셋 id'),
        params: z.array(z.string()).optional().describe("경로 파라미터 (get_dataset_spec의 pathParams 순서대로, 건너뛰는 자리는 공백 ' ')"),
        limit: z.number().int().optional().describe('최대 행 수 (기본 10, 최대 50)'),
      },
    },
    async ({ id, params, limit }) => {
      const e = findEntry(id)
      if (!e) {
        return ok(
          { id, found: false, candidates: searchCatalog(id).map(x => x.id) },
          { source: 'built-in catalog.ts', notes: ['미등재 id는 호출할 수 없습니다(카탈로그 한정). candidates 또는 search_dataset을 사용하세요.'], sample: ctx.client.isSample },
        )
      }
      const problem = validateCall(e, params ?? [])
      if (problem) {
        return ok(
          { id: e.id, called: false, spec: e.pathParams },
          { source: `열린데이터광장 ${e.id}`, notes: [problem], sample: ctx.client.isSample },
        )
      }
      const n = clampLimit(limit)
      const start = startFor(e)
      const u = await ctx.client[routeFor(e)](e.id, start, n, params ?? [])
      return ok(
        { id: e.id, name: e.name, count: u.rows.length, totalCount: u.totalCount, rows: u.rows.slice(0, n) },
        {
          source: `열린데이터광장 ${e.id}`,
          notes: [
            '비정규화 원본 필드입니다 — 필드 의미는 get_dataset_spec의 sampleFields 참고.',
            ...(u.note ? [u.note] : []),
          ],
          sample: ctx.client.isSample,
        },
      )
    },
  )
}
