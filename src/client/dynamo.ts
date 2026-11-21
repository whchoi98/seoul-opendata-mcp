import { createHash } from 'node:crypto'
import { HARD_TTL_MS, type CacheBackend, type CacheEntry } from './cache.js'
import { kstDayKey, parseQuotaLimit, type QuotaLedger, type QuotaStatus } from './quota.js'
import type { SeoulApiClient } from './seoulApi.js'

const MAX_ITEM_BYTES = 380_000 // DynamoDB 400KB 한도 대비 여유

export interface DocClientLike {
  get(params: any): Promise<{ Item?: any }>
  put(params: any): Promise<any>
  update(params: any): Promise<{ Attributes?: any }>
}

export class DynamoDbCache implements CacheBackend {
  constructor(private doc: DocClientLike, private table: string) {}

  // pk는 캐시 키의 sha256이다. 길이를 고정하기 위해서이고, 예전 캐시 키 형식에는 인증키가 들어 있었다 (스펙 §4.2: pk = URL 해시)
  private pk(key: string): string {
    return createHash('sha256').update(key).digest('hex')
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const { Item } = await this.doc.get({ TableName: this.table, Key: { pk: this.pk(key) } })
    if (!Item?.entry) return undefined
    const e = JSON.parse(Item.entry) as CacheEntry
    return e
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const body = JSON.stringify(entry)
    if (Buffer.byteLength(body) > MAX_ITEM_BYTES) return // L1만으로 충분한 대형 응답
    await this.doc.put({
      TableName: this.table,
      Item: { pk: this.pk(key), entry: body, expireAt: Math.floor((entry.storedAt + HARD_TTL_MS) / 1000) },
    })
  }
}

export class DynamoDbLedger implements QuotaLedger {
  constructor(
    private doc: DocClientLike,
    private table: string,
    private limit: number = parseQuotaLimit(process.env.QUOTA_DAILY_LIMIT),
    private now: () => number = Date.now,
  ) {}

  private pk(keyId: string): string { return `quota#${keyId}#${kstDayKey(this.now)}` }

  async increment(keyId: string): Promise<void> {
    await this.doc.update({
      TableName: this.table,
      Key: { pk: this.pk(keyId) },
      UpdateExpression: 'ADD used :one',
      ExpressionAttributeValues: { ':one': 1 },
    })
  }

  async status(keyId: string): Promise<QuotaStatus> {
    const { Item } = await this.doc.get({ TableName: this.table, Key: { pk: this.pk(keyId) } })
    const used = Item?.used ?? 0
    return { used, limit: this.limit, ratio: this.limit > 0 ? used / this.limit : 1 }
  }
}

/** aws-sdk를 lazy 로드해 DynamoDB 문서 클라이언트를 만든다. 서버(캐시와 장부)와 수집기(장부만)가 함께 쓴다 */
export async function createDocClient(region?: string): Promise<DocClientLike> {
  const [{ DynamoDBClient }, { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand }] =
    await Promise.all([import('@aws-sdk/client-dynamodb'), import('@aws-sdk/lib-dynamodb')])
  const raw = DynamoDBDocumentClient.from(new DynamoDBClient(region ? { region } : {}))
  return {
    get: p => raw.send(new GetCommand(p)),
    put: p => raw.send(new PutCommand(p)),
    update: p => raw.send(new UpdateCommand(p)),
  }
}

/** CACHE_TABLE_NAME 설정 시에만 aws-sdk를 lazy 로드해 L2 캐시·원장을 연결한다. 실패해도 서버는 L1으로 계속 동작 */
export async function maybeAttachL2(client: SeoulApiClient): Promise<boolean> {
  const table = process.env.CACHE_TABLE_NAME
  if (!table) return false
  try {
    const doc = await createDocClient()
    client.attachL2(new DynamoDbCache(doc, table))
    client.setLedger(new DynamoDbLedger(doc, table))
    console.error(`[cache] DynamoDB L2 활성화: ${table}`)
    return true
  } catch (e) {
    console.error(`[cache] L2 연결 실패 — L1 전용으로 계속: ${(e as Error).message}`)
    return false
  }
}
