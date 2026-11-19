// AgentCore Gateway REQUEST interceptor for the Seoul workshop gateway.
// Design: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md section 3.
// Never log headers, the code or its hash: the gateway passes Authorization to this function.
import { createHash, timingSafeEqual } from 'node:crypto'

const MESSAGES = {
  bad_code: '워크숍 코드가 올바르지 않습니다. Authorization: Bearer <코드> 헤더를 확인하세요. / Invalid workshop code.',
  expired: '워크숍 코드가 만료되었습니다. 진행자에게 새 코드를 받으세요. / Workshop code expired.',
  rate_limited: '요청이 많습니다. 1분 뒤 다시 시도하세요. / Too many requests, retry in a minute.',
}
const DEFAULT_RATE_PER_MINUTE = 120

/** UTC minute bucket of the per-minute counter, e.g. rate#202611190100 */
export function minuteKey(ms) {
  return `rate#${new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
}

function bearerToken(headers) {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== 'authorization' || typeof value !== 'string') continue
    const match = /^Bearer\s+(.+)$/i.exec(value.trim())
    return match ? match[1].trim() : undefined
  }
  return undefined
}

function codeMatches(code, codeSha256) {
  if (!code || !/^[0-9a-f]{64}$/i.test(codeSha256 ?? '')) return false
  const actual = createHash('sha256').update(code).digest()
  return timingSafeEqual(actual, Buffer.from(codeSha256, 'hex'))
}

const pass = body => ({ interceptorOutputVersion: '1.0', mcp: { transformedGatewayRequest: { body } } })

const deny = (id, message) => ({
  interceptorOutputVersion: '1.0',
  mcp: { transformedGatewayResponse: { statusCode: 403, body: { jsonrpc: '2.0', id, error: { code: -32001, message } } } },
})

const limited = id => ({
  interceptorOutputVersion: '1.0',
  mcp: {
    transformedGatewayResponse: {
      statusCode: 200,
      body: { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: MESSAGES.rate_limited }] } },
    },
  },
})

export function createHandler({ codeSha256, validUntil, ratePerMinute, incr, now = Date.now, log = console.log }) {
  const until = Date.parse(validUntil ?? '')
  return async event => {
    const request = event?.mcp?.gatewayRequest ?? {}
    const body = request.body ?? {}
    const id = body.id ?? null
    const method = typeof body.method === 'string' ? body.method : null
    const tool = method === 'tools/call' && typeof body.params?.name === 'string' ? body.params.name : null
    const finish = (decision, output) => {
      log(JSON.stringify({ method, tool, decision }))
      return output
    }

    if (!codeMatches(bearerToken(request.headers), codeSha256)) return finish('bad_code', deny(id, MESSAGES.bad_code))
    if (!Number.isFinite(until) || now() >= until) return finish('expired', deny(id, MESSAGES.expired))
    if (method === 'tools/call') {
      try {
        const t = now()
        const count = await incr(minuteKey(t), Math.floor(t / 1000) + 120)
        if (count > ratePerMinute) return finish('rate_limited', limited(id))
      } catch {
        // The counter guards against runaway loops, not against strangers: let the call through.
        return finish('rate_check_failed', pass(body))
      }
    }
    return finish('pass', pass(body))
  }
}

function parseRate(raw) {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RATE_PER_MINUTE
}

let dynamo
/** Atomic add on the minute bucket in the workshop table; returns the new count */
async function incrementMinute(pk, expireAt) {
  if (!dynamo) {
    const { DynamoDBClient, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb')
    dynamo = { client: new DynamoDBClient({}), UpdateItemCommand }
  }
  const out = await dynamo.client.send(new dynamo.UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: { pk: { S: pk } },
    UpdateExpression: 'ADD n :one SET expireAt = if_not_exists(expireAt, :exp)',
    ExpressionAttributeValues: { ':one': { N: '1' }, ':exp': { N: String(expireAt) } },
    ReturnValues: 'UPDATED_NEW',
  }))
  return Number(out.Attributes.n.N)
}

export const handler = createHandler({
  codeSha256: process.env.CODE_SHA256,
  validUntil: process.env.VALID_UNTIL,
  ratePerMinute: parseRate(process.env.RATE_PER_MINUTE),
  incr: incrementMinute,
})
