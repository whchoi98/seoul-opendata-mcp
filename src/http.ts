#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer, SERVER_NAME, SERVER_VERSION } from './index.js'
import { SeoulApiClient } from './client/seoulApi.js'
import { loadDotEnv } from './client/env.js'

loadDotEnv()
const client = new SeoulApiClient() // 프로세스 전역 1개 — L1 캐시·원장 공유
const { maybeAttachL2 } = await import('./client/dynamo.js')
await maybeAttachL2(client)

const MAX_BODY_BYTES = 1_000_000 // 1MB — 무제한 버퍼링 방지

/** 본문이 MAX_BODY_BYTES를 넘으면 던진다 — readBody는 그 이상 청크를 누적하지 않는다 */
class PayloadTooLargeError extends Error {}
/** 본문이 JSON이 아니면 던진다 — JSON-RPC 규약상 -32700(Parse error)으로 응답해야 한다 */
class InvalidJsonError extends Error {}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const c of req) {
    const buf = c as Buffer
    total += buf.length
    if (total > MAX_BODY_BYTES) throw new PayloadTooLargeError(`request body exceeds ${MAX_BODY_BYTES} bytes`)
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new InvalidJsonError((e as Error).message)
  }
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  // stateless: 요청마다 독립 server/transport — 플랫폼의 Mcp-Session-Id를 검증하지 않는다
  const server = buildServer(client)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { void transport.close(); void server.close() })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

const port = Number(process.env.PORT ?? 8000)
createServer((req, res) => {
  const url = req.url ?? ''
  if (req.method === 'GET' && (url === '/ping' || url.startsWith('/ping?'))) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"Healthy"}')
    return
  }
  if (url === '/mcp' || url.startsWith('/mcp?')) {
    // AgentCore 계약은 POST /mcp만 요구한다. SDK 전송 계층에 넘기기 전에 다른 메서드를 막아야
    // 하는 이유: 예를 들어 Accept: text/event-stream을 실은 GET을 그대로 통과시키면
    // StreamableHTTPServerTransport가 종료되지 않는 SSE 스트림을 열어버려, 장기 실행 Runtime
    // 프로세스에 열린 핸들이 반복 호출마다 누적된다.
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'method not allowed' }))
      return
    }
    handleMcp(req, res).catch(e => {
      if (e instanceof PayloadTooLargeError) {
        console.error(`[http] 요청 처리 실패: ${e.message}`)
        if (!res.headersSent) res.writeHead(413, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'payload too large' }))
        req.destroy() // 응답을 먼저 흘려보낸 뒤 소켓을 정리 — 순서를 바꾸면 응답 전송 전에 소켓이 끊길 수 있다
        return
      }
      if (e instanceof InvalidJsonError) {
        if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
        return
      }
      console.error(`[http] 요청 처리 실패: ${(e as Error).message}`)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }))
    })
    return
  }
  res.writeHead(404).end()
}).listen(port, '0.0.0.0', () => {
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} Streamable HTTP on 0.0.0.0:${port} (stateless)`)
  if (client.isSample) console.error(`[${SERVER_NAME}] SEOUL_API_KEY 미설정 — 샘플 키로 동작합니다.`)
  else console.error(`[${SERVER_NAME}] SEOUL_API_KEY ${client.maskedKey()}`)
})
