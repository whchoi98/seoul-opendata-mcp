// tool 경로 전체 검증용 공용 도구: 실제 McpServer와 Client를 in-memory로 연결하고 업스트림만 가짜로 둔다.
import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { SeoulApiClient } from '../../src/client/seoulApi.js'
import type { QuotaLedger } from '../../src/client/quota.js'
import { buildServer } from '../../src/index.js'

export type Call = { svc: string; start: number; end: number; path: string[] }

/** URL에서 서비스명, 범위, 경로 자리를 뽑는다. 열린데이터광장과 swopenapi 모두 `.../{key}/{type}/{svc}/{start}/{end}/{...path}` 꼴이다 */
export function parseCall(url: string): Call {
  const segs = new URL(url).pathname.split('/').slice(1).map(decodeURIComponent)
  const i = segs.findIndex(s => s === 'json' || s === 'xml')
  const [svc, s, e, ...path] = segs.slice(i + 1)
  return { svc, start: Number(s), end: Number(e), path }
}

/** 서비스명마다 픽스처 파일 본문을 그대로 돌려주는 가짜 업스트림 */
export function fixtureUpstream(files: Record<string, string>) {
  const calls: Call[] = []
  const fetchFn = vi.fn(async (url: string) => {
    const call = parseCall(url)
    calls.push(call)
    const file = files[call.svc]
    if (!file) throw new Error(`픽스처가 없는 서비스 호출: ${call.svc}`)
    return new Response(readFileSync(`tests/fixtures/${file}`, 'utf8'), { status: 200 })
  })
  return { fetchFn, calls }
}

/** 표준 봉투(`{svc: {list_total_count, RESULT, row}}`)를 직접 만들어 돌려주는 가짜 업스트림 */
export function rowsUpstream(handler: (c: Call) => { rows: any[]; total?: number }) {
  const calls: Call[] = []
  const fetchFn = vi.fn(async (url: string) => {
    const call = parseCall(url)
    calls.push(call)
    const r = handler(call)
    const body = r.rows.length === 0
      ? { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } }
      : { [call.svc]: { list_total_count: r.total ?? r.rows.length, RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다' }, row: r.rows } }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return { fetchFn, calls }
}

export async function callTool(
  fetchFn: unknown, name: string, args: Record<string, unknown>, opts: { ledger?: QuotaLedger } = {},
) {
  const client = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as typeof fetch, retryDelayMs: 0, ledger: opts.ledger })
  const server = buildServer(client)
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 'tool-test', version: '0' })
  await Promise.all([server.connect(st), mcp.connect(ct)])
  const res = await mcp.callTool({ name, arguments: args })
  return JSON.parse((res.content as Array<{ type: string; text: string }>)[0].text)
}
