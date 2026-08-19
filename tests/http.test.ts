import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, execSync, type ChildProcess } from 'node:child_process'

const PORT = 18077
let proc: ChildProcess

const rpc = (body: object, extraHeaders: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extraHeaders },
    body: JSON.stringify(body),
  })

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }

/** SSE 또는 JSON 응답에서 JSON-RPC 메시지를 추출 */
const parseRpc = async (res: Response) => {
  const text = await res.text()
  const line = text.split('\n').find(l => l.startsWith('data:'))
  return JSON.parse(line ? line.slice(5).trim() : text)
}

beforeAll(async () => {
  execSync('npm run build', { stdio: 'ignore' })
  // SEOUL_API_KEY를 가짜 값으로 고정 — 스폰된 프로세스가 cwd의 .env(실키)를 로드하더라도
  // loadDotEnv()는 이미 설정된 값을 덮어쓰지 않으므로 실제 키가 절대 쓰이지 않는다.
  proc = spawn('node', ['dist/http.js'], {
    env: { ...process.env, PORT: String(PORT), SEOUL_API_KEY: 'test-fake-key' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/ping`)).ok) return } catch { /* 기동 대기 */ }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('http 서버 기동 실패')
}, 30_000)

afterAll(() => { proc?.kill() })

describe('AgentCore Runtime HTTP 계약', () => {
  it('GET /ping → 200 {"status":"Healthy"}', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/ping`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'Healthy' })
  })

  it('POST /mcp: initialize → tools/list 19개 (stateless — 요청 간 세션 불요)', async () => {
    const init = await rpc(INIT)
    expect(init.status).toBe(200)
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const msg = await parseRpc(list)
    expect(msg.result.tools).toHaveLength(19)
  }, 15_000)

  it('플랫폼 주입 Mcp-Session-Id 헤더를 거부하지 않는다', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-session-id': 'platform-generated-abc123' })
    expect(res.status).toBe(200)
  }, 15_000)

  it('미지정 경로는 404', async () => {
    expect((await fetch(`http://127.0.0.1:${PORT}/nope`)).status).toBe(404)
  })

  it('동시 2개 POST 요청도 500 없이 처리된다 (요청별 독립 server/transport)', async () => {
    const [a, b] = await Promise.all([
      rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
      rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  }, 15_000)
})
