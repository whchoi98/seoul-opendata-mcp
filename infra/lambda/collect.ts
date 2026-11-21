/**
 * 매일 묶음 스냅샷을 수집하는 Lambda. EventBridge 스케줄이 부른다. 설계: docs/superpowers/specs/2026-11-21-snapshot-store-design.md §5.6
 * scripts/workshop-bundle.ts가 esbuild로 한 파일(collect.mjs)로 묶는다. @aws-sdk/*는 Lambda 런타임에 든 것을 쓴다.
 * static 묶음(약 1,850회)은 제한 시간 15분을 넘으므로 여기서 돌리지 않는다.
 */
import { createDocClient, DynamoDbLedger } from '../../src/client/dynamo.js'
import { parseKeys } from '../../src/client/keyPool.js'
import { InMemoryLedger, parseQuotaLimit, type QuotaLedger } from '../../src/client/quota.js'
import { SeoulApiClient } from '../../src/client/seoulApi.js'
import { openStore } from '../../src/store/attach.js'
import { collect, formatPlan, formatQuota, formatReport, remainingQuota, type CollectClient } from '../../src/store/collector.js'
import type { SnapshotStore } from '../../src/store/snapshotStore.js'

export interface Deps {
  client: CollectClient
  store: SnapshotStore
  keys: string[]
  ledger: QuotaLedger
  log: (line: string) => void
  /** 서울 API 호출 사이의 간격. 주지 않으면 수집기의 기본값(200ms). 테스트는 0을 넣는다 */
  delayMs?: number
}

/** 환경 변수로 의존성을 만든다: SEOUL_API_KEY, STORE_URI, TABLE_NAME, QUOTA_DAILY_LIMIT */
async function fromEnv(): Promise<Deps> {
  const uri = process.env.STORE_URI
  if (!uri) throw new Error('STORE_URI가 없습니다')
  const limit = parseQuotaLimit(process.env.QUOTA_DAILY_LIMIT)
  const table = process.env.TABLE_NAME
  // 수집 호출도 워크숍 테이블의 쿼터 장부에 기록한다. 런타임의 키 풀이 이 장부를 보고 다음 키로 넘어간다
  const ledger: QuotaLedger = table ? new DynamoDbLedger(await createDocClient(), table, limit) : new InMemoryLedger(limit)
  return {
    client: new SeoulApiClient({ ledger }),
    store: await openStore(uri),
    keys: parseKeys(process.env.SEOUL_API_KEY),
    ledger,
    log: line => console.log(line),
  }
}

/** 수집을 한 번 실행한다. 실패한 데이터셋이 있거나 시작하지 못했으면 던져서 호출을 실패로 남긴다 */
export async function runDaily(deps: Deps): Promise<{ calls: number; saved: number }> {
  const quota = await remainingQuota(deps.keys, deps.ledger)
  deps.log(formatQuota(quota))
  const report = await collect(deps.client, deps.store, { bundle: 'daily', remaining: quota.remaining, delayMs: deps.delayMs })
  deps.log(report.started ? formatReport(report) : formatPlan(report))
  if (!report.ok) throw new Error(report.aborted ?? report.reason ?? '수집에 실패한 데이터셋이 있습니다')
  return { calls: report.calls, saved: report.results.reduce((n, r) => n + r.saved, 0) }
}

export const handler = async (): Promise<{ calls: number; saved: number }> => runDaily(await fromEnv())
