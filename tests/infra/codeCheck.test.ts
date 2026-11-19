import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createHandler, minuteKey } from '../../infra/lambda/code-check.mjs'

const CODE = 'seoul-ABCD-2345'
const HASH = createHash('sha256').update(CODE).digest('hex')
const NOW = Date.parse('2026-11-19T10:00:00+09:00')
const auth = { Authorization: `Bearer ${CODE}` }

const event = (headers: Record<string, string> | undefined, body: any) => ({
  interceptorInputVersion: '1.0',
  mcp: { gatewayRequest: { path: '/mcp', httpMethod: 'POST', ...(headers ? { headers } : {}), body } },
})
const callBody = (id: number) => ({
  jsonrpc: '2.0', id, method: 'tools/call',
  params: { name: 'seoul___get_city_snapshot', arguments: { place: '강남역' } },
})
const listBody = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/list' })
const response = (out: any) => out.mcp.transformedGatewayResponse

function setup(over: Record<string, unknown> = {}) {
  const logs: string[] = []
  let count = 0
  const handler = createHandler({
    codeSha256: HASH,
    validUntil: '2026-11-20T18:00:00+09:00',
    ratePerMinute: 2,
    incr: async () => ++count,
    now: () => NOW,
    log: (line: string) => { logs.push(line) },
    ...over,
  })
  return { handler, logs }
}

describe('code-check 인터셉터', () => {
  it('올바른 코드면 요청 본문을 바꾸지 않고 넘긴다', async () => {
    const { handler, logs } = setup()
    const body = listBody(1)
    const out = await handler(event(auth, body))
    expect(out).toEqual({ interceptorOutputVersion: '1.0', mcp: { transformedGatewayRequest: { body } } })
    expect(JSON.parse(logs[0])).toEqual({ method: 'tools/list', tool: null, decision: 'pass' })
  })

  it('헤더 이름과 Bearer의 대소문자를 가리지 않는다', async () => {
    const { handler } = setup()
    const out = await handler(event({ authorization: `bearer ${CODE}` }, listBody(1)))
    expect(out.mcp.transformedGatewayRequest).toBeDefined()
  })

  it.each([
    ['헤더 없음', undefined],
    ['Bearer 없음', { Authorization: CODE }],
    ['틀린 코드', { Authorization: 'Bearer seoul-WRNG-CODE' }],
  ])('%s이면 403과 -32001', async (_name, headers) => {
    const { handler, logs } = setup()
    const out = await handler(event(headers as Record<string, string> | undefined, listBody(7)))
    expect(response(out)).toEqual({
      statusCode: 403,
      body: { jsonrpc: '2.0', id: 7, error: { code: -32001, message: expect.stringContaining('워크숍 코드가 올바르지 않습니다') } },
    })
    expect(JSON.parse(logs[0]).decision).toBe('bad_code')
  })

  it('CODE_SHA256이 비어 있으면 모두 거부한다', async () => {
    const { handler } = setup({ codeSha256: '' })
    expect(response(await handler(event(auth, listBody(1)))).statusCode).toBe(403)
  })

  it.each([
    ['만료 시각이 지남', '2026-11-19T09:59:59+09:00'],
    ['만료 시각이 비어 있음', ''],
    ['만료 시각을 해석할 수 없음', 'tomorrow'],
  ])('%s이면 403 만료 안내', async (_name, validUntil) => {
    const { handler, logs } = setup({ validUntil })
    const out = await handler(event(auth, listBody(2)))
    expect(response(out).statusCode).toBe(403)
    expect(response(out).body.error.message).toContain('만료')
    expect(JSON.parse(logs[0]).decision).toBe('expired')
  })

  it('분당 한도를 넘은 tools/call은 200과 isError 결과로 돌려준다', async () => {
    const { handler, logs } = setup()
    await handler(event(auth, callBody(1)))
    await handler(event(auth, callBody(2)))
    const out = await handler(event(auth, callBody(3)))
    expect(response(out)).toEqual({
      statusCode: 200,
      body: { jsonrpc: '2.0', id: 3, result: { isError: true, content: [{ type: 'text', text: expect.stringContaining('1분 뒤') }] } },
    })
    expect(JSON.parse(logs[2])).toEqual({ method: 'tools/call', tool: 'seoul___get_city_snapshot', decision: 'rate_limited' })
  })

  it('tools/list는 카운터를 올리지 않고 통과한다', async () => {
    let calls = 0
    const { handler } = setup({ incr: async () => { calls++; return 99 } })
    const out = await handler(event(auth, listBody(1)))
    expect(out.mcp.transformedGatewayRequest).toBeDefined()
    expect(calls).toBe(0)
  })

  it('카운터가 실패하면 통과시키고 rate_check_failed를 남긴다', async () => {
    const { handler, logs } = setup({ incr: async () => { throw new Error('ddb down') } })
    const out = await handler(event(auth, callBody(1)))
    expect(out.mcp.transformedGatewayRequest).toBeDefined()
    expect(JSON.parse(logs[0]).decision).toBe('rate_check_failed')
    expect(JSON.parse(logs[0]).error).toBe('Error')
    expect(logs).toHaveLength(1)
  })

  it('카운터 키는 UTC 분 단위이고 만료는 120초 뒤다', async () => {
    const seen: Array<[string, number]> = []
    const { handler } = setup({ incr: async (pk: string, expireAt: number) => { seen.push([pk, expireAt]); return 1 } })
    await handler(event(auth, callBody(1)))
    expect(seen).toEqual([['rate#202611190100', Math.floor(NOW / 1000) + 120]])
    expect(minuteKey(NOW)).toBe('rate#202611190100')
  })

  it('id가 없는 요청(알림)은 id null로 거부한다', async () => {
    const { handler } = setup()
    const out = await handler(event(undefined, { jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(response(out).body.id).toBeNull()
  })

  it('로그에 코드와 헤더 값이 남지 않는다', async () => {
    const { handler, logs } = setup()
    await handler(event({ ...auth, 'X-Secret': 'header-value' }, callBody(1)))
    await handler(event({ Authorization: 'Bearer seoul-WRNG-CODE' }, callBody(2)))
    const text = logs.join('\n')
    for (const s of [CODE, 'seoul-WRNG-CODE', 'header-value', 'Bearer', HASH]) expect(text).not.toContain(s)
  })
})
