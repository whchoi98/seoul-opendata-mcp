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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // stateless: 요청마다 독립 server/transport — 플랫폼의 Mcp-Session-Id를 검증하지 않는다
  const server = buildServer(client)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { void transport.close(); void server.close() })
  await server.connect(transport)
  await transport.handleRequest(req, res, await readBody(req))
}

const port = Number(process.env.PORT ?? 8000)
createServer((req, res) => {
  const url = req.url ?? ''
  if (req.method === 'GET' && (url === '/ping' || url.startsWith('/ping?'))) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"Healthy"}')
    return
  }
  if (url === '/mcp' || url.startsWith('/mcp?')) {
    handleMcp(req, res).catch(e => {
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
})
