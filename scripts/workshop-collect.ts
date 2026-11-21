#!/usr/bin/env tsx
/**
 * 사전 적재 스냅샷을 수집한다. 설계: docs/superpowers/specs/2026-11-21-snapshot-store-design.md §5
 * 키는 화면에 출력하지 않고 maskKey()로만 보여 준다. 수집 호출도 워크숍 테이블의 쿼터 장부에 기록한다.
 */
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { createDocClient, DynamoDbLedger } from '../src/client/dynamo.js'
import { parseDotEnv } from '../src/client/env.js'
import { parseKeys } from '../src/client/keyPool.js'
import { InMemoryLedger, parseQuotaLimit, type QuotaLedger } from '../src/client/quota.js'
import { SeoulApiClient } from '../src/client/seoulApi.js'
import { openStore } from '../src/store/attach.js'
import { collect, formatPlan, formatQuota, formatReport, formatStatus, remainingQuota, statusOf } from '../src/store/collector.js'
import { STORE_PREFIX } from '../src/store/snapshot.js'
import { formatVerify, runVerify } from '../src/store/verify.js'
import { REGION, STACK, parseCollectDays } from './workshop-lib.js'
import { describeStack, stackOutputs, stackParameterValue } from './workshop-aws.js'

const USAGE = `사용법:
  npm run workshop:collect -- daily     매일 묶음: 전체와 머리 스냅샷, 새 날짜와 월 파티션
  npm run workshop:collect -- static    첫차와 막차, 시간표(약 1,850회, 워크숍 당일이 아닌 날)
  npm run workshop:collect -- status    데이터셋별 스냅샷 수, 수집 시각, 기한 내 여부
  npm run workshop:collect -- verify    수집한 스냅샷을 실제 API와 비교(약 70회, 남은 한도를 검사하지 않음). 규칙을 바꾸거나 처음 수집했을 때
옵션:
  --env-file <경로>     키를 읽을 파일(기본 .env.workshop)
  --store <주소>        스냅샷을 둘 곳. 기본은 스택 버킷의 s3://<버킷>/${STORE_PREFIX}. 디렉터리 경로면 로컬에 저장
  --only <서비스,...>   지정한 서비스만
  --days N              날짜 파티션 세 종(일별 승하차, 생활인구, 버스 승하차)을 N일 치로
  --dry-run             계획만 출력
  --force               예상 호출 수가 남은 한도를 넘어도 시작`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'env-file': { type: 'string', default: '.env.workshop' },
    store: { type: 'string' },
    only: { type: 'string' },
    days: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

interface StackInfo { bucket?: string; table?: string; limit: number }

/** 버킷과 테이블 이름, 키 하나의 하루 한도를 스택에서 읽는다. --store를 준 경우에만 스택 없이 진행한다 */
function readStack(): StackInfo {
  try {
    const stack = describeStack()
    const out = stackOutputs(stack)
    return { bucket: out.BucketName, table: out.TableName, limit: parseQuotaLimit(stackParameterValue(stack, 'QuotaDailyLimit')) }
  } catch (e) {
    if (!values.store) throw e
    console.log(`스택 ${STACK}을 읽지 못해 쿼터 장부 없이 진행합니다: ${(e as Error).message}`)
    return { limit: parseQuotaLimit(undefined) }
  }
}

async function main(): Promise<void> {
  const command = positionals[0]
  if (values.help || (command !== 'daily' && command !== 'static' && command !== 'status' && command !== 'verify')) {
    console.log(USAGE)
    if (!values.help && command) process.exitCode = 1
    return
  }
  const days = parseCollectDays(values.days) // AWS를 부르기 전에 인자를 검사한다
  const only = values.only?.split(',').map(s => s.trim()).filter(Boolean)
  const stack = readStack()
  const uri = values.store ?? (stack.bucket ? `s3://${stack.bucket}/${STORE_PREFIX}` : undefined)
  if (!uri) throw new Error(`스택 ${STACK}이 없습니다. 먼저 npm run workshop:deploy를 실행하거나 --store로 저장할 곳을 지정하세요`)
  const store = await openStore(uri, REGION)

  if (command === 'status') {
    console.log(formatStatus(await statusOf(store, Date.now())))
    return
  }

  const envFile = values['env-file']!
  const env = parseDotEnv(readFileSync(envFile, 'utf8'))
  const ledger: QuotaLedger = stack.table
    ? new DynamoDbLedger(await createDocClient(REGION), stack.table, stack.limit)
    : new InMemoryLedger(stack.limit)
  // 캐시(L2)와 저장소를 붙이지 않은 새 클라이언트. 항상 서울 API에서 받는다
  const client = new SeoulApiClient({ apiKey: env.SEOUL_API_KEY ?? '', subwayApiKey: env.SEOUL_SUBWAY_API_KEY ?? '', ledger })
  if (client.isSample) throw new Error(`${envFile}에 SEOUL_API_KEY가 없습니다`)
  const quota = await remainingQuota(parseKeys(env.SEOUL_API_KEY), ledger)
  console.log(formatQuota(quota))

  if (command === 'verify') {
    const verified = await runVerify(client, store, { only })
    console.log(formatVerify(verified))
    if (!verified.ok) process.exitCode = 1
    return
  }

  const report = await collect(client, store, {
    bundle: command, only, days, force: values.force, dryRun: values['dry-run'], remaining: quota.remaining,
    log: line => console.log(line),
  })
  console.log(report.started ? formatReport(report) : formatPlan(report))
  if (!report.ok) process.exitCode = 1
}

main().catch(e => {
  console.error((e as Error).message)
  process.exit(1)
})
