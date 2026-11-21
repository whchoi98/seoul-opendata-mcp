# 느린 데이터 수집기와 저장소 모드 구현 계획 (하위 프로젝트 ②)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하루 단위 이상으로 바뀌는 데이터셋 37종을 미리 받아 S3에 스냅샷으로 저장하고, 워크숍 런타임이 서울 API보다 스냅샷을 먼저 읽어 그 요청의 서울 API 호출을 0회로 만든다.

**Architecture:** 새 디렉터리 `src/store/`에 규칙 표(허용 목록), 규칙 엔진(순수 함수), 스냅샷 형식, 저장소 구현(디렉터리와 S3), 읽기 경로(`SnapshotReader`), 수집기, 실제 API 대비 검사를 둔다. `SeoulApiClient.fetchUnwrapped`는 샘플 범위 제한 다음, 캐시와 키 선택보다 앞에서 저장소를 조회한다. 수집은 `npm run workshop:collect`가 같은 규칙 표와 같은 `SnapshotStore`로 한다. 스택 템플릿은 런타임에 `store/` 읽기 권한과 `STORE_URI`를 주고, 선택적으로 스케줄 Lambda를 둔다.

**Tech Stack:** TypeScript(strict, ESM), vitest, `node:zlib`(gzip), `@aws-sdk/client-s3`(lazy import), `esbuild`(수집 Lambda 묶기, devDependency), CloudFormation(`AWS::S3::Bucket` 수명 규칙, `AWS::Scheduler::Schedule`, `AWS::Lambda::Function` Node.js 22 arm64), aws CLI 2.

**Spec:** `docs/superpowers/specs/2026-11-21-snapshot-store-design.md`

## Global Constraints

- 리전 `ap-northeast-2`, 스택 이름 `seoul-workshop`, 런타임 이름 `seoul_workshop_mcp`, ECR 저장소 `seoul-opendata-mcp`. 이미지 태그는 `0.8.0-workshop-<커밋 7자>`. ECR의 `latest`, `X.Y.Z` 태그는 옮기지 않는다.
- Task 1~8은 AWS 리소스를 만들거나 바꾸지 않고 실제 서울 API도 부르지 않는다. 스택 변경, ECR 푸시, 실제 수집, `verify`는 Task 9에서 사용자 승인을 받은 뒤에만 한다.
- 기존 리소스 `seoul_opendata_mcp`, `myseoul_mcp`, `seoul-mcp-cache`는 읽지도 바꾸지도 않는다. 템플릿에 이 이름이 나오면 안 된다.
- 원문 API 키, 워크숍 코드, 코드 해시를 로그, 오류 메시지, 커밋, 명령 인자에 넣지 않는다. 키는 `maskKey()`로만 보여 준다. 쿼터 장부는 `keyIdOf()` 해시만 쓴다. `.env`, `.env.workshop`의 값을 출력하지 않는다.
- 서울 API 호출은 모두 `SeoulApiClient`를 거친다. 수집기와 `verify`도 `client.getJson()`만 쓴다. 임의 `fetch`를 쓰지 않는다.
- `@aws-sdk/*`는 `src/client/dynamo.ts`의 `createDocClient()`와 `src/store/s3Store.ts`의 `createS3Store()` 안에서만 lazy import한다. 다른 곳에서 top-level import하지 않는다.
- 의존 방향: `src/client`는 `src/store`를 import하지 않는다. `src/store`는 `src/client`를 import하고, `verify.ts`만 `src/data/catalog.ts`를 더 import한다. `src/store`는 `src/tools`와 `src/normalize`를 import하지 않는다.
- tool 23개, tool `description`, `src/normalize/`의 함수는 고치지 않는다. `tests/fixtures/`는 수정하지 않는다.
- 저장소가 0건으로 답할 때 `note`는 정확히 `해당하는 데이터가 없습니다 (<서비스>)` 하나다(`noDataNote()`). 다른 문구를 붙이지 않는다.
- 저장소가 1건 이상으로 답할 때 `note`는 `사전 적재 데이터(11월 21일 수집)` 형식이다. 기한 지난 스냅샷은 `일일 API 쿼터 소진. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다` 또는 `서울 API 호출 제한. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다`다. 날짜는 KST다.
- 저장소의 모든 실패(S3 오류, 압축 해제, 파싱, 형식 버전, 시간 초과)는 요청을 실패시키지 않는다. 로그만 남기고 지금 경로(캐시와 서울 API)로 넘긴다.
- 고정 값: 메모리 상한 96MB(압축을 푼 JSON 바이트), 재확인 간격 10분, 없는 객체와 오류 기억 5분, 읽기 시간 제한 3초, 수집 호출 간격 200ms, 페이지 1,000행, 매일 묶음 건너뛰기 1시간, 정적 묶음 건너뛰기 7일, 날짜 탐색 범위는 개수 + 10일, 월 탐색 범위는 개수 + 2개월.
- 템플릿에 12자리 계정 ID, `arn:aws:` 리터럴, 버킷 이름을 쓰지 않는다. `Resource: "*"`는 `ecr:GetAuthorizationToken`에만 쓴다.
- 커밋 접두사는 `feat:` `fix:` `test:` `docs:` `chore:`, 메시지는 영어. 모든 커밋 메시지 마지막 줄은 `Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs`.
- 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다. 각 태스크 끝에 `npm test` 전체와 `npm run build`가 통과해야 한다.
- 작업 브랜치는 `feature/snapshot-store`다. `main`에 직접 커밋하지 않는다.

## File Structure

| 파일 | 작업 | 책임 | Task |
|---|---|---|---|
| `src/client/response.ts` | 수정 | `noDataNote()` 내보내기 | 1 |
| `src/store/snapshot.ts` | 생성 | 스냅샷 형식, gzip 직렬화, 객체 키, 접두사 상수 | 1 |
| `src/store/rules.ts` | 생성 | 규칙 표 `STORE_RULES` | 1 |
| `src/store/engine.ts` | 생성 | `planRequest()`, `answerFrom()` | 1 |
| `src/store/CLAUDE.md` | 생성 | 모듈 규칙 | 1 |
| `src/store/snapshotStore.ts` | 생성 | `SnapshotStore` 인터페이스, `DirectoryStore` | 2 |
| `src/store/s3Store.ts` | 생성 | `S3Store`, `parseS3Uri()`, `createS3Store()` | 2 |
| `src/client/snapshotSource.ts` | 생성 | `SnapshotSource`, `SnapshotHit`, `storeNote()` | 2 |
| `src/store/reader.ts` | 생성 | `SnapshotReader`(메모리 보관, 재확인, 시간 제한) | 2 |
| `src/client/seoulApi.ts` | 수정 | `attachStore()`, `fetchUnwrapped`의 저장소 조회 | 3 |
| `src/store/attach.ts` | 생성 | `openStore()`, `maybeAttachStore()` | 3 |
| `src/index.ts`, `src/http.ts` | 수정 | `maybeAttachStore(client)` 호출 | 3 |
| `tests/helpers/mcp.ts` | 수정 | `callTool`에 `store` 옵션 | 3 |
| `src/client/dynamo.ts` | 수정 | `createDocClient()` 분리 | 4 |
| `src/store/collector.ts` | 생성 | 수집 계획, 실행, 증분, 예산, 상태 | 4 |
| `scripts/workshop-collect.ts` | 생성 | `npm run workshop:collect` 껍데기 | 4, 5 |
| `src/store/verify.ts` | 생성 | 실제 API 대비 검사 | 5 |
| `infra/seoul-workshop.yaml` | 수정 | 런타임 권한과 `STORE_URI`, 수명 규칙, 스케줄 리소스 | 6, 7 |
| `scripts/workshop-lib.ts`, `workshop-deploy.ts`, `workshop-code.ts` | 수정 | 새 파라미터, 수집 코드 올리기 | 7 |
| `infra/lambda/collect.ts`, `scripts/workshop-bundle.ts` | 생성 | 수집 Lambda 진입점과 묶기 | 7 |
| `package.json`, `manifest.json`, `src/index.ts`, `CHANGELOG.md` | 수정 | 0.8.0 | 6 |
| 문서(스펙 10절) | 수정, 생성 | 참조 문서, ADR-007, README, 인포그래픽 | 8 |

테스트 파일: `tests/store/snapshot.test.ts`, `rules.test.ts`, `engine.test.ts`(Task 1), `snapshotStore.test.ts`, `reader.test.ts`(Task 2), `tests/seoulApi.test.ts` 추가분, `tests/store/attach.test.ts`, `parity.test.ts`(Task 3), `tests/store/collector.test.ts`, `tests/dynamo.test.ts` 추가분(Task 4), `tests/store/verify.test.ts`(Task 5), `tests/infra/workshopTemplate.test.ts` 추가분(Task 6, 7), `tests/workshopLib.test.ts` 추가분, `tests/infra/collectLambda.test.ts`, `tests/workshopBundle.test.ts`(Task 7).

태스크 순서는 스펙 12절과 한 가지가 다르다. 실제 API와 AWS를 쓰는 일(실제 수집, `verify` 실행과 규칙 확정, 배포, 검증)을 모두 Task 9로 모았다. Task 1~8은 승인 없이 끝까지 진행할 수 있고, Task 9가 끝나면 워크숍에 쓸 수 있다.

스펙에서 계획을 쓰며 정한 것(스펙 3.1, 5.3, 5.6, 7.2, 8.1, 9.1에 같은 커밋으로 반영):

- 저장소 인터페이스의 키는 `STORE_URI` 아래의 상대 키다(`<서비스>/<파티션 키>.json.gz`). S3 객체 키는 그 앞에 `store/v1/`이 붙는다.
- 월 파티션(시간대별 승하차)의 탐색 범위는 개수 + 2개월이다.
- 수집 Lambda의 진입점은 `infra/lambda/collect.ts`이고 `esbuild`로 한 파일(`collect.mjs`)로 묶는다.
- 스택에 아직 없는 파라미터에는 `UsePreviousValue`를 보낼 수 없다. `stackParameters()`가 스택의 현재 파라미터 목록을 받아 새 파라미터는 빼고 보낸다(템플릿 기본값 적용).
- `verify`는 "검증으로 결정" 자리를 예시 값 전체와 그 앞부분, 두 값으로 시험한다. 전체 값만으로는 일치와 부분일치가 같은 행을 고르기 때문이다. 호출은 약 50회다.
- 스케줄이 실패한 실행을 다시 부르지 않도록 `AWS::Lambda::EventInvokeConfig`(`MaximumRetryAttempts: 0`)를 둔다. 수집 Lambda의 메모리는 1,024MB다.
- 수집 예상 호출 수는 상한으로 계산한다. 날짜와 월 파티션은 `max(1, 목표 개수 - 저장된 수) x 스냅샷당 호출 수 + 탐색 여유(10일 또는 2개월)`다. 빈 저장소의 `daily`는 144회로 나오고 실제 호출은 약 125회다.

---

### Task 1: 스냅샷 형식, 규칙 표, 규칙 엔진

**Files:**
- Modify: `src/client/response.ts:25-36`
- Create: `src/store/snapshot.ts`, `src/store/rules.ts`, `src/store/engine.ts`, `src/store/CLAUDE.md`
- Test: `tests/store/snapshot.test.ts`, `tests/store/rules.test.ts`, `tests/store/engine.test.ts`

**Interfaces:**
- Consumes: `Unwrapped { rows: any[]; totalCount: number; note?: string }`, `unwrap(service, payload)`, `isNoData(u)` (`src/client/response.ts`); `CATALOG: DatasetEntry[]` (`src/data/catalog.ts`, 테스트에서만)
- Produces:
  - `noDataNote(service: string): string` (`src/client/response.ts`)
  - `SNAPSHOT_VERSION = 1`, `STORE_PREFIX = 'store/v1'`, `ALL = '_all'`
  - `interface Snapshot { v: 1; service: string; partition: string[]; collectedAt: string; totalCount: number; rows: any[] }`
  - `snapshotKey(service: string, partition: string[]): string`
  - `encodeSnapshot(s: Snapshot): Buffer`, `decodeSnapshot(body: Buffer): { snapshot: Snapshot; bytes: number }`, `isHead(s: Snapshot): boolean`
  - `type SlotRule = { field: string; kind: 'eq' | 'contains' } | { field: string; kind: 'unsupported'; decide?: boolean } | { field: string; kind: 'partition'; pattern: RegExp }`
  - `type PartitionPlan = { kind: 'date'; count: number } | { kind: 'month'; count: number } | { kind: 'lineDirDay' } | { kind: 'stationDayDir' }`
  - `interface StoreRule { slots: SlotRule[]; bundle: 'daily' | 'static'; scope: 'full' | 'head'; maxAgeMs: number | null; callsPerSnapshot: number; partitions?: PartitionPlan; examples?: string[] }`
  - `STORE_RULES: Record<string, StoreRule>`
  - `interface Filter { field: string; kind: 'eq' | 'contains'; value: string }`
  - `interface RequestPlan { service: string; key: string; partition: string[]; filters: Filter[]; rule: StoreRule }`
  - `planRequest(service: string, path: string[], rules?: Record<string, StoreRule>): RequestPlan | undefined`
  - `interface Answer { value: Unwrapped; collectedAt: number; expired: boolean }`
  - `answerFrom(snapshot: Snapshot, plan: RequestPlan, start: number, end: number, now: number, opts?: { allowExpired?: boolean }): Answer | undefined`

- [ ] **Step 1: 스냅샷 형식 테스트 작성**

`tests/store/snapshot.test.ts` (새 파일):

```ts
import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'
import {
  ALL, SNAPSHOT_VERSION, STORE_PREFIX, decodeSnapshot, encodeSnapshot, isHead, snapshotKey, type Snapshot,
} from '../../src/store/snapshot.js'

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  v: 1, service: 'CardSubwayStatsNew', partition: ['20261116'],
  collectedAt: '2026-11-21T01:23:45.000Z', totalCount: 2, rows: [{ a: 1 }, { a: '가' }], ...over,
})

describe('snapshot', () => {
  it('키는 <서비스>/<파티션 값을 _로 이은 것>.json.gz이고 파티션이 없으면 _all이다', () => {
    expect(snapshotKey('TbPharmacyOperateInfo', [])).toBe('TbPharmacyOperateInfo/_all.json.gz')
    expect(snapshotKey('CardSubwayStatsNew', ['20261116'])).toBe('CardSubwayStatsNew/20261116.json.gz')
    expect(snapshotKey('SearchFirstAndLastTrainbyLineServiceNew', ['2호선', '1', '1']))
      .toBe('SearchFirstAndLastTrainbyLineServiceNew/2호선_1_1.json.gz')
    expect(ALL).toBe('_all')
    expect(STORE_PREFIX).toBe('store/v1')
    expect(SNAPSHOT_VERSION).toBe(1)
  })

  it('gzip JSON으로 왕복하고 압축을 푼 바이트 수를 돌려준다', () => {
    const s = snap()
    const body = encodeSnapshot(s)
    expect(body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b])) // gzip 머리
    const { snapshot, bytes } = decodeSnapshot(body)
    expect(snapshot).toEqual(s)
    expect(bytes).toBe(Buffer.byteLength(JSON.stringify(s)))
  })

  it('버전이 다르거나 필드가 빠졌거나 gzip이 아니면 던진다', () => {
    const bad = (o: unknown) => () => decodeSnapshot(gzipSync(JSON.stringify(o)))
    expect(bad({ ...snap(), v: 2 })).toThrow('스냅샷 형식')
    expect(bad({ ...snap(), rows: undefined })).toThrow('스냅샷 형식')
    expect(bad({ ...snap(), collectedAt: 'yesterday' })).toThrow('스냅샷 형식')
    expect(bad(null)).toThrow('스냅샷 형식')
    expect(() => decodeSnapshot(Buffer.from('not gzip'))).toThrow()
  })

  it('저장된 행이 전체 건수보다 적으면 머리 스냅샷이다', () => {
    expect(isHead(snap({ totalCount: 2 }))).toBe(false)
    expect(isHead(snap({ totalCount: 814_076 }))).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/store/snapshot.test.ts`
Expected: FAIL, `Cannot find module '../../src/store/snapshot.js'` 계열 오류

- [ ] **Step 3: `snapshot.ts` 구현**

`src/store/snapshot.ts` (새 파일):

```ts
/** 스냅샷 객체의 형식과 키 규칙. 수집기와 서버가 맞춰야 하는 것은 이 파일 하나다 (스펙 §3.1) */
import { gunzipSync, gzipSync } from 'node:zlib'

export const SNAPSHOT_VERSION = 1
/** S3 객체 키의 맨 앞. STORE_URI는 이 접두사까지 포함한다: s3://<버킷>/store/v1 */
export const STORE_PREFIX = 'store/v1'
/** 파티션이 없는 데이터셋의 파티션 키 */
export const ALL = '_all'

export interface Snapshot {
  v: 1
  service: string
  /** 파티션 자리의 값. 파티션이 없으면 빈 배열 */
  partition: string[]
  /** 수집을 마친 시각(ISO 8601) */
  collectedAt: string
  /** 서울 API가 알려 준 전체 건수 */
  totalCount: number
  /** 서울 API가 준 원본 행. 순서를 바꾸지 않고 정규화하지 않는다 */
  rows: any[]
}

/** STORE_URI 아래의 상대 키. 파티션 값은 규칙의 형식 검사를 통과한 것만 넘겨야 한다 */
export function snapshotKey(service: string, partition: string[]): string {
  return `${service}/${partition.length > 0 ? partition.join('_') : ALL}.json.gz`
}

export function encodeSnapshot(s: Snapshot): Buffer {
  return gzipSync(JSON.stringify(s))
}

/** bytes는 압축을 푼 JSON의 바이트 수. 메모리 상한 계산에 쓴다 */
export function decodeSnapshot(body: Buffer): { snapshot: Snapshot; bytes: number } {
  const json = gunzipSync(body)
  const s = JSON.parse(json.toString('utf8'))
  const ok = s?.v === SNAPSHOT_VERSION && typeof s.service === 'string' && Array.isArray(s.partition)
    && Array.isArray(s.rows) && typeof s.totalCount === 'number' && !Number.isNaN(Date.parse(s.collectedAt))
  if (!ok) throw new Error(`스냅샷 형식이 맞지 않습니다 (v=${String(s?.v)})`)
  return { snapshot: s as Snapshot, bytes: json.length }
}

/** 저장된 행이 전체 건수보다 적으면 머리 스냅샷이다. 필터 요청에는 답할 수 없다 (스펙 §2.1) */
export const isHead = (s: Snapshot): boolean => s.rows.length < s.totalCount
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/store/snapshot.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 규칙 표 테스트 작성**

`tests/store/rules.test.ts` (새 파일):

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CATALOG } from '../../src/data/catalog.js'
import { unwrap } from '../../src/client/response.js'
import { STORE_RULES } from '../../src/store/rules.js'

const entry = (id: string) => CATALOG.find(e => e.id === id)
const services = Object.keys(STORE_RULES)
// 스펙 §1.3: 실시간 12종과 부동산 3종은 저장소를 지나간다
const EXCLUDED = [
  'citydata', 'citydata_ppltn', 'citydata_cmrcl', 'LIVE_DST_MESSAGE', 'bikeList', 'GetParkingInfo', 'RealtimeCityAir',
  'realtimeStationArrival', 'AccInfo', 'TimeAverageAirQuality', 'AiRainfallService', 'ListRiverStageService',
  'tbLnOpendataRtmsV', 'tbLnOpendataRentV', 'IndividuallyPostedLandPriceService',
]
// 카탈로그에 자리가 없고 tool이 직접 /{CODENAME}/{TITLE}/{DATE}를 만드는 서비스
const SLOTS_NOT_IN_CATALOG = ['culturalEventInfo']

describe('STORE_RULES', () => {
  it('대상은 37종이고 제외 15종과 합치면 카탈로그 52종이다', () => {
    expect(services).toHaveLength(37)
    expect(EXCLUDED).toHaveLength(15)
    expect([...services, ...EXCLUDED].sort()).toEqual(CATALOG.map(e => e.id).sort())
  })

  it('규칙이 있는 서비스는 모두 일반 API의 JSON 서비스다', () => {
    for (const id of services) {
      expect(entry(id), id).toBeDefined()
      expect(entry(id)!.endpoint, id).toBe('open')
      expect(entry(id)!.responseType, id).toBe('json')
    }
  })

  it('자리 수와 필드 이름이 카탈로그의 pathParams와 같다(문화행사만 규칙 표가 자리를 정의)', () => {
    for (const id of services) {
      const fields = STORE_RULES[id].slots.map(s => s.field)
      if (SLOTS_NOT_IN_CATALOG.includes(id)) {
        expect(entry(id)!.pathParams, id).toEqual([])
        expect(fields).toEqual(['CODENAME', 'TITLE', 'DATE'])
        expect(STORE_RULES[id].examples).toHaveLength(3)
      } else {
        expect(fields, id).toEqual(entry(id)!.pathParams.map(p => p.name))
      }
    }
  })

  it('파티션 자리는 항상 맨 앞에 모여 있고 파티션 계획과 짝이 맞는다', () => {
    for (const id of services) {
      const r = STORE_RULES[id]
      const kinds = r.slots.map(s => s.kind)
      const n = kinds.filter(k => k === 'partition').length
      expect(kinds.slice(0, n).every(k => k === 'partition'), id).toBe(true)
      expect(r.partitions !== undefined, id).toBe(n > 0)
    }
  })

  it('모든 규칙에 묶음, 범위, 기한, 스냅샷당 호출 수가 있다', () => {
    for (const id of services) {
      const r = STORE_RULES[id]
      expect(['daily', 'static'], id).toContain(r.bundle)
      expect(['full', 'head'], id).toContain(r.scope)
      expect(r.maxAgeMs === null || r.maxAgeMs > 0, id).toBe(true)
      expect(r.callsPerSnapshot, id).toBeGreaterThan(0)
    }
  })

  it('묶음별 개수와 예상 호출 수가 스펙 §2.2와 같다', () => {
    const of = (f: (id: string) => boolean) => services.filter(f)
    const plain = of(id => !STORE_RULES[id].partitions)
    const full = plain.filter(id => STORE_RULES[id].scope === 'full')
    const head = plain.filter(id => STORE_RULES[id].scope === 'head')
    expect(full).toHaveLength(12)
    expect(head).toHaveLength(19)
    expect(full.reduce((n, id) => n + STORE_RULES[id].callsPerSnapshot, 0)).toBe(42)
    expect(head.every(id => STORE_RULES[id].callsPerSnapshot === 1 && STORE_RULES[id].slots.length === 0)).toBe(true)
    expect(of(id => STORE_RULES[id].bundle === 'daily' && !!STORE_RULES[id].partitions).sort())
      .toEqual(['CardBusStatisticsServiceNew', 'CardSubwayStatsNew', 'CardSubwayTime', 'SPOP_LOCAL_RESD_DONG'])
    expect(of(id => STORE_RULES[id].bundle === 'static').sort())
      .toEqual(['SearchFirstAndLastTrainbyLineServiceNew', 'SearchSTNTimeTableByIDService'])
    expect(STORE_RULES.SPOP_LOCAL_RESD_DONG.callsPerSnapshot).toBe(11)
    expect(STORE_RULES.CardBusStatisticsServiceNew.scope).toBe('head')
  })

  it('기한이 스펙 §6.3과 같다', () => {
    const DAY = 86_400_000
    const age = (id: string) => STORE_RULES[id].maxAgeMs
    for (const id of services.filter(s => s.startsWith('ListPublicReservation'))) expect(age(id), id).toBe(DAY)
    expect(age('culturalEventInfo')).toBe(3 * DAY)
    expect(age('SeoulMetroFaciInfo')).toBe(3 * DAY)
    expect(age('TbPharmacyOperateInfo')).toBe(7 * DAY)
    expect(age('goodPrices')).toBe(7 * DAY)
    expect(age('SearchFirstAndLastTrainbyLineServiceNew')).toBe(30 * DAY)
    expect(age('SearchSTNTimeTableByIDService')).toBe(30 * DAY)
    for (const id of ['CardSubwayStatsNew', 'CardSubwayTime', 'SPOP_LOCAL_RESD_DONG', 'CardBusStatisticsServiceNew']) {
      expect(age(id), id).toBeNull()
    }
  })

  it('검증으로 결정할 자리 네 개는 미지원으로 시작한다', () => {
    const undecided = services.flatMap(id =>
      STORE_RULES[id].slots.filter(s => s.kind === 'unsupported' && s.decide).map(s => `${id}.${s.field}`))
    expect(undecided.sort()).toEqual([
      'ListPublicReservationEducation.AREANM', 'ListPublicReservationEducation.USETGTINFO',
      'OdsnBuildingInfo.SISUL_NM', 'culturalEventInfo.CODENAME',
    ])
  })

  it('필터와 파티션 필드가 픽스처의 실제 행에 있다', () => {
    const fixtures: Record<string, string> = {
      TbPharmacyOperateInfo: 'pharmacy.json', GetParkInfo: 'parkinfo.json', culturalEventInfo: 'culture.json',
      SearchInfoBySubwayNameService: 'subway_station.json', ListPublicReservationSport: 'reservation.json',
      CardSubwayStatsNew: 'subway_stats.json', CardBusStatisticsServiceNew: 'bus_stats.json',
      CardSubwayTime: 'subway_hourly.json', SPOP_LOCAL_RESD_DONG: 'living_pop.json',
      SearchFirstAndLastTrainbyLineServiceNew: 'subway_firstlast.json', SearchSTNTimeTableByIDService: 'subway_timetable.json',
    }
    for (const [id, file] of Object.entries(fixtures)) {
      const row = unwrap(id, JSON.parse(readFileSync(`tests/fixtures/${file}`, 'utf8'))).rows[0]
      for (const slot of STORE_RULES[id].slots) expect(row, `${id}.${slot.field}`).toHaveProperty(slot.field)
    }
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run tests/store/rules.test.ts`
Expected: FAIL, `src/store/rules.js`를 찾지 못한다는 오류

- [ ] **Step 7: `rules.ts` 구현**

`src/store/rules.ts` (새 파일):

```ts
/**
 * 저장소가 답할 수 있는 요청의 허용 목록 (스펙 §4). 표에 없는 서비스와 자리는 저장소를 지나
 * 지금 경로(캐시와 서울 API)로 간다. 규칙이 모자라면 호출이 한 번 더 나갈 뿐 틀린 답은 나가지 않는다.
 */

/** 경로 자리 하나의 규칙. field는 행의 필드 이름이자 카탈로그 pathParams의 name이다 */
export type SlotRule =
  | { field: string; kind: 'eq' | 'contains' }
  /** decide: 문서만으로 의미를 알 수 없어 verify로 정할 자리 (스펙 §7.2) */
  | { field: string; kind: 'unsupported'; decide?: boolean }
  | { field: string; kind: 'partition'; pattern: RegExp }

/** 수집기가 파티션 값을 만드는 방법 */
export type PartitionPlan =
  | { kind: 'date'; count: number } // 어제(KST)부터 거꾸로, 공개된 날짜 count개
  | { kind: 'month'; count: number } // 지난달부터 거꾸로 count개
  | { kind: 'lineDirDay' } // 1~9호선 x 방향 2 x 요일 3
  | { kind: 'stationDayDir' } // 역 코드 스냅샷의 1~9호선 역 x 요일 3 x 방향 2

export interface StoreRule {
  slots: SlotRule[]
  /** daily는 매일, static은 시간표 개정 때만 수집한다 */
  bundle: 'daily' | 'static'
  /** 스냅샷 하나에 저장하는 범위. full은 끝 페이지까지, head는 첫 1,000행 */
  scope: 'full' | 'head'
  /** 기한(ms). 지난 날짜의 통계처럼 바뀌지 않으면 null (스펙 §6.3) */
  maxAgeMs: number | null
  /** 스냅샷 하나를 받는 데 드는 호출 수 (2026-11-21 기준, 스펙 §2.2) */
  callsPerSnapshot: number
  partitions?: PartitionPlan
  /** verify가 쓰는 자리별 예시 값. 카탈로그에 자리가 없는 서비스만 적는다 */
  examples?: string[]
}

const DAY = 86_400_000
const eq = (field: string): SlotRule => ({ field, kind: 'eq' })
const contains = (field: string): SlotRule => ({ field, kind: 'contains' })
const unsupported = (field: string): SlotRule => ({ field, kind: 'unsupported' })
const undecided = (field: string): SlotRule => ({ field, kind: 'unsupported', decide: true })
const partition = (field: string, pattern: RegExp): SlotRule => ({ field, kind: 'partition', pattern })

const full = (slots: SlotRule[], maxAgeDays: number, calls: number): StoreRule =>
  ({ slots, bundle: 'daily', scope: 'full', maxAgeMs: maxAgeDays * DAY, callsPerSnapshot: calls })
const head = (maxAgeDays = 7): StoreRule =>
  ({ slots: [], bundle: 'daily', scope: 'head', maxAgeMs: maxAgeDays * DAY, callsPerSnapshot: 1 })

// 파티션 값은 객체 키와 파일 경로가 된다. 형식에 맞는 값만 통과시킨다
const YMD = /^\d{8}$/
const YM = /^\d{6}$/
const LINE = /^[1-9]호선$/
const DIRECTION = /^[12]$/
const DAY_TYPE = /^[123]$/
const STATION_CODE = /^[0-9A-Za-z]{1,8}$/

export const STORE_RULES: Record<string, StoreRule> = {
  // ── 매일 묶음, 전체 12종 ──
  TbPharmacyOperateInfo: full([contains('DUTYADDR'), contains('DUTYNAME')], 7, 6),
  GetParkInfo: full([contains('ADDR'), eq('PKLT_CD'), eq('PRK_NOW_INFO_PVSN_YN')], 7, 3),
  culturalEventInfo: {
    ...full([undecided('CODENAME'), contains('TITLE'), unsupported('DATE')], 3, 20),
    examples: ['콘서트', '서울', '2026-12-24'],
  },
  SearchInfoBySubwayNameService: full([eq('STATION_NM')], 7, 1),
  ListPublicReservationCulture: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationSport: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationInstitution: full([contains('MINCLASSNM')], 1, 1),
  ListPublicReservationEducation: full(
    [contains('MINCLASSNM'), contains('SVCNM'), undecided('USETGTINFO'), undecided('AREANM')], 1, 1),
  ListPublicReservationMedical: full([contains('MINCLASSNM')], 1, 1),
  tnFcltySttusInfo1011: full([contains('FCLTY_NM')], 7, 1),
  ListPriceModelStoreService: full([eq('INDUTY_CODE_SE')], 7, 2),
  OdsnBuildingInfo: full([undecided('SISUL_NM')], 7, 4),

  // ── 매일 묶음, 머리 19종: call_dataset은 1행부터 최대 50행만 요청한다 ──
  SPOP_DAILYSUM_JACHI: head(),
  TbPublicWifiInfo: head(),
  TbGtnHwcwP: head(),
  VwsmTrdarSelngQq: head(),
  ListTraditionalMarket: head(),
  ListNecessariesPricesService: head(),
  culturalSpaceInfo: head(),
  SearchParkInfoService: head(),
  SeoulPublicLibraryInfo: head(),
  TbHospitalInfo: head(),
  ChildCareInfo: head(),
  TbGtnCwP: head(),
  tbClicomCnt: head(),
  TvEmgcHospitalInfo: head(),
  mgis1708328729039Point: head(),
  SeoulMetroFaciInfo: head(3),
  goodPrices: head(),
  mgisToiletPoi: head(),
  LOCALDATA_020301: head(),

  // ── 매일 묶음, 파티션 4종: 지난 날짜의 통계는 바뀌지 않아 기한이 없다 ──
  CardSubwayStatsNew: {
    slots: [partition('USE_YMD', YMD)],
    bundle: 'daily', scope: 'full', maxAgeMs: null, callsPerSnapshot: 1, partitions: { kind: 'date', count: 14 },
  },
  CardBusStatisticsServiceNew: {
    slots: [partition('USE_YMD', YMD)],
    bundle: 'daily', scope: 'head', maxAgeMs: null, callsPerSnapshot: 1, partitions: { kind: 'date', count: 1 },
  },
  CardSubwayTime: {
    slots: [partition('USE_MM', YM), eq('SBWY_ROUT_LN_NM'), eq('STTN')],
    bundle: 'daily', scope: 'full', maxAgeMs: null, callsPerSnapshot: 1, partitions: { kind: 'month', count: 3 },
  },
  SPOP_LOCAL_RESD_DONG: {
    slots: [partition('STDR_DE_ID', YMD), eq('TMZON_PD_SE'), eq('ADSTRD_CODE_SE')],
    bundle: 'daily', scope: 'full', maxAgeMs: null, callsPerSnapshot: 11, partitions: { kind: 'date', count: 3 },
  },

  // ── 정적 묶음, 파티션 2종: 시간표 개정 때만 바뀐다 ──
  SearchFirstAndLastTrainbyLineServiceNew: {
    slots: [partition('SBWY_ROUT_LN', LINE), partition('UPLN_DNLN', DIRECTION), partition('DOW', DAY_TYPE), eq('SUBW_CD'), eq('OTSD_CD')],
    bundle: 'static', scope: 'full', maxAgeMs: 30 * DAY, callsPerSnapshot: 1, partitions: { kind: 'lineDirDay' },
  },
  SearchSTNTimeTableByIDService: {
    slots: [partition('STATION_CD', STATION_CODE), partition('WEEK_TAG', DAY_TYPE), partition('INOUT_TAG', DIRECTION)],
    bundle: 'static', scope: 'full', maxAgeMs: 30 * DAY, callsPerSnapshot: 1, partitions: { kind: 'stationDayDir' },
  },
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run tests/store/rules.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 9: 규칙 엔진 테스트 작성**

`tests/store/engine.test.ts` (새 파일):

```ts
import { describe, it, expect } from 'vitest'
import { isNoData, noDataNote, unwrap } from '../../src/client/response.js'
import { answerFrom, planRequest } from '../../src/store/engine.js'
import type { StoreRule } from '../../src/store/rules.js'
import type { Snapshot } from '../../src/store/snapshot.js'

const NOW = Date.parse('2026-11-21T03:00:00.000Z')
const DAY = 86_400_000
const B = ' '

const snapshot = (service: string, rows: any[], over: Partial<Snapshot> = {}): Snapshot => ({
  v: 1, service, partition: [], collectedAt: new Date(NOW - 3_600_000).toISOString(), totalCount: rows.length, rows, ...over,
})

const pharmacies = [
  { DUTYNAME: '강남온누리약국', DUTYADDR: '서울특별시 강남구 테헤란로 1' },
  { DUTYNAME: '역삼약국', DUTYADDR: '서울특별시 강남구 역삼로 2' },
  { DUTYNAME: '서초온누리약국', DUTYADDR: '서울특별시 서초구 서초대로 3' },
]

describe('noDataNote', () => {
  it('서울 API의 INFO-200 문구와 같고 isNoData가 참이다', () => {
    const live = unwrap('TbPharmacyOperateInfo', { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } })
    expect(noDataNote('TbPharmacyOperateInfo')).toBe(live.note)
    expect(noDataNote('X')).toBe('해당하는 데이터가 없습니다 (X)')
    expect(isNoData({ rows: [], totalCount: 0, note: noDataNote('X') })).toBe(true)
  })
})

describe('planRequest', () => {
  it('규칙이 없는 서비스는 답하지 않는다', () => {
    expect(planRequest('citydata_ppltn', ['강남역'])).toBeUndefined()
    expect(planRequest('constructor', [])).toBeUndefined()
    expect(planRequest('__proto__', [])).toBeUndefined()
  })

  it('인자가 없으면 필터 없이 _all 스냅샷을 고른다', () => {
    const p = planRequest('TbPharmacyOperateInfo', [])!
    expect(p.key).toBe('TbPharmacyOperateInfo/_all.json.gz')
    expect(p.partition).toEqual([])
    expect(p.filters).toEqual([])
    expect(p.service).toBe('TbPharmacyOperateInfo')
  })

  it('자리 순서대로 일치와 부분일치 필터를 만들고 값의 앞뒤 공백을 자른다', () => {
    expect(planRequest('TbPharmacyOperateInfo', ['강남구', ' 온누리 '])!.filters).toEqual([
      { field: 'DUTYADDR', kind: 'contains', value: '강남구' },
      { field: 'DUTYNAME', kind: 'contains', value: '온누리' },
    ])
    expect(planRequest('GetParkInfo', [B, '1033125'])!.filters).toEqual([{ field: 'PKLT_CD', kind: 'eq', value: '1033125' }])
  })

  it('공백뿐이거나 빈 자리는 값이 없는 것으로 본다', () => {
    expect(planRequest('TbPharmacyOperateInfo', [B, '온누리'])!.filters).toEqual([{ field: 'DUTYNAME', kind: 'contains', value: '온누리' }])
    expect(planRequest('TbPharmacyOperateInfo', ['', '  '])!.filters).toEqual([])
    expect(planRequest('culturalEventInfo', [B, B, B])!.filters).toEqual([])
  })

  it('미지원 자리에 값이 오면 답하지 않는다', () => {
    expect(planRequest('culturalEventInfo', ['콘서트', B, B])).toBeUndefined()
    expect(planRequest('culturalEventInfo', [B, '재즈', '2026-12-24'])).toBeUndefined()
    expect(planRequest('culturalEventInfo', [B, '재즈', B])!.filters).toEqual([{ field: 'TITLE', kind: 'contains', value: '재즈' }])
    expect(planRequest('OdsnBuildingInfo', ['경로당'])).toBeUndefined()
  })

  it('값이 온 자리가 규칙의 자리 수를 넘으면 답하지 않는다', () => {
    expect(planRequest('TbPharmacyOperateInfo', ['강남구', '온누리', '추가'])).toBeUndefined()
    expect(planRequest('TbPublicWifiInfo', ['강남구'])).toBeUndefined()
    expect(planRequest('TbPublicWifiInfo', [B])!.filters).toEqual([])
    expect(planRequest('TbPharmacyOperateInfo', ['강남구', '온누리', B])!.filters).toHaveLength(2)
  })

  it('파티션 자리의 값으로 스냅샷을 고르고 나머지는 필터가 된다', () => {
    const p = planRequest('CardSubwayTime', ['202610', B, '강남'])!
    expect(p.key).toBe('CardSubwayTime/202610.json.gz')
    expect(p.partition).toEqual(['202610'])
    expect(p.filters).toEqual([{ field: 'STTN', kind: 'eq', value: '강남' }])
    expect(planRequest('SearchFirstAndLastTrainbyLineServiceNew', ['2호선', '1', '1', '0222'])!.key)
      .toBe('SearchFirstAndLastTrainbyLineServiceNew/2호선_1_1.json.gz')
    expect(planRequest('SearchSTNTimeTableByIDService', ['0222', '1', '2'])!.key).toBe('SearchSTNTimeTableByIDService/0222_1_2.json.gz')
  })

  it('파티션 자리가 비었거나 형식에 맞지 않으면 답하지 않는다', () => {
    expect(planRequest('CardSubwayStatsNew', [])).toBeUndefined()
    expect(planRequest('SPOP_LOCAL_RESD_DONG', [B, '14'])).toBeUndefined()
    expect(planRequest('SearchSTNTimeTableByIDService', ['0222', '1'])).toBeUndefined()
    for (const bad of ['2026111', '202611160', '2026-11-16', '..', '../20261116', '20261116/..', 'a/b', '%2e%2e']) {
      expect(planRequest('CardSubwayStatsNew', [bad]), bad).toBeUndefined()
    }
    expect(planRequest('SearchFirstAndLastTrainbyLineServiceNew', ['경의선', '1', '1'])).toBeUndefined()
    expect(planRequest('SearchFirstAndLastTrainbyLineServiceNew', ['2호선/..', '1', '1'])).toBeUndefined()
    expect(planRequest('SearchSTNTimeTableByIDService', ['../0222', '1', '1'])).toBeUndefined()
    expect(planRequest('SearchSTNTimeTableByIDService', ['0222', '4', '1'])).toBeUndefined()
  })

  it('규칙 표를 바꿔 넣을 수 있다(verify가 가정을 시험할 때 쓴다)', () => {
    const rules: Record<string, StoreRule> = {
      X: { slots: [{ field: 'A', kind: 'eq' }], bundle: 'daily', scope: 'full', maxAgeMs: DAY, callsPerSnapshot: 1 },
    }
    expect(planRequest('X', ['v'], rules)!.filters).toEqual([{ field: 'A', kind: 'eq', value: 'v' }])
    expect(planRequest('TbPharmacyOperateInfo', [], rules)).toBeUndefined()
  })
})

describe('answerFrom', () => {
  const all = snapshot('TbPharmacyOperateInfo', pharmacies)
  const plan = (path: string[]) => planRequest('TbPharmacyOperateInfo', path)!

  it('필터가 없으면 범위만 자르고 전체 건수는 스냅샷의 값이다', () => {
    const a = answerFrom(all, plan([]), 1, 2, NOW)!
    expect(a.value.rows).toEqual(pharmacies.slice(0, 2))
    expect(a.value.totalCount).toBe(3)
    expect(a.value.note).toBeUndefined()
    expect(a.expired).toBe(false)
    expect(a.collectedAt).toBe(NOW - 3_600_000)
    expect(answerFrom(all, plan([]), 2, 1000, NOW)!.value.rows).toEqual(pharmacies.slice(1))
  })

  it('부분일치는 필드가 값을 포함하는 행만 남기고 전체 건수는 걸러진 행 수다', () => {
    const a = answerFrom(all, plan(['강남구', '온누리']), 1, 1000, NOW)!
    expect(a.value.rows).toEqual([pharmacies[0]])
    expect(a.value.totalCount).toBe(1)
    const b = answerFrom(all, plan([B, '온누리']), 1, 1, NOW)!
    expect(b.value.rows).toEqual([pharmacies[0]])
    expect(b.value.totalCount).toBe(2) // 범위로 잘렸어도 조건에 맞는 전체 건수
  })

  it('부분일치는 대소문자를 구분한다', () => {
    const s = snapshot('TbPharmacyOperateInfo', [{ DUTYNAME: 'ABC약국', DUTYADDR: 'x' }])
    expect(answerFrom(s, plan([B, 'ABC']), 1, 10, NOW)!.value.rows).toHaveLength(1)
    expect(answerFrom(s, plan([B, 'abc']), 1, 10, NOW)!.value.rows).toHaveLength(0)
  })

  it('일치는 문자열로 바꾸고 앞뒤 공백을 자른 뒤 비교한다', () => {
    const rows = [{ ADDR: '강남구 1', PKLT_CD: 1033125, PRK_NOW_INFO_PVSN_YN: ' 1 ' }, { ADDR: '강남구 2', PKLT_CD: '10331250', PRK_NOW_INFO_PVSN_YN: '2' }]
    const s = snapshot('GetParkInfo', rows)
    const a = answerFrom(s, planRequest('GetParkInfo', [B, '1033125', '1'])!, 1, 10, NOW)!
    expect(a.value.rows).toEqual([rows[0]])
    expect(answerFrom(s, planRequest('GetParkInfo', [B, '103312'])!, 1, 10, NOW)!.value.rows).toEqual([])
  })

  it('0건이면 note에 서울 API와 같은 문구만 넣는다', () => {
    const a = answerFrom(all, plan([B, '없는약국']), 1, 1000, NOW)!
    expect(a.value).toEqual({ rows: [], totalCount: 0, note: '해당하는 데이터가 없습니다 (TbPharmacyOperateInfo)' })
    expect(isNoData(a.value)).toBe(true)
    // 범위가 걸러진 행을 벗어나도 0건이다
    expect(answerFrom(all, plan([]), 4, 10, NOW)!.value).toEqual({ rows: [], totalCount: 0, note: noDataNote('TbPharmacyOperateInfo') })
  })

  it('머리 스냅샷은 필터 요청과 저장된 범위를 넘는 요청에 답하지 않는다', () => {
    const headSnap = snapshot('TbPharmacyOperateInfo', pharmacies, { totalCount: 5650 })
    expect(answerFrom(headSnap, plan([]), 1, 3, NOW)!.value).toEqual({ rows: pharmacies, totalCount: 5650 })
    expect(answerFrom(headSnap, plan([]), 1, 4, NOW)).toBeUndefined()
    expect(answerFrom(headSnap, plan(['강남구']), 1, 3, NOW)).toBeUndefined()
  })

  it('기한이 지난 스냅샷은 allowExpired일 때만 expired 표시와 함께 답한다', () => {
    const old = snapshot('TbPharmacyOperateInfo', pharmacies, { collectedAt: new Date(NOW - 8 * DAY).toISOString() })
    expect(answerFrom(old, plan([]), 1, 10, NOW)).toBeUndefined()
    const a = answerFrom(old, plan([]), 1, 10, NOW, { allowExpired: true })!
    expect(a.expired).toBe(true)
    expect(a.value.rows).toHaveLength(3)
    const edge = snapshot('TbPharmacyOperateInfo', pharmacies, { collectedAt: new Date(NOW - 7 * DAY).toISOString() })
    expect(answerFrom(edge, plan([]), 1, 10, NOW)!.expired).toBe(false) // 기한과 같으면 아직 쓴다
  })

  it('기한이 없는 규칙의 스냅샷은 오래돼도 답한다', () => {
    const s = snapshot('CardSubwayStatsNew', [{ USE_YMD: '20260101' }], {
      partition: ['20260101'], collectedAt: new Date(NOW - 300 * DAY).toISOString(),
    })
    expect(answerFrom(s, planRequest('CardSubwayStatsNew', ['20260101'])!, 1, 1000, NOW)!.expired).toBe(false)
  })

  it('잘못된 범위에는 답하지 않는다', () => {
    expect(answerFrom(all, plan([]), 0, 5, NOW)).toBeUndefined()
    expect(answerFrom(all, plan([]), 5, 4, NOW)).toBeUndefined()
  })
})
```

- [ ] **Step 10: 실패 확인**

Run: `npx vitest run tests/store/engine.test.ts`
Expected: FAIL, `noDataNote`가 `src/client/response.js`에 없고 `src/store/engine.js`를 찾지 못한다는 오류

- [ ] **Step 11: `noDataNote` 내보내기**

`src/client/response.ts`에서 아래 두 곳을 고친다.

바꾸기 전:

```ts
const NO_DATA = '해당하는 데이터가 없습니다'

/** 조건에 맞는 행이 없다는 정상 응답(INFO-200)인지. 쿼터 소진처럼 다른 이유로 비어 있으면 false */
export const isNoData = (u: Unwrapped) => u.rows.length === 0 && (!u.note || u.note.startsWith(NO_DATA))
```

바꾼 뒤:

```ts
const NO_DATA = '해당하는 데이터가 없습니다'

/** INFO-200과 같은 뜻의 note. 사전 적재 저장소(src/store)도 0건일 때 이 함수로 같은 문구를 만든다 */
export const noDataNote = (service: string): string => `${NO_DATA} (${service})`

/** 조건에 맞는 행이 없다는 정상 응답(INFO-200)인지. 쿼터 소진처럼 다른 이유로 비어 있으면 false */
export const isNoData = (u: Unwrapped) => u.rows.length === 0 && (!u.note || u.note.startsWith(NO_DATA))
```

`assertOk` 안의 한 줄:

```ts
  if (code === 'INFO-200') return `${NO_DATA} (${service})`
```

를 다음으로 바꾼다.

```ts
  if (code === 'INFO-200') return noDataNote(service)
```

- [ ] **Step 12: `engine.ts` 구현**

`src/store/engine.ts` (새 파일):

```ts
/** 규칙 엔진. 입출력만 있는 순수 함수다 (스펙 §4.3). "답하지 않는다"는 undefined이고, 부르는 쪽이 지금 경로로 넘긴다 */
import { noDataNote, type Unwrapped } from '../client/response.js'
import { STORE_RULES, type StoreRule } from './rules.js'
import { isHead, snapshotKey, type Snapshot } from './snapshot.js'

export interface Filter { field: string; kind: 'eq' | 'contains'; value: string }

export interface RequestPlan {
  service: string
  /** 읽을 스냅샷의 상대 키 */
  key: string
  partition: string[]
  filters: Filter[]
  rule: StoreRule
}

/** 요청을 저장소가 답할 수 있으면 읽을 스냅샷과 적용할 필터를 정한다 (§4.3의 1~3) */
export function planRequest(
  service: string, path: string[], rules: Record<string, StoreRule> = STORE_RULES,
): RequestPlan | undefined {
  const rule = Object.hasOwn(rules, service) ? rules[service] : undefined
  if (!rule) return undefined
  // tool은 건너뛰는 자리를 공백 한 칸으로 채워 보낸다. 공백뿐인 값은 없는 값이다
  const values = path.map(v => String(v).trim())
  if (values.some((v, i) => v !== '' && i >= rule.slots.length)) return undefined
  const partition: string[] = []
  const filters: Filter[] = []
  for (let i = 0; i < rule.slots.length; i++) {
    const slot = rule.slots[i]
    const value = values[i] ?? ''
    if (slot.kind === 'partition') {
      // 빈 값도 형식 검사에서 걸린다. 통과한 값만 객체 키에 들어간다
      if (!slot.pattern.test(value)) return undefined
      partition.push(value)
    } else if (value !== '') {
      if (slot.kind === 'unsupported') return undefined
      filters.push({ field: slot.field, kind: slot.kind, value })
    }
  }
  return { service, key: snapshotKey(service, partition), partition, filters, rule }
}

const text = (v: unknown): string => String(v ?? '').trim()

const matches = (row: any, f: Filter): boolean =>
  f.kind === 'eq' ? text(row?.[f.field]) === f.value : text(row?.[f.field]).includes(f.value)

export interface Answer {
  value: Unwrapped
  /** 스냅샷을 수집한 시각(ms) */
  collectedAt: number
  /** 기한이 지난 스냅샷으로 답했는지. allowExpired일 때만 true가 나온다 */
  expired: boolean
}

/** 스냅샷에 필터와 범위를 적용한다 (§4.3의 4~7) */
export function answerFrom(
  snapshot: Snapshot, plan: RequestPlan, start: number, end: number, now: number, opts: { allowExpired?: boolean } = {},
): Answer | undefined {
  const collectedAt = Date.parse(snapshot.collectedAt)
  const expired = plan.rule.maxAgeMs !== null && now - collectedAt > plan.rule.maxAgeMs
  if (expired && !opts.allowExpired) return undefined
  if (start < 1 || end < start) return undefined
  const filtering = plan.filters.length > 0
  if (isHead(snapshot) && (filtering || end > snapshot.rows.length)) return undefined
  const filtered = filtering ? snapshot.rows.filter(r => plan.filters.every(f => matches(r, f))) : snapshot.rows
  const rows = filtered.slice(start - 1, end)
  // 0건에는 서울 API와 같은 문구만 붙인다. isNoData()와 여러 tool이 이 문구로 "조건에 맞는 행 없음"을 구분한다
  if (rows.length === 0) return { value: { rows: [], totalCount: 0, note: noDataNote(plan.service) }, collectedAt, expired }
  return { value: { rows, totalCount: filtering ? filtered.length : snapshot.totalCount }, collectedAt, expired }
}
```

- [ ] **Step 13: 통과 확인**

Run: `npx vitest run tests/store tests/response.test.ts`
Expected: PASS (snapshot 4, rules 9, engine 19, response 기존 테스트 전부)

- [ ] **Step 14: 모듈 규칙 문서 작성**

저장소의 구조 검사(`bash tests/harness/run-all.sh`)는 `src/` 아래 디렉터리마다 `CLAUDE.md`가 있는지 본다.

`src/store/CLAUDE.md` (새 파일):

```markdown
# Store Module

## Role
사전 적재 저장소입니다. 하루 단위 이상으로 바뀌는 데이터셋 37종을 미리 받아 gzip JSON 스냅샷으로 저장하고, 서버가 서울 API보다 스냅샷을 먼저 읽게 합니다. 설계는 `docs/superpowers/specs/2026-11-21-snapshot-store-design.md`입니다.

## Key Files
- `rules.ts` - 규칙 표 `STORE_RULES`. 서비스별 자리 규칙(일치, 부분일치, 파티션, 미지원), 묶음, 범위, 기한, 스냅샷당 호출 수.
- `engine.ts` - 순수 함수 `planRequest()`(읽을 스냅샷과 필터 결정)와 `answerFrom()`(필터, 범위, 기한 적용).
- `snapshot.ts` - 스냅샷 형식, gzip 직렬화, 객체 키(`<서비스>/<파티션 키>.json.gz`), 접두사 `store/v1`.

## Rules
- 허용 목록 방식입니다. 규칙 표에 없는 서비스, 미지원 자리, 형식에 맞지 않는 파티션 값은 답하지 않고 지금 경로(캐시와 서울 API)로 넘깁니다. 추측으로 답하지 않습니다.
- 0건으로 답할 때 `note`는 `noDataNote()`가 만든 문구 하나입니다. 다른 문구를 붙이면 `isNoData()`와 tool의 분기가 깨집니다.
- 파티션 값은 객체 키와 파일 경로가 됩니다. 규칙의 정규식을 통과한 값만 `snapshotKey()`에 넘깁니다.
- 저장소의 실패는 요청을 실패시키지 않습니다. 로그만 남기고 답하지 않음으로 처리합니다.
- `src/client`만 import합니다(`verify.ts`는 `src/data/catalog.ts`도). `src/tools`와 `src/normalize`는 import하지 않습니다. `src/client`는 이 디렉터리를 import하지 않습니다.
- 규칙을 바꾸면 `tests/store/rules.test.ts`를 먼저 고치고, 배포 전에 `npm run workshop:collect -- verify`로 실제 API와 비교합니다.
```

- [ ] **Step 15: 전체 테스트와 빌드**

Run: `npm test && npm run build && bash tests/harness/run-all.sh`
Expected: 모두 통과. vitest는 기존 테스트에 32개가 늘어난다

- [ ] **Step 16: 커밋**

```bash
git add src/client/response.ts src/store tests/store
git commit -m "feat: add snapshot format, store rules, and the rule engine

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 2: 저장소 구현(디렉터리, S3)과 읽기 경로

**Files:**
- Create: `src/store/snapshotStore.ts`, `src/store/s3Store.ts`, `src/client/snapshotSource.ts`, `src/store/reader.ts`
- Modify: `package.json`(`@aws-sdk/client-s3` 추가), `src/store/CLAUDE.md`
- Test: `tests/store/snapshotStore.test.ts`, `tests/store/reader.test.ts`

**Interfaces:**
- Consumes: `planRequest()`, `answerFrom()`, `Answer` (`src/store/engine.ts`); `decodeSnapshot()`, `encodeSnapshot()`, `Snapshot` (`src/store/snapshot.ts`); `Unwrapped` (`src/client/response.ts`)
- Produces:
  - `interface StoredObject { body: Buffer; etag?: string }`, `interface ListedObject { key: string; lastModified: number; size: number }`
  - `interface SnapshotStore { get(key: string, opts?: { ifNoneMatch?: string }): Promise<StoredObject | 'not-modified' | undefined>; put(key: string, body: Buffer): Promise<void>; list(prefix: string): Promise<ListedObject[]> }`
  - `class DirectoryStore implements SnapshotStore { constructor(root: string) }`
  - `interface S3Like { getObject(p: { Bucket: string; Key: string; IfNoneMatch?: string }): Promise<StoredObject>; putObject(p: { Bucket: string; Key: string; Body: Buffer }): Promise<void>; listObjectsV2(p: { Bucket: string; Prefix: string; ContinuationToken?: string }): Promise<{ contents: ListedObject[]; nextToken?: string }> }`
  - `class S3Store implements SnapshotStore { constructor(s3: S3Like, bucket: string, prefix: string) }`
  - `parseS3Uri(uri: string): { bucket: string; prefix: string } | undefined`
  - `createS3Store(uri: string, region?: string): Promise<S3Store>`
  - `interface SnapshotHit { value: Unwrapped; collectedAt: number; expired: boolean }`
  - `interface SnapshotSource { lookup(service: string, start: number, end: number, path: string[], opts?: { allowExpired?: boolean }): Promise<SnapshotHit | undefined> }`
  - `storeNote(hit: SnapshotHit, now: number, reason?: 'quota' | 'rate'): string | undefined`
  - `MAX_BYTES = 100_663_296`, `REVALIDATE_MS = 600_000`, `NEGATIVE_MS = 300_000`, `READ_TIMEOUT_MS = 3_000`
  - `class SnapshotReader implements SnapshotSource { constructor(store: SnapshotStore, opts?: { now?: () => number; maxBytes?: number; timeoutMs?: number; log?: (line: string) => void }) }`

- [ ] **Step 1: S3 SDK 의존성 추가**

이미 설치된 DynamoDB SDK와 같은 버전으로 맞춰 공용 패키지를 함께 쓰게 한다.

```bash
npm install "@aws-sdk/client-s3@$(node -p "require('./node_modules/@aws-sdk/client-dynamodb/package.json').version")"
```

Expected: `package.json`의 `dependencies`에 `"@aws-sdk/client-s3": "^3.x.y"`가 생기고 `package-lock.json`이 바뀐다

- [ ] **Step 2: 저장소 구현 테스트 작성**

`tests/store/snapshotStore.test.ts` (새 파일):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DirectoryStore } from '../../src/store/snapshotStore.js'
import { S3Store, parseS3Uri, type S3Like } from '../../src/store/s3Store.js'

describe('DirectoryStore', () => {
  let dir: string
  let store: DirectoryStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seoul-store-'))
    store = new DirectoryStore(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('put한 본문을 get으로 돌려주고 etag는 내용의 sha256이다', async () => {
    await store.put('A/_all.json.gz', Buffer.from('one'))
    expect(await store.get('A/_all.json.gz')).toEqual({
      body: Buffer.from('one'), etag: createHash('sha256').update('one').digest('hex'),
    })
    expect(readdirSync(join(dir, 'A'))).toEqual(['_all.json.gz']) // 임시 파일이 남지 않는다
  })

  it('없는 키는 undefined', async () => {
    expect(await store.get('A/_all.json.gz')).toBeUndefined()
  })

  it('ifNoneMatch가 지금 etag와 같으면 not-modified, 내용이 바뀌면 새 본문', async () => {
    await store.put('A/_all.json.gz', Buffer.from('one'))
    const first = await store.get('A/_all.json.gz')
    if (!first || first === 'not-modified') throw new Error('본문이 와야 한다')
    expect(await store.get('A/_all.json.gz', { ifNoneMatch: first.etag })).toBe('not-modified')
    await store.put('A/_all.json.gz', Buffer.from('two'))
    expect(await store.get('A/_all.json.gz', { ifNoneMatch: first.etag })).toMatchObject({ body: Buffer.from('two') })
  })

  it('list는 접두사에 맞는 .json.gz만 키, 수정 시각, 크기와 함께 돌려준다', async () => {
    await store.put('A/_all.json.gz', Buffer.from('1'))
    await store.put('B/20261116.json.gz', Buffer.from('22'))
    await store.put('B/20261117.json.gz', Buffer.from('333'))
    writeFileSync(join(dir, 'B', 'notes.txt'), 'x')
    const all = await store.list('')
    expect(all.map(o => o.key)).toEqual(['A/_all.json.gz', 'B/20261116.json.gz', 'B/20261117.json.gz'])
    expect(all.map(o => o.size)).toEqual([1, 2, 3])
    expect(all.every(o => Math.abs(o.lastModified - Date.now()) < 60_000)).toBe(true)
    expect((await store.list('B/')).map(o => o.key)).toEqual(['B/20261116.json.gz', 'B/20261117.json.gz'])
  })

  it('없는 루트 디렉터리의 list는 빈 배열이고 put은 디렉터리를 만든다', async () => {
    const fresh = new DirectoryStore(join(dir, 'not-yet'))
    expect(await fresh.list('')).toEqual([])
    await fresh.put('A/_all.json.gz', Buffer.from('1'))
    expect(existsSync(join(dir, 'not-yet', 'A', '_all.json.gz'))).toBe(true)
  })

  it('루트 밖을 가리키는 키는 거부한다', async () => {
    await expect(store.get('../outside.json.gz')).rejects.toThrow('저장소 밖')
    await expect(store.put('A/../../outside.json.gz', Buffer.from('x'))).rejects.toThrow('저장소 밖')
  })
})

const s3Error = (name: string, status: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } })

function fakeS3(pageSize = 2) {
  const objects = new Map<string, { body: Buffer; etag: string; lastModified: number }>()
  const calls: Array<{ op: string; params: any }> = []
  const s3: S3Like = {
    async getObject(p) {
      calls.push({ op: 'get', params: p })
      const o = objects.get(p.Key)
      if (!o) throw s3Error('NoSuchKey', 404)
      if (p.IfNoneMatch === o.etag) throw s3Error('NotModified', 304)
      return { body: o.body, etag: o.etag }
    },
    async putObject(p) {
      calls.push({ op: 'put', params: p })
      objects.set(p.Key, { body: p.Body, etag: `"e${objects.size + 1}"`, lastModified: 1000 + objects.size })
    },
    async listObjectsV2(p) {
      calls.push({ op: 'list', params: p })
      const keys = [...objects.keys()].filter(k => k.startsWith(p.Prefix)).sort()
      const from = p.ContinuationToken ? Number(p.ContinuationToken) : 0
      return {
        contents: keys.slice(from, from + pageSize).map(k => ({ key: k, lastModified: objects.get(k)!.lastModified, size: objects.get(k)!.body.length })),
        nextToken: from + pageSize < keys.length ? String(from + pageSize) : undefined,
      }
    },
  }
  return { s3, objects, calls }
}

describe('S3Store', () => {
  it('put과 get은 접두사를 붙인 키를 쓴다', async () => {
    const { s3, calls } = fakeS3()
    const store = new S3Store(s3, 'bucket', 'store/v1')
    await store.put('A/_all.json.gz', Buffer.from('one'))
    expect(calls[0]).toEqual({ op: 'put', params: { Bucket: 'bucket', Key: 'store/v1/A/_all.json.gz', Body: Buffer.from('one') } })
    expect(await store.get('A/_all.json.gz')).toEqual({ body: Buffer.from('one'), etag: '"e1"' })
    expect(calls[1]).toEqual({ op: 'get', params: { Bucket: 'bucket', Key: 'store/v1/A/_all.json.gz' } })
  })

  it('없는 객체는 undefined, 조건부 요청이 304면 not-modified', async () => {
    const { s3, calls } = fakeS3()
    const store = new S3Store(s3, 'bucket', 'store/v1')
    expect(await store.get('A/_all.json.gz')).toBeUndefined()
    await store.put('A/_all.json.gz', Buffer.from('one'))
    expect(await store.get('A/_all.json.gz', { ifNoneMatch: '"e1"' })).toBe('not-modified')
    expect(calls.at(-1)!.params.IfNoneMatch).toBe('"e1"')
    expect(await store.get('A/_all.json.gz', { ifNoneMatch: '"old"' })).toMatchObject({ etag: '"e1"' })
  })

  it('이름 없이 상태 코드만 있는 404와 304도 같은 뜻으로 읽는다', async () => {
    const s3 = { ...fakeS3().s3, getObject: async () => { throw s3Error('UnknownError', 404) } } as S3Like
    expect(await new S3Store(s3, 'b', 'p').get('k')).toBeUndefined()
    const s304 = { ...fakeS3().s3, getObject: async () => { throw s3Error('UnknownError', 304) } } as S3Like
    expect(await new S3Store(s304, 'b', 'p').get('k', { ifNoneMatch: 'x' })).toBe('not-modified')
  })

  it('그 밖의 오류(403 등)는 그대로 던진다', async () => {
    const s3 = { ...fakeS3().s3, getObject: async () => { throw s3Error('AccessDenied', 403) } } as S3Like
    await expect(new S3Store(s3, 'b', 'p').get('k')).rejects.toThrow('AccessDenied')
  })

  it('list는 페이지를 끝까지 넘기고 접두사를 뗀 키를 돌려준다', async () => {
    const { s3, calls } = fakeS3(2)
    const store = new S3Store(s3, 'bucket', 'store/v1')
    for (const k of ['A/_all.json.gz', 'B/1.json.gz', 'B/2.json.gz', 'B/3.json.gz', 'C/_all.json.gz']) await store.put(k, Buffer.from(k))
    calls.length = 0
    expect((await store.list('')).map(o => o.key)).toEqual(['A/_all.json.gz', 'B/1.json.gz', 'B/2.json.gz', 'B/3.json.gz', 'C/_all.json.gz'])
    expect(calls.map(c => c.params.ContinuationToken)).toEqual([undefined, '2', '4'])
    expect(calls[0].params.Prefix).toBe('store/v1/')
    const b = await store.list('B/')
    expect(b.map(o => o.key)).toEqual(['B/1.json.gz', 'B/2.json.gz', 'B/3.json.gz'])
    expect(b[0]).toEqual({ key: 'B/1.json.gz', lastModified: 1001, size: 'B/1.json.gz'.length })
  })

  it('접두사가 없으면 키를 그대로 쓴다', async () => {
    const { s3, calls } = fakeS3()
    await new S3Store(s3, 'bucket', '').put('A/_all.json.gz', Buffer.from('x'))
    expect(calls[0].params.Key).toBe('A/_all.json.gz')
  })
})

describe('parseS3Uri', () => {
  it('버킷과 접두사를 나누고 끝의 빗금을 뗀다', () => {
    expect(parseS3Uri('s3://my-bucket/store/v1')).toEqual({ bucket: 'my-bucket', prefix: 'store/v1' })
    expect(parseS3Uri('s3://my-bucket/store/v1/')).toEqual({ bucket: 'my-bucket', prefix: 'store/v1' })
    expect(parseS3Uri('s3://my-bucket')).toEqual({ bucket: 'my-bucket', prefix: '' })
  })
  it('s3 주소가 아니면 undefined', () => {
    expect(parseS3Uri('/var/store')).toBeUndefined()
    expect(parseS3Uri('s3://')).toBeUndefined()
    expect(parseS3Uri('s3://Bad_Bucket/x')).toBeUndefined()
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/store/snapshotStore.test.ts`
Expected: FAIL, `src/store/snapshotStore.js`를 찾지 못한다는 오류

- [ ] **Step 4: `snapshotStore.ts` 구현**

`src/store/snapshotStore.ts` (새 파일):

```ts
/** 스냅샷을 두는 곳의 인터페이스와 디렉터리 구현 (스펙 §3.2). 서버는 get만, 수집기는 셋 다 쓴다 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

export interface StoredObject { body: Buffer; etag?: string }
export interface ListedObject { key: string; lastModified: number; size: number }

export interface SnapshotStore {
  /** 없는 객체는 undefined. ifNoneMatch가 지금 etag와 같으면 'not-modified' */
  get(key: string, opts?: { ifNoneMatch?: string }): Promise<StoredObject | 'not-modified' | undefined>
  put(key: string, body: Buffer): Promise<void>
  /** prefix로 시작하는 키의 객체. 빈 문자열이면 전부 */
  list(prefix: string): Promise<ListedObject[]>
}

const isMissing = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

/** 테스트와 로컬 개발용. 키를 루트 디렉터리 아래의 상대 경로로 쓴다 */
export class DirectoryStore implements SnapshotStore {
  private root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private pathOf(key: string): string {
    const full = resolve(this.root, key)
    if (!full.startsWith(this.root + sep)) throw new Error('저장소 밖을 가리키는 키입니다')
    return full
  }

  async get(key: string, opts: { ifNoneMatch?: string } = {}): Promise<StoredObject | 'not-modified' | undefined> {
    let body: Buffer
    try {
      body = await readFile(this.pathOf(key))
    } catch (e) {
      if (isMissing(e)) return undefined
      throw e
    }
    const etag = createHash('sha256').update(body).digest('hex')
    return opts.ifNoneMatch === etag ? 'not-modified' : { body, etag }
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathOf(key)
    await mkdir(dirname(path), { recursive: true })
    // 읽는 쪽이 반쯤 쓴 파일을 보지 않도록 임시 파일에 쓴 뒤 이름을 바꾼다
    const tmp = `${path}.tmp-${process.pid}`
    await writeFile(tmp, body)
    await rename(tmp, path)
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (e) {
        if (isMissing(e)) return
        throw e
      }
      for (const entry of entries) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(path)
        } else if (entry.name.endsWith('.json.gz')) {
          const key = relative(this.root, path).split(sep).join('/')
          if (!key.startsWith(prefix)) continue
          const s = await stat(path)
          out.push({ key, lastModified: s.mtimeMs, size: s.size })
        }
      }
    }
    await walk(this.root)
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }
}
```

- [ ] **Step 5: `s3Store.ts` 구현**

`src/store/s3Store.ts` (새 파일):

```ts
/** S3 저장소 구현. @aws-sdk/client-s3는 createS3Store() 안에서만 lazy import한다 */
import type { ListedObject, SnapshotStore, StoredObject } from './snapshotStore.js'

/** 이 모듈이 쓰는 S3 호출만 추린 형태. 테스트는 가짜 구현을 넣는다 */
export interface S3Like {
  getObject(p: { Bucket: string; Key: string; IfNoneMatch?: string }): Promise<StoredObject>
  putObject(p: { Bucket: string; Key: string; Body: Buffer }): Promise<void>
  listObjectsV2(p: { Bucket: string; Prefix: string; ContinuationToken?: string }): Promise<{ contents: ListedObject[]; nextToken?: string }>
}

const statusOf = (e: unknown): number | undefined => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
const nameOf = (e: unknown): string | undefined => (e as { name?: string })?.name
const isMissing = (e: unknown): boolean => nameOf(e) === 'NoSuchKey' || statusOf(e) === 404
const isNotModified = (e: unknown): boolean => nameOf(e) === 'NotModified' || statusOf(e) === 304

export class S3Store implements SnapshotStore {
  constructor(private s3: S3Like, private bucket: string, private prefix: string) {}

  private keyOf(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key
  }

  async get(key: string, opts: { ifNoneMatch?: string } = {}): Promise<StoredObject | 'not-modified' | undefined> {
    try {
      return await this.s3.getObject({
        Bucket: this.bucket, Key: this.keyOf(key), ...(opts.ifNoneMatch ? { IfNoneMatch: opts.ifNoneMatch } : {}),
      })
    } catch (e) {
      if (isNotModified(e)) return 'not-modified'
      if (isMissing(e)) return undefined
      throw e
    }
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.s3.putObject({ Bucket: this.bucket, Key: this.keyOf(key), Body: body })
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = []
    const strip = this.prefix ? this.prefix.length + 1 : 0
    let token: string | undefined
    do {
      const page = await this.s3.listObjectsV2({ Bucket: this.bucket, Prefix: this.keyOf(prefix), ContinuationToken: token })
      for (const o of page.contents) out.push({ ...o, key: o.key.slice(strip) })
      token = page.nextToken
    } while (token)
    return out
  }
}

/** s3://<버킷>/<접두사>. 접두사 끝의 빗금은 뗀다 */
export function parseS3Uri(uri: string): { bucket: string; prefix: string } | undefined {
  const m = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(uri)
  if (!m) return undefined
  return { bucket: m[1], prefix: (m[2] ?? '').replace(/\/+$/, '') }
}

/** region을 주지 않으면 SDK의 기본 설정(런타임의 AWS_REGION)을 쓴다 */
export async function createS3Store(uri: string, region?: string): Promise<S3Store> {
  const parsed = parseS3Uri(uri)
  if (!parsed) throw new Error('저장소 주소는 s3://<버킷>/<접두사> 형식이어야 합니다')
  const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3')
  const client = new S3Client(region ? { region } : {})
  const s3: S3Like = {
    async getObject(p) {
      const r = await client.send(new GetObjectCommand(p))
      if (!r.Body) throw new Error('S3 응답에 본문이 없습니다')
      return { body: Buffer.from(await r.Body.transformToByteArray()), etag: r.ETag }
    },
    async putObject(p) {
      await client.send(new PutObjectCommand({ ...p, ContentType: 'application/gzip' }))
    },
    async listObjectsV2(p) {
      const r = await client.send(new ListObjectsV2Command(p))
      return {
        contents: (r.Contents ?? []).map(o => ({ key: o.Key ?? '', lastModified: o.LastModified?.getTime() ?? 0, size: o.Size ?? 0 })),
        nextToken: r.IsTruncated ? r.NextContinuationToken : undefined,
      }
    },
  }
  return new S3Store(s3, parsed.bucket, parsed.prefix)
}
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/store/snapshotStore.test.ts && npm run build`
Expected: PASS (14 tests), 빌드 오류 없음(`createS3Store`의 SDK 타입 검사 포함)

- [ ] **Step 7: 읽기 경로 테스트 작성**

`tests/store/reader.test.ts` (새 파일):

```ts
import { describe, it, expect } from 'vitest'
import { storeNote } from '../../src/client/snapshotSource.js'
import { MAX_BYTES, NEGATIVE_MS, READ_TIMEOUT_MS, REVALIDATE_MS, SnapshotReader } from '../../src/store/reader.js'
import { encodeSnapshot, snapshotKey, type Snapshot } from '../../src/store/snapshot.js'
import type { SnapshotStore, StoredObject } from '../../src/store/snapshotStore.js'

const NOW = Date.parse('2026-11-21T03:00:00.000Z')
const PHARMACY = 'TbPharmacyOperateInfo'
const STATS = 'CardSubwayStatsNew'
const rows = [{ DUTYNAME: '강남온누리약국', DUTYADDR: '서울특별시 강남구 1' }, { DUTYNAME: '역삼약국', DUTYADDR: '서울특별시 강남구 2' }]

const snap = (service: string, partition: string[], r: any[], over: Partial<Snapshot> = {}): Snapshot => ({
  v: 1, service, partition, collectedAt: new Date(NOW - 3_600_000).toISOString(), totalCount: r.length, rows: r, ...over,
})

function memoryStore() {
  const objects = new Map<string, StoredObject>()
  const gets: Array<{ key: string; ifNoneMatch?: string }> = []
  const state = { fail: undefined as Error | undefined, delayMs: 0, version: 0 }
  const store: SnapshotStore = {
    async get(key, opts) {
      gets.push({ key, ifNoneMatch: opts?.ifNoneMatch })
      if (state.delayMs > 0) await new Promise(r => setTimeout(r, state.delayMs))
      if (state.fail) throw state.fail
      const o = objects.get(key)
      if (!o) return undefined
      return opts?.ifNoneMatch === o.etag ? 'not-modified' : o
    },
    async put(key, body) { objects.set(key, { body, etag: `"v${++state.version}"` }) },
    async list() { return [] },
  }
  const seed = (s: Snapshot) => store.put(snapshotKey(s.service, s.partition), encodeSnapshot(s))
  return { store, objects, gets, state, seed }
}

function setup(opts: { maxBytes?: number; timeoutMs?: number } = {}) {
  const m = memoryStore()
  const clock = { t: NOW }
  const logs: string[] = []
  const reader = new SnapshotReader(m.store, { now: () => clock.t, log: l => logs.push(l), ...opts })
  return { ...m, clock, logs, reader }
}

describe('storeNote', () => {
  const hit = (over: object = {}) => ({ value: { rows: [{}], totalCount: 1 }, collectedAt: Date.parse('2026-11-20T16:30:00.000Z'), expired: false, ...over })

  it('1건 이상이면 KST 수집 날짜를 적는다', () => {
    expect(storeNote(hit(), NOW)).toBe('사전 적재 데이터(11월 21일 수집)') // UTC 20일 16:30은 KST 21일 01:30
  })
  it('기한이 지났으면 이유와 경과 일수를 적는다', () => {
    const old = hit({ collectedAt: Date.parse('2026-11-18T01:00:00.000Z'), expired: true })
    expect(storeNote(old, NOW, 'quota')).toBe('일일 API 쿼터 소진. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다')
    expect(storeNote(old, NOW, 'rate')).toBe('서울 API 호출 제한. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다')
  })
  it('0건이면 문구를 붙이지 않는다', () => {
    expect(storeNote(hit({ value: { rows: [], totalCount: 0, note: '해당하는 데이터가 없습니다 (X)' } }), NOW)).toBeUndefined()
    expect(storeNote(hit({ value: { rows: [], totalCount: 0 }, expired: true }), NOW, 'quota')).toBeUndefined()
  })
})

describe('SnapshotReader', () => {
  it('상수는 스펙 §6.5와 같다', () => {
    expect(MAX_BYTES).toBe(96 * 1024 * 1024)
    expect(REVALIDATE_MS).toBe(600_000)
    expect(NEGATIVE_MS).toBe(300_000)
    expect(READ_TIMEOUT_MS).toBe(3_000)
  })

  it('스냅샷으로 답하고 10분 안의 같은 키는 다시 읽지 않는다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    const hit = await s.reader.lookup(PHARMACY, 1, 1000, [' ', '온누리'])
    expect(hit).toEqual({ value: { rows: [rows[0]], totalCount: 1 }, collectedAt: NOW - 3_600_000, expired: false })
    s.clock.t += REVALIDATE_MS - 1
    expect((await s.reader.lookup(PHARMACY, 1, 1000, []))!.value.totalCount).toBe(2)
    expect(s.gets).toEqual([{ key: 'TbPharmacyOperateInfo/_all.json.gz', ifNoneMatch: undefined }])
  })

  it('규칙이 없는 서비스와 답할 수 없는 요청은 저장소를 읽지 않는다', async () => {
    const s = setup()
    expect(await s.reader.lookup('citydata_ppltn', 1, 5, ['강남역'])).toBeUndefined()
    expect(await s.reader.lookup(STATS, 1, 1000, [])).toBeUndefined()
    expect(s.gets).toEqual([])
  })

  it('10분이 지나면 ETag 조건부 요청으로 바뀌었는지만 확인한다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, [])
    s.clock.t += REVALIDATE_MS
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.totalCount).toBe(2)
    expect(s.gets[1]).toEqual({ key: 'TbPharmacyOperateInfo/_all.json.gz', ifNoneMatch: '"v1"' })
    // 다시 수집하면 다음 재확인에서 새 내용이 나온다
    await s.seed(snap(PHARMACY, [], [rows[0]]))
    s.clock.t += REVALIDATE_MS
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.totalCount).toBe(1)
    expect(s.gets).toHaveLength(3)
  })

  it('없는 객체는 5분 동안 다시 읽지 않는다', async () => {
    const s = setup()
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    s.clock.t += NEGATIVE_MS - 1
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect(s.gets).toHaveLength(1)
    await s.seed(snap(PHARMACY, [], rows))
    s.clock.t += 1
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
    expect(s.gets).toHaveLength(2)
  })

  it('읽기 오류는 던지지 않고 5분 동안 기억하며 로그를 남긴다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    s.state.fail = Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' })
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect(s.gets).toHaveLength(1)
    expect(s.logs.some(l => l.includes('읽기 실패') && l.includes('AccessDenied'))).toBe(true)
    s.state.fail = undefined
    s.clock.t += NEGATIVE_MS
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
  })

  it('손상된 본문과 형식이 다른 스냅샷은 던지지 않고 답하지 않는다', async () => {
    const s = setup()
    await s.store.put('TbPharmacyOperateInfo/_all.json.gz', Buffer.from('not gzip'))
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    await s.store.put('CardSubwayStatsNew/20261116.json.gz', encodeSnapshot({ ...snap(STATS, ['20261116'], [{}]), v: 2 as 1 }))
    expect(await s.reader.lookup(STATS, 1, 10, ['20261116'])).toBeUndefined()
    expect(s.logs.filter(l => l.includes('읽기 실패'))).toHaveLength(2)
  })

  it('재확인 중 오류가 나면 가진 스냅샷으로 답하고 5분 뒤 다시 확인한다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, [])
    s.clock.t += REVALIDATE_MS
    s.state.fail = new Error('SlowDown')
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.totalCount).toBe(2)
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
    expect(s.gets).toHaveLength(2)
    s.clock.t += NEGATIVE_MS
    await s.reader.lookup(PHARMACY, 1, 10, [])
    expect(s.gets).toHaveLength(3)
  })

  it('재확인에서 객체가 사라졌으면 답하지 않는다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, [])
    s.objects.clear()
    s.clock.t += REVALIDATE_MS
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
  })

  it('같은 키의 동시 요청은 읽기 한 번으로 합친다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    s.state.delayMs = 10
    const hits = await Promise.all(Array.from({ length: 5 }, (_, i) => s.reader.lookup(PHARMACY, 1, 10, [' ', i % 2 ? '온누리' : '역삼'])))
    expect(hits.every(h => h?.value.totalCount === 1)).toBe(true)
    expect(s.gets).toHaveLength(1)
  })

  it('읽기가 시간 제한을 넘으면 그 요청은 넘기고, 읽기는 끝까지 해서 메모리에 둔다', async () => {
    const s = setup({ timeoutMs: 20 })
    await s.seed(snap(PHARMACY, [], rows))
    s.state.delayMs = 60
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect(s.logs.some(l => l.includes('초과'))).toBe(true)
    await new Promise(r => setTimeout(r, 80))
    s.state.delayMs = 0
    expect((await s.reader.lookup(PHARMACY, 1, 10, []))!.value.totalCount).toBe(2)
    expect(s.gets).toHaveLength(1)
  })

  it('메모리 상한을 넘으면 오래 안 쓴 스냅샷부터 버린다', async () => {
    const pad = 'x'.repeat(1000)
    const days = ['20261101', '20261102', '20261103']
    const one = Buffer.byteLength(JSON.stringify(snap(STATS, [days[0]], [{ USE_YMD: days[0], pad }])))
    const s = setup({ maxBytes: one * 2 + 10 })
    for (const d of days) await s.seed(snap(STATS, [d], [{ USE_YMD: d, pad }]))
    await s.reader.lookup(STATS, 1, 10, [days[0]])
    await s.reader.lookup(STATS, 1, 10, [days[1]])
    await s.reader.lookup(STATS, 1, 10, [days[0]]) // 0을 다시 써서 1이 가장 오래 안 쓴 것이 된다
    await s.reader.lookup(STATS, 1, 10, [days[2]]) // 상한 초과: 1을 버린다
    expect(s.gets).toHaveLength(3)
    await s.reader.lookup(STATS, 1, 10, [days[0]])
    await s.reader.lookup(STATS, 1, 10, [days[2]])
    expect(s.gets).toHaveLength(3) // 0과 2는 메모리에 있다
    await s.reader.lookup(STATS, 1, 10, [days[1]])
    expect(s.gets).toHaveLength(4) // 1은 다시 읽는다
  })

  it('상한보다 큰 스냅샷은 보관하지 않고 그 요청에만 쓴다', async () => {
    const s = setup({ maxBytes: 10 })
    await s.seed(snap(PHARMACY, [], rows))
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeDefined()
    expect(s.gets).toHaveLength(2)
  })

  it('기한이 지난 스냅샷은 allowExpired일 때만 답한다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows, { collectedAt: new Date(NOW - 8 * 86_400_000).toISOString() }))
    expect(await s.reader.lookup(PHARMACY, 1, 10, [])).toBeUndefined()
    expect((await s.reader.lookup(PHARMACY, 1, 10, [], { allowExpired: true }))!.expired).toBe(true)
  })

  it('읽을 때마다 키, 크기, 행 수, 시간, 힙을 한 줄로 남기고 요청 인자는 남기지 않는다', async () => {
    const s = setup()
    await s.seed(snap(PHARMACY, [], rows))
    await s.reader.lookup(PHARMACY, 1, 10, ['강남구', '온누리'])
    const line = s.logs.find(l => l.includes('읽음'))!
    expect(line).toMatch(/^\[store\] 읽음 TbPharmacyOperateInfo\/_all\.json\.gz: 압축 \d+B, 원본 \d+B, 2행, \d+ms, 힙 \d+MB$/)
    expect(s.logs.join('\n')).not.toContain('온누리')
    expect(s.logs.join('\n')).not.toContain('강남구')
  })
})
```

- [ ] **Step 8: 실패 확인**

Run: `npx vitest run tests/store/reader.test.ts`
Expected: FAIL, `src/client/snapshotSource.js`와 `src/store/reader.js`를 찾지 못한다는 오류

- [ ] **Step 9: `snapshotSource.ts` 구현**

`src/client/snapshotSource.ts` (새 파일):

```ts
/** 클라이언트가 아는 사전 적재 저장소의 모양. 구현은 src/store/reader.ts에 있고, 이 디렉터리는 src/store를 import하지 않는다 */
import type { Unwrapped } from './response.js'

export interface SnapshotHit {
  value: Unwrapped
  /** 스냅샷을 수집한 시각(ms) */
  collectedAt: number
  /** 기한이 지난 스냅샷으로 답했는지 */
  expired: boolean
}

export interface SnapshotSource {
  /** 답할 수 없으면 undefined. 던지지 않는다 */
  lookup(
    service: string, start: number, end: number, path: string[], opts?: { allowExpired?: boolean },
  ): Promise<SnapshotHit | undefined>
}

const kstMonthDay = (ms: number): string => {
  const d = new Date(ms + 9 * 3_600_000)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
}

/**
 * 저장소가 답한 응답에 붙이는 안내 (스펙 §6.4). tool 봉투의 asOf는 현재 시각이라, 이 문구가 없으면 며칠 전 데이터가 방금 받은 것처럼 보인다.
 * 0건이면 붙이지 않는다. 0건의 note는 서울 API와 같은 문구 하나여야 한다
 */
export function storeNote(hit: SnapshotHit, now: number, reason?: 'quota' | 'rate'): string | undefined {
  if (hit.value.rows.length === 0) return undefined
  const date = kstMonthDay(hit.collectedAt)
  if (!hit.expired) return `사전 적재 데이터(${date} 수집)`
  const days = Math.max(1, Math.round((now - hit.collectedAt) / 86_400_000))
  const why = reason === 'rate' ? '서울 API 호출 제한' : '일일 API 쿼터 소진'
  return `${why}. 기한이 지난 사전 적재 데이터(${date} 수집, 약 ${days}일 경과)로 응답합니다`
}
```

- [ ] **Step 10: `reader.ts` 구현**

`src/store/reader.ts` (새 파일):

```ts
/** 서버의 읽기 경로 (스펙 §6.5, §6.6). 어떤 실패도 요청을 실패시키지 않고 "답하지 않음"으로 끝난다 */
import type { SnapshotHit, SnapshotSource } from '../client/snapshotSource.js'
import { answerFrom, planRequest } from './engine.js'
import { decodeSnapshot, type Snapshot } from './snapshot.js'
import type { SnapshotStore } from './snapshotStore.js'

/** 메모리에 두는 스냅샷의 합계 상한. 압축을 푼 JSON 바이트 수로 센다 */
export const MAX_BYTES = 96 * 1024 * 1024
/** 한 번 읽은 스냅샷을 다시 확인하지 않고 쓰는 시간 */
export const REVALIDATE_MS = 600_000
/** 없는 객체와 읽기 오류를 기억하는 시간 */
export const NEGATIVE_MS = 300_000
/** 읽기가 이 시간을 넘으면 그 요청은 지금 경로로 넘긴다 */
export const READ_TIMEOUT_MS = 3_000

interface Held { snapshot: Snapshot; bytes: number; etag?: string; checkedAt: number }

export interface ReaderOptions {
  now?: () => number
  maxBytes?: number
  timeoutMs?: number
  log?: (line: string) => void
}

const TIMED_OUT = Symbol('timed-out')

export class SnapshotReader implements SnapshotSource {
  /** Map의 삽입 순서를 사용 순서로 쓴다. 맨 앞이 가장 오래 안 쓴 것 */
  private held = new Map<string, Held>()
  /** 키 → 다시 읽어도 되는 시각 */
  private missing = new Map<string, number>()
  private loading = new Map<string, Promise<Held | undefined>>()
  private total = 0
  private now: () => number
  private maxBytes: number
  private timeoutMs: number
  private log: (line: string) => void

  constructor(private store: SnapshotStore, opts: ReaderOptions = {}) {
    this.now = opts.now ?? Date.now
    this.maxBytes = opts.maxBytes ?? MAX_BYTES
    this.timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS
    this.log = opts.log ?? (line => console.error(line))
  }

  async lookup(
    service: string, start: number, end: number, path: string[], opts: { allowExpired?: boolean } = {},
  ): Promise<SnapshotHit | undefined> {
    try {
      const plan = planRequest(service, path)
      if (!plan) return undefined
      const held = await this.withTimeout(this.resolve(plan.key))
      if (held === TIMED_OUT) {
        this.log(`[store] 읽기 ${this.timeoutMs}ms 초과 ${plan.key} — 지금 경로로 넘김`)
        return undefined
      }
      if (!held) return undefined
      return answerFrom(held.snapshot, plan, start, end, this.now(), opts)
    } catch (e) {
      this.log(`[store] 조회 실패 — 지금 경로로 넘김: ${(e as Error).message}`)
      return undefined
    }
  }

  private withTimeout<T>(p: Promise<T>): Promise<T | typeof TIMED_OUT> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<typeof TIMED_OUT>(done => { timer = setTimeout(() => done(TIMED_OUT), this.timeoutMs) })
    // 시간 제한이 먼저 끝나도 p는 계속 진행해 끝나면 메모리에 둔다
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
  }

  private resolve(key: string): Promise<Held | undefined> {
    const now = this.now()
    const cur = this.held.get(key)
    if (cur && now - cur.checkedAt < REVALIDATE_MS) {
      this.touch(key, cur)
      return Promise.resolve(cur)
    }
    if (!cur) {
      const until = this.missing.get(key)
      if (until !== undefined && now < until) return Promise.resolve(undefined)
      this.missing.delete(key)
    }
    // 같은 키를 동시에 찾는 요청은 읽기 한 번을 함께 기다린다
    const running = this.loading.get(key)
    if (running) return running
    const p = this.load(key, cur).finally(() => this.loading.delete(key))
    this.loading.set(key, p)
    return p
  }

  private async load(key: string, cur: Held | undefined): Promise<Held | undefined> {
    const started = Date.now()
    try {
      const got = await this.store.get(key, cur?.etag ? { ifNoneMatch: cur.etag } : undefined)
      if (got === 'not-modified' && cur) {
        cur.checkedAt = this.now()
        this.touch(key, cur)
        return cur
      }
      if (got === undefined || got === 'not-modified') {
        this.drop(key)
        this.missing.set(key, this.now() + NEGATIVE_MS)
        return undefined
      }
      const { snapshot, bytes } = decodeSnapshot(got.body)
      const held: Held = { snapshot, bytes, etag: got.etag, checkedAt: this.now() }
      this.keep(key, held)
      // 요청 인자는 남기지 않는다. 키에 든 파티션 값은 형식 검사를 통과한 날짜, 호선, 역 코드뿐이다
      this.log(`[store] 읽음 ${key}: 압축 ${got.body.length}B, 원본 ${bytes}B, ${snapshot.rows.length}행, ${Date.now() - started}ms, 힙 ${Math.round(process.memoryUsage().heapUsed / 1_048_576)}MB`)
      return held
    } catch (e) {
      this.log(`[store] 읽기 실패 ${key}: ${(e as Error).message}`)
      if (cur) {
        // 가진 스냅샷으로 답하고 5분 뒤 다시 확인한다
        cur.checkedAt = this.now() - REVALIDATE_MS + NEGATIVE_MS
        return cur
      }
      this.missing.set(key, this.now() + NEGATIVE_MS)
      return undefined
    }
  }

  private touch(key: string, held: Held): void {
    this.held.delete(key)
    this.held.set(key, held)
  }

  private drop(key: string): void {
    const h = this.held.get(key)
    if (!h) return
    this.held.delete(key)
    this.total -= h.bytes
  }

  private keep(key: string, held: Held): void {
    this.drop(key)
    this.missing.delete(key)
    if (held.bytes > this.maxBytes) return // 상한보다 큰 스냅샷은 이번 요청에만 쓴다
    this.held.set(key, held)
    this.total += held.bytes
    while (this.total > this.maxBytes) this.drop(this.held.keys().next().value as string)
  }
}
```

- [ ] **Step 11: 통과 확인**

Run: `npx vitest run tests/store/reader.test.ts`
Expected: PASS (18 tests)

- [ ] **Step 12: 모듈 규칙 문서에 새 파일 추가**

`src/store/CLAUDE.md`의 `## Key Files` 목록 끝(`snapshot.ts` 줄 다음)에 아래 세 줄을 추가한다.

```markdown
- `snapshotStore.ts` - `SnapshotStore` 인터페이스(`get`, `put`, `list`)와 디렉터리 구현 `DirectoryStore`(테스트와 로컬 개발용).
- `s3Store.ts` - S3 구현 `S3Store`. `createS3Store()` 안에서만 `@aws-sdk/client-s3`를 lazy import합니다. 없는 객체(404)는 `undefined`, 그 밖의 오류는 던집니다.
- `reader.ts` - `SnapshotReader`. 메모리 보관(96MB, 오래 안 쓴 것부터 버림), 10분 뒤 ETag 재확인, 없는 객체와 오류 5분 기억, 동시 읽기 합치기, 3초 시간 제한.
```

- [ ] **Step 13: 전체 테스트와 빌드**

Run: `npm test && npm run build`
Expected: 모두 통과

- [ ] **Step 14: 커밋**

```bash
git add package.json package-lock.json src/store src/client/snapshotSource.ts tests/store
git commit -m "feat: add snapshot stores for a directory and S3, and the snapshot reader

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 3: 클라이언트 연결, 두 진입점, 동등성 테스트

**Files:**
- Modify: `src/client/seoulApi.ts:1-5`(import), `:64-99`(필드와 연결 메서드), `:171-204`(`fetchUnwrapped`), `src/index.ts:65-66`, `src/http.ts:10-11`, `tests/helpers/mcp.ts`, `src/store/CLAUDE.md`
- Create: `src/store/attach.ts`
- Test: `tests/seoulApi.test.ts`(끝에 추가), `tests/store/attach.test.ts`, `tests/store/parity.test.ts`

**Interfaces:**
- Consumes: `SnapshotSource`, `SnapshotHit`, `storeNote()` (`src/client/snapshotSource.ts`); `SnapshotReader` (`src/store/reader.ts`); `DirectoryStore`, `SnapshotStore` (`src/store/snapshotStore.ts`); `createS3Store()` (`src/store/s3Store.ts`)
- Produces:
  - `SeoulApiClient.attachStore(source: SnapshotSource): void`
  - `openStore(uri: string, region?: string): Promise<SnapshotStore>` (`src/store/attach.ts`)
  - `maybeAttachStore(client: SeoulApiClient): Promise<boolean>` (`src/store/attach.ts`)
  - `callTool(fetchFn, name, args, opts?: { ledger?: QuotaLedger; store?: SnapshotSource })` (`tests/helpers/mcp.ts`)

- [ ] **Step 1: 클라이언트 테스트 작성**

`tests/seoulApi.test.ts` (끝에 추가):

```ts
describe('SeoulApiClient 사전 적재 저장소', () => {
  const NOW = Date.parse('2026-11-21T03:00:00.000Z')
  const COLLECTED = Date.parse('2026-11-20T16:30:00.000Z') // KST 11월 21일 01:30
  const OLD = Date.parse('2026-11-18T01:00:00.000Z')
  const PHARMACY = 'TbPharmacyOperateInfo'
  type Opts = { allowExpired?: boolean } | undefined
  const hit = (rows: any[], over: object = {}) => ({ value: { rows, totalCount: rows.length }, collectedAt: COLLECTED, expired: false, ...over })
  const fakeStore = (answer: (service: string, opts: Opts) => unknown) => ({
    lookup: vi.fn(async (service: string, _start: number, _end: number, _path: string[], opts?: { allowExpired?: boolean }) => answer(service, opts) as any),
  })
  const xml337 = () => new Response('<RESULT><CODE>ERROR-337</CODE><MESSAGE>호출 제한</MESSAGE></RESULT>', { status: 200 })

  it('저장소가 답하면 업스트림과 쿼터 장부를 건드리지 않고 수집 날짜를 안내한다', async () => {
    const fetchFn = vi.fn()
    const ledger = new InMemoryLedger(10)
    const status = vi.spyOn(ledger, 'status')
    const increment = vi.spyOn(ledger, 'increment')
    const store = fakeStore(() => hit([{ a: 1 }]))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger, now: () => NOW })
    c.attachStore(store)
    const u = await c.getJson(PHARMACY, 1, 1000, ['강남구'])
    expect(u).toEqual({ rows: [{ a: 1 }], totalCount: 1, note: '사전 적재 데이터(11월 21일 수집)' })
    expect(store.lookup).toHaveBeenCalledWith(PHARMACY, 1, 1000, ['강남구'], { allowExpired: false })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
    expect(increment).not.toHaveBeenCalled()
  })

  it('저장소가 답하지 않으면 지금 경로로 가고 안내 문구를 붙이지 않는다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const store = fakeStore(() => undefined)
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    c.attachStore(store)
    const u = await c.getJson('bikeList', 1, 5)
    expect(u).toEqual({ rows: [{ a: 1 }], totalCount: 1, note: undefined })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(store.lookup).toHaveBeenCalledTimes(1)
  })

  it('0건 응답에는 서울 API와 같은 문구만 있다', async () => {
    const { isNoData } = await import('../src/client/response.js')
    const empty = { value: { rows: [], totalCount: 0, note: `해당하는 데이터가 없습니다 (${PHARMACY})` }, collectedAt: COLLECTED, expired: false }
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: vi.fn() as any, now: () => NOW })
    c.attachStore(fakeStore(() => empty))
    const u = await c.getJson(PHARMACY, 1, 1000, [' ', '없는약국'])
    expect(u).toEqual({ rows: [], totalCount: 0, note: `해당하는 데이터가 없습니다 (${PHARMACY})` })
    expect(isNoData(u)).toBe(true)
  })

  it('모든 키가 소진돼도 저장소에 있는 데이터는 답한다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const store = fakeStore(service => (service === PHARMACY ? hit([{ p: 1 }]) : undefined))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger: new InMemoryLedger(1), now: () => NOW })
    c.attachStore(store)
    await c.getJson('bikeList', 1, 5) // 1/1 소진
    const u = await c.getJson(PHARMACY, 1, 1000)
    expect(u.rows).toEqual([{ p: 1 }])
    expect(u.note).toBe('사전 적재 데이터(11월 21일 수집)')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('키가 소진되고 캐시도 없으면 기한 지난 스냅샷을 쿼터 소진 문구와 함께 돌려준다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const store = fakeStore((service, opts) =>
      service === PHARMACY && opts?.allowExpired ? hit([{ p: 1 }], { collectedAt: OLD, expired: true }) : undefined)
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger: new InMemoryLedger(1), now: () => NOW })
    c.attachStore(store)
    await c.getJson('bikeList', 1, 5) // 1/1 소진
    const u = await c.getJson(PHARMACY, 1, 1000)
    expect(u.rows).toEqual([{ p: 1 }])
    expect(u.note).toBe('일일 API 쿼터 소진. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다')
    expect(store.lookup.mock.calls.filter(a => a[0] === PHARMACY).map(a => a[4])).toEqual([{ allowExpired: false }, { allowExpired: true }])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    // 기한 지난 스냅샷도 없으면 지금처럼 빈 결과와 쿼터 안내가 나간다
    const miss = await c.getJson('GetParkInfo', 1, 5)
    expect(miss.rows).toEqual([])
    expect(miss.note).toContain('소진되어')
  })

  it('키가 모두 쿨다운 중이고 캐시도 없으면 호출 제한 문구를 쓴다', async () => {
    const fetchFn = vi.fn(async () => xml337())
    const store = fakeStore((service, opts) =>
      service === PHARMACY && opts?.allowExpired ? hit([{ p: 1 }], { collectedAt: OLD, expired: true }) : undefined)
    const c = new SeoulApiClient({ apiKey: 'K1,K2', fetchFn: fetchFn as any, now: () => NOW })
    c.attachStore(store)
    await expect(c.getJson('bikeList', 1, 5)).rejects.toMatchObject({ code: 'ERROR-337' })
    const u = await c.getJson(PHARMACY, 1, 1000)
    expect(u.note).toBe('서울 API 호출 제한. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다')
  })

  it('소진 상태에서 캐시가 있으면 기한 지난 스냅샷보다 캐시가 먼저다', async () => {
    let t = NOW
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const store = fakeStore((_service, opts) => (opts?.allowExpired ? hit([{ old: 1 }], { collectedAt: OLD, expired: true }) : undefined))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger: new InMemoryLedger(1), now: () => t })
    c.attachStore(store)
    await c.getJson('bikeList', 1, 5) // 캐시에 넣고 1/1 소진
    t += 300_001
    const u = await c.getJson('bikeList', 1, 5)
    expect(u.rows).toEqual([{ a: 1 }])
    expect(u.note).toContain('캐시된 데이터')
    expect(store.lookup.mock.calls.every(a => a[4]?.allowExpired === false)).toBe(true)
  })

  it('샘플 모드에서는 5행 범위로 저장소를 조회한다', async () => {
    const store = fakeStore(() => hit([{ a: 1 }]))
    const c = new SeoulApiClient({ apiKey: '', fetchFn: vi.fn() as any, now: () => NOW })
    c.attachStore(store)
    await c.getJson(PHARMACY, 1, 1000)
    expect(store.lookup).toHaveBeenCalledWith(PHARMACY, 1, 5, [], { allowExpired: false })
  })

  it('지하철 실시간과 XML 요청은 저장소를 조회하지 않는다', async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes('/xml/')
      ? new Response('<AccInfo><list_total_count>1</list_total_count><RESULT><CODE>INFO-000</CODE><MESSAGE>ok</MESSAGE></RESULT><row><a>1</a></row></AccInfo>', { status: 200 })
      : jsonResponse({ errorMessage: { status: 200, code: 'INFO-000', message: 'ok', total: 1 }, realtimeArrivalList: [{ a: 1 }] })))
    const store = fakeStore(() => hit([{ wrong: 1 }]))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    c.attachStore(store)
    expect((await c.getSubway('realtimeStationArrival', 0, 5, ['강남'])).rows).toEqual([{ a: 1 }])
    expect((await c.getXml('AccInfo', 1, 5)).rows).toEqual([{ a: 1 }])
    expect(store.lookup).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('저장소가 던져도 요청은 지금 경로로 계속된다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    c.attachStore({ lookup: async () => { throw new Error('boom') } })
    expect((await c.getJson('bikeList', 1, 5)).rows).toEqual([{ a: 1 }])
    expect(err.mock.calls.flat().join(' ')).toContain('[store]')
    err.mockRestore()
  })

  it('저장소가 답한 응답에는 쿼터 80% 안내를 붙이지 않는다', async () => {
    const ledger = new InMemoryLedger(10)
    for (let i = 0; i < 9; i++) await ledger.increment(keyIdOf('K'))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: vi.fn() as any, ledger, now: () => NOW })
    c.attachStore(fakeStore(() => hit([{ a: 1 }])))
    expect((await c.getJson(PHARMACY, 1, 10)).note).toBe('사전 적재 데이터(11월 21일 수집)')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/seoulApi.test.ts`
Expected: FAIL, 새 테스트 11개가 `c.attachStore is not a function`으로 실패하고 기존 테스트는 통과

- [ ] **Step 3: `SeoulApiClient`에 저장소 연결**

`src/client/seoulApi.ts`의 import 끝(`import { KeyPool, ... } from './keyPool.js'` 다음 줄)에 추가한다.

```ts
import { storeNote, type SnapshotHit, type SnapshotSource } from './snapshotSource.js'
```

클래스 필드 `private ledger: QuotaLedger` 다음 줄에 추가한다.

```ts
  private store: SnapshotSource | undefined
```

`attachL2()` 메서드 다음에 세 메서드를 추가한다.

```ts
  /** 사전 적재 저장소 연결용. 저장소가 답한 요청은 캐시, 키 풀, 쿼터 장부를 건드리지 않는다 */
  attachStore(source: SnapshotSource): void {
    this.store = source
  }

  /** 저장소 조회 실패는 요청을 실패시키지 않는다 */
  private async safeLookup(service: string, start: number, end: number, path: string[], allowExpired: boolean): Promise<SnapshotHit | undefined> {
    if (!this.store) return undefined
    try {
      return await this.store.lookup(service, start, end, path, { allowExpired })
    } catch (e) {
      console.error(`[store] 조회 실패 — 지금 경로로 넘김: ${(e as Error).message}`)
      return undefined
    }
  }

  /** 0건이면 저장소가 넣은 "데이터 없음" 문구만 남기고, 1건 이상이면 수집 날짜 안내를 붙인다 */
  private fromStore(hit: SnapshotHit, reason?: 'quota' | 'rate'): Unwrapped {
    const note = storeNote(hit, this.nowFn(), reason)
    return note ? withNote(hit.value, note) : hit.value
  }
```

`fetchUnwrapped`의 앞부분을 바꾼다.

바꾸기 전:

```ts
    const pool = base === SUBWAY_BASE ? this.subwayPool : this.pool
    // 샘플 키는 요청당 최대 5건 제한(ERROR-335) — 범위를 클램프해 맛보기 모드로 동작시킨다
    if (pool.isSample) end = Math.min(end, start + 4)
    // 캐시 키에는 원문 키 대신 자리 표시를 넣는다. 키가 바뀌어도 같은 요청은 같은 캐시 항목을 쓴다.
```

바꾼 뒤:

```ts
    const pool = base === SUBWAY_BASE ? this.subwayPool : this.pool
    // 샘플 키는 요청당 최대 5건 제한(ERROR-335) — 범위를 클램프해 맛보기 모드로 동작시킨다
    if (pool.isSample) end = Math.min(end, start + 4)
    // 사전 적재 저장소는 일반 API의 JSON 요청만 답한다. 캐시와 키 선택보다 앞이라, 모든 키가 소진돼도 저장소에 있는 데이터는 나간다
    const storable = base === OPEN_BASE && type === 'json'
    if (storable) {
      const hit = await this.safeLookup(service, start, end, path, false)
      if (hit) return this.fromStore(hit)
    }
    // 캐시 키에는 원문 키 대신 자리 표시를 넣는다. 키가 바뀌어도 같은 요청은 같은 캐시 항목을 쓴다.
```

같은 메서드의 소진 분기 첫머리를 바꾼다.

바꾸기 전:

```ts
    if (picked.exhausted) {
      if (picked.coolingUntil !== undefined) {
```

바꾼 뒤:

```ts
    if (picked.exhausted) {
      if (!cached && storable) {
        // 서울 API를 쓸 수 없고 캐시에도 없으면 기한이 지난 스냅샷으로라도 답한다. 캐시가 쿼터 소진 때 오래된 값을 주는 것과 같은 원칙
        const hit = await this.safeLookup(service, start, end, path, true)
        if (hit) return this.fromStore(hit, picked.coolingUntil !== undefined ? 'rate' : 'quota')
      }
      if (picked.coolingUntil !== undefined) {
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/seoulApi.test.ts`
Expected: PASS (기존 테스트와 새 테스트 11개)

- [ ] **Step 5: `maybeAttachStore` 테스트 작성**

`tests/store/attach.test.ts` (새 파일):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SeoulApiClient } from '../../src/client/seoulApi.js'
import { maybeAttachStore, openStore } from '../../src/store/attach.js'
import { S3Store } from '../../src/store/s3Store.js'
import { encodeSnapshot, snapshotKey } from '../../src/store/snapshot.js'
import { DirectoryStore } from '../../src/store/snapshotStore.js'

describe('maybeAttachStore', () => {
  const dirs: string[] = []
  afterEach(() => {
    delete process.env.STORE_URI
    vi.restoreAllMocks()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const newClient = (fetchFn = vi.fn()) => new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })

  it('STORE_URI가 없으면 아무것도 붙이지 않는다', async () => {
    delete process.env.STORE_URI
    const client = newClient()
    const attach = vi.spyOn(client, 'attachStore')
    expect(await maybeAttachStore(client)).toBe(false)
    expect(attach).not.toHaveBeenCalled()
  })

  it('디렉터리 경로면 그 디렉터리의 스냅샷으로 답한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = mkdtempSync(join(tmpdir(), 'seoul-attach-'))
    dirs.push(dir)
    await new DirectoryStore(dir).put(snapshotKey('TbPharmacyOperateInfo', []), encodeSnapshot({
      v: 1, service: 'TbPharmacyOperateInfo', partition: [], collectedAt: new Date().toISOString(), totalCount: 1, rows: [{ DUTYNAME: '약국' }],
    }))
    process.env.STORE_URI = dir
    const fetchFn = vi.fn()
    const client = newClient(fetchFn)
    expect(await maybeAttachStore(client)).toBe(true)
    const u = await client.getJson('TbPharmacyOperateInfo', 1, 10)
    expect(u.rows).toEqual([{ DUTYNAME: '약국' }])
    expect(u.note).toMatch(/^사전 적재 데이터\(\d+월 \d+일 수집\)$/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('잘못된 s3 주소면 로그만 남기고 저장소 없이 계속한다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.STORE_URI = 's3://'
    const client = newClient()
    const attach = vi.spyOn(client, 'attachStore')
    expect(await maybeAttachStore(client)).toBe(false)
    expect(attach).not.toHaveBeenCalled()
    expect(err.mock.calls.flat().join(' ')).toContain('저장소 연결 실패')
  })

  it('openStore는 s3 주소면 S3Store, 아니면 DirectoryStore를 연다', async () => {
    expect(await openStore('/tmp/seoul-store-example')).toBeInstanceOf(DirectoryStore)
    // SDK 클라이언트를 만드는 것만으로는 네트워크를 쓰지 않는다
    expect(await openStore('s3://example-bucket/store/v1', 'ap-northeast-2')).toBeInstanceOf(S3Store)
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run tests/store/attach.test.ts`
Expected: FAIL, `src/store/attach.js`를 찾지 못한다는 오류

- [ ] **Step 7: `attach.ts` 구현과 진입점 연결**

`src/store/attach.ts` (새 파일):

```ts
/** STORE_URI로 사전 적재 저장소를 켠다 (스펙 §6.1) */
import type { SeoulApiClient } from '../client/seoulApi.js'
import { SnapshotReader } from './reader.js'
import { createS3Store } from './s3Store.js'
import { DirectoryStore, type SnapshotStore } from './snapshotStore.js'

/** s3://로 시작하면 S3(SDK는 이때만 불러온다), 아니면 디렉터리 */
export async function openStore(uri: string, region?: string): Promise<SnapshotStore> {
  return uri.startsWith('s3://') ? createS3Store(uri, region) : new DirectoryStore(uri)
}

/** STORE_URI가 설정된 경우에만 저장소를 붙인다. 실패해도 서버는 저장소 없이 계속 동작한다 */
export async function maybeAttachStore(client: SeoulApiClient): Promise<boolean> {
  const uri = process.env.STORE_URI
  if (!uri) return false
  try {
    client.attachStore(new SnapshotReader(await openStore(uri)))
    console.error(`[store] 사전 적재 저장소 활성화: ${uri}`)
    return true
  } catch (e) {
    console.error(`[store] 저장소 연결 실패 — 저장소 없이 계속: ${(e as Error).message}`)
    return false
  }
}
```

`src/index.ts`에서 다음 두 줄을 찾는다.

```ts
  const { maybeAttachL2 } = await import('./client/dynamo.js')
  await maybeAttachL2(client)
```

바로 다음에 두 줄을 추가한다.

```ts
  const { maybeAttachStore } = await import('./store/attach.js')
  await maybeAttachStore(client)
```

`src/http.ts`에서 다음 두 줄을 찾는다.

```ts
const { maybeAttachL2 } = await import('./client/dynamo.js')
await maybeAttachL2(client)
```

바로 다음에 두 줄을 추가한다.

```ts
const { maybeAttachStore } = await import('./store/attach.js')
await maybeAttachStore(client)
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run tests/store/attach.test.ts tests/http.test.ts tests/cli.test.ts tests/smoke.test.ts`
Expected: PASS (attach 4개와 기존 진입점 테스트)

- [ ] **Step 9: 테스트 도우미에 `store` 옵션 추가**

`tests/helpers/mcp.ts`의 import에 한 줄을 추가한다(`import type { QuotaLedger } ...` 다음 줄).

```ts
import type { SnapshotSource } from '../../src/client/snapshotSource.js'
```

`callTool`을 바꾼다.

바꾸기 전:

```ts
export async function callTool(
  fetchFn: unknown, name: string, args: Record<string, unknown>, opts: { ledger?: QuotaLedger } = {},
) {
  const client = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as typeof fetch, retryDelayMs: 0, ledger: opts.ledger })
  const server = buildServer(client)
```

바꾼 뒤:

```ts
export async function callTool(
  fetchFn: unknown, name: string, args: Record<string, unknown>, opts: { ledger?: QuotaLedger; store?: SnapshotSource } = {},
) {
  const client = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as typeof fetch, retryDelayMs: 0, ledger: opts.ledger })
  if (opts.store) client.attachStore(opts.store)
  const server = buildServer(client)
```

- [ ] **Step 10: 동등성 테스트 작성**

같은 행을 서울 API 응답으로 줬을 때와 스냅샷으로 줬을 때 tool 출력이 안내 문구 말고는 같은지 본다. 가짜 업스트림은 규칙 엔진을 쓰지 않고 자리별 의미를 테스트 안에서 따로 흉내 낸다.

`tests/store/parity.test.ts` (새 파일):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unwrap } from '../../src/client/response.js'
import { SnapshotReader } from '../../src/store/reader.js'
import { encodeSnapshot, snapshotKey } from '../../src/store/snapshot.js'
import { DirectoryStore } from '../../src/store/snapshotStore.js'
import { callTool, rowsUpstream, type Call } from '../helpers/mcp.js'

const PHARMACY = 'TbPharmacyOperateInfo'
const SPORT = 'ListPublicReservationSport'
const STATION = 'SearchInfoBySubwayNameService'
const FIRST_LAST = 'SearchFirstAndLastTrainbyLineServiceNew'
const TIMETABLE = 'SearchSTNTimeTableByIDService'

const fixture = (svc: string, file: string) => unwrap(svc, JSON.parse(readFileSync(`tests/fixtures/${file}`, 'utf8'))).rows
const pharmacyRows = fixture(PHARMACY, 'pharmacy.json')
const sportRows = fixture(SPORT, 'reservation.json')
const stationRows = fixture(STATION, 'subway_station.json')
const firstLastRows = fixture(FIRST_LAST, 'subway_firstlast.json')
const timetableRows = fixture(TIMETABLE, 'subway_timetable.json')

// 강남(2호선, 역 코드 0222)의 자료를 픽스처 행으로 만든다. 하행 첫차와 막차는 일부러 비워 0건 경로도 지나게 한다
const gangnam = { ...stationRows[0], STATION_NM: '강남', STATION_CD: '0222', LINE_NUM: '02호선' }
const DATA: Array<{ service: string; partition: string[]; rows: any[] }> = [
  { service: PHARMACY, partition: [], rows: pharmacyRows },
  { service: SPORT, partition: [], rows: sportRows },
  { service: STATION, partition: [], rows: [...stationRows, gangnam] },
  { service: FIRST_LAST, partition: ['2호선', '1', '1'], rows: [...firstLastRows.filter((r: any) => r.SUBW_CD !== '0222'), { ...firstLastRows[0], SUBW_CD: '0222' }] },
  { service: FIRST_LAST, partition: ['2호선', '2', '1'], rows: firstLastRows.filter((r: any) => r.SUBW_CD !== '0222').map((r: any) => ({ ...r, UPLN_DNLN: '2' })) },
  { service: TIMETABLE, partition: ['0222', '1', '1'], rows: timetableRows },
  { service: TIMETABLE, partition: ['0222', '1', '2'], rows: timetableRows.map((r: any) => ({ ...r, INOUT_TAG: '2' })) },
]

// 서울 API의 자리별 동작을 손으로 적은 표. src/store/rules.ts를 쓰지 않는다
type Slot = ['partition'] | ['eq' | 'contains', string]
const SEMANTICS: Record<string, Slot[]> = {
  [PHARMACY]: [['contains', 'DUTYADDR'], ['contains', 'DUTYNAME']],
  [SPORT]: [['contains', 'MINCLASSNM']],
  [STATION]: [['eq', 'STATION_NM']],
  [FIRST_LAST]: [['partition'], ['partition'], ['partition'], ['eq', 'SUBW_CD'], ['eq', 'OTSD_CD']],
  [TIMETABLE]: [['partition'], ['partition'], ['partition']],
}

function upstream(c: Call): { rows: any[]; total: number } {
  const slots = SEMANTICS[c.svc]
  if (!slots) throw new Error(`동등성 테스트에 없는 서비스: ${c.svc}`)
  const values = c.path.map(v => v.trim())
  const partition = values.filter((_, i) => slots[i]?.[0] === 'partition').join('|')
  const data = DATA.find(d => d.service === c.svc && d.partition.join('|') === partition)?.rows ?? []
  const filtered = data.filter(row => slots.every((slot, i) => {
    const value = values[i] ?? ''
    if (slot[0] === 'partition' || value === '') return true
    const cell = String(row[slot[1]] ?? '').trim()
    return slot[0] === 'eq' ? cell === value : cell.includes(value)
  }))
  return { rows: filtered.slice(c.start - 1, c.end), total: filtered.length }
}

const STORE_NOTE = /^사전 적재 데이터\(\d+월 \d+일 수집\)$/

describe('저장소 응답과 서울 API 응답의 동등성', () => {
  let dir: string
  let reader: SnapshotReader

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'seoul-parity-'))
    const store = new DirectoryStore(dir)
    for (const d of DATA) {
      await store.put(snapshotKey(d.service, d.partition), encodeSnapshot({
        v: 1, service: d.service, partition: d.partition, collectedAt: new Date().toISOString(), totalCount: d.rows.length, rows: d.rows,
      }))
    }
    reader = new SnapshotReader(store, { log: () => {} })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  async function both(name: string, args: Record<string, unknown>) {
    const live = rowsUpstream(upstream)
    const liveBody = await callTool(live.fetchFn, name, args)
    const stored = rowsUpstream(upstream)
    const storeBody = await callTool(stored.fetchFn, name, args, { store: reader })
    expect(live.calls.length).toBeGreaterThan(0)
    expect(stored.calls).toEqual([]) // 저장소가 모든 요청에 답했다
    expect(storeBody.data).toEqual(liveBody.data)
    expect(storeBody.source).toBe(liveBody.source)
    expect(storeBody.notes.filter((n: string) => !STORE_NOTE.test(n))).toEqual(liveBody.notes)
    return { liveBody, storeBody }
  }

  it('find_pharmacies: 인자 없음, 자치구, 약국명', async () => {
    const all = await both('find_pharmacies', {})
    expect(all.storeBody.data.count).toBe(pharmacyRows.length)
    expect(all.storeBody.notes.some((n: string) => STORE_NOTE.test(n))).toBe(true)
    const district = String(pharmacyRows[0].DUTYADDR).split(' ')[1] // 픽스처 첫 행의 자치구
    const byDistrict = await both('find_pharmacies', { district })
    expect(byDistrict.storeBody.data.count).toBeGreaterThan(0)
    const byName = await both('find_pharmacies', { name: String(pharmacyRows[0].DUTYNAME).slice(0, 3) })
    expect(byName.storeBody.data.count).toBeGreaterThan(0)
  })

  it('find_pharmacies: 조건에 맞는 약국이 없으면 양쪽 모두 같은 "데이터 없음" 안내만 있다', async () => {
    const none = await both('find_pharmacies', { name: '세상에없는약국이름' })
    expect(none.storeBody.data.count).toBe(0)
    expect(none.storeBody.notes).toEqual(none.liveBody.notes)
    expect(none.storeBody.notes.join(' ')).toContain('해당하는 데이터가 없습니다 (TbPharmacyOperateInfo)')
  })

  it('search_public_reservations: 분야 전체와 소분류', async () => {
    const all = await both('search_public_reservations', { category: 'sports', limit: 50 })
    expect(all.storeBody.data.count).toBe(sportRows.length)
    const sub = await both('search_public_reservations', { category: 'sports', subcategory: String(sportRows[0].MINCLASSNM) })
    expect(sub.storeBody.data.count).toBeGreaterThan(0)
  })

  it('get_subway_schedule: 역 찾기, 첫차와 막차, 시간표', async () => {
    const r = await both('get_subway_schedule', { station: '강남', day: 'weekday', includeTimetable: true, after: '05:00', limit: 3 })
    const line = r.storeBody.data.lines[0]
    expect(line.line).toBe('2호선')
    expect(line.stationCode).toBe('0222')
    expect(line.directions[0].first).not.toBeNull()
    expect(line.directions[1].first).toBeNull() // 하행은 0건: "데이터 없음"으로 읽혀 안내가 붙지 않는다
    expect(line.directions[0].timetable.length).toBeGreaterThan(0)
    expect(r.storeBody.notes.some((n: string) => STORE_NOTE.test(n))).toBe(true)
  })
})
```

- [ ] **Step 11: 통과 확인**

Run: `npx vitest run tests/store/parity.test.ts`
Expected: PASS (4 tests). Task 1~3의 구현이 끝난 상태라 이 테스트는 처음부터 통과한다. 실패하면 저장소 경로와 서울 API 경로의 출력이 갈린 것이므로 구현을 고친다

- [ ] **Step 12: 모듈 규칙 문서에 `attach.ts` 추가**

`src/store/CLAUDE.md`의 `## Key Files` 목록 끝에 한 줄을 추가한다.

```markdown
- `attach.ts` - `openStore()`(주소가 `s3://`면 S3, 아니면 디렉터리)와 `maybeAttachStore()`(`STORE_URI`가 있을 때만 `SeoulApiClient.attachStore()` 호출, 실패해도 서버는 계속 동작).
```

- [ ] **Step 13: 전체 테스트와 빌드**

Run: `npm test && npm run build`
Expected: 모두 통과

- [ ] **Step 14: 커밋**

```bash
git add src/client/seoulApi.ts src/store src/index.ts src/http.ts tests/seoulApi.test.ts tests/store tests/helpers/mcp.ts
git commit -m "feat: answer from the snapshot store before the cache and the key pool

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 4: 수집기와 `workshop:collect`의 `daily`, `static`, `status`

**Files:**
- Modify: `src/client/dynamo.ts:65-86`(`createDocClient` 분리), `scripts/workshop-lib.ts`(`parseCollectDays`), `package.json`(`workshop:collect` 스크립트), `src/store/CLAUDE.md`
- Create: `src/store/collector.ts`, `scripts/workshop-collect.ts`
- Test: `tests/store/collector.test.ts`, `tests/dynamo.test.ts`(끝에 추가), `tests/workshopLib.test.ts`(끝에 추가)

**Interfaces:**
- Consumes: `STORE_RULES`, `StoreRule` (`src/store/rules.ts`); `snapshotKey()`, `encodeSnapshot()`, `decodeSnapshot()`, `ALL`, `STORE_PREFIX` (`src/store/snapshot.ts`); `SnapshotStore`, `ListedObject` (`src/store/snapshotStore.ts`); `openStore()` (`src/store/attach.ts`); `isNoData()`, `SeoulApiError`, `Unwrapped` (`src/client/response.ts`); `maskKey()`, `parseKeys()` (`src/client/keyPool.ts`); `keyIdOf()`, `QuotaLedger`, `InMemoryLedger`, `parseQuotaLimit()` (`src/client/quota.ts`); `DynamoDbLedger`, `DocClientLike` (`src/client/dynamo.ts`); `REGION`, `STACK` (`scripts/workshop-lib.ts`); `describeStack()`, `stackOutputs()`, `stackParameterValue()` (`scripts/workshop-aws.ts`)
- Produces:
  - `createDocClient(region?: string): Promise<DocClientLike>` (`src/client/dynamo.ts`)
  - `parseCollectDays(raw: string | undefined): number | undefined` (`scripts/workshop-lib.ts`)
  - `PAGE = 1000`, `CALL_DELAY_MS = 200`, `DAILY_SKIP_MS = 3_600_000`, `STATIC_SKIP_MS = 604_800_000`, `DATE_EXTRA = 10`, `MONTH_EXTRA = 2`, `STATION_ESTIMATE = 300`
  - `interface CollectClient { isSample: boolean; getJson(service: string, start: number, end: number, path?: string[]): Promise<Unwrapped> }`
  - `recentDates(now: number, n: number): string[]`, `recentMonths(now: number, n: number): string[]`
  - `indexExisting(objects: ListedObject[]): Map<string, Map<string, number>>`
  - `stationCodes(store: SnapshotStore): Promise<string[] | undefined>`
  - `interface DatasetPlan { service: string; rule: StoreRule; mode: 'fixed' | 'scan'; partitions: string[][]; stored: Set<string>; count: number; skipped: number; estimated: number; needsStations?: boolean }`
  - `planCollection(store: SnapshotStore, opts: { bundle: 'daily' | 'static'; only?: string[]; days?: number; now: number }): Promise<DatasetPlan[]>`
  - `interface DatasetResult { service: string; saved: number; skipped: number; empty: number; calls: number; warnings: string[]; error?: string }`
  - `interface CollectReport { bundle: 'daily' | 'static'; estimated: number; remaining?: number; started: boolean; reason?: string; plans: DatasetPlan[]; results: DatasetResult[]; calls: number; aborted?: string; ok: boolean }`
  - `interface CollectOptions { bundle: 'daily' | 'static'; only?: string[]; days?: number; force?: boolean; dryRun?: boolean; remaining?: number; now?: () => number; delayMs?: number; log?: (line: string) => void }`
  - `collect(client: CollectClient, store: SnapshotStore, opts: CollectOptions): Promise<CollectReport>`
  - `interface KeyQuota { key: string; used: number; limit: number }`, `remainingQuota(keys: readonly string[], ledger: QuotaLedger): Promise<{ keys: KeyQuota[]; remaining: number }>`
  - `interface DatasetStatus { service: string; bundle: 'daily' | 'static'; count: number; newest?: number; oldest?: number; state: '없음' | '기한 내' | '기한 초과' | '기한 없음' }`, `statusOf(store: SnapshotStore, now: number): Promise<DatasetStatus[]>`
  - `formatQuota(q)`, `formatPlan(report)`, `formatReport(report)`, `formatStatus(list)`: 모두 `string`을 돌려준다

- [ ] **Step 1: 수집기 테스트 작성**

`tests/store/collector.test.ts` (새 파일):

```ts
import { describe, it, expect } from 'vitest'
import { SeoulApiError, type Unwrapped } from '../../src/client/response.js'
import { InMemoryLedger, keyIdOf } from '../../src/client/quota.js'
import {
  CALL_DELAY_MS, DAILY_SKIP_MS, PAGE, STATIC_SKIP_MS, collect, formatPlan, formatQuota, formatReport, formatStatus,
  indexExisting, planCollection, recentDates, recentMonths, remainingQuota, stationCodes, statusOf, type CollectClient,
} from '../../src/store/collector.js'
import { decodeSnapshot, encodeSnapshot, isHead, snapshotKey, type Snapshot } from '../../src/store/snapshot.js'
import type { SnapshotStore } from '../../src/store/snapshotStore.js'

const NOW = Date.parse('2026-11-21T03:00:00.000Z') // KST 11월 21일 12:00
const HOUR = 3_600_000
const DAY = 86_400_000
const PHARMACY = 'TbPharmacyOperateInfo'
const STATS = 'CardSubwayStatsNew'
const STATION = 'SearchInfoBySubwayNameService'
const FIRST_LAST = 'SearchFirstAndLastTrainbyLineServiceNew'
const TIMETABLE = 'SearchSTNTimeTableByIDService'

type Req = { service: string; start: number; end: number; path: string[] }

function fakeClient(handler: (r: Req) => Unwrapped) {
  const calls: Req[] = []
  const client: CollectClient = {
    isSample: false,
    async getJson(service, start, end, path = []) {
      const r = { service, start, end, path }
      calls.push(r)
      return handler(r)
    },
  }
  return { client, calls }
}

/** 전체 total행 가운데 요청 범위의 행. 범위를 벗어나면 서울 API처럼 "데이터 없음" */
const page = (r: Req, total: number): Unwrapped => {
  const rows = []
  for (let i = r.start; i <= Math.min(r.end, total); i++) rows.push({ i })
  return rows.length > 0 ? { rows, totalCount: total } : noData(r.service)
}
const noData = (service: string): Unwrapped => ({ rows: [], totalCount: 0, note: `해당하는 데이터가 없습니다 (${service})` })

function memoryStore() {
  const objects = new Map<string, { body: Buffer; lastModified: number }>()
  const clock = { t: NOW }
  const store: SnapshotStore = {
    async get(key) { const o = objects.get(key); return o ? { body: o.body, etag: 'e' } : undefined },
    async put(key, body) { objects.set(key, { body, lastModified: clock.t }) },
    async list(prefix) {
      return [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, lastModified: o.lastModified, size: o.body.length }))
    },
  }
  const seed = (service: string, partition: string[], rows: any[], at = NOW, totalCount = rows.length) => {
    const s: Snapshot = { v: 1, service, partition, collectedAt: new Date(at).toISOString(), totalCount, rows }
    objects.set(snapshotKey(service, partition), { body: encodeSnapshot(s), lastModified: at })
  }
  const read = (service: string, partition: string[]) => decodeSnapshot(objects.get(snapshotKey(service, partition))!.body).snapshot
  return { store, objects, clock, seed, read }
}

const run = (client: CollectClient, store: SnapshotStore, opts: Partial<Parameters<typeof collect>[2]> = {}) =>
  collect(client, store, { bundle: 'daily', now: () => NOW, delayMs: 0, ...opts })

describe('날짜와 월 후보', () => {
  it('어제(KST)부터 거꾸로 n일', () => {
    expect(recentDates(NOW, 3)).toEqual(['20261120', '20261119', '20261118'])
    expect(recentDates(Date.parse('2026-11-20T15:30:00.000Z'), 2)).toEqual(['20261120', '20261119']) // KST 21일 00:30
    expect(recentDates(Date.parse('2026-03-01T03:00:00.000Z'), 2)).toEqual(['20260228', '20260227'])
  })
  it('지난달부터 거꾸로 n개월', () => {
    expect(recentMonths(NOW, 3)).toEqual(['202610', '202609', '202608'])
    expect(recentMonths(Date.parse('2026-01-15T03:00:00.000Z'), 2)).toEqual(['202512', '202511'])
  })
})

describe('indexExisting', () => {
  it('서비스별로 파티션 키와 수정 시각을 묶고 형식이 다른 키는 버린다', () => {
    const idx = indexExisting([
      { key: 'A/_all.json.gz', lastModified: 1, size: 1 },
      { key: 'B/20261116.json.gz', lastModified: 2, size: 1 },
      { key: 'B/20261117.json.gz', lastModified: 3, size: 1 },
      { key: 'stray.txt', lastModified: 4, size: 1 },
    ])
    expect([...idx.keys()]).toEqual(['A', 'B'])
    expect(idx.get('B')!.get('20261117')).toBe(3)
    expect(idx.get('A')!.get('_all')).toBe(1)
  })
})

describe('planCollection', () => {
  it('빈 저장소의 매일 묶음은 35종, 예상 144회다', async () => {
    const { store } = memoryStore()
    const plans = await planCollection(store, { bundle: 'daily', now: NOW })
    expect(plans).toHaveLength(35)
    // 전체 42 + 머리 19 + 일별 승하차 14+10 + 버스 1+10 + 시간대별 3+2 + 생활인구 3x11+10
    expect(plans.reduce((n, p) => n + p.estimated, 0)).toBe(144)
    expect(plans.find(p => p.service === STATS)).toMatchObject({ mode: 'scan', count: 14 })
    expect(plans.find(p => p.service === STATS)!.partitions).toHaveLength(24)
    expect(plans.find(p => p.service === 'CardSubwayTime')!.partitions).toEqual([['202610'], ['202609'], ['202608'], ['202607'], ['202606']])
  })

  it('정적 묶음은 첫차와 막차 54개와 시간표다. 역 코드 스냅샷이 없으면 300개 역으로 어림한다', async () => {
    const { store } = memoryStore()
    const plans = await planCollection(store, { bundle: 'static', now: NOW })
    expect(plans.map(p => p.service)).toEqual([FIRST_LAST, TIMETABLE])
    expect(plans[0].partitions).toHaveLength(54)
    expect(plans[0].partitions[0]).toEqual(['1호선', '1', '1'])
    expect(plans[0].estimated).toBe(54)
    expect(plans[1]).toMatchObject({ needsStations: true, estimated: 1801 })
  })

  it('--days는 날짜 파티션 세 종의 개수만 바꾼다', async () => {
    const { store } = memoryStore()
    const plans = await planCollection(store, { bundle: 'daily', now: NOW, days: 2 })
    const count = (id: string) => plans.find(p => p.service === id)!.count
    expect([count(STATS), count('SPOP_LOCAL_RESD_DONG'), count('CardBusStatisticsServiceNew')]).toEqual([2, 2, 2])
    expect(count('CardSubwayTime')).toBe(3)
  })

  it('--only는 그 서비스만 남기고, 규칙 표에 없는 이름은 거부한다', async () => {
    const { store } = memoryStore()
    expect((await planCollection(store, { bundle: 'daily', now: NOW, only: [PHARMACY, 'GetParkInfo'] })).map(p => p.service)).toEqual([PHARMACY, 'GetParkInfo'])
    expect(await planCollection(store, { bundle: 'daily', now: NOW, only: [TIMETABLE] })).toEqual([]) // 다른 묶음
    await expect(planCollection(store, { bundle: 'daily', now: NOW, only: ['citydata'] })).rejects.toThrow('규칙 표에 없는 서비스: citydata')
  })
})

describe('collect', () => {
  it('전체 스냅샷은 1,000행씩 끝 페이지까지 받아 한 번에 쓴다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => page(r, 2500))
    const report = await run(client, m.store, { only: [PHARMACY] })
    expect(calls.map(c => [c.start, c.end])).toEqual([[1, 1000], [1001, 2000], [2001, 3000]])
    expect(calls.every(c => c.path.length === 0)).toBe(true)
    const s = m.read(PHARMACY, [])
    expect(s.rows).toHaveLength(2500)
    expect(s.rows[2499]).toEqual({ i: 2500 })
    expect(s.totalCount).toBe(2500)
    expect(s.collectedAt).toBe(new Date(NOW).toISOString())
    expect(report).toMatchObject({ started: true, ok: true, calls: 3 })
    expect(report.results).toEqual([{ service: PHARMACY, saved: 1, skipped: 0, empty: 0, calls: 3, warnings: [] }])
  })

  it('머리 스냅샷은 첫 1,000행과 전체 건수만 받는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => page(r, 814_076))
    await run(client, m.store, { only: ['ListNecessariesPricesService'] })
    expect(calls).toHaveLength(1)
    const s = m.read('ListNecessariesPricesService', [])
    expect(s.rows).toHaveLength(PAGE)
    expect(s.totalCount).toBe(814_076)
    expect(isHead(s)).toBe(true)
  })

  it('매일 묶음의 스냅샷은 수집한 지 1시간 이내면 건너뛴다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], [{ old: 1 }], NOW - DAILY_SKIP_MS + 1)
    m.seed('GetParkInfo', [], [{ old: 1 }], NOW - DAILY_SKIP_MS)
    const { client, calls } = fakeClient(r => page(r, 3))
    const report = await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] })
    expect(calls.map(c => c.service)).toEqual(['GetParkInfo'])
    expect(m.read(PHARMACY, []).rows).toEqual([{ old: 1 }])
    expect(report.results[0]).toMatchObject({ service: PHARMACY, saved: 0, skipped: 1, calls: 0 })
  })

  it('날짜 파티션은 어제부터 거꾸로 가며 없는 날짜만 받고, 공개 전 날짜는 저장하지 않는다', async () => {
    const m = memoryStore()
    m.seed(STATS, ['20261116'], [{ USE_YMD: '20261116' }], NOW - 5 * DAY)
    const { client, calls } = fakeClient(r => (r.path[0] <= '20261117' ? page(r, 616) : noData(r.service)))
    const report = await run(client, m.store, { only: [STATS], days: 3 })
    // 20, 19, 18일은 공개 전. 17일을 받고, 16일은 이미 있고, 15일을 받으면 3개가 찬다
    expect(calls.map(c => c.path[0])).toEqual(['20261120', '20261119', '20261118', '20261117', '20261115'])
    expect([...m.objects.keys()].sort()).toEqual(['20261115', '20261116', '20261117'].map(d => `${STATS}/${d}.json.gz`))
    expect(m.read(STATS, ['20261117'])).toMatchObject({ partition: ['20261117'], totalCount: 616 })
    expect(report.results[0]).toMatchObject({ saved: 2, skipped: 1, empty: 3, calls: 5 })
    expect(report.ok).toBe(true)
  })

  it('공개된 날짜가 없으면 개수에 10일을 더한 만큼만 거슬러 올라가고 실패로 보지 않는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => noData(r.service))
    const report = await run(client, m.store, { only: [STATS], days: 3 })
    expect(calls).toHaveLength(13)
    expect(m.objects.size).toBe(0)
    expect(report).toMatchObject({ ok: true })
    expect(report.results[0]).toMatchObject({ saved: 0, empty: 13 })
  })

  it('정적 묶음의 스냅샷은 수집한 지 7일 이내면 건너뛴다', async () => {
    const m = memoryStore()
    m.seed(FIRST_LAST, ['1호선', '1', '1'], [{ a: 1 }], NOW - STATIC_SKIP_MS + 1)
    m.seed(FIRST_LAST, ['1호선', '1', '2'], [{ a: 1 }], NOW - STATIC_SKIP_MS)
    const { client, calls } = fakeClient(r => page(r, 51))
    const report = await run(client, m.store, { bundle: 'static', only: [FIRST_LAST] })
    expect(calls).toHaveLength(53)
    expect(calls.some(c => c.path.join('_') === '1호선_1_1')).toBe(false)
    expect(calls[0].path).toEqual(['1호선', '1', '2'])
    expect(report.results[0]).toMatchObject({ saved: 53, skipped: 1 })
  })

  it('시간표는 역 코드 스냅샷의 1~9호선 역마다 요일 3종, 방향 2종을 받는다', async () => {
    const m = memoryStore()
    m.seed(STATION, [], [
      { STATION_CD: '0222', LINE_NUM: '02호선' }, { STATION_CD: '0150', LINE_NUM: '01호선' },
      { STATION_CD: '1251', LINE_NUM: '경의선' }, { STATION_CD: '0222', LINE_NUM: '02호선' }, { STATION_CD: '../x', LINE_NUM: '03호선' },
    ])
    // 형식에 맞지 않는 코드는 파티션을 만들 때 걸러진다
    expect(await stationCodes(m.store)).toEqual(['../x', '0150', '0222'])
    const { client, calls } = fakeClient(r => page(r, 239))
    const report = await run(client, m.store, { bundle: 'static', only: [TIMETABLE] })
    expect(calls).toHaveLength(12)
    expect(calls.map(c => c.path.join('_')).slice(0, 7)).toEqual(['0150_1_1', '0150_1_2', '0150_2_1', '0150_2_2', '0150_3_1', '0150_3_2', '0222_1_1'])
    expect(m.objects.has(`${TIMETABLE}/0222_3_2.json.gz`)).toBe(true)
    expect(report.results[0]).toMatchObject({ saved: 12 })
  })

  it('역 코드 스냅샷이 없으면 먼저 받은 뒤 시간표를 받는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => (r.service === STATION
      ? { rows: [{ STATION_CD: '0222', LINE_NUM: '02호선' }], totalCount: 1 }
      : page(r, 10)))
    const report = await run(client, m.store, { bundle: 'static', only: [TIMETABLE] })
    expect(calls[0]).toMatchObject({ service: STATION, path: [] })
    expect(calls).toHaveLength(7)
    expect(m.objects.has(`${STATION}/_all.json.gz`)).toBe(true)
    expect(report.results[0].warnings.join(' ')).toContain('역 코드 스냅샷')
  })

  it('한 데이터셋이 SeoulApiError로 실패하면 이전 스냅샷을 그대로 두고 다음 데이터셋으로 넘어간다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], [{ old: 1 }], NOW - 2 * HOUR)
    const before = m.objects.get(`${PHARMACY}/_all.json.gz`)!.body
    const { client } = fakeClient(r => {
      if (r.service === PHARMACY && r.start > 1) throw new SeoulApiError('TIMEOUT', '응답 시간 초과(15초) (key=ABCD…(masked))')
      return page(r, 2500)
    })
    const report = await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] })
    expect(m.objects.get(`${PHARMACY}/_all.json.gz`)!.body).toBe(before)
    expect(m.read('GetParkInfo', []).rows).toHaveLength(2500)
    expect(report.ok).toBe(false)
    expect(report.aborted).toBeUndefined()
    expect(report.results[0]).toMatchObject({ service: PHARMACY, saved: 0, calls: 2 })
    expect(report.results[0].error).toContain('응답 시간 초과')
    expect(report.results[1]).toMatchObject({ service: 'GetParkInfo', saved: 1 })
  })

  it('쿼터 소진이나 호출 제한 응답을 받으면 실패로 처리하고 실행을 끝낸다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(() => ({ rows: [], totalCount: 0, note: '일일 API 쿼터(3000회)가 소진되어 새 데이터를 가져올 수 없습니다. 내일 자정(KST) 이후 재시도하세요.' }))
    const report = await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] })
    expect(calls).toHaveLength(1)
    expect(report.ok).toBe(false)
    expect(report.aborted).toContain('소진되어')
    expect(report.results).toHaveLength(1)
    expect(m.objects.size).toBe(0)
  })

  it('받은 행이 전체 건수보다 적으면 경고를 내고 그대로 저장한다(머리 스냅샷이 된다)', async () => {
    const m = memoryStore()
    const { client } = fakeClient(r => (r.start === 1 ? { rows: Array.from({ length: 1000 }, (_, i) => ({ i })), totalCount: 2500 } : noData(r.service)))
    const report = await run(client, m.store, { only: [PHARMACY] })
    expect(isHead(m.read(PHARMACY, []))).toBe(true)
    expect(report.results[0].warnings[0]).toContain('2500행 중 1000행')
    expect(report.ok).toBe(true)
  })

  it('예상 호출 수가 남은 한도를 넘으면 --force 없이는 시작하지 않는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => page(r, 3))
    const blocked = await run(client, m.store, { only: [PHARMACY], remaining: 5 })
    expect(blocked).toMatchObject({ started: false, ok: false, estimated: 6 })
    expect(blocked.reason).toContain('--force')
    expect(calls).toHaveLength(0)
    const forced = await run(client, m.store, { only: [PHARMACY], remaining: 5, force: true })
    expect(forced).toMatchObject({ started: true, ok: true })
    expect(calls).toHaveLength(1)
  })

  it('--dry-run은 계획만 만들고 서울 API를 부르지 않는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => page(r, 3))
    const report = await run(client, m.store, { dryRun: true })
    expect(report).toMatchObject({ started: false, ok: true, estimated: 144 })
    expect(calls).toHaveLength(0)
    expect(m.objects.size).toBe(0)
    expect(formatPlan(report)).toContain('예상 호출 합계(상한): 144회')
  })

  it('샘플 키로는 수집하지 않는다', async () => {
    const m = memoryStore()
    const { client } = fakeClient(r => page(r, 3))
    await expect(collect({ ...client, isSample: true }, m.store, { bundle: 'daily' })).rejects.toThrow('샘플 키')
  })

  it('호출 사이 간격의 기본값은 200ms다', () => {
    expect(CALL_DELAY_MS).toBe(200)
  })
})

describe('쿼터와 출력', () => {
  it('남은 한도를 키별로 세고 키는 마스킹해서만 보여 준다', async () => {
    const ledger = new InMemoryLedger(1000)
    for (let i = 0; i < 3; i++) await ledger.increment(keyIdOf('RAWKEYONE1234'))
    const q = await remainingQuota(['RAWKEYONE1234', 'RAWKEYTWO5678'], ledger)
    expect(q.remaining).toBe(1997)
    expect(q.keys).toEqual([{ key: 'RAWK…(masked)', used: 3, limit: 1000 }, { key: 'RAWK…(masked)', used: 0, limit: 1000 }])
    const text = formatQuota(q)
    expect(text).toContain('남은 한도 합계: 1997회')
    expect(text).not.toContain('RAWKEYONE1234')
    expect(text).not.toContain('RAWKEYTWO5678')
  })

  it('결과 표에 데이터셋별 저장, 건너뜀, 실패, 경고와 실제 호출 수가 있다', async () => {
    const m = memoryStore()
    const { client } = fakeClient(r => {
      if (r.service === 'GetParkInfo') throw new SeoulApiError('HTTP-500', 'HTTP 500 (key=ABCD…(masked))')
      return page(r, 3)
    })
    const text = formatReport(await run(client, m.store, { only: [PHARMACY, 'GetParkInfo'] }))
    expect(text).toContain(`${PHARMACY}: 저장 1, 건너뜀 0, 데이터 없음 0, 호출 1`)
    expect(text).toContain('GetParkInfo: 저장 0, 건너뜀 0, 데이터 없음 0, 호출 1, 실패: HTTP 500')
    expect(text).toContain('실제 호출 합계: 2회')
  })

  it('status는 데이터셋별 스냅샷 수, 수집 시각, 기한 내 여부를 보여 준다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], [{}], NOW - 2 * DAY)
    m.seed('ListPublicReservationSport', [], [{}], NOW - 2 * DAY)
    m.seed(STATS, ['20261116'], [{}], NOW - 100 * DAY)
    m.seed(STATS, ['20261117'], [{}], NOW - DAY)
    m.seed(FIRST_LAST, ['1호선', '1', '1'], [{}], NOW - 31 * DAY)
    m.seed(FIRST_LAST, ['1호선', '1', '2'], [{}], NOW - DAY)
    const list = await statusOf(m.store, NOW)
    expect(list).toHaveLength(37)
    const of = (id: string) => list.find(s => s.service === id)!
    expect(of(PHARMACY)).toMatchObject({ count: 1, state: '기한 내', newest: NOW - 2 * DAY })
    expect(of('ListPublicReservationSport')).toMatchObject({ count: 1, state: '기한 초과' })
    expect(of(STATS)).toMatchObject({ count: 2, state: '기한 없음', oldest: NOW - 100 * DAY, newest: NOW - DAY })
    expect(of(FIRST_LAST)).toMatchObject({ count: 2, state: '기한 초과' })
    expect(of('GetParkInfo')).toMatchObject({ count: 0, state: '없음' })
    const text = formatStatus(list)
    expect(text).toContain(`${PHARMACY}: 1개, 최근 11-19 12:00, 기한 내`)
    expect(text).toContain('GetParkInfo: 없음')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/store/collector.test.ts`
Expected: FAIL, `src/store/collector.js`를 찾지 못한다는 오류

- [ ] **Step 3: `collector.ts` 구현**

`src/store/collector.ts` (새 파일):

```ts
/** 수집기 (스펙 §5). 서버의 읽기 경로와 같은 규칙 표, 같은 키 규칙, 같은 SnapshotStore를 쓴다 */
import { maskKey } from '../client/keyPool.js'
import { keyIdOf, type QuotaLedger } from '../client/quota.js'
import { isNoData, SeoulApiError, type Unwrapped } from '../client/response.js'
import { STORE_RULES, type StoreRule } from './rules.js'
import { ALL, decodeSnapshot, encodeSnapshot, snapshotKey, type Snapshot } from './snapshot.js'
import type { ListedObject, SnapshotStore } from './snapshotStore.js'

export const PAGE = 1000
/** 서울 API 호출 사이의 간격 */
export const CALL_DELAY_MS = 200
/** 매일 묶음: 이 시간 안에 받은 스냅샷은 건너뛴다. 도중에 끊긴 실행을 이어 받기 위한 값 */
export const DAILY_SKIP_MS = 3_600_000
/** 정적 묶음: 이 시간 안에 받은 스냅샷은 건너뛴다 */
export const STATIC_SKIP_MS = 7 * 86_400_000
/** 날짜 탐색 범위는 개수 + 10일, 월 탐색 범위는 개수 + 2개월 */
export const DATE_EXTRA = 10
export const MONTH_EXTRA = 2
/** 역 코드 스냅샷이 아직 없을 때 시간표 예상에 쓰는 역 수 */
export const STATION_ESTIMATE = 300

const STATION_SERVICE = 'SearchInfoBySubwayNameService'
const NUMBERED_LINE = /^0?[1-9]호선$/
const LINES = ['1호선', '2호선', '3호선', '4호선', '5호선', '6호선', '7호선', '8호선', '9호선']
const DIRECTIONS = ['1', '2']
const DAY_TYPES = ['1', '2', '3']

/** SeoulApiClient에서 수집기가 쓰는 부분 */
export interface CollectClient {
  isSample: boolean
  getJson(service: string, start: number, end: number, path?: string[]): Promise<Unwrapped>
}

const KST = 9 * 3_600_000
const cross = (...lists: string[][]): string[][] =>
  lists.reduce<string[][]>((acc, list) => acc.flatMap(a => list.map(v => [...a, v])), [[]])
const partitionKey = (partition: string[]): string => (partition.length > 0 ? partition.join('_') : ALL)

/** 어제(KST)부터 거꾸로 n일, YYYYMMDD */
export function recentDates(now: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now + KST - (i + 1) * 86_400_000).toISOString().slice(0, 10).replace(/-/g, ''))
}

/** 지난달(KST)부터 거꾸로 n개월, YYYYMM */
export function recentMonths(now: number, n: number): string[] {
  const d = new Date(now + KST)
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1 - i, 1))
    return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

/** 저장소 목록을 서비스 → (파티션 키 → 수정 시각)으로 묶는다 */
export function indexExisting(objects: ListedObject[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const o of objects) {
    const m = /^([^/]+)\/([^/]+)\.json\.gz$/.exec(o.key)
    if (!m) continue
    if (!out.has(m[1])) out.set(m[1], new Map())
    out.get(m[1])!.set(m[2], o.lastModified)
  }
  return out
}

/** 파티션 값이 규칙의 형식에 맞는지. 맞지 않는 값으로 만든 스냅샷은 서버가 찾지 않는다 */
function isValidPartition(rule: StoreRule, partition: string[]): boolean {
  const slots = rule.slots.filter(s => s.kind === 'partition')
  return slots.length === partition.length && slots.every((s, i) => s.kind === 'partition' && s.pattern.test(partition[i]))
}

/** 역 코드 스냅샷에서 1~9호선 역 코드를 읽는다. 스냅샷이 없으면 undefined */
export async function stationCodes(store: SnapshotStore): Promise<string[] | undefined> {
  const got = await store.get(snapshotKey(STATION_SERVICE, []))
  if (!got || got === 'not-modified') return undefined
  const { snapshot } = decodeSnapshot(got.body)
  const codes = snapshot.rows
    .filter(r => NUMBERED_LINE.test(String(r?.LINE_NUM ?? '').trim()))
    .map(r => String(r?.STATION_CD ?? '').trim())
  return [...new Set(codes)].sort()
}

export interface DatasetPlan {
  service: string
  rule: StoreRule
  /** fixed: 받을 파티션이 정해져 있다. scan: 새것부터 차례로 시도해 공개된 것을 count개 채운다 */
  mode: 'fixed' | 'scan'
  /** fixed면 받을 파티션, scan이면 후보(새것부터) */
  partitions: string[][]
  /** scan 후보 가운데 이미 저장된 것 */
  stored: Set<string>
  /** scan의 목표 개수. fixed면 0 */
  count: number
  /** fixed에서 최근에 받아 건너뛰는 수 */
  skipped: number
  /** 예상 호출 수(상한) */
  estimated: number
  /** 시간표: 역 코드 스냅샷이 없어 실행 때 먼저 받는다 */
  needsStations?: boolean
}

export interface PlanOptions { bundle: 'daily' | 'static'; only?: string[]; days?: number; now: number }

async function planDataset(
  service: string, rule: StoreRule, have: Map<string, number>, store: SnapshotStore, opts: PlanOptions,
): Promise<DatasetPlan> {
  const base = { service, rule, stored: new Set<string>(), count: 0, skipped: 0 }
  const p = rule.partitions
  if (p?.kind === 'date' || p?.kind === 'month') {
    const count = p.kind === 'date' ? (opts.days ?? p.count) : p.count
    const extra = p.kind === 'date' ? DATE_EXTRA : MONTH_EXTRA
    const candidates = p.kind === 'date' ? recentDates(opts.now, count + extra) : recentMonths(opts.now, count + extra)
    const stored = new Set(candidates.filter(c => have.has(c)))
    // 새로 공개된 것 하나는 늘 받는다고 보고, 공개 전 날짜를 확인하는 호출을 extra만큼 더한다
    const estimated = Math.max(1, count - stored.size) * rule.callsPerSnapshot + extra
    return { ...base, mode: 'scan', partitions: candidates.map(c => [c]), stored, count, estimated }
  }
  const skipMs = rule.bundle === 'static' ? STATIC_SKIP_MS : DAILY_SKIP_MS
  const isFresh = (partition: string[]): boolean => {
    const at = have.get(partitionKey(partition))
    return at !== undefined && opts.now - at < skipMs
  }
  let all: string[][] = [[]]
  let needsStations = false
  if (p?.kind === 'lineDirDay') all = cross(LINES, DIRECTIONS, DAY_TYPES)
  if (p?.kind === 'stationDayDir') {
    const codes = await stationCodes(store)
    needsStations = codes === undefined
    all = cross(codes ?? [], DAY_TYPES, DIRECTIONS)
  }
  all = all.filter(x => isValidPartition(rule, x))
  const partitions = all.filter(x => !isFresh(x))
  if (needsStations) return { ...base, mode: 'fixed', partitions, estimated: 1 + STATION_ESTIMATE * 6, needsStations }
  return { ...base, mode: 'fixed', partitions, skipped: all.length - partitions.length, estimated: partitions.length * rule.callsPerSnapshot }
}

/** 저장소만 읽어 수집 계획을 만든다. 서울 API를 부르지 않는다 */
export async function planCollection(store: SnapshotStore, opts: PlanOptions): Promise<DatasetPlan[]> {
  const unknown = (opts.only ?? []).filter(s => !Object.hasOwn(STORE_RULES, s))
  if (unknown.length > 0) throw new Error(`규칙 표에 없는 서비스: ${unknown.join(', ')}`)
  const existing = indexExisting(await store.list(''))
  const plans: DatasetPlan[] = []
  for (const [service, rule] of Object.entries(STORE_RULES)) {
    if (rule.bundle !== opts.bundle) continue
    if (opts.only && !opts.only.includes(service)) continue
    plans.push(await planDataset(service, rule, existing.get(service) ?? new Map(), store, opts))
  }
  return plans
}

export interface DatasetResult {
  service: string
  saved: number
  skipped: number
  /** 서울 API가 "데이터 없음"으로 답해 저장하지 않은 수(공개 전 날짜 등) */
  empty: number
  calls: number
  warnings: string[]
  error?: string
}

export interface CollectReport {
  bundle: 'daily' | 'static'
  estimated: number
  remaining?: number
  /** 실제 수집을 시작했는지. dry-run이거나 예산을 넘으면 false */
  started: boolean
  reason?: string
  plans: DatasetPlan[]
  results: DatasetResult[]
  calls: number
  /** 키 풀이나 저장소를 쓸 수 없어 실행을 끝낸 이유 */
  aborted?: string
  ok: boolean
}

export interface CollectOptions {
  bundle: 'daily' | 'static'
  only?: string[]
  days?: number
  force?: boolean
  dryRun?: boolean
  /** 키 풀의 남은 한도 합계. 주지 않으면 예산 검사를 하지 않는다 */
  remaining?: number
  now?: () => number
  delayMs?: number
  log?: (line: string) => void
}

/** 쿼터 소진이나 호출 제한으로 키 풀 전체를 쓸 수 없는 상태 */
class PoolUnavailable extends Error {}

const resultLine = (r: DatasetResult): string =>
  `${r.service}: 저장 ${r.saved}, 건너뜀 ${r.skipped}, 데이터 없음 ${r.empty}, 호출 ${r.calls}${r.error ? `, 실패: ${r.error}` : ''}`

export async function collect(client: CollectClient, store: SnapshotStore, opts: CollectOptions): Promise<CollectReport> {
  if (client.isSample) throw new Error('샘플 키로는 수집할 수 없습니다. SEOUL_API_KEY를 설정하세요')
  const now = opts.now ?? Date.now
  const delayMs = opts.delayMs ?? CALL_DELAY_MS
  const log = opts.log ?? (() => {})
  const plans = await planCollection(store, { bundle: opts.bundle, only: opts.only, days: opts.days, now: now() })
  const estimated = plans.reduce((n, p) => n + p.estimated, 0)
  const report: CollectReport = { bundle: opts.bundle, estimated, remaining: opts.remaining, started: false, plans, results: [], calls: 0, ok: true }
  if (opts.dryRun) return { ...report, reason: '계획만 출력했습니다(--dry-run)' }
  if (opts.remaining !== undefined && estimated > opts.remaining && !opts.force) {
    return { ...report, ok: false, reason: `예상 호출 ${estimated}회가 남은 한도 ${opts.remaining}회를 넘어 시작하지 않았습니다. --force를 붙이면 그래도 시작합니다` }
  }
  report.started = true

  let first = true
  const pace = async (): Promise<void> => {
    if (!first && delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
    first = false
  }

  /** 스냅샷 하나를 받아 저장한다. "데이터 없음"이면 저장하지 않고 false */
  const fetchAndSave = async (service: string, partition: string[], rule: StoreRule, result: DatasetResult): Promise<boolean> => {
    const rows: any[] = []
    let totalCount = 0
    for (let start = 1; ; start += PAGE) {
      await pace()
      result.calls++
      const u = await client.getJson(service, start, start + PAGE - 1, partition)
      if (u.rows.length === 0) {
        // 빈 응답인데 "데이터 없음"이 아니면 쿼터 소진이나 호출 제한이다. 남은 데이터셋도 같은 결과가 나온다
        if (!isNoData(u)) throw new PoolUnavailable(u.note ?? '서울 API가 이유 없이 빈 응답을 돌려줬습니다')
        break
      }
      rows.push(...u.rows)
      totalCount = u.totalCount
      if (rule.scope === 'head' || rows.length >= totalCount) break
    }
    if (rows.length === 0) {
      result.empty++ // 공개 전 날짜. 저장하지 않아 다음 실행이 다시 시도한다
      return false
    }
    if (rule.scope === 'full' && rows.length < totalCount) {
      result.warnings.push(`${snapshotKey(service, partition)}: 전체 ${totalCount}행 중 ${rows.length}행만 받았습니다. 머리 스냅샷으로 취급되어 필터 요청은 서울 API로 갑니다`)
    }
    const snapshot: Snapshot = { v: 1, service, partition, collectedAt: new Date(now()).toISOString(), totalCount, rows }
    // 모든 페이지를 받은 뒤에만 쓴다. 중간에 실패하면 이전 스냅샷이 그대로 남는다
    await store.put(snapshotKey(service, partition), encodeSnapshot(snapshot))
    result.saved++
    return true
  }

  const runPlan = async (plan: DatasetPlan, result: DatasetResult): Promise<void> => {
    let partitions = plan.partitions
    if (plan.needsStations) {
      result.warnings.push('역 코드 스냅샷이 없어 먼저 받았습니다')
      await fetchAndSave(STATION_SERVICE, [], STORE_RULES[STATION_SERVICE], result)
      partitions = cross((await stationCodes(store)) ?? [], DAY_TYPES, DIRECTIONS).filter(x => isValidPartition(plan.rule, x))
    }
    if (plan.mode === 'fixed') {
      for (const partition of partitions) await fetchAndSave(plan.service, partition, plan.rule, result)
      return
    }
    let published = 0
    for (const partition of partitions) {
      if (plan.stored.has(partition[0])) {
        result.skipped++
        published++
      } else if (await fetchAndSave(plan.service, partition, plan.rule, result)) {
        published++
      }
      if (published >= plan.count) break
    }
  }

  for (const plan of plans) {
    const result: DatasetResult = { service: plan.service, saved: 0, skipped: plan.skipped, empty: 0, calls: 0, warnings: [] }
    report.results.push(result)
    try {
      await runPlan(plan, result)
    } catch (e) {
      result.error = (e as Error).message
      report.ok = false
      // 서울 API 오류(시간 초과, 서버 오류)는 그 데이터셋만 실패다. 그 밖의 오류는 남은 호출을 낭비하지 않도록 실행을 끝낸다
      if (!(e instanceof SeoulApiError)) {
        report.aborted = result.error
        log(resultLine(result))
        break
      }
    }
    log(resultLine(result))
  }
  report.calls = report.results.reduce((n, r) => n + r.calls, 0)
  return report
}

export interface KeyQuota { key: string; used: number; limit: number }

/** 키별 사용량과 남은 한도 합계. key는 maskKey() 결과만 담는다 */
export async function remainingQuota(keys: readonly string[], ledger: QuotaLedger): Promise<{ keys: KeyQuota[]; remaining: number }> {
  const statuses = await Promise.all(keys.map(k => ledger.status(keyIdOf(k))))
  const list = keys.map((k, i) => ({ key: maskKey(k), used: statuses[i].used, limit: statuses[i].limit }))
  return { keys: list, remaining: list.reduce((n, k) => n + Math.max(0, k.limit - k.used), 0) }
}

export function formatQuota(q: { keys: KeyQuota[]; remaining: number }): string {
  return [...q.keys.map(k => `키 ${k.key}: ${k.used}/${k.limit}`), `남은 한도 합계: ${q.remaining}회`].join('\n')
}

function planLine(p: DatasetPlan): string {
  if (p.needsStations) return `${p.service}: 역 코드 스냅샷이 없어 먼저 받음, 예상 ${p.estimated}회`
  if (p.mode === 'scan') return `${p.service}: 최근 ${p.count}개 목표, 후보 ${p.partitions.length}개 중 저장됨 ${p.stored.size}개, 예상 ${p.estimated}회`
  return `${p.service}: 받을 스냅샷 ${p.partitions.length}개, 건너뜀 ${p.skipped}개, 예상 ${p.estimated}회`
}

export function formatPlan(report: CollectReport): string {
  return [
    `[${report.bundle}] 수집 계획`,
    ...report.plans.map(p => `  ${planLine(p)}`),
    `예상 호출 합계(상한): ${report.estimated}회`,
    ...(report.remaining !== undefined ? [`남은 한도 합계: ${report.remaining}회`] : []),
    ...(report.reason ? [report.reason] : []),
  ].join('\n')
}

export function formatReport(report: CollectReport): string {
  return [
    `[${report.bundle}] 수집 결과`,
    ...report.results.flatMap(r => [`  ${resultLine(r)}`, ...r.warnings.map(w => `    경고: ${w}`)]),
    `실제 호출 합계: ${report.calls}회 (예상 상한 ${report.estimated}회)`,
    ...(report.aborted ? [`중단: ${report.aborted}`] : []),
  ].join('\n')
}

export interface DatasetStatus {
  service: string
  bundle: 'daily' | 'static'
  count: number
  newest?: number
  oldest?: number
  state: '없음' | '기한 내' | '기한 초과' | '기한 없음'
}

/** 데이터셋별 스냅샷 수와 수정 시각. 기한은 가장 오래된 스냅샷으로 판단한다 */
export async function statusOf(store: SnapshotStore, now: number): Promise<DatasetStatus[]> {
  const existing = indexExisting(await store.list(''))
  return Object.entries(STORE_RULES).map(([service, rule]): DatasetStatus => {
    const times = [...(existing.get(service)?.values() ?? [])]
    if (times.length === 0) return { service, bundle: rule.bundle, count: 0, state: '없음' }
    const newest = Math.max(...times)
    const oldest = Math.min(...times)
    const state = rule.maxAgeMs === null ? '기한 없음' : now - oldest > rule.maxAgeMs ? '기한 초과' : '기한 내'
    return { service, bundle: rule.bundle, count: times.length, newest, oldest, state }
  })
}

const kstStamp = (ms: number): string => new Date(ms + KST).toISOString().slice(5, 16).replace('T', ' ')

export function formatStatus(list: DatasetStatus[]): string {
  return list.map(s => {
    if (s.count === 0 || s.newest === undefined || s.oldest === undefined) return `${s.service}: 없음`
    const oldest = s.count > 1 ? `, 가장 오래된 것 ${kstStamp(s.oldest)}` : ''
    return `${s.service}: ${s.count}개, 최근 ${kstStamp(s.newest)}${oldest}, ${s.state}`
  }).join('\n')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/store/collector.test.ts`
Expected: PASS (25 tests)

- [ ] **Step 5: DynamoDB 연결 분리 테스트 작성**

수집기는 캐시 없이 쿼터 장부만 붙인다. 그래서 문서 클라이언트를 만드는 부분을 함수로 떼어 낸다.

`tests/dynamo.test.ts` (끝에 추가):

```ts
describe('createDocClient', () => {
  it('get, put, update를 가진 문서 클라이언트를 만든다(네트워크 호출 없음)', async () => {
    const { createDocClient } = await import('../src/client/dynamo.js')
    const doc = await createDocClient('ap-northeast-2')
    expect(typeof doc.get).toBe('function')
    expect(typeof doc.put).toBe('function')
    expect(typeof doc.update).toBe('function')
  })
})
```

`tests/workshopLib.test.ts` (끝에 추가):

```ts
describe('parseCollectDays', () => {
  it('없으면 undefined, 1~60 정수만 받는다', async () => {
    const { parseCollectDays } = await import('../scripts/workshop-lib.js')
    expect(parseCollectDays(undefined)).toBeUndefined()
    expect(parseCollectDays('1')).toBe(1)
    expect(parseCollectDays('60')).toBe(60)
    for (const bad of ['0', '61', '1.5', 'two', '']) expect(() => parseCollectDays(bad)).toThrow('--days')
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run tests/dynamo.test.ts tests/workshopLib.test.ts`
Expected: FAIL, `createDocClient is not a function`, `parseCollectDays is not a function`

- [ ] **Step 7: `createDocClient`와 `parseCollectDays` 구현**

`src/client/dynamo.ts`의 `maybeAttachL2` 전체(주석 포함)를 아래로 바꾼다.

```ts
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
```

`scripts/workshop-lib.ts`의 `parseDays` 함수 다음에 추가한다.

```ts
/** workshop:collect의 --days. 날짜 파티션을 며칠 치 받을지 정한다 */
export function parseCollectDays(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(n) || n < 1 || n > 60) throw new Error(`--days는 1~60 사이 정수여야 합니다: ${raw}`)
  return n
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run tests/dynamo.test.ts tests/workshopLib.test.ts`
Expected: PASS

- [ ] **Step 9: 명령줄 스크립트 작성**

main 흐름은 단위 테스트가 없으므로 얇게 둔다. 판단은 모두 `src/store/collector.ts`에 있다.

`scripts/workshop-collect.ts` (새 파일):

```ts
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
import { REGION, STACK, parseCollectDays } from './workshop-lib.js'
import { describeStack, stackOutputs, stackParameterValue } from './workshop-aws.js'

const USAGE = `사용법:
  npm run workshop:collect -- daily     매일 묶음: 전체와 머리 스냅샷, 새 날짜와 월 파티션
  npm run workshop:collect -- static    첫차와 막차, 시간표(약 1,850회, 워크숍 당일이 아닌 날)
  npm run workshop:collect -- status    데이터셋별 스냅샷 수, 수집 시각, 기한 내 여부
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
  if (values.help || (command !== 'daily' && command !== 'static' && command !== 'status')) {
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
```

`package.json`의 `scripts`에서 `"workshop:code": "tsx scripts/workshop-code.ts"` 줄을 아래 두 줄로 바꾼다.

```json
    "workshop:code": "tsx scripts/workshop-code.ts",
    "workshop:collect": "tsx scripts/workshop-collect.ts"
```

- [ ] **Step 10: 스크립트 동작 확인(AWS와 서울 API를 부르지 않는 경로)**

Run: `npm run workshop:collect -- --help`
Expected: 사용법이 출력되고 종료 코드 0

Run: `npm run workshop:collect -- daily --days 0`
Expected: `--days는 1~60 사이 정수여야 합니다: 0`, 종료 코드 1

Run: `npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck scripts/workshop-collect.ts`
Expected: 오류 없음

- [ ] **Step 11: 모듈 규칙 문서에 `collector.ts` 추가**

`src/store/CLAUDE.md`의 `## Key Files` 목록 끝에 한 줄을, `## Rules` 목록 끝에 두 줄을 추가한다.

```markdown
- `collector.ts` - 수집 계획(`planCollection`), 실행(`collect`), 증분 건너뛰기, 예산 검사, 상태(`statusOf`), 출력 문자열. `scripts/workshop-collect.ts`와 수집 Lambda가 함께 씁니다.
```

```markdown
- 수집기는 `client.getJson()`만 씁니다. 빈 응답이 `isNoData()`가 아니면 쿼터 소진이나 호출 제한이므로 실행을 끝냅니다. 스냅샷은 모든 페이지를 받은 뒤에만 씁니다.
- 수집기의 출력과 로그에 원문 키를 넣지 않습니다. 키는 `maskKey()`로만 보여 줍니다.
```

- [ ] **Step 12: 전체 테스트와 빌드**

Run: `npm test && npm run build`
Expected: 모두 통과

- [ ] **Step 13: 커밋**

```bash
git add src/client/dynamo.ts src/store scripts/workshop-collect.ts scripts/workshop-lib.ts package.json tests/store/collector.test.ts tests/dynamo.test.ts tests/workshopLib.test.ts
git commit -m "feat: add the snapshot collector and the workshop:collect command

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 5: 실제 API 대비 검사 `verify`

이 태스크는 코드와 단위 테스트만 만든다. 실제 API로 돌리는 일은 Task 9에서 사용자 승인 뒤에 한다.

**Files:**
- Create: `src/store/verify.ts`
- Modify: `scripts/workshop-collect.ts`(`verify` 명령), `src/store/CLAUDE.md`
- Test: `tests/store/verify.test.ts`

**Interfaces:**
- Consumes: `CATALOG` (`src/data/catalog.ts`); `CollectClient`, `indexExisting()`, `PAGE`, `CALL_DELAY_MS` (`src/store/collector.ts`); `planRequest()`, `answerFrom()` (`src/store/engine.ts`); `STORE_RULES`, `StoreRule`, `SlotRule` (`src/store/rules.ts`); `ALL`, `decodeSnapshot()`, `snapshotKey()`, `Snapshot` (`src/store/snapshot.ts`); `isNoData()`, `Unwrapped` (`src/client/response.ts`)
- Produces:
  - `interface VerifyCase { service: string; path: string[]; label: string; assume?: { slot: number; field: string; kind: 'eq' | 'contains' } }`
  - `casesFor(service: string, rule: StoreRule, partition: string[]): VerifyCase[]`
  - `interface CaseResult { service: string; label: string; path: string[]; status: 'ok' | 'order' | 'fail' | 'skip'; detail: string; assume?: VerifyCase['assume'] }`
  - `interface Decision { service: string; field: string; verdict: '일치' | '부분일치' | '둘 다 맞음' | '재현 못 함' }`
  - `interface VerifyReport { results: CaseResult[]; decisions: Decision[]; calls: number; aborted?: string; ok: boolean }`
  - `runVerify(client: CollectClient, store: SnapshotStore, opts?: { only?: string[]; now?: () => number; delayMs?: number }): Promise<VerifyReport>`
  - `formatVerify(report: VerifyReport): string`

- [ ] **Step 1: 테스트 작성**

`tests/store/verify.test.ts` (새 파일):

```ts
import { describe, it, expect } from 'vitest'
import type { Unwrapped } from '../../src/client/response.js'
import type { CollectClient } from '../../src/store/collector.js'
import { STORE_RULES } from '../../src/store/rules.js'
import { encodeSnapshot, snapshotKey, type Snapshot } from '../../src/store/snapshot.js'
import type { SnapshotStore } from '../../src/store/snapshotStore.js'
import { casesFor, formatVerify, runVerify } from '../../src/store/verify.js'

const NOW = Date.parse('2026-11-21T03:00:00.000Z')
const PHARMACY = 'TbPharmacyOperateInfo'
const SENIOR = 'OdsnBuildingInfo'
const B = ' '

function memoryStore() {
  const objects = new Map<string, Buffer>()
  const store: SnapshotStore = {
    async get(key) { const body = objects.get(key); return body ? { body } : undefined },
    async put(key, body) { objects.set(key, body) },
    async list(prefix) { return [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key, lastModified: NOW, size: 1 })) },
  }
  const seed = (service: string, partition: string[], rows: any[], totalCount = rows.length) => {
    const s: Snapshot = { v: 1, service, partition, collectedAt: new Date(NOW).toISOString(), totalCount, rows }
    objects.set(snapshotKey(service, partition), encodeSnapshot(s))
  }
  return { store, seed }
}

type Req = { service: string; path: string[] }
function fakeClient(handler: (r: Req) => Unwrapped) {
  const calls: Req[] = []
  const client: CollectClient = {
    isSample: false,
    async getJson(service, _start, _end, path = []) { calls.push({ service, path }); return handler({ service, path }) },
  }
  return { client, calls }
}
const noData = (service: string): Unwrapped => ({ rows: [], totalCount: 0, note: `해당하는 데이터가 없습니다 (${service})` })
const answer = (service: string, rows: any[]): Unwrapped => (rows.length > 0 ? { rows, totalCount: rows.length } : noData(service))

const pharmacies = [
  { DUTYNAME: '강남온누리약국', DUTYADDR: '서울특별시 강남구 테헤란로 1' },
  { DUTYNAME: '역삼약국', DUTYADDR: '서울특별시 강남구 역삼로 2' },
  { DUTYNAME: '서초온누리약국', DUTYADDR: '서울특별시 서초구 서초대로 3' },
]
/** 약국 서비스의 실제 동작(두 자리 모두 부분일치)을 흉내 낸다 */
const livePharmacy = (r: Req): Unwrapped => {
  const [addr = '', name = ''] = r.path.map(v => v.trim())
  return answer(r.service, pharmacies.filter(p => p.DUTYADDR.includes(addr) && p.DUTYNAME.includes(name)))
}

describe('casesFor', () => {
  it('인자 없음, 자리 하나씩, 지원 자리 전부를 카탈로그 예시 값으로 만든다', () => {
    expect(casesFor(PHARMACY, STORE_RULES[PHARMACY], []).map(c => [c.label, c.path])).toEqual([
      ['인자 없음', []],
      ['DUTYADDR만', ['강남구']],
      ['DUTYNAME만', [B, '온누리']],
      ['지원 자리 전부', ['강남구', '온누리']],
    ])
  })

  it('검증으로 결정할 자리는 두 가정으로 만들고, 그냥 미지원인 자리는 만들지 않는다', () => {
    const cases = casesFor('culturalEventInfo', STORE_RULES.culturalEventInfo, [])
    expect(cases.map(c => [c.label, c.path, c.assume?.kind])).toEqual([
      ['인자 없음', [], undefined],
      ['TITLE만', [B, '서울'], undefined],
      ['CODENAME 가정: 일치(전체 값)', ['콘서트'], 'eq'],
      ['CODENAME 가정: 부분일치(전체 값)', ['콘서트'], 'contains'],
      ['CODENAME 가정: 일치(앞부분)', ['콘서'], 'eq'],
      ['CODENAME 가정: 부분일치(앞부분)', ['콘서'], 'contains'],
    ])
    expect(cases[2].assume).toEqual({ slot: 0, field: 'CODENAME', kind: 'eq' })
  })

  it('파티션 자리에는 저장된 파티션 값을 넣는다', () => {
    expect(casesFor('CardSubwayTime', STORE_RULES.CardSubwayTime, ['202609']).map(c => c.path)).toEqual([
      ['202609'], ['202609', '2호선'], ['202609', B, '강남'], ['202609', '2호선', '강남'],
    ])
    expect(casesFor('CardBusStatisticsServiceNew', STORE_RULES.CardBusStatisticsServiceNew, ['20261116']).map(c => c.path)).toEqual([['20261116']])
  })
})

describe('runVerify', () => {
  it('저장소와 서울 API의 전체 건수와 행이 같으면 통과한다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], pharmacies)
    const { client, calls } = fakeClient(livePharmacy)
    const report = await runVerify(client, m.store, { only: [PHARMACY], now: () => NOW, delayMs: 0 })
    expect(report.results.map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'], ['DUTYADDR만', 'ok'], ['DUTYNAME만', 'ok'], ['지원 자리 전부', 'ok'],
    ])
    expect(report).toMatchObject({ ok: true, calls: 4 })
    expect(calls.map(c => c.path)).toEqual([[], ['강남구'], [B, '온누리'], ['강남구', '온누리']])
  })

  it('행은 같고 순서만 다르면 경고, 전체 건수나 행 집합이 다르면 실패다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], pharmacies)
    const { client } = fakeClient(r => {
      if (r.path.length === 0) return { rows: [...pharmacies].reverse(), totalCount: 3 }
      if (r.path[0] === '강남구' && r.path.length === 1) return { rows: [pharmacies[0]], totalCount: 1 } // 서울 API가 한 건만 준다
      if (r.path.length === 2 && r.path[0] === B) return { rows: [pharmacies[0], pharmacies[1]], totalCount: 2 } // 건수는 같고 행이 다르다
      return livePharmacy(r)
    })
    const report = await runVerify(client, m.store, { only: [PHARMACY], now: () => NOW, delayMs: 0 })
    expect(report.results.map(r => r.status)).toEqual(['order', 'fail', 'fail', 'ok'])
    expect(report.results[1].detail).toBe('전체 건수 다름: 저장소 2, 서울 API 1')
    expect(report.results[2].detail).toContain('행 집합 다름')
    expect(report.ok).toBe(false)
  })

  const NAME = '더샵둔촌포레(둔촌현대1차A)'
  const seniors = [{ SISUL_NM: NAME }, { SISUL_NM: `${NAME} 별관` }]
  /** 경로당 서비스가 이름을 일치로 거른다고 볼 때와 부분일치로 거른다고 볼 때의 서울 API */
  const liveSenior = (kind: 'eq' | 'contains', rows = seniors) => (r: Req): Unwrapped => {
    const v = (r.path[0] ?? '').trim()
    return answer(r.service, rows.filter(x => v === '' || (kind === 'eq' ? x.SISUL_NM === v : x.SISUL_NM.includes(v))))
  }

  it('검증으로 결정할 자리는 전체 값과 앞부분으로 두 가정을 비교하고, 같은 요청은 서울 API를 한 번만 부른다', async () => {
    const m = memoryStore()
    m.seed(SENIOR, [], seniors)
    const { client, calls } = fakeClient(liveSenior('eq'))
    const report = await runVerify(client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(report.results.map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'],
      ['SISUL_NM 가정: 일치(전체 값)', 'ok'], ['SISUL_NM 가정: 부분일치(전체 값)', 'fail'],
      ['SISUL_NM 가정: 일치(앞부분)', 'ok'], ['SISUL_NM 가정: 부분일치(앞부분)', 'fail'],
    ])
    expect(calls.map(c => c.path)).toEqual([[], [NAME], [NAME.slice(0, 8)]])
    expect(report.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '일치' }])
    expect(report.ok).toBe(true) // 가정의 실패는 검사 실패가 아니다
  })

  it('서울 API가 부분일치로 거르면 부분일치로 판정한다', async () => {
    const m = memoryStore()
    m.seed(SENIOR, [], seniors)
    const report = await runVerify(fakeClient(liveSenior('contains')).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(report.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '부분일치' }])
  })

  it('예시 값에 맞는 행이 없으면 구분하지 못하고, 어느 가정도 맞지 않으면 재현 못 함이다', async () => {
    const m = memoryStore()
    const others = [{ SISUL_NM: '다른경로당' }]
    m.seed(SENIOR, [], others)
    const both = await runVerify(fakeClient(liveSenior('eq', others)).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(both.decisions[0].verdict).toBe('둘 다 맞음')
    const neither = await runVerify(fakeClient(r => answer(r.service, others)).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(neither.decisions[0].verdict).toBe('재현 못 함')
  })

  it('파티션이 있는 서비스는 가장 최근에 저장된 파티션으로 검사한다', async () => {
    const m = memoryStore()
    m.seed('CardSubwayStatsNew', ['20261115'], [{ USE_YMD: '20261115' }])
    m.seed('CardSubwayStatsNew', ['20261117'], [{ USE_YMD: '20261117' }])
    const { client, calls } = fakeClient(r => answer(r.service, [{ USE_YMD: r.path[0] }]))
    const report = await runVerify(client, m.store, { only: ['CardSubwayStatsNew'], now: () => NOW, delayMs: 0 })
    expect(calls.map(c => c.path)).toEqual([['20261117']])
    expect(report.results[0].status).toBe('ok')
  })

  it('스냅샷이 없는 서비스는 건너뛰고, 자리가 없는 머리 19종은 검사하지 않는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => noData(r.service))
    const report = await runVerify(client, m.store, { now: () => NOW, delayMs: 0 })
    expect(calls).toHaveLength(0)
    expect(report.results).toHaveLength(18)
    expect(report.results.every(r => r.status === 'skip' && r.detail === '스냅샷 없음')).toBe(true)
    expect(report.ok).toBe(true)
  })

  it('쿼터 소진이나 호출 제한 응답을 받으면 검사를 끝낸다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], pharmacies)
    const { client, calls } = fakeClient(() => ({ rows: [], totalCount: 0, note: '일일 API 쿼터(3000회)가 소진되어 새 데이터를 가져올 수 없습니다.' }))
    const report = await runVerify(client, m.store, { only: [PHARMACY], now: () => NOW, delayMs: 0 })
    expect(calls).toHaveLength(1)
    expect(report.ok).toBe(false)
    expect(report.aborted).toContain('소진되어')
  })

  it('샘플 키로는 검사하지 않는다', async () => {
    const m = memoryStore()
    await expect(runVerify({ ...fakeClient(livePharmacy).client, isSample: true }, m.store)).rejects.toThrow('샘플 키')
  })

  it('결과를 상태, 서비스, 요청, 설명으로 출력하고 결정할 자리를 따로 모은다', async () => {
    const m = memoryStore()
    m.seed(SENIOR, [], seniors)
    const text = formatVerify(await runVerify(fakeClient(liveSenior('eq')).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 }))
    expect(text).toContain('통과 OdsnBuildingInfo 인자 없음: 2건 일치')
    expect(text).toContain('실패 OdsnBuildingInfo SISUL_NM 가정: 부분일치(전체 값)')
    expect(text).toContain('OdsnBuildingInfo.SISUL_NM: 일치')
    expect(text).toContain('호출 합계: 3회')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/store/verify.test.ts`
Expected: FAIL, `src/store/verify.js`를 찾지 못한다는 오류

- [ ] **Step 3: `verify.ts` 구현**

`src/store/verify.ts` (새 파일):

```ts
/**
 * 실제 API 대비 검사 (스펙 §7.2). 수집 직후 같은 요청을 스냅샷과 서울 API 양쪽에 보내 비교한다.
 * 쿼터를 쓰므로 CI에 넣지 않고, 규칙을 바꾸거나 처음 수집했을 때 손으로 돌린다.
 */
import { isNoData, type Unwrapped } from '../client/response.js'
import { CATALOG } from '../data/catalog.js'
import { CALL_DELAY_MS, PAGE, indexExisting, type CollectClient } from './collector.js'
import { answerFrom, planRequest } from './engine.js'
import { STORE_RULES, type SlotRule, type StoreRule } from './rules.js'
import { ALL, decodeSnapshot, snapshotKey, type Snapshot } from './snapshot.js'
import type { SnapshotStore } from './snapshotStore.js'

const BLANK = ' '

export interface VerifyCase {
  service: string
  /** 서울 API에 보낼 경로 */
  path: string[]
  label: string
  /** 미지원 자리를 이 규칙으로 가정하고 비교한다 */
  assume?: { slot: number; field: string; kind: 'eq' | 'contains' }
}

const examplesOf = (service: string, rule: StoreRule): string[] =>
  rule.examples ?? CATALOG.find(e => e.id === service)?.pathParams.map(p => p.example) ?? []

/**
 * 서비스 하나의 검사 요청: 인자 없음, 자리 하나씩, 지원 자리 전부, 결정할 자리의 두 가정.
 * 결정할 자리는 예시 값 전체와 그 앞부분 두 값으로 시험한다. 전체 값만으로는 일치와 부분일치가 같은 행을 고르기 때문이다
 */
export function casesFor(service: string, rule: StoreRule, partition: string[]): VerifyCase[] {
  const examples = examplesOf(service, rule)
  /** values: 자리 번호 → 넣을 값. 파티션 자리에는 저장된 파티션 값이 들어간다 */
  const pathWith = (values: Record<number, string>): string[] => {
    const path = rule.slots.map((_, i) => (i < partition.length ? partition[i] : values[i] ?? BLANK))
    while (path.length > 0 && path[path.length - 1] === BLANK) path.pop()
    return path
  }
  const example = (indexes: number[]): Record<number, string> => Object.fromEntries(indexes.map(i => [i, examples[i]]))
  const supported = rule.slots.flatMap((s, i) => (s.kind === 'eq' || s.kind === 'contains' ? [i] : []))
  const cases: VerifyCase[] = [{ service, path: pathWith({}), label: '인자 없음' }]
  for (const i of supported) cases.push({ service, path: pathWith(example([i])), label: `${rule.slots[i].field}만` })
  if (supported.length > 1) cases.push({ service, path: pathWith(example(supported)), label: '지원 자리 전부' })
  rule.slots.forEach((s, i) => {
    if (s.kind !== 'unsupported' || !s.decide) return
    const full = examples[i]
    const front = full.slice(0, Math.max(1, Math.ceil(full.length / 2)))
    for (const [value, which] of [[full, '전체 값'], [front, '앞부분']] as const) {
      for (const kind of ['eq', 'contains'] as const) {
        cases.push({
          service, path: pathWith({ [i]: value }), label: `${s.field} 가정: ${kind === 'eq' ? '일치' : '부분일치'}(${which})`,
          assume: { slot: i, field: s.field, kind },
        })
      }
    }
  })
  return cases
}

export interface CaseResult {
  service: string
  label: string
  path: string[]
  status: 'ok' | 'order' | 'fail' | 'skip'
  detail: string
  assume?: VerifyCase['assume']
}

export interface Decision { service: string; field: string; verdict: '일치' | '부분일치' | '둘 다 맞음' | '재현 못 함' }

export interface VerifyReport {
  results: CaseResult[]
  decisions: Decision[]
  calls: number
  aborted?: string
  ok: boolean
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

function compare(c: VerifyCase, snapshot: Snapshot, rule: StoreRule, live: Unwrapped, now: number): CaseResult {
  const base = { service: c.service, label: c.label, path: c.path, ...(c.assume ? { assume: c.assume } : {}) }
  const assumed: SlotRule[] = rule.slots.map((s, i) => (c.assume && i === c.assume.slot ? { field: s.field, kind: c.assume.kind } : s))
  const plan = planRequest(c.service, c.path, { [c.service]: { ...rule, slots: assumed } })
  if (!plan) return { ...base, status: 'skip', detail: '규칙으로 답할 수 없는 요청' }
  const mine = answerFrom(snapshot, plan, 1, PAGE, now, { allowExpired: true })?.value
  if (!mine) return { ...base, status: 'skip', detail: '머리 스냅샷이라 이 요청에 답할 수 없음' }
  if (mine.totalCount !== live.totalCount) {
    return { ...base, status: 'fail', detail: `전체 건수 다름: 저장소 ${mine.totalCount}, 서울 API ${live.totalCount}` }
  }
  const a = mine.rows.map(r => JSON.stringify(r))
  const b = live.rows.map(r => JSON.stringify(r))
  if (sameList(a, b)) return { ...base, status: 'ok', detail: `${live.totalCount}건 일치` }
  if (sameList([...a].sort(), [...b].sort())) return { ...base, status: 'order', detail: `${live.totalCount}건, 행은 같고 순서만 다름` }
  return { ...base, status: 'fail', detail: `행 집합 다름: 저장소 ${a.length}행, 서울 API ${b.length}행(전체 ${live.totalCount}건)` }
}

/** 가정은 그 가정으로 비교한 요청(전체 값과 앞부분)이 모두 맞아야 맞는 것으로 본다 */
function decide(results: CaseResult[]): Decision[] {
  const groups = new Map<string, { service: string; field: string; eq: boolean; contains: boolean }>()
  for (const r of results) {
    if (!r.assume) continue
    const key = `${r.service}.${r.assume.field}`
    const g = groups.get(key) ?? { service: r.service, field: r.assume.field, eq: true, contains: true }
    if (r.status !== 'ok' && r.status !== 'order') g[r.assume.kind] = false
    groups.set(key, g)
  }
  return [...groups.values()].map(g => ({
    service: g.service, field: g.field,
    verdict: g.eq && g.contains ? '둘 다 맞음' : g.eq ? '일치' : g.contains ? '부분일치' : '재현 못 함',
  }))
}

export async function runVerify(
  client: CollectClient, store: SnapshotStore, opts: { only?: string[]; now?: () => number; delayMs?: number } = {},
): Promise<VerifyReport> {
  if (client.isSample) throw new Error('샘플 키로는 검사할 수 없습니다. SEOUL_API_KEY를 설정하세요')
  const now = opts.now ?? Date.now
  const delayMs = opts.delayMs ?? CALL_DELAY_MS
  const existing = indexExisting(await store.list(''))
  const results: CaseResult[] = []
  let calls = 0
  let aborted: string | undefined

  services: for (const [service, rule] of Object.entries(STORE_RULES)) {
    if (rule.slots.length === 0) continue // 자리가 없는 머리 스냅샷은 첫 페이지 그대로라 비교할 것이 없다
    if (opts.only && !opts.only.includes(service)) continue
    const keys = [...(existing.get(service)?.keys() ?? [])].sort()
    const partitionKey = rule.partitions ? keys.at(-1) : keys.find(k => k === ALL)
    const partition = rule.partitions && partitionKey ? partitionKey.split('_') : []
    const got = partitionKey ? await store.get(snapshotKey(service, partition)) : undefined
    if (!got || got === 'not-modified') {
      results.push({ service, label: '전체', path: [], status: 'skip', detail: '스냅샷 없음' })
      continue
    }
    const { snapshot } = decodeSnapshot(got.body)
    const live = new Map<string, Unwrapped>()
    for (const c of casesFor(service, rule, partition)) {
      const key = c.path.join('\u0000')
      if (!live.has(key)) {
        if (calls > 0 && delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
        calls++
        const u = await client.getJson(service, 1, PAGE, c.path)
        if (u.rows.length === 0 && !isNoData(u)) {
          aborted = u.note ?? '서울 API가 이유 없이 빈 응답을 돌려줬습니다'
          break services
        }
        live.set(key, u)
      }
      results.push(compare(c, snapshot, rule, live.get(key)!, now()))
    }
  }
  // 가정을 시험한 요청의 실패는 "그 가정이 틀렸다"는 결과이지 검사 실패가 아니다
  const ok = aborted === undefined && results.every(r => r.status !== 'fail' || r.assume !== undefined)
  return { results, decisions: decide(results), calls, aborted, ok }
}

const STATUS_LABEL = { ok: '통과', order: '순서', fail: '실패', skip: '건너뜀' } as const

export function formatVerify(report: VerifyReport): string {
  return [
    '[verify] 실제 API 대비 검사',
    ...report.results.map(r => `  ${STATUS_LABEL[r.status]} ${r.service} ${r.label}: ${r.detail}`),
    ...(report.decisions.length > 0 ? ['검증으로 결정할 자리:', ...report.decisions.map(d => `  ${d.service}.${d.field}: ${d.verdict}`)] : []),
    `호출 합계: ${report.calls}회`,
    ...(report.aborted ? [`중단: ${report.aborted}`] : []),
  ].join('\n')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/store/verify.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 스크립트에 `verify` 명령 연결**

`scripts/workshop-collect.ts`를 네 군데 고친다.

import에 한 줄을 추가한다(`import { STORE_PREFIX } ...` 다음 줄).

```ts
import { formatVerify, runVerify } from '../src/store/verify.js'
```

`USAGE`의 `status` 줄 다음에 한 줄을 추가한다.

```ts
  npm run workshop:collect -- verify    수집한 스냅샷을 실제 API와 비교(약 50회). 규칙을 바꾸거나 처음 수집했을 때
```

명령 검사 조건을 바꾼다.

바꾸기 전:

```ts
  if (values.help || (command !== 'daily' && command !== 'static' && command !== 'status')) {
```

바꾼 뒤:

```ts
  if (values.help || (command !== 'daily' && command !== 'static' && command !== 'status' && command !== 'verify')) {
```

`console.log(formatQuota(quota))` 줄 다음에 추가한다.

```ts
  if (command === 'verify') {
    const verified = await runVerify(client, store, { only })
    console.log(formatVerify(verified))
    if (!verified.ok) process.exitCode = 1
    return
  }
```

- [ ] **Step 6: 스크립트 타입 검사**

Run: `npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck scripts/workshop-collect.ts && npm run workshop:collect -- --help`
Expected: 타입 오류 없음, 사용법에 `verify` 줄이 보인다

- [ ] **Step 7: 모듈 규칙 문서에 `verify.ts` 추가**

`src/store/CLAUDE.md`의 `## Key Files` 목록 끝에 한 줄을 추가한다.

```markdown
- `verify.ts` - 실제 API 대비 검사. 카탈로그 예시 값으로 요청을 만들고(`casesFor`), 스냅샷의 답과 서울 API의 답을 전체 건수와 행으로 비교합니다(`runVerify`). "검증으로 결정" 자리는 일치와 부분일치 두 가정으로 비교합니다.
```

- [ ] **Step 8: 전체 테스트와 빌드**

Run: `npm test && npm run build`
Expected: 모두 통과

- [ ] **Step 9: 커밋**

```bash
git add src/store scripts/workshop-collect.ts tests/store/verify.test.ts
git commit -m "feat: add workshop:collect verify to compare snapshots with the live API

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 6: 스택 템플릿(런타임 권한, `STORE_URI`, 수명 규칙)과 버전 0.8.0

템플릿 파일만 고친다. 스택은 Task 9에서 사용자 승인 뒤에 갱신한다. 배포 스크립트가 `package.json`의 버전으로 이미지 태그를 만들기 때문에 버전을 여기서 올린다.

**Files:**
- Modify: `infra/seoul-workshop.yaml`(`WorkshopBucket`, `RuntimeRole`, `WorkshopRuntime`), `tests/infra/workshopTemplate.test.ts`, `package.json`, `package-lock.json`, `manifest.json`, `src/index.ts:20`, `CHANGELOG.md`, `README.md:3`, `CLAUDE.md:4`, `docs/api-reference.md:3`

**Interfaces:**
- Consumes: `STORE_PREFIX = 'store/v1'` (`src/store/snapshot.ts`)의 값과 같은 접두사
- Produces: 런타임 환경 변수 `STORE_URI = s3://<WorkshopBucket>/store/v1`, 런타임 역할의 `s3:GetObject`(`store/*`)와 `s3:ListBucket`(접두사 `store/*`), 버킷 수명 규칙 `expire-store-snapshots`(`store/`, 90일), `SERVER_VERSION = '0.8.0'`

- [ ] **Step 1: 템플릿 테스트 고치기**

`tests/infra/workshopTemplate.test.ts`의 첫 테스트에서 환경 변수 기대값을 바꾼다.

바꾸기 전:

```ts
      CACHE_TABLE_NAME: { Ref: 'WorkshopTable' },
      QUOTA_DAILY_LIMIT: { Ref: 'QuotaDailyLimit' },
    })
  })
```

바꾼 뒤:

```ts
      CACHE_TABLE_NAME: { Ref: 'WorkshopTable' },
      QUOTA_DAILY_LIMIT: { Ref: 'QuotaDailyLimit' },
      STORE_URI: { Sub: 's3://${WorkshopBucket}/store/v1' },
    })
  })

  it('런타임 역할은 store/ 아래 객체만 읽고 목록 권한은 store/ 접두사로 제한한다', () => {
    const st = statements('RuntimeRole')
    expect(st.find(s => s.Sid === 'StoreRead')).toEqual({
      Sid: 'StoreRead', Effect: 'Allow', Action: 's3:GetObject', Resource: { Sub: '${WorkshopBucket.Arn}/store/*' },
    })
    expect(st.find(s => s.Sid === 'StoreList')).toEqual({
      Sid: 'StoreList', Effect: 'Allow', Action: 's3:ListBucket', Resource: { GetAtt: 'WorkshopBucket.Arn' },
      Condition: { StringLike: { 's3:prefix': 'store/*' } },
    })
    const s3Actions = st.flatMap(s => asList(s.Action)).filter(a => String(a).startsWith('s3:')).sort()
    expect(s3Actions).toEqual(['s3:GetObject', 's3:ListBucket'])
  })

  it('버킷은 store/ 아래 객체만 90일 뒤에 지운다', () => {
    expect(R.WorkshopBucket.Properties.LifecycleConfiguration).toEqual({
      Rules: [{ Id: 'expire-store-snapshots', Status: 'Enabled', Prefix: 'store/', ExpirationInDays: 90 }],
    })
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/infra/workshopTemplate.test.ts`
Expected: FAIL, 환경 변수 비교와 새 테스트 두 개가 실패

- [ ] **Step 3: 템플릿 고치기**

`infra/seoul-workshop.yaml`의 `WorkshopBucket`에서 주석과 `OwnershipControls`를 고친다.

바꾸기 전:

```yaml
  WorkshopBucket:
    # Holds the interceptor zip under code/.
```

바꾼 뒤:

```yaml
  WorkshopBucket:
    # Holds the Lambda zips under code/ and the pre-collected snapshots under store/v1/.
```

바꾸기 전:

```yaml
      OwnershipControls:
        Rules:
          - ObjectOwnership: BucketOwnerEnforced

  RuntimeRole:
```

바꾼 뒤:

```yaml
      OwnershipControls:
        Rules:
          - ObjectOwnership: BucketOwnerEnforced
      LifecycleConfiguration:
        Rules:
          # Longer than the longest snapshot max age the server uses (30 days). code/ is not affected.
          - Id: expire-store-snapshots
            Status: Enabled
            Prefix: store/
            ExpirationInDays: 90

  RuntimeRole:
```

`RuntimeRole`의 마지막 문장 다음에 두 문장을 추가한다.

바꾸기 전:

```yaml
              - Sid: WorkshopTable
                Effect: Allow
                Action: [dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem]
                Resource: !GetAtt WorkshopTable.Arn

  WorkshopRuntime:
```

바꾼 뒤:

```yaml
              - Sid: WorkshopTable
                Effect: Allow
                Action: [dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem]
                Resource: !GetAtt WorkshopTable.Arn
              - Sid: StoreRead
                Effect: Allow
                Action: s3:GetObject
                Resource: !Sub "${WorkshopBucket.Arn}/store/*"
              - Sid: StoreList
                # With list permission a read of a missing snapshot returns 404 instead of 403.
                Effect: Allow
                Action: s3:ListBucket
                Resource: !GetAtt WorkshopBucket.Arn
                Condition:
                  StringLike: {"s3:prefix": "store/*"}

  WorkshopRuntime:
```

`WorkshopRuntime`의 환경 변수에 한 줄을 추가한다.

바꾸기 전:

```yaml
        QUOTA_DAILY_LIMIT: !Ref QuotaDailyLimit

  CodeCheckLogGroup:
```

바꾼 뒤:

```yaml
        QUOTA_DAILY_LIMIT: !Ref QuotaDailyLimit
        STORE_URI: !Sub "s3://${WorkshopBucket}/store/v1"

  CodeCheckLogGroup:
```

파일 머리의 설계 주석 줄 다음에 한 줄을 추가한다.

바꾸기 전:

```yaml
# Design: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md
```

바꾼 뒤:

```yaml
# Design: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md
# Snapshot store: docs/superpowers/specs/2026-11-21-snapshot-store-design.md
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/infra/workshopTemplate.test.ts`
Expected: PASS. "Resource \"*\"는 ecr:GetAuthorizationToken에만 쓴다"와 "계정 ID, ARN 리터럴, 기존 리소스 이름이 없다"도 그대로 통과

- [ ] **Step 5: 템플릿 문법 검사(AWS 리소스를 만들지 않는다)**

Run: `aws cloudformation validate-template --template-body file://infra/seoul-workshop.yaml --region ap-northeast-2 --query 'Parameters[].ParameterKey' --output text`
Expected: 파라미터 이름 9개가 출력된다. 자격 증명이 없어 실패하면 이 단계는 건너뛰고 Task 9에서 확인한다고 보고한다

- [ ] **Step 6: 버전 0.8.0**

```bash
npm version 0.8.0 --no-git-tag-version
```

`manifest.json`의 `"version": "0.7.0"`을 `"version": "0.8.0"`으로, `src/index.ts`의 `export const SERVER_VERSION = '0.7.0'`을 `'0.8.0'`으로 바꾼다. `README.md` 3행 배지의 `Version-0.7.0-green`을 `Version-0.8.0-green`으로, `CLAUDE.md` 4행의 `seoul-opendata-mcp(v0.7.0, MIT)`를 `seoul-opendata-mcp(v0.8.0, MIT)`로, `docs/api-reference.md` 3행의 `v0.7.0`을 `v0.8.0`으로 바꾼다.

- [ ] **Step 7: CHANGELOG에 0.8.0 추가**

`CHANGELOG.md`의 영어 절에서 `## [Unreleased]` 다음, `## [0.7.0] - 2026-11-19` 앞에 넣는다. 날짜는 이 커밋을 만드는 날(KST)로 쓴다.

```markdown
## [0.8.0] - 2026-11-21

### Added

- Snapshot store (`src/store/`): with `STORE_URI` set (`s3://<bucket>/store/v1` or a directory), the server answers 37 slow-changing datasets from pre-collected gzip JSON snapshots before it touches the cache, the key pool, or the quota ledger. A request answered from the store makes no upstream call, and stored data keeps answering after every key has reached its daily limit. Such responses carry a `사전 적재 데이터(M월 D일 수집)` note. Requests the store cannot answer take the existing path unchanged, and without `STORE_URI` nothing changes.
- `npm run workshop:collect -- daily|static|status|verify`: collects snapshots with the workshop keys, records its calls in the quota ledger, skips what was collected recently, and compares snapshots with the live API.
- Workshop stack: the runtime reads `store/` in the workshop bucket through `STORE_URI`, and snapshots expire after 90 days.

### Changed

- `@aws-sdk/client-s3` is a new dependency. It is imported only when `STORE_URI` starts with `s3://`.
- `src/client/dynamo.ts` exports `createDocClient()` and `src/client/response.ts` exports `noDataNote()`.
```

한국어 절에서도 같은 자리에 넣는다.

```markdown
## [0.8.0] - 2026-11-21

### Added

- 사전 적재 저장소(`src/store/`): `STORE_URI`(`s3://<버킷>/store/v1` 또는 디렉터리)를 설정하면 하루 단위 이상으로 바뀌는 데이터셋 37종을 미리 받아 둔 gzip JSON 스냅샷으로 답함. 캐시, 키 풀, 쿼터 장부보다 먼저 조회하므로 저장소가 답한 요청은 서울 API 호출이 0회이고, 모든 키가 하루 한도에 닿아도 저장된 데이터는 계속 나감. 응답에 `사전 적재 데이터(M월 D일 수집)` 안내 추가. 저장소가 답하지 못하는 요청은 기존 경로 그대로이고, `STORE_URI`가 없으면 동작 변화 없음
- `npm run workshop:collect -- daily|static|status|verify`: 워크숍 키로 스냅샷 수집, 수집 호출의 쿼터 장부 기록, 최근에 받은 스냅샷 건너뛰기, 실제 API 대비 검사
- 워크숍 스택: 런타임이 `STORE_URI`로 워크숍 버킷의 `store/`를 읽음. 스냅샷은 90일 뒤 삭제

### Changed

- 새 의존성 `@aws-sdk/client-s3` 추가. `STORE_URI`가 `s3://`로 시작할 때만 불러옴
- `src/client/dynamo.ts`가 `createDocClient()`를, `src/client/response.ts`가 `noDataNote()`를 내보냄
```

두 절의 맨 아래 참조 링크에서 `[Unreleased]` 줄을 아래 세 줄로 바꾼다(0.7.0 링크가 빠져 있어 함께 넣는다). 두 절 모두 고친다.

```markdown
[Unreleased]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.6.0...v0.7.0
```

- [ ] **Step 8: mcpb 크기 기록**

새 의존성이 묶음 크기를 얼마나 키우는지 잰다(스펙 §9.2).

Run: `npm run bundle && ls -l seoul-opendata-mcp.mcpb`
Expected: `seoul-opendata-mcp.mcpb`가 만들어진다(git에는 올라가지 않는다). 크기를 MB로 읽어 `CHANGELOG.md` 두 절의 `@aws-sdk/client-s3` 항목 끝에 적는다. 영어는 ` The mcpb bundle is N MB.`, 한국어는 `. mcpb 묶음 N MB`. 태스크 보고에도 이 크기를 적는다

- [ ] **Step 9: 전체 테스트와 빌드**

Run: `npm test && npm run build`
Expected: 모두 통과(`tests/version.test.ts` 포함)

- [ ] **Step 10: 커밋**

```bash
git add infra/seoul-workshop.yaml tests/infra/workshopTemplate.test.ts package.json package-lock.json manifest.json src/index.ts CHANGELOG.md README.md CLAUDE.md docs/api-reference.md
git commit -m "feat: give the workshop runtime the snapshot store and bump to 0.8.0

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 7: 선택적 스케줄 Lambda

스택 파라미터 `CollectSchedule`에 스케줄 식을 넣으면 EventBridge 스케줄이 Lambda로 `daily`를 실행한다. 기본값은 빈 문자열이고 이때는 리소스를 만들지 않는다. 이 태스크도 파일만 고친다.

**Files:**
- Create: `infra/lambda/collect.ts`, `scripts/workshop-bundle.ts`
- Modify: `infra/seoul-workshop.yaml`(파라미터, 조건, 스케줄 리소스), `scripts/workshop-lib.ts`(`PARAMETERS`, `stackParameters`, `codeKeyOf`), `scripts/workshop-aws.ts`(`stackParameterKeys`), `scripts/workshop-deploy.ts`, `scripts/workshop-code.ts`, `package.json`(`esbuild` devDependency), `CHANGELOG.md`
- Test: `tests/infra/collectLambda.test.ts`, `tests/workshopBundle.test.ts`, `tests/infra/workshopTemplate.test.ts`, `tests/workshopLib.test.ts`, `tests/workshopAws.test.ts`(끝에 추가)

**Interfaces:**
- Consumes: `collect()`, `remainingQuota()`, `formatQuota()`, `formatReport()`, `formatPlan()`, `CollectClient` (`src/store/collector.ts`); `openStore()` (`src/store/attach.ts`); `createDocClient()`, `DynamoDbLedger` (`src/client/dynamo.ts`); `SeoulApiClient`; `parseKeys()`; `InMemoryLedger`, `parseQuotaLimit()`, `QuotaLedger`; `SnapshotStore`
- Produces:
  - `interface Deps { client: CollectClient; store: SnapshotStore; keys: string[]; ledger: QuotaLedger; log: (line: string) => void; delayMs?: number }`, `runDaily(deps: Deps): Promise<{ calls: number; saved: number }>`, `handler(): Promise<{ calls: number; saved: number }>` (`infra/lambda/collect.ts`)
  - `bundleCollectLambda(outfile: string): Promise<void>` (`scripts/workshop-bundle.ts`)
  - `stackParameters(given, mode: 'create' | 'update', existing?: readonly string[]): StackParameter[]`, `codeKeyOf(source: string | Buffer, name?: string): string` (`scripts/workshop-lib.ts`)
  - `stackParameterKeys(stack: any): string[]` (`scripts/workshop-aws.ts`)
  - 템플릿 파라미터 `CollectSchedule`, `CollectCodeKey`, 조건 `HasSchedule`, 리소스 `CollectLogGroup`, `CollectRole`, `CollectFunction`, `CollectInvokeConfig`, `CollectScheduleRole`, `CollectDailySchedule`

- [ ] **Step 1: `esbuild`를 devDependency로 추가**

`tsx`가 이미 쓰는 버전과 같은 버전으로 맞춘다.

```bash
npm install -D "esbuild@$(node -p "require('./node_modules/esbuild/package.json').version")"
```

Expected: `package.json`의 `devDependencies`에 `esbuild`가 생긴다

- [ ] **Step 2: Lambda와 묶기 테스트 작성**

`tests/infra/collectLambda.test.ts` (새 파일):

```ts
import { describe, it, expect } from 'vitest'
import { InMemoryLedger } from '../../src/client/quota.js'
import type { Unwrapped } from '../../src/client/response.js'
import type { CollectClient } from '../../src/store/collector.js'
import type { SnapshotStore } from '../../src/store/snapshotStore.js'
import { runDaily, type Deps } from '../../infra/lambda/collect.js'

function deps(handler: (service: string) => Unwrapped): Deps & { logs: string[]; objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>()
  const logs: string[] = []
  const store: SnapshotStore = {
    async get(key) { const body = objects.get(key); return body ? { body } : undefined },
    async put(key, body) { objects.set(key, body) },
    async list() { return [...objects.keys()].map(key => ({ key, lastModified: Date.now(), size: 1 })) },
  }
  const client: CollectClient = { isSample: false, async getJson(service) { return handler(service) } }
  return { client, store, keys: ['RAWKEYONE1234'], ledger: new InMemoryLedger(1000), log: l => logs.push(l), delayMs: 0, logs, objects }
}

describe('수집 Lambda', () => {
  it('매일 묶음을 받아 저장하고 호출 수와 저장 수를 돌려준다', async () => {
    const d = deps(() => ({ rows: [{ a: 1 }], totalCount: 1 }))
    const out = await runDaily(d)
    expect(out.saved).toBeGreaterThanOrEqual(31) // 전체 12종과 머리 19종, 그리고 공개된 날짜 파티션
    expect(out.calls).toBeGreaterThanOrEqual(out.saved)
    expect(d.objects.has('TbPharmacyOperateInfo/_all.json.gz')).toBe(true)
    expect(d.logs.join('\n')).toContain('[daily] 수집 결과')
  })

  it('실패가 있으면 던져서 Lambda 호출을 실패로 남긴다', async () => {
    const d = deps(() => ({ rows: [], totalCount: 0, note: '일일 API 쿼터(1000회)가 소진되어 새 데이터를 가져올 수 없습니다.' }))
    await expect(runDaily(d)).rejects.toThrow('소진되어')
    expect(d.objects.size).toBe(0)
  })

  it('로그에 원문 키가 없다', async () => {
    const d = deps(() => ({ rows: [{ a: 1 }], totalCount: 1 }))
    await runDaily(d)
    expect(d.logs.join('\n')).toContain('RAWK…(masked)')
    expect(d.logs.join('\n')).not.toContain('RAWKEYONE1234')
  })
})
```

`tests/workshopBundle.test.ts` (새 파일):

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleCollectLambda } from '../scripts/workshop-bundle.js'

describe('bundleCollectLambda', () => {
  it('수집 Lambda를 handler를 내보내는 ESM 한 파일로 묶고 AWS SDK는 묶지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seoul-bundle-'))
    try {
      const out = join(dir, 'collect.mjs')
      await bundleCollectLambda(out)
      const text = readFileSync(out, 'utf8')
      expect(text).toContain('import("@aws-sdk/client-s3")')
      expect(text).toContain('import("@aws-sdk/client-dynamodb")')
      expect(text.length).toBeLessThan(1_000_000)
      const mod = await import(pathToFileURL(out).href)
      expect(typeof mod.handler).toBe('function')
      // 같은 소스는 같은 바이트를 낸다. 코드 키가 내용 해시라서 필요하다
      const again = join(dir, 'again.mjs')
      await bundleCollectLambda(again)
      expect(readFileSync(again, 'utf8')).toBe(text)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/infra/collectLambda.test.ts tests/workshopBundle.test.ts`
Expected: FAIL, `infra/lambda/collect.js`와 `scripts/workshop-bundle.js`를 찾지 못한다는 오류

- [ ] **Step 4: Lambda 진입점과 묶기 함수 구현**

`infra/lambda/collect.ts` (새 파일):

```ts
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
```

`scripts/workshop-bundle.ts` (새 파일):

```ts
/** 수집 Lambda를 한 파일로 묶는다. @aws-sdk/*는 Lambda Node.js 22 런타임에 들어 있어 묶지 않는다 */
import { build } from 'esbuild'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export async function bundleCollectLambda(outfile: string): Promise<void> {
  await build({
    entryPoints: [join(ROOT, 'infra', 'lambda', 'collect.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['@aws-sdk/*'],
    legalComments: 'none',
    logLevel: 'silent',
  })
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/infra/collectLambda.test.ts tests/workshopBundle.test.ts && npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck infra/lambda/collect.ts scripts/workshop-bundle.ts`
Expected: PASS (4 tests), 타입 오류 없음


- [ ] **Step 6: 스크립트 공용 함수 테스트 작성**

스택에 아직 없는 파라미터에 `UsePreviousValue`를 보내면 CloudFormation이 갱신을 거부한다. 새 파라미터는 빼고 보내 템플릿 기본값이 쓰이게 한다.

`tests/workshopLib.test.ts` (끝에 추가):

```ts
describe('새 파라미터와 수집 코드 키', () => {
  it('PARAMETERS에 수집 스케줄 파라미터가 있다', () => {
    expect(PARAMETERS).toContain('CollectSchedule')
    expect(PARAMETERS).toContain('CollectCodeKey')
  })

  it('update에서 스택에 아직 없는 파라미터는 빼서 템플릿 기본값을 쓴다', () => {
    const existing = ['McpImageUri', 'McpRepositoryName', 'CodeKey', 'SeoulApiKey', 'SeoulSubwayApiKey', 'CodeSha256', 'CodeValidUntil', 'RatePerMinute', 'QuotaDailyLimit']
    const params = stackParameters({ CodeKey: 'code/x.zip', CollectCodeKey: 'code/collect-1.zip' }, 'update', existing)
    expect(params.map(p => p.ParameterKey)).not.toContain('CollectSchedule')
    expect(params.find(p => p.ParameterKey === 'CollectCodeKey')).toEqual({ ParameterKey: 'CollectCodeKey', ParameterValue: 'code/collect-1.zip' })
    expect(params.find(p => p.ParameterKey === 'SeoulApiKey')).toEqual({ ParameterKey: 'SeoulApiKey', UsePreviousValue: true })
    expect(params).toHaveLength(10)
  })

  it('스택에 이미 있는 파라미터는 이전 값을 유지한다', () => {
    const params = stackParameters({}, 'update', [...PARAMETERS])
    expect(params).toHaveLength(PARAMETERS.length)
    expect(params.every(p => p.UsePreviousValue === true)).toBe(true)
  })

  it('코드 키는 이름을 바꿔 쓸 수 있다', () => {
    expect(codeKeyOf('a', 'collect')).toMatch(/^code\/collect-[0-9a-f]{16}\.zip$/)
    expect(codeKeyOf('a')).toMatch(/^code\/code-check-[0-9a-f]{16}\.zip$/)
  })
})
```

`tests/workshopAws.test.ts` (끝에 추가):

```ts
describe('stackParameterKeys', () => {
  it('스택이 가진 파라미터 이름을 돌려준다', async () => {
    const { stackParameterKeys } = await import('../scripts/workshop-aws.js')
    expect(stackParameterKeys({ Parameters: [{ ParameterKey: 'CodeKey', ParameterValue: 'x' }, { ParameterKey: 'SeoulApiKey' }] })).toEqual(['CodeKey', 'SeoulApiKey'])
    expect(stackParameterKeys(undefined)).toEqual([])
  })
})
```

`tests/infra/workshopTemplate.test.ts`의 마지막 테스트(`배포 스크립트가 읽는 출력이 모두 있다`) 다음, `describe`를 닫는 `})` 앞에 추가한다.

```ts
  it('스케줄 리소스는 CollectSchedule과 CollectCodeKey가 모두 있을 때만 만든다', () => {
    expect(T.Parameters.CollectSchedule).toMatchObject({ Type: 'String', Default: '' })
    expect(T.Parameters.CollectCodeKey).toMatchObject({ Type: 'String', Default: '' })
    expect(T.Conditions.HasSchedule).toEqual({
      And: [{ Not: [{ Equals: [{ Ref: 'CollectSchedule' }, ''] }] }, { Not: [{ Equals: [{ Ref: 'CollectCodeKey' }, ''] }] }],
    })
    for (const name of ['CollectLogGroup', 'CollectRole', 'CollectFunction', 'CollectInvokeConfig', 'CollectScheduleRole', 'CollectDailySchedule']) {
      expect(R[name].Condition, name).toBe('HasSchedule')
    }
  })

  it('수집 Lambda는 Node.js 22 arm64, 15분이고 store/와 쿼터 장부만 쓴다', () => {
    const fn = R.CollectFunction.Properties
    expect(fn).toMatchObject({ Runtime: 'nodejs22.x', Architectures: ['arm64'], Handler: 'collect.handler', Timeout: 900 })
    expect(fn.FunctionName).toEqual({ Sub: '${AWS::StackName}-collect' })
    expect(fn.Code).toEqual({ S3Bucket: { Ref: 'WorkshopBucket' }, S3Key: { Ref: 'CollectCodeKey' } })
    expect(fn.Environment.Variables).toEqual({
      SEOUL_API_KEY: { Ref: 'SeoulApiKey' },
      STORE_URI: { Sub: 's3://${WorkshopBucket}/store/v1' },
      TABLE_NAME: { Ref: 'WorkshopTable' },
      QUOTA_DAILY_LIMIT: { Ref: 'QuotaDailyLimit' },
    })
    const st = statements('CollectRole')
    expect(st.flatMap(s => asList(s.Action)).sort()).toEqual([
      'dynamodb:GetItem', 'dynamodb:UpdateItem', 'logs:CreateLogStream', 'logs:PutLogEvents', 's3:GetObject', 's3:ListBucket', 's3:PutObject',
    ])
    expect(st.find(s => s.Sid === 'StoreReadWrite').Resource).toEqual({ Sub: '${WorkshopBucket.Arn}/store/*' })
    expect(st.find(s => s.Sid === 'StoreList').Condition).toEqual({ StringLike: { 's3:prefix': 'store/*' } })
    expect(R.CollectLogGroup.Properties).toEqual({ LogGroupName: { Sub: '/aws/lambda/${AWS::StackName}-collect' }, RetentionInDays: 14 })
    expect(R.CollectInvokeConfig.Properties).toEqual({ FunctionName: { Ref: 'CollectFunction' }, Qualifier: '$LATEST', MaximumRetryAttempts: 0 })
  })

  it('스케줄은 서울 시간으로 수집 Lambda만 부른다', () => {
    const s = R.CollectDailySchedule
    expect(s.Type).toBe('AWS::Scheduler::Schedule')
    expect(s.Properties.ScheduleExpression).toEqual({ Ref: 'CollectSchedule' })
    expect(s.Properties.ScheduleExpressionTimezone).toBe('Asia/Seoul')
    expect(s.Properties.FlexibleTimeWindow).toEqual({ Mode: 'OFF' })
    expect(s.Properties.Target).toEqual({
      Arn: { GetAtt: 'CollectFunction.Arn' }, RoleArn: { GetAtt: 'CollectScheduleRole.Arn' }, Input: '{}', RetryPolicy: { MaximumRetryAttempts: 0 },
    })
    expect(statements('CollectScheduleRole')).toEqual([
      { Sid: 'Invoke', Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: { GetAtt: 'CollectFunction.Arn' } },
    ])
    expect(R.CollectScheduleRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal).toEqual({ Service: 'scheduler.amazonaws.com' })
  })

  it('스크립트의 PARAMETERS 목록이 템플릿의 파라미터와 같다', async () => {
    const { PARAMETERS } = await import('../../scripts/workshop-lib.js')
    expect([...PARAMETERS].sort()).toEqual(Object.keys(T.Parameters).sort())
  })
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run tests/workshopLib.test.ts tests/workshopAws.test.ts tests/infra/workshopTemplate.test.ts`
Expected: FAIL, 새 테스트 9개가 실패

- [ ] **Step 8: 스크립트 공용 함수 구현**

`scripts/workshop-lib.ts`를 세 군데 고친다.

바꾸기 전:

```ts
  'CodeSha256', 'CodeValidUntil', 'RatePerMinute', 'QuotaDailyLimit',
] as const
```

바꾼 뒤:

```ts
  'CodeSha256', 'CodeValidUntil', 'RatePerMinute', 'QuotaDailyLimit', 'CollectSchedule', 'CollectCodeKey',
] as const
```

바꾸기 전:

```ts
/** create: 주지 않은 파라미터는 빼서 템플릿 기본값을 쓴다. update: 주지 않은 파라미터는 이전 값을 유지한다 */
export function stackParameters(given: Partial<Record<ParameterName, string>>, mode: 'create' | 'update'): StackParameter[] {
  return PARAMETERS.flatMap((key): StackParameter[] => {
    const value = given[key]
    if (value !== undefined) return [{ ParameterKey: key, ParameterValue: value }]
    return mode === 'update' ? [{ ParameterKey: key, UsePreviousValue: true }] : []
  })
}
```

바꾼 뒤:

```ts
/**
 * create: 주지 않은 파라미터는 빼서 템플릿 기본값을 쓴다. update: 주지 않은 파라미터는 이전 값을 유지한다.
 * existing은 스택이 지금 가진 파라미터 이름이다. 거기 없는 파라미터(템플릿에 새로 생긴 것)에는
 * UsePreviousValue를 보낼 수 없으므로 빼서 템플릿 기본값을 쓴다
 */
export function stackParameters(
  given: Partial<Record<ParameterName, string>>, mode: 'create' | 'update', existing?: readonly string[],
): StackParameter[] {
  return PARAMETERS.flatMap((key): StackParameter[] => {
    const value = given[key]
    if (value !== undefined) return [{ ParameterKey: key, ParameterValue: value }]
    if (mode === 'create') return []
    return existing && !existing.includes(key) ? [] : [{ ParameterKey: key, UsePreviousValue: true }]
  })
}
```

바꾸기 전:

```ts
export function codeKeyOf(source: string | Buffer): string {
  return `code/code-check-${sha256Hex(source).slice(0, 16)}.zip`
}
```

바꾼 뒤:

```ts
export function codeKeyOf(source: string | Buffer, name = 'code-check'): string {
  return `code/${name}-${sha256Hex(source).slice(0, 16)}.zip`
}
```

`scripts/workshop-aws.ts`의 `stackParameterValue` 함수 다음에 추가한다.

```ts
/** 스택이 지금 가진 파라미터 이름. 템플릿에 새로 생긴 파라미터를 가려내는 데 쓴다 */
export function stackParameterKeys(stack: any): string[] {
  return (stack?.Parameters ?? []).map((p: any) => p.ParameterKey)
}
```

- [ ] **Step 9: 템플릿에 스케줄 리소스 추가**

`infra/seoul-workshop.yaml`을 세 군데 고친다.

바꾸기 전:

```yaml
    Description: Daily upstream calls per Seoul API key (QUOTA_DAILY_LIMIT of the server).

Conditions:
  HasImage: !Not [!Equals [!Ref McpImageUri, ""]]
  HasCode: !Not [!Equals [!Ref CodeKey, ""]]
  HasAll: !And [!Condition HasImage, !Condition HasCode]
```

바꾼 뒤:

```yaml
    Description: Daily upstream calls per Seoul API key (QUOTA_DAILY_LIMIT of the server).
  CollectSchedule:
    Type: String
    Default: ""
    Description: EventBridge Scheduler expression in Asia/Seoul for the daily snapshot collection, for example cron(0 5 * * ? *). Empty disables the schedule.
  CollectCodeKey:
    Type: String
    Default: ""
    Description: S3 key of the collector zip in WorkshopBucket. Empty disables the schedule.

Conditions:
  HasImage: !Not [!Equals [!Ref McpImageUri, ""]]
  HasCode: !Not [!Equals [!Ref CodeKey, ""]]
  HasAll: !And [!Condition HasImage, !Condition HasCode]
  HasSchedule: !And [!Not [!Equals [!Ref CollectSchedule, ""]], !Not [!Equals [!Ref CollectCodeKey, ""]]]
```

바꾸기 전:

```yaml
  GatewayRole:
    # Name patterns instead of GetAtt: the role exists before the conditional resources do.
```

바꾼 뒤:

```yaml
  CollectLogGroup:
    Type: AWS::Logs::LogGroup
    Condition: HasSchedule
    DeletionPolicy: Delete
    UpdateReplacePolicy: Delete
    Properties:
      LogGroupName: !Sub "/aws/lambda/${AWS::StackName}-collect"
      RetentionInDays: 14

  CollectRole:
    Type: AWS::IAM::Role
    Condition: HasSchedule
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: {Service: lambda.amazonaws.com}
            Action: sts:AssumeRole
      Policies:
        - PolicyName: collect
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: Logs
                Effect: Allow
                Action: [logs:CreateLogStream, logs:PutLogEvents]
                Resource: !Sub "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-collect:*"
              - Sid: StoreReadWrite
                Effect: Allow
                Action: [s3:GetObject, s3:PutObject]
                Resource: !Sub "${WorkshopBucket.Arn}/store/*"
              - Sid: StoreList
                Effect: Allow
                Action: s3:ListBucket
                Resource: !GetAtt WorkshopBucket.Arn
                Condition:
                  StringLike: {"s3:prefix": "store/*"}
              - Sid: QuotaLedger
                Effect: Allow
                Action: [dynamodb:GetItem, dynamodb:UpdateItem]
                Resource: !GetAtt WorkshopTable.Arn

  CollectFunction:
    # Runs the daily bundle only. The static bundle (about 1,850 calls) exceeds the 15 minute limit and is run locally.
    Type: AWS::Lambda::Function
    Condition: HasSchedule
    DependsOn: CollectLogGroup
    Properties:
      FunctionName: !Sub "${AWS::StackName}-collect"
      Description: Collects the daily snapshot bundle into store/v1 of the workshop bucket.
      Runtime: nodejs22.x
      Architectures: [arm64]
      Handler: collect.handler
      MemorySize: 1024
      Timeout: 900
      Role: !GetAtt CollectRole.Arn
      Code:
        S3Bucket: !Ref WorkshopBucket
        S3Key: !Ref CollectCodeKey
      Environment:
        Variables:
          SEOUL_API_KEY: !Ref SeoulApiKey
          STORE_URI: !Sub "s3://${WorkshopBucket}/store/v1"
          TABLE_NAME: !Ref WorkshopTable
          QUOTA_DAILY_LIMIT: !Ref QuotaDailyLimit

  CollectInvokeConfig:
    # A failed run is not retried: a retry would spend quota again. The next scheduled run picks up where it stopped.
    Type: AWS::Lambda::EventInvokeConfig
    Condition: HasSchedule
    Properties:
      FunctionName: !Ref CollectFunction
      Qualifier: $LATEST
      MaximumRetryAttempts: 0

  CollectScheduleRole:
    Type: AWS::IAM::Role
    Condition: HasSchedule
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: {Service: scheduler.amazonaws.com}
            Action: sts:AssumeRole
            Condition:
              StringEquals: {"aws:SourceAccount": !Ref "AWS::AccountId"}
      Policies:
        - PolicyName: invoke-collect
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: Invoke
                Effect: Allow
                Action: lambda:InvokeFunction
                Resource: !GetAtt CollectFunction.Arn

  CollectDailySchedule:
    Type: AWS::Scheduler::Schedule
    Condition: HasSchedule
    Properties:
      Name: !Sub "${AWS::StackName}-collect-daily"
      Description: Runs the daily snapshot collection.
      ScheduleExpression: !Ref CollectSchedule
      ScheduleExpressionTimezone: Asia/Seoul
      FlexibleTimeWindow: {Mode: "OFF"}
      State: ENABLED
      Target:
        Arn: !GetAtt CollectFunction.Arn
        RoleArn: !GetAtt CollectScheduleRole.Arn
        Input: "{}"
        RetryPolicy: {MaximumRetryAttempts: 0}

  GatewayRole:
    # Name patterns instead of GetAtt: the role exists before the conditional resources do.
```

- [ ] **Step 10: 통과 확인과 템플릿 문법 검사**

Run: `npx vitest run tests/workshopLib.test.ts tests/workshopAws.test.ts tests/infra/workshopTemplate.test.ts`
Expected: PASS

Run: `aws cloudformation validate-template --template-body file://infra/seoul-workshop.yaml --region ap-northeast-2 --query 'Parameters[].ParameterKey' --output text`
Expected: 파라미터 이름 11개(`CollectSchedule`, `CollectCodeKey` 포함). 자격 증명이 없으면 건너뛰고 Task 9에서 확인한다고 보고한다

- [ ] **Step 11: 배포 스크립트와 코드 스크립트 고치기**

`scripts/workshop-deploy.ts`를 여섯 군데 고친다.

import 두 줄을 바꾼다.

바꾸기 전:

```ts
import { aws, awsJson, createStack, deleteStack, describeStack, run, sleep, stackOutputs, updateStack } from './workshop-aws.js'
```

바꾼 뒤:

```ts
import { aws, awsJson, createStack, deleteStack, describeStack, run, sleep, stackOutputs, stackParameterKeys, updateStack } from './workshop-aws.js'
import { bundleCollectLambda } from './workshop-bundle.js'
```

`USAGE`에 한 줄을 추가한다.

바꾸기 전:

```ts
  npm run workshop:deploy -- --delete [--yes]       버킷을 비우고 스택 삭제(--yes가 없으면 계획만 출력)
```

바꾼 뒤:

```ts
  npm run workshop:deploy -- --skip-image --collect-schedule "cron(0 5 * * ? *)"   매일 05:00(KST)에 스냅샷 수집. ""를 주면 끈다
  npm run workshop:deploy -- --delete [--yes]       버킷을 비우고 스택 삭제(--yes가 없으면 계획만 출력)
```

옵션을 추가한다.

바꾸기 전:

```ts
    'quota-daily-limit': { type: 'string' },
    delete: { type: 'boolean', default: false },
```

바꾼 뒤:

```ts
    'quota-daily-limit': { type: 'string' },
    'collect-schedule': { type: 'string' },
    delete: { type: 'boolean', default: false },
```

`checkRuntime` 함수 앞에 수집 코드를 올리는 함수를 추가한다.

바꾸기 전:

```ts
function checkRuntime(runtimeId: string): void {
```

바꾼 뒤:

```ts
/** 수집 Lambda를 묶어 올린다. 스케줄을 켜지 않아도 올려 두어, 나중에 파라미터만 바꿔 켤 수 있게 한다 */
async function uploadCollector(bucket: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'seoul-collect-'))
  try {
    const bundle = join(dir, 'collect.mjs')
    await bundleCollectLambda(bundle)
    const key = codeKeyOf(readFileSync(bundle), 'collect')
    try {
      aws(['s3api', 'head-object', '--bucket', bucket, '--key', key])
      console.log(`수집 코드 ${key}가 이미 있습니다`)
      return key
    } catch {
      // 없으면 아래에서 올린다
    }
    const zip = join(dir, 'collect.zip')
    run('zip', ['-q', '-X', zip, 'collect.mjs'], { cwd: dir })
    aws(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', zip])
    console.log(`수집 코드 ${key}를 올렸습니다`)
    return key
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function checkRuntime(runtimeId: string): void {
```

`main`에서 파라미터를 만드는 부분을 바꾼다.

바꾸기 전:

```ts
  const codeKey = uploadCode(created.BucketName)

  const given: Partial<Record<ParameterName, string>> = { CodeKey: codeKey, ...(keys ?? {}) }
  if (image) given.McpImageUri = image
  if (values['rate-per-minute']) given.RatePerMinute = values['rate-per-minute']
  if (values['quota-daily-limit']) given.QuotaDailyLimit = values['quota-daily-limit']
  console.log(updateStack(stackParameters(given, 'update'), TEMPLATE) ? '스택을 갱신했습니다' : '스택에 바뀐 것이 없습니다')
```

바꾼 뒤:

```ts
  const codeKey = uploadCode(created.BucketName)
  const collectKey = await uploadCollector(created.BucketName)

  const given: Partial<Record<ParameterName, string>> = { CodeKey: codeKey, CollectCodeKey: collectKey, ...(keys ?? {}) }
  if (image) given.McpImageUri = image
  if (values['rate-per-minute']) given.RatePerMinute = values['rate-per-minute']
  if (values['quota-daily-limit']) given.QuotaDailyLimit = values['quota-daily-limit']
  // 빈 문자열도 값이다: 스케줄을 끈다
  if (values['collect-schedule'] !== undefined) given.CollectSchedule = values['collect-schedule']
  const parameters = stackParameters(given, 'update', stackParameterKeys(stack))
  console.log(updateStack(parameters, TEMPLATE) ? '스택을 갱신했습니다' : '스택에 바뀐 것이 없습니다')
```

`scripts/workshop-code.ts`를 세 군데 고친다. 이 스크립트는 이전 템플릿을 그대로 쓰므로, 스택에 아직 없는 파라미터를 보내면 안 된다.

바꾸기 전:

```ts
import { describeStack, stackParameterValue, updateStack } from './workshop-aws.js'
```

바꾼 뒤:

```ts
import { describeStack, stackParameterKeys, stackParameterValue, updateStack } from './workshop-aws.js'
```

바꾸기 전:

```ts
    updateStack(stackParameters({ CodeSha256: sha256Hex(code), CodeValidUntil: until }, 'update'))
```

바꾼 뒤:

```ts
    updateStack(stackParameters({ CodeSha256: sha256Hex(code), CodeValidUntil: until }, 'update', stackParameterKeys(stack)))
```

바꾸기 전:

```ts
    updateStack(stackParameters({ CodeValidUntil: now }, 'update'))
```

바꾼 뒤:

```ts
    updateStack(stackParameters({ CodeValidUntil: now }, 'update', stackParameterKeys(stack)))
```

- [ ] **Step 12: 스크립트 타입 검사와 도움말 확인(AWS를 부르지 않는다)**

Run: `npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck scripts/workshop-deploy.ts scripts/workshop-code.ts scripts/workshop-collect.ts && npm run workshop:deploy -- --help`
Expected: 타입 오류 없음, 사용법에 `--collect-schedule` 줄이 보인다

- [ ] **Step 13: CHANGELOG에 스케줄 항목 추가**

`CHANGELOG.md` 영어 절 0.8.0의 `### Added` 마지막 항목(`- Workshop stack: ...`) 다음에 추가한다.

```markdown
- Optional schedule: `npm run workshop:deploy -- --skip-image --collect-schedule "cron(0 5 * * ? *)"` sets the `CollectSchedule` stack parameter, and an EventBridge Scheduler schedule then runs the daily collection in a Lambda function (`infra/lambda/collect.ts`, bundled with esbuild). Empty by default, in which case the stack creates none of these resources.
```

한국어 절 0.8.0의 `### Added` 마지막 항목 다음에 추가한다.

```markdown
- 선택적 스케줄: `npm run workshop:deploy -- --skip-image --collect-schedule "cron(0 5 * * ? *)"`로 스택 파라미터 `CollectSchedule`을 넣으면 EventBridge Scheduler 스케줄이 Lambda(`infra/lambda/collect.ts`, esbuild로 묶음)로 매일 수집 실행. 기본값은 빈 문자열이고 이때는 관련 리소스를 만들지 않음
```

- [ ] **Step 14: 전체 테스트와 빌드**

Run: `npm test && npm run build && bash tests/harness/run-all.sh`
Expected: 모두 통과

- [ ] **Step 15: 커밋**

```bash
git add infra scripts package.json package-lock.json CHANGELOG.md tests/infra tests/workshopBundle.test.ts tests/workshopLib.test.ts tests/workshopAws.test.ts
git commit -m "feat: add an optional scheduled Lambda for the daily snapshot collection

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 8: 문서

코드 변경은 없다. 문서마다 넣을 문장을 아래에 적었다. 영어와 한국어 절이 함께 있는 문서는 두 절을 모두 고친다. `README.ko.md`는 `README.md`로 안내만 하는 파일이라 고치지 않는다.

표기: Step 1, 2, 4의 한 줄짜리 지시문에서 `\``는 넣을 문장 안의 백틱을 뜻한다. 문서에는 백슬래시 없이 백틱만 쓴다. 코드 블록 안의 문장은 보이는 그대로 넣는다.

**Files:**
- Create: `docs/decisions/ADR-007-snapshot-store-with-server-side-filters.md`
- Modify: `CLAUDE.md`, `src/client/CLAUDE.md`, `scripts/CLAUDE.md`, `infra/CLAUDE.md`, `tests/CLAUDE.md`, `docs/reference/api.md`, `docs/reference/agent-llm.md`, `docs/reference/security.md`, `docs/reference/infrastructure.md`, `docs/reference/iac.md`, `docs/architecture.md`, `docs/workshop.md`, `README.md`, `docs/images/src/arch_ko.py`, `docs/images/src/arch_en.py`, `docs/images/architecture-{ko,en}-{light,dark}.png`

**Interfaces:**
- Consumes: Task 1~7에서 만든 이름과 문구(`STORE_URI`, `npm run workshop:collect`, `사전 적재 데이터(M월 D일 수집)`, `CollectSchedule`)
- Produces: 없음

- [ ] **Step 1: 모듈 규칙 문서**

`CLAUDE.md`(루트):

- `## Tech Stack`의 배포 줄 끝에 `, S3(선택적 사전 적재 저장소, \`@aws-sdk/client-s3\`는 lazy import)`를 붙인다.
- `## Project Structure`의 `src/client/` 줄 다음에 추가한다: `src/store/      사전 적재 저장소: 규칙 표, 규칙 엔진, 스냅샷 형식, 디렉터리와 S3 저장소, 읽기 경로, 수집기, 실제 API 대비 검사`
- 같은 블록의 `scripts/` 줄에서 `workshop-*.ts(워크숍 스택 배포와 코드 관리)`를 `workshop-*.ts(워크숍 스택 배포, 코드 관리, 스냅샷 수집)`로, `infra/` 줄에서 `인터셉터 Lambda(lambda/code-check.mjs)`를 `인터셉터 Lambda(lambda/code-check.mjs), 수집 Lambda(lambda/collect.ts)`로 바꾼다.
- `## Key Commands` 끝에 추가한다: `- \`npm run workshop:collect -- daily|static|status|verify\` - 사전 적재 스냅샷 수집, 상태 조회, 실제 API 대비 검사(실제 API를 부르므로 승인 후에만 실행)`
- `## Auto-Sync Rules`에 추가한다: `- \`src/store/rules.ts\`의 규칙 변경 -> \`tests/store/rules.test.ts\`를 먼저 고치고 \`docs/reference/api.md\`의 저장소 절을 갱신합니다.`

`src/client/CLAUDE.md`:

- `## Key Files`의 `dynamo.ts` 줄에서 `/ \`maybeAttachL2\`(` 앞에 `/ \`createDocClient\`(aws-sdk를 lazy 로드해 문서 클라이언트 생성, 서버와 수집기가 함께 사용) `를 넣는다.
- `## Key Files`의 `response.ts` 줄 끝에 ` \`noDataNote()\`는 INFO-200 문구를 만들고 사전 적재 저장소도 0건일 때 같은 문구를 씁니다.`를 붙인다.
- `## Key Files` 끝에 추가한다: `- \`snapshotSource.ts\` - 사전 적재 저장소의 인터페이스 \`SnapshotSource\`/\`SnapshotHit\`와 안내 문구 \`storeNote()\`. 구현은 \`src/store/reader.ts\`에 있습니다.`
- `## Rules`의 `@aws-sdk/*` 규칙을 다음으로 바꾼다: `- \`@aws-sdk/*\`는 \`dynamo.ts\`의 \`createDocClient()\`와 \`src/store/s3Store.ts\`의 \`createS3Store()\` 안에서만 lazy import합니다(stdio/로컬 경로에 비용을 지우지 않기 위함). 다른 곳에서 top-level import하지 않습니다.`
- `## Rules` 끝에 두 줄을 추가한다:
  - `- \`fetchUnwrapped\`의 순서는 샘플 범위 제한, 사전 적재 저장소 조회(일반 API의 JSON 요청만), 캐시 조회와 키 선택, 서울 API 호출입니다. 저장소가 답한 요청은 캐시, 키 풀, 쿼터 장부를 건드리지 않습니다. 키가 없고 캐시도 없을 때만 기한 지난 스냅샷을 한 번 더 찾습니다.`
  - `- 이 디렉터리는 \`src/store\`를 import하지 않습니다. 저장소는 \`attachStore()\`로 주입받습니다. 저장소 조회 실패도 요청을 실패시키지 않습니다.`

`scripts/CLAUDE.md`:

- `## Key Files` 끝에 두 줄을 추가한다:
  - `- \`workshop-collect.ts\` - \`npm run workshop:collect -- daily|static|status|verify\`. 스택에서 버킷, 테이블, 하루 한도를 읽고 \`src/store/collector.ts\`와 \`verify.ts\`를 실행합니다. \`--store <디렉터리>\`를 주면 로컬에 저장합니다.`
  - `- \`workshop-bundle.ts\` - 수집 Lambda(\`infra/lambda/collect.ts\`)를 esbuild로 한 파일로 묶습니다. \`tests/workshopBundle.test.ts\`가 검사합니다.`
- `## Rules` 끝에 추가한다: `- \`workshop-collect.ts\`의 \`daily\`, \`static\`, \`verify\`는 실제 서울 API를 불러 쿼터를 쓰고 워크숍 버킷에 씁니다. 사용자 승인 뒤에만 실행합니다. \`--help\`, \`--dry-run\`, \`status\`는 서울 API를 부르지 않습니다.`

`infra/CLAUDE.md`:

- `## Role`의 첫 문장 끝에 ` 사전 적재 저장소(버킷의 \`store/v1/\`)와 선택적 수집 스케줄의 설계는 \`docs/superpowers/specs/2026-11-21-snapshot-store-design.md\`입니다.`를 붙인다.
- `## Key Files`의 `seoul-workshop.yaml` 줄 끝에 ` 런타임은 \`STORE_URI\`로 버킷의 \`store/v1/\`을 읽고, \`CollectSchedule\`을 넣으면 수집 Lambda와 EventBridge 스케줄이 생깁니다(\`HasSchedule\`).`를 붙인다.
- `## Key Files` 끝에 추가한다: `- \`lambda/collect.ts\` - 매일 묶음 스냅샷을 수집하는 Lambda 진입점. \`scripts/workshop-bundle.ts\`가 \`collect.mjs\`로 묶어 \`code/\` 아래에 올립니다.`
- `## Rules`의 "워크숍 스택에서 서울 API 키는 런타임 환경 변수에" 줄에서 `런타임 환경 변수에`를 `런타임과 수집 Lambda의 환경 변수에`로 바꾼다.
- `## Rules` 끝에 추가한다: `- 버킷의 \`store/\` 아래 객체는 90일 뒤에 지워집니다. 런타임 역할은 \`store/*\`를 읽기만 하고, 쓰기는 수집 Lambda 역할과 진행자의 자격 증명만 합니다.`

`tests/CLAUDE.md`의 `## Key Files`에서 `harness/` 줄 앞에 세 줄을 추가한다:

- `- \`store/\` - 사전 적재 저장소 테스트: 스냅샷 형식, 규칙 표와 카탈로그의 일관성, 규칙 엔진, 디렉터리와 S3 저장소(가짜 클라이언트), 읽기 경로, 수집기, 실제 API 대비 검사, tool 출력 동등성(\`parity.test.ts\`). 서울 API와 AWS를 부르지 않습니다.`
- `- \`infra/collectLambda.test.ts\` - 수집 Lambda의 \`runDaily\`가 실패를 던지고 로그에 원문 키를 남기지 않는지 검사합니다.`
- `- \`workshopBundle.test.ts\` - 수집 Lambda가 \`handler\`를 내보내는 한 파일로 묶이고 AWS SDK가 빠지는지 검사합니다.`

- [ ] **Step 2: 참조 문서(`docs/reference/`)**

`docs/reference/api.md`의 영어 절 `### 3. Key Decisions` 목록 끝에 추가한다.

```markdown
- **Snapshot store before the cache.** With `STORE_URI` set, `fetchUnwrapped` asks the snapshot store first for JSON requests to the general API. The store answers only what its rule table (`src/store/rules.ts`) allows: a service with a rule, positions marked equal or contains, and partition values that pass a format check. It returns the same `Unwrapped` shape, so tools and normalizers are unchanged. A store answer adds the note `사전 적재 데이터(M월 D일 수집)`; an empty store answer carries only the upstream no-data note, which `isNoData()` relies on. Anything else falls through to the cache and the Seoul API.
- **Expired snapshots only as a last resort.** Each dataset has a maximum age (24 hours for reservations, 3 days for cultural events, 7 days for most, 30 days for timetables, none for past-date statistics). An expired snapshot is used only when no key is usable and the cache has nothing, and the note then says so.
```

`### 4. Code Pointers`에 추가한다.

```markdown
- `src/store/rules.ts` and `src/store/engine.ts`: the rule table and the pure functions that pick a snapshot and apply filters, range, and maximum age.
- `src/store/reader.ts`: in-process snapshot memory (96 MB), ETag revalidation after 10 minutes, a 3-second read timeout.
- `src/client/snapshotSource.ts`: the `SnapshotSource` interface the client knows, and the note text.
```

한국어 절 `### 3. 주요 결정` 목록 끝에 추가한다.

```markdown
- **캐시보다 사전 적재 저장소가 먼저입니다.** `STORE_URI`를 설정하면 `fetchUnwrapped`가 일반 API의 JSON 요청을 저장소에 먼저 묻습니다. 저장소는 규칙 표(`src/store/rules.ts`)가 허용한 것만 답합니다. 규칙이 있는 서비스, 일치나 부분일치로 표시한 자리, 형식 검사를 통과한 파티션 값입니다. 응답은 같은 `Unwrapped` 형태라서 tool과 정규화 함수는 그대로입니다. 저장소가 답하면 `사전 적재 데이터(M월 D일 수집)` 안내가 붙고, 0건이면 서울 API와 같은 "데이터 없음" 문구만 붙습니다. `isNoData()`가 이 문구로 판단합니다. 나머지 요청은 캐시와 서울 API로 갑니다.
- **기한 지난 스냅샷은 마지막 수단입니다.** 데이터셋마다 기한이 있습니다(공공예약 24시간, 문화행사 3일, 대부분 7일, 시간표 30일, 지난 날짜 통계는 없음). 기한이 지난 스냅샷은 쓸 키가 없고 캐시에도 없을 때만 쓰고, 안내 문구에 그 사실을 적습니다.
```

`### 4. 코드 포인터`에 추가한다.

```markdown
- `src/store/rules.ts`, `src/store/engine.ts`: 규칙 표와, 스냅샷을 고르고 필터, 범위, 기한을 적용하는 순수 함수.
- `src/store/reader.ts`: 프로세스 메모리 보관(96MB), 10분 뒤 ETag 재확인, 읽기 시간 제한 3초.
- `src/client/snapshotSource.ts`: 클라이언트가 아는 `SnapshotSource` 인터페이스와 안내 문구.
```

`docs/reference/agent-llm.md`의 영어 절 `### 3. Key Decisions` 끝에 추가한다.

```markdown
- **Pre-collected data is labeled.** When the snapshot store answers, `notes` carries `사전 적재 데이터(M월 D일 수집)` (collection date in KST). The envelope's `asOf` is still the response time, so the note is the only sign that the data is from an earlier collection. When an expired snapshot is used because the Seoul API is unavailable, the note reads `일일 API 쿼터 소진. 기한이 지난 사전 적재 데이터(M월 D일 수집, 약 N일 경과)로 응답합니다` or the same with `서울 API 호출 제한.` at the front.
```

한국어 절 `### 3. 주요 결정` 끝에 추가한다.

```markdown
- **미리 받아 둔 데이터에는 표시를 붙입니다.** 사전 적재 저장소가 답하면 `notes`에 `사전 적재 데이터(M월 D일 수집)`(수집 날짜는 KST)가 들어갑니다. 봉투의 `asOf`는 응답 시각이라서, 이 문구가 며칠 전에 받은 데이터임을 알리는 유일한 표시입니다. 서울 API를 쓸 수 없어 기한 지난 스냅샷으로 답할 때는 `일일 API 쿼터 소진. 기한이 지난 사전 적재 데이터(M월 D일 수집, 약 N일 경과)로 응답합니다` 또는 앞부분이 `서울 API 호출 제한.`인 문구가 들어갑니다.
```

`docs/reference/security.md`의 영어 절 `### 3. Key Decisions` 끝에 추가한다.

```markdown
- **Partition values are checked before they become a key.** A participant can pass any string through `call_dataset`, and a partition value becomes part of an S3 key or a file path. Each partition position has a format (`^\d{8}$`, `^[1-9]호선$`, and so on) and only values that pass are used; anything else is not answered by the store. `DirectoryStore` also refuses keys that resolve outside its root.
- **The collector shows keys only masked.** `npm run workshop:collect` reads keys from `.env.workshop`, prints them through `maskKey()`, and records its calls in the same quota ledger as the runtime. With the schedule enabled, the collector Lambda holds the Seoul API keys in its environment, so `lambda:GetFunctionConfiguration` on it is equivalent to reading the keys.
```

한국어 절 `### 3. 주요 결정` 끝에 추가한다.

```markdown
- **파티션 값은 키가 되기 전에 형식을 검사합니다.** 참가자는 `call_dataset`으로 어떤 문자열이든 넘길 수 있고, 파티션 값은 S3 키나 파일 경로의 일부가 됩니다. 파티션 자리마다 형식(`^\d{8}$`, `^[1-9]호선$` 등)이 있어 통과한 값만 쓰고, 나머지는 저장소가 답하지 않습니다. `DirectoryStore`도 루트 밖으로 풀리는 키를 거부합니다.
- **수집기는 키를 마스킹해서만 보여 줍니다.** `npm run workshop:collect`는 `.env.workshop`에서 키를 읽어 `maskKey()`로만 출력하고, 호출을 런타임과 같은 쿼터 장부에 기록합니다. 스케줄을 켜면 수집 Lambda의 환경 변수에도 서울 API 키가 들어가므로, 그 함수의 `lambda:GetFunctionConfiguration` 권한은 키 읽기 권한과 같습니다.
```

`docs/reference/infrastructure.md`의 영어 절 구성요소 표에서 세 행을 고치고 한 행을 추가한다.

- `Workshop runtime` 행의 마지막 문장을 `Receives \`SEOUL_API_KEY\`, \`SEOUL_SUBWAY_API_KEY\`, \`CACHE_TABLE_NAME\`, \`QUOTA_DAILY_LIMIT\` and \`STORE_URI\` as environment variables`로 바꾼다.
- `Workshop bucket` 행의 설명을 `Holds the Lambda zips under \`code/\` and the pre-collected snapshots under \`store/v1/\` (gzip JSON, one object per dataset or partition, deleted after 90 days). Public access blocked, SSE-S3`로 바꾼다.
- `IAM roles` 행의 `Runtime:` 부분 끝에 `, read \`store/*\` in the bucket`을 붙인다.
- `Interceptor Lambda` 행 다음에 추가한다: `| Collector Lambda (optional) | \`infra/lambda/collect.ts\`, \`CollectFunction\`, \`CollectDailySchedule\` | Created only when \`CollectSchedule\` is set. \`nodejs22.x\`, arm64, 1024 MB, 15-minute timeout. An EventBridge Scheduler schedule in Asia/Seoul runs the daily collection; failed runs are not retried |`

한국어 절의 같은 행도 같은 내용으로 고친다.

- `워크숍 런타임` 행의 환경 변수 목록에 `STORE_URI`를 넣는다.
- `워크숍 버킷` 행의 설명을 `Lambda zip을 \`code/\` 아래에, 사전 적재 스냅샷을 \`store/v1/\` 아래에 둡니다(gzip JSON, 데이터셋이나 파티션마다 객체 하나, 90일 뒤 삭제). 퍼블릭 액세스 차단, SSE-S3`로 바꾼다.
- `IAM 역할` 행의 런타임 부분 끝에 `, 버킷의 \`store/*\` 읽기`를 붙인다.
- 인터셉터 Lambda 행 다음에 추가한다: `| 수집 Lambda(선택) | \`infra/lambda/collect.ts\`, \`CollectFunction\`, \`CollectDailySchedule\` | \`CollectSchedule\`을 넣었을 때만 만듭니다. \`nodejs22.x\`, arm64, 1024MB, 제한 시간 15분. EventBridge Scheduler 스케줄(Asia/Seoul)이 매일 수집을 실행하고, 실패한 실행은 다시 시도하지 않습니다 |`

`docs/reference/iac.md`의 구성요소 표에서 두 행을 고친다.

- 영어 `Stack template` 행의 설명을 `Eleven parameters, four conditions, sixteen resources and seven outputs. Declares the table, bucket, three IAM roles, runtime, interceptor log group and function, gateway and gateway target, and behind \`HasSchedule\` the collector log group, role, function, invoke config, schedule role and schedule`로 바꾼다.
- 영어 `Conditions` 행의 조건 목록에 `HasSchedule`을 넣고 설명 끝에 ` The collector resources need \`HasSchedule\`, which holds when both \`CollectSchedule\` and \`CollectCodeKey\` are set`을 붙인다.
- 한국어 `스택 템플릿` 행의 설명을 `파라미터 11개, 조건 4개, 리소스 16개, 출력 7개입니다. 테이블, 버킷, IAM 역할 3개, 런타임, 인터셉터 로그 그룹과 함수, Gateway, Gateway 대상을 선언하고, \`HasSchedule\` 조건 아래에 수집 로그 그룹, 역할, 함수, 호출 설정, 스케줄 역할, 스케줄을 선언합니다`로 바꾼다.
- 한국어 `조건` 행의 조건 목록에 `HasSchedule`을 넣고 설명 끝에 ` 수집 리소스는 \`CollectSchedule\`과 \`CollectCodeKey\`가 모두 있을 때 참인 \`HasSchedule\`이 필요합니다`를 붙인다.

영어 절 `### 3. Key Decisions` 끝에 추가한다.

```markdown
- **New parameters are left out on update.** CloudFormation rejects `UsePreviousValue` for a parameter the stack does not have yet. `stackParameters()` takes the stack's current parameter names and omits any parameter that is neither given nor present, so the template default applies. `workshop:code`, which reuses the previous template, relies on the same rule.
- **The schedule is a parameter, not a separate stack.** `CollectSchedule` and `CollectCodeKey` gate six resources through `HasSchedule`. The deploy script always uploads the collector bundle, so turning the schedule on or off is a parameter change.
```

한국어 절 `### 3. 주요 결정` 끝에 추가한다.

```markdown
- **새 파라미터는 갱신 때 빼고 보냅니다.** CloudFormation은 스택에 아직 없는 파라미터에 `UsePreviousValue`를 받지 않습니다. `stackParameters()`가 스택의 현재 파라미터 이름을 받아, 값을 주지 않았고 스택에도 없는 파라미터는 빼서 템플릿 기본값이 쓰이게 합니다. 이전 템플릿을 그대로 쓰는 `workshop:code`도 같은 규칙에 기댑니다.
- **스케줄은 별도 스택이 아니라 파라미터입니다.** `CollectSchedule`과 `CollectCodeKey`가 `HasSchedule` 조건으로 리소스 6개를 켜고 끕니다. 배포 스크립트가 수집 코드 묶음을 항상 올려 두므로 스케줄을 켜고 끄는 일은 파라미터 변경입니다.
```

- [ ] **Step 3: ADR-007과 아키텍처 문서**

`docs/decisions/ADR-007-snapshot-store-with-server-side-filters.md` (새 파일):

```markdown
# ADR-007: S3 스냅샷과 서버 필터로 느린 데이터에 답하기 (Snapshot Store with Server-Side Filters)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>
# English

## Status
Accepted (2026-11-21)

## Context
The cache is read-through and keyed by the request URL. Two kinds of request therefore still reach the Seoul API in every session: requests with free-text arguments (a pharmacy name, an event title), because every argument combination is its own cache entry, and responses larger than 380 KB (public reservations, cultural events), because the DynamoDB tier does not store them. With a workshop of many participants these spend the daily quota even though the data changes once a day or less.

## Options Considered

### Option A (chosen): Snapshots in S3 and filtering in the server
- **Pros**: Free-text arguments are filtered by the server, so any combination is answered. No size limit. A maximum age per dataset. About 2,000 objects.
- **Cons**: The filter behavior of the Seoul API has to be written again in the server.

### Option B: Warm the existing cache
- **Pros**: No new read path.
- **Cons**: Only the listed argument combinations hit. Responses over 380 KB are still not shared. Entries expire after 24 hours.

### Option C: Store rows in DynamoDB
- **Pros**: A maximum age per dataset, no item size problem.
- **Cons**: A contains filter has to read a whole partition, and collection writes hundreds of thousands of items.

## Decision
Slow-changing datasets (37 of the 52 in the catalog) are collected ahead of time into gzip JSON snapshots under `store/v1/` in the workshop bucket. `SeoulApiClient.fetchUnwrapped` asks the store after the sample clamp and before the cache and the key pool, so a request the store answers makes no upstream call and stored data keeps answering when every key is exhausted.

The store answers only what an allowlist permits (`src/store/rules.ts`): a service with a rule, positions marked equal or contains, and partition values that pass a format check. Everything else falls through to the existing path, so a missing rule costs one extra call and never a wrong answer. `npm run workshop:collect -- verify` compares the store with the live API and decides the positions whose meaning the documentation does not state.

The feature is off unless `STORE_URI` is set. Collection is a local command; a scheduled Lambda is optional and off by default.

## Consequences
- The filter rules must be kept in step with the Seoul API. `verify` is the check, and the tools keep their own duplicate filters.
- Data can be up to its maximum age old. Every store answer carries the collection date in `notes`.
- `@aws-sdk/client-s3` is a new dependency, imported lazily.
- Real-time datasets and real-estate datasets are not covered; they belong to later sub-projects.

---

<a id="korean"></a>
# 한국어

## 상태
채택 (2026-11-21)

## 배경
캐시는 요청 URL을 키로 쓰는 read-through 방식입니다. 그래서 두 종류의 요청은 세션마다 서울 API까지 갑니다. 하나는 약국명이나 행사 제목 같은 자유 인자가 든 요청입니다. 인자 조합마다 캐시 항목이 따로 생기기 때문입니다. 다른 하나는 380KB를 넘는 응답(공공예약, 문화행사)입니다. DynamoDB 계층이 저장하지 않기 때문입니다. 참가자가 많은 워크숍에서는 하루에 한 번도 바뀌지 않는 데이터가 하루 쿼터를 씁니다.

## 검토한 선택지

### 선택지 A (채택): S3 스냅샷과 서버 필터
- **장점**: 자유 인자를 서버가 직접 걸러 어떤 조합에도 답합니다. 크기 제한이 없습니다. 데이터셋별로 기한을 정합니다. 객체는 약 2,000개입니다.
- **단점**: 서울 API의 필터 동작을 서버에 다시 적어야 합니다.

### 선택지 B: 기존 캐시 예열
- **장점**: 새 읽기 경로가 없습니다.
- **단점**: 미리 나열한 조합만 적중합니다. 380KB를 넘는 응답은 여전히 공유되지 않습니다. 항목이 24시간 뒤 사라집니다.

### 선택지 C: DynamoDB에 행 단위 저장
- **장점**: 데이터셋별 기한, 항목 크기 문제 없음.
- **단점**: 부분일치 필터는 파티션 전체를 읽어야 하고, 수집 때 쓰기가 수십만 건입니다.

## 결정
하루 단위 이상으로 바뀌는 데이터셋(카탈로그 52종 중 37종)을 미리 받아 워크숍 버킷의 `store/v1/` 아래에 gzip JSON 스냅샷으로 둡니다. `SeoulApiClient.fetchUnwrapped`는 샘플 범위 제한 다음, 캐시와 키 풀보다 앞에서 저장소를 조회합니다. 저장소가 답한 요청은 서울 API 호출이 0회이고, 모든 키가 소진돼도 저장된 데이터는 계속 답합니다.

저장소는 허용 목록(`src/store/rules.ts`)이 허용한 것만 답합니다. 규칙이 있는 서비스, 일치나 부분일치로 표시한 자리, 형식 검사를 통과한 파티션 값입니다. 나머지는 기존 경로로 넘어가므로 규칙이 모자라면 호출이 한 번 더 나갈 뿐 틀린 답은 나가지 않습니다. `npm run workshop:collect -- verify`가 저장소와 실제 API를 비교하고, 문서에 의미가 적혀 있지 않은 자리를 정합니다.

`STORE_URI`를 설정하지 않으면 꺼져 있습니다. 수집은 로컬 명령으로 하고, 스케줄 Lambda는 선택 사항이며 기본값은 꺼짐입니다.

## 결과
- 필터 규칙을 서울 API와 맞춰 두어야 합니다. `verify`가 그 검사이고, tool은 자기 쪽의 중복 필터를 그대로 둡니다.
- 데이터는 기한만큼 오래됐을 수 있습니다. 저장소가 답한 응답은 `notes`에 수집 날짜를 싣습니다.
- 새 의존성 `@aws-sdk/client-s3`가 생기고 lazy import합니다.
- 실시간 데이터셋과 부동산 데이터셋은 대상이 아닙니다. 뒤의 하위 프로젝트에서 다룹니다.
```

`docs/architecture.md`의 영어 절을 고친다.

- `### Ingestion Layer` 목록 끝에 추가한다: `- **\`src/store/\`** (\`STORE_RULES\`, \`planRequest\`, \`answerFrom\`, \`SnapshotReader\`, \`collect\`) -- Optional snapshot store. With \`STORE_URI\` set, \`SeoulApiClient\` asks it before the cache and the key pool for JSON requests to the general API. It answers 37 slow-changing datasets from gzip JSON snapshots (a directory or S3), applying the argument filters and the row range itself; anything its rule table does not allow falls through unchanged. \`npm run workshop:collect\` fills it through the same client and records its calls in the quota ledger.`
- `## Full Architecture Diagram`의 mermaid에서 `subgraph ingestion` 안의 `CLIENT --> CACHE[("L1 InMemoryCache + optional L2 DynamoDbCache")]` 줄 다음에 두 줄을 추가한다.

```
    CLIENT -.->|"STORE_URI set, asked first"| STORE[("Snapshot store<br/>S3 store/v1 or a directory")]
    COLLECTOR["workshop:collect<br/>local command or scheduled Lambda"] -->|"gzip JSON snapshots"| STORE
```

- `## Data Flow Summary`의 mermaid에서 첫 줄(`Agent(["LLM Agent"]) --> Tool["MCP Tool"] --> Client[...] --> API(...)`) 다음에 한 줄을 추가한다.

```
  Client -.->|"slow data, if STORE_URI"| Store[("Snapshot store")] -.-> Normalize
```

- `## Key Design Decisions` 목록 끝에 추가한다: `- **Slow data from snapshots, filtered in the server** -- Pre-collect the 37 datasets that change once a day or less into S3 snapshots and answer them before the cache, so free-text arguments and responses over 380 KB stop spending the daily quota. The store answers only what an allowlist permits and everything else takes the existing path. Recorded as [ADR-007](decisions/ADR-007-snapshot-store-with-server-side-filters.md).`

한국어 절도 같은 네 곳을 고친다.

- 수집 계층 목록 끝: `- **\`src/store/\`** (\`STORE_RULES\`, \`planRequest\`, \`answerFrom\`, \`SnapshotReader\`, \`collect\`) -- 선택적 사전 적재 저장소입니다. \`STORE_URI\`를 설정하면 \`SeoulApiClient\`가 일반 API의 JSON 요청을 캐시와 키 풀보다 먼저 저장소에 묻습니다. 느린 데이터 37종을 gzip JSON 스냅샷(디렉터리 또는 S3)으로 답하고, 인자 필터와 행 범위를 직접 적용합니다. 규칙 표가 허용하지 않는 요청은 그대로 지나갑니다. \`npm run workshop:collect\`가 같은 클라이언트로 저장소를 채우고 호출을 쿼터 장부에 기록합니다.`
- `## 전체 아키텍처 다이어그램`과 `## 데이터 흐름 요약`의 mermaid는 영어 절과 같은 내용이다. 같은 자리에 같은 세 줄을 추가한다.
- 주요 설계 결정 끝: `- **느린 데이터는 스냅샷으로, 필터는 서버에서** -- 하루에 한 번 이하로 바뀌는 37종을 미리 받아 S3 스냅샷으로 두고 캐시보다 먼저 답합니다. 자유 인자와 380KB를 넘는 응답이 하루 쿼터를 쓰지 않게 됩니다. 저장소는 허용 목록이 허용한 것만 답하고 나머지는 기존 경로로 갑니다. [ADR-007](decisions/ADR-007-snapshot-store-with-server-side-filters.md)에 기록했습니다.`

- [ ] **Step 4: 워크숍 안내와 README**

`docs/workshop.md`의 `### 처음 한 번` 절 끝에 추가한다.

````markdown
배포한 뒤 시간표 스냅샷을 한 번 받아 둡니다. 약 1,850회를 부르므로 워크숍 당일이 아닌 날에 합니다. 도중에 끊기면 다시 실행해 이어 받습니다.

```bash
npm run workshop:collect -- static --dry-run   # 계획과 남은 한도 확인
npm run workshop:collect -- static
```
````

`### 워크숍 전날` 절의 코드 블록 앞에 추가한다.

````markdown
스냅샷을 새로 받습니다. 약 100회를 부르고 몇 분 걸립니다. 참가자 요청 가운데 약국, 공영주차장 안내, 문화행사, 공공예약, 승하차 통계, 시간표는 이 스냅샷으로 답하므로 서울 API를 부르지 않습니다.

```bash
npm run workshop:collect -- daily
npm run workshop:collect -- status    # 모든 데이터셋이 "기한 내" 또는 "기한 없음"인지 확인
```

공공예약은 기한이 24시간이라 워크숍 당일 아침에 `daily`를 한 번 더 돌리면 좋습니다. 매일 자동으로 받으려면 `npm run workshop:deploy -- --skip-image --collect-schedule "cron(0 5 * * ? *)"`로 스케줄을 켭니다.
````

`### 워크숍 중`의 표에 한 행을 추가한다: `| 스냅샷이 오래됨(응답의 수집 날짜가 지난 날짜) | \`npm run workshop:collect -- daily\`. 10분 안에 런타임에 반영됩니다 |`

`README.md`의 영어 절을 고친다.

- AgentCore 배포 절의 환경 변수 표(`QUOTA_DAILY_LIMIT` 행 다음)에 추가한다: `| \`STORE_URI\` | Optional — \`s3://<bucket>/store/v1\` or a directory holding pre-collected snapshots. When set, 37 slow-changing datasets are answered from snapshots before the cache and the Seoul API. See [docs/workshop.md](docs/workshop.md). | (unset) |`
- `## Architecture`의 목록 끝에 추가한다: `- With \`STORE_URI\` set, slow-changing datasets are answered from pre-collected snapshots with no upstream call, and the response \`notes\` carry the collection date (recorded as [ADR-007](docs/decisions/ADR-007-snapshot-store-with-server-side-filters.md)).`
- `## Project Structure`의 `client/` 줄 다음에 추가한다: `    store/           # Optional snapshot store: rules, engine, S3/directory stores, reader, collector`
- `## Testing`의 단위 테스트 수 주석이 실제와 다르면 `npm test` 출력의 수로 고친다.

한국어 절의 같은 세 곳도 고친다.

- 환경 변수 표: `| \`STORE_URI\` | 선택 사항. 미리 받아 둔 스냅샷이 있는 \`s3://<버킷>/store/v1\` 또는 디렉터리. 설정하면 느린 데이터 37종을 캐시와 서울 API보다 먼저 스냅샷으로 답합니다. [docs/workshop.md](docs/workshop.md) 참조. | (미설정) |`
- 아키텍처 목록 끝: `- \`STORE_URI\`를 설정하면 느린 데이터는 미리 받아 둔 스냅샷으로 답해 서울 API를 부르지 않고, 응답의 \`notes\`에 수집 날짜가 들어갑니다([ADR-007](docs/decisions/ADR-007-snapshot-store-with-server-side-filters.md)).`
- 프로젝트 구조: `    store/           # 선택적 사전 적재 저장소: 규칙, 엔진, S3와 디렉터리 저장소, 읽기 경로, 수집기`

- [ ] **Step 5: README 인포그래픽 문구와 다시 만들기**

`docs/images/src/arch_ko.py`에서 네 값을 바꾼다.

- 첫 줄 docstring의 `v0.7.0`을 `v0.8.0`으로
- `sub_ko="v0.7.0 구조 요약"`을 `sub_ko="v0.8.0 구조 요약"`으로
- `("SeoulApiClient", "키 풀, 캐시, 재시도 1회", "purple", False)`를 `("SeoulApiClient", "저장소, 키 풀, 캐시, 재시도", "purple", False)`로
- `insight=("키와 무관한 캐시 공유", "캐시 키의 키 자리를 {key}로 치환, 어느 키로 받은 응답이든 재사용")`을 `insight=("사전 적재 저장소 우선 조회", "느린 데이터 37종은 S3 스냅샷으로 응답, 서울 API 호출 0회")`로
- `note="v0.7.0 기준, 수치는 기본 설정값"`을 `note="v0.8.0 기준, 수치는 기본 설정값"`으로

`docs/images/src/arch_en.py`에서 같은 값을 바꾼다.

- 첫 줄 docstring의 `v0.7.0`을 `v0.8.0`으로
- `sub_ko="as of v0.7.0"`을 `sub_ko="as of v0.8.0"`으로
- `("SeoulApiClient", "key pool, cache, one retry", "purple", False)`를 `("SeoulApiClient", "store, key pool, cache, retry", "purple", False)`로
- `insight=(...)`를 `insight=("Snapshot store first", "37 slow-changing datasets are answered from S3 snapshots with no upstream call")`로
- `note="As of v0.7.0. Numbers are default settings"`를 `note="As of v0.8.0. Numbers are default settings"`로

그림은 `aws-infographic` skill의 `infokit.py`, `buildkit.py`로 다시 만든다. 이 단계는 하위 에이전트에 맡기지 않고 진행자가 직접 한다. 이 머신에서 필요한 준비(메모리 `readme-infographic-build`):

1. 임시 디렉터리에 venv를 만들고 `pip install playwright pillow`. Chromium은 `~/.cache/ms-playwright/chromium-*/chrome-linux-arm64/chrome`을 `executable_path`로 넘긴다(브라우저를 새로 받지 않는다).
2. 글꼴은 `~/.local/share/fonts/nanumsquare-otf`와 `d2coding`을 임시 디렉터리의 `nanumsquare`, `d2coding`으로 심볼릭 링크하고 `INFOKIT_FONTS`로 지정한다.
3. `AWS_ICON_BUNDLE=~/.claude/plugins/marketplaces/my-plugins/skills/aws-diagram/assets/icons.json`.
4. `infokit.py`, `buildkit.py`를 skill 문서의 코드 블록에서 그대로 꺼내 `docs/images/src/`의 세 파일과 같은 임시 디렉터리에 두고 `python3 buildkit.py build arch_ko:architecture-ko arch_en:architecture-en`을 실행한다.
5. buildkit의 이슈(넘침, 겹침, 금지 문자)가 0건이어야 한다. 문구가 넘치면 SeoulApiClient 설명을 `저장소, 키 풀, 캐시`(영어 `store, key pool, cache`)로 줄인다.
6. 2x PNG 네 장을 Pillow로 256색(디더링 없음)으로 줄여 `docs/images/architecture-{ko,en}-{light,dark}.png`를 덮어쓴다.

Expected: PNG 네 장이 바뀌고, 각 파일이 300KB를 넘지 않는다. 그림을 열어 SeoulApiClient 상자와 콜아웃의 글자가 상자 안에 있는지 눈으로 확인한다

- [ ] **Step 6: 문서 검사**

Run: `npm test && bash tests/harness/run-all.sh`
Expected: 모두 통과(구조 검사가 `src/store/CLAUDE.md`와 `docs/reference/` 연결을 본다)

Run: `grep -rn "0\.7\.0" README.md CLAUDE.md docs/api-reference.md docs/images/src manifest.json package.json src/index.ts`
Expected: 출력 없음

Run: `grep -rnF '\`' CLAUDE.md README.md src/client/CLAUDE.md src/store/CLAUDE.md scripts/CLAUDE.md infra/CLAUDE.md tests/CLAUDE.md docs/reference docs/architecture.md docs/workshop.md docs/decisions/ADR-007-snapshot-store-with-server-side-filters.md`
Expected: 출력 없음(지시문의 백슬래시가 문서에 들어가지 않았다)

- [ ] **Step 7: 커밋**

```bash
git add CLAUDE.md src/client/CLAUDE.md scripts/CLAUDE.md infra/CLAUDE.md tests/CLAUDE.md docs README.md
git commit -m "docs: document the snapshot store, the collector, and ADR-007

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 9: 실제 수집, 규칙 확정, 배포, 검증 (사용자 승인 필요)

이 태스크는 실제 서울 API를 부르고, 워크숍 버킷에 쓰고, ECR에 이미지를 올리고, 스택을 갱신한다. 하위 에이전트에 맡기지 않고 진행자가 사용자와 함께 한 단계씩 한다. 판정은 쿼터 장부의 `used` 값으로 한다(스펙 §8.3).

**Files:**
- Modify(검사 결과에 따라): `src/store/rules.ts`, `tests/store/rules.test.ts`, `docs/superpowers/specs/2026-11-21-snapshot-store-design.md`(4.2, 9.1), `docs/workshop.md`(검증 기록), `infra/seoul-workshop.yaml`과 `tests/infra/workshopTemplate.test.ts`(403이 나올 때만)

**Interfaces:**
- Consumes: `npm run workshop:collect`, `npm run workshop:deploy`, `npm run workshop:code`, 스택 출력 `GatewayUrl`, `RuntimeId`
- Produces: 버킷의 `store/v1/` 스냅샷, 이미지 `0.8.0-workshop-<커밋 7자>`, 갱신된 스택, 검증 기록

- [ ] **Step 1: 사전 확인(AWS와 서울 API를 부르지 않는다)**

Run: `git status --short && npm test && npm run build`
Expected: 작업 트리가 깨끗하고 모두 통과

- [ ] **Step 2: 사용자 승인**

아래 범위를 사용자에게 보여 주고 승인을 받는다. 승인이 없으면 여기서 멈춘다.

- 서울 API 호출: `daily` 최대 144회(첫 실행), `verify` 약 50회. 키 3개의 하루 한도 합계는 3,000회다
- 워크숍 버킷의 `store/v1/`에 스냅샷 약 60개 쓰기
- ECR 저장소 `seoul-opendata-mcp`에 이미지 `0.8.0-workshop-<커밋 7자>` 푸시. `latest`와 `X.Y.Z` 태그는 옮기지 않는다
- 스택 `seoul-workshop` 갱신: 런타임 새 버전(이미지와 `STORE_URI`), 런타임 역할 정책, 버킷 수명 규칙, 새 파라미터 두 개(스케줄은 켜지 않는다)
- 검증용 워크숍 코드 1일짜리 발급과 검증 뒤 폐기

- [ ] **Step 3: 수집 계획 확인과 실제 수집**

Run: `npm run workshop:collect -- daily --dry-run`
Expected: 키별 `used/limit`(마스킹한 키), 데이터셋 35종의 계획, `예상 호출 합계(상한): 144회`, 남은 한도 합계가 144회보다 크다

Run: `npm run workshop:collect -- daily`
Expected: `[daily] 수집 결과`의 모든 줄에 `실패`가 없다. 실제 호출 합계는 약 125회(공개 전 날짜 확인 포함). 종료 코드 0. 실패가 있으면 원인을 보고 같은 명령을 다시 실행한다(1시간 안에 받은 것은 건너뛴다)

Run: `npm run workshop:collect -- status`
Expected: 매일 묶음 35종이 `기한 내` 또는 `기한 없음`. 정적 묶음 2종은 `없음`

- [ ] **Step 4: 실제 API 대비 검사와 규칙 확정**

Run: `npm run workshop:collect -- verify`
Expected: 호출 합계 약 50회. `검증으로 결정할 자리` 네 줄이 나온다

결과를 아래 표대로 처리한다.

| 결과 | 조치 |
|---|---|
| 결정 `일치` | `src/store/rules.ts`에서 그 자리의 `undecided('X')`를 `eq('X')`로 바꾼다 |
| 결정 `부분일치` | `undecided('X')`를 `contains('X')`로 바꾼다 |
| 결정 `둘 다 맞음`(예시 값에 맞는 행이 없어 구분 못 함) 또는 `재현 못 함` | 그대로 둔다(미지원). 그 자리에 값이 온 요청은 서울 API로 간다 |
| 가정이 아닌 요청의 `실패` | 그 자리를 `unsupported('X')`로 바꾼다. 인자 없는 요청이 실패하면 수집 뒤 데이터가 바뀐 것인지 먼저 본다(공공예약은 접수 상태가 수시로 바뀐다). 다시 수집하고 바로 검사해도 실패하면 그 서비스의 규칙을 지운다 |
| `순서`(행은 같고 순서만 다름) | 전체 건수가 1,000건 이하면 그대로 두고 검증 기록에 적는다. 1,000건을 넘는데 순서가 다르면 그 자리를 `unsupported('X')`로 바꾼다 |

규칙을 바꿨으면 `tests/store/rules.test.ts`의 `검증으로 결정할 자리 네 개는 미지원으로 시작한다` 테스트를 `검증으로 정하지 못한 자리만 미지원으로 남는다`로 이름을 바꾸고 기대 목록을 남은 자리로 고친다. `tests/store/engine.test.ts`와 `tests/store/verify.test.ts`에서 그 자리를 미지원으로 가정한 단정(`planRequest('culturalEventInfo', ['콘서트', B, B])`가 `undefined`, `planRequest('OdsnBuildingInfo', ['경로당'])`이 `undefined`, `casesFor('culturalEventInfo', ...)`의 기대 목록)도 새 규칙에 맞게 고친다. 스펙 4.2 표의 "검증으로 결정"을 정해진 규칙으로 바꾸고 9.1의 해당 행에 결과를 적는다.

Run: `npm test && npm run build`
Expected: 모두 통과

Run: `npm run workshop:collect -- verify --only <규칙을 바꾼 서비스를 쉼표로>`
Expected: 바꾼 자리가 `<필드>만` 요청으로 검사되어 `통과`로 나온다

```bash
git add src/store/rules.ts tests/store docs/superpowers/specs/2026-11-21-snapshot-store-design.md
git commit -m "fix: settle the undecided store rules from live verification

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

규칙을 하나도 바꾸지 않았으면 이 커밋은 건너뛴다.

- [ ] **Step 5: 배포**

Run: `npm run workshop:deploy`
Expected: 이미지 `0.8.0-workshop-<커밋 7자>`를 빌드해 올리고, 인터셉터 코드와 수집 코드를 올리고, `스택을 갱신했습니다`, `런타임 seoul_workshop_mcp: status=READY platformVersion=V2`, `대상 동기화를 마쳤습니다`, `코드 없는 요청 거부 확인`이 차례로 나온다. 실패하면 출력된 실패 리소스와 이유를 사용자에게 보여 주고 멈춘다

- [ ] **Step 6: 검증용 코드 발급과 호출 도구 준비**

사용자가 직접 실행해 코드를 받는다. 코드는 대화와 파일에 남기지 않고 사용자의 셸 환경 변수로만 넘긴다.

```bash
npm run workshop:code -- new --days 1
export SEOUL_WORKSHOP_CODE=<방금 출력된 코드>
```

Gateway로 tool 하나를 부르고 `notes`만 출력하는 임시 파일을 저장소 루트에 만든다(커밋하지 않고 Step 10에서 지운다).

`tmp-gw-call.mts`:

```ts
// 사용: npx tsx tmp-gw-call.mts <GatewayUrl> <tool> '<JSON 인자>'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const [url, tool, args] = process.argv.slice(2)
const code = process.env.SEOUL_WORKSHOP_CODE
if (!url || !tool || !code) throw new Error('GatewayUrl, tool, SEOUL_WORKSHOP_CODE가 필요합니다')
const client = new Client({ name: 'store-verify', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${code}` } } }))
const result = await client.callTool({ name: `seoul___${tool}`, arguments: JSON.parse(args ?? '{}') })
const body = JSON.parse((result.content as Array<{ text: string }>)[0].text)
console.log(JSON.stringify({ isError: result.isError ?? false, count: body.data?.count, notes: body.notes }, null, 1))
await client.close()
```

Gateway URL과 장부를 읽는 명령:

```bash
GW=$(aws cloudformation describe-stacks --stack-name seoul-workshop --region ap-northeast-2 --query "Stacks[0].Outputs[?OutputKey=='GatewayUrl'].OutputValue" --output text)
npm run -s workshop:collect -- daily --dry-run | grep '^키 '    # 키별 used/limit. 서울 API를 부르지 않는다
```

- [ ] **Step 7: 저장소가 답하는 요청은 장부가 그대로인지 확인(스펙 §8.3의 4, 5)**

장부를 읽어 `used`를 적어 둔 뒤 실행한다.

```bash
npx tsx tmp-gw-call.mts "$GW" find_pharmacies '{"name":"온누리"}'
npx tsx tmp-gw-call.mts "$GW" find_pharmacies '{"name":"365"}'
npx tsx tmp-gw-call.mts "$GW" search_public_reservations '{"category":"culture"}'
npm run -s workshop:collect -- daily --dry-run | grep '^키 '
```

Expected: 세 응답 모두 `isError: false`이고 `notes`에 `사전 적재 데이터(M월 D일 수집)`가 있다. 장부의 `used`가 호출 전과 같다

- [ ] **Step 8: 저장소에 없는 요청은 서울 API로 가는지 확인(스펙 §8.3의 6)**

```bash
npx tsx tmp-gw-call.mts "$GW" get_subway_ridership '{"date":"20260901"}'
npm run -s workshop:collect -- daily --dry-run | grep '^키 '
```

Expected: `notes`에 사전 적재 문구가 없고, 장부의 `used` 합계가 1 늘었다

런타임 로그에서 저장소 줄을 본다.

```bash
RID=$(aws cloudformation describe-stacks --stack-name seoul-workshop --region ap-northeast-2 --query "Stacks[0].Outputs[?OutputKey=='RuntimeId'].OutputValue" --output text)
aws logs filter-log-events --region ap-northeast-2 --log-group-name "/aws/bedrock-agentcore/runtimes/${RID}-DEFAULT" --start-time $(($(date +%s) * 1000 - 1800000)) --filter-pattern '"[store]"' --query 'events[].message' --output text
```

Expected: `[store] 사전 적재 저장소 활성화`, `[store] 읽음 TbPharmacyOperateInfo/_all.json.gz: ...` 줄이 있고 `AccessDenied`가 없다

`[store] 읽기 실패 CardSubwayStatsNew/20260901.json.gz: ... AccessDenied`가 있으면 접두사 조건이 붙은 목록 권한으로는 없는 키에 403이 온다는 뜻이다(스펙 §9.1). 그때만 아래를 한다: `infra/seoul-workshop.yaml`의 `RuntimeRole`과 `CollectRole`에서 `StoreList` 문장의 `Condition` 세 줄을 지우고, `tests/infra/workshopTemplate.test.ts`의 `StoreList` 기대값 두 곳에서 `Condition`을 뺀다. `npm test` 뒤 커밋(`fix: let the runtime list the workshop bucket so missing snapshots return 404`)하고 `npm run workshop:deploy -- --skip-image`로 반영한 다음 이 단계를 다시 한다. 동작은 403이어도 같다(지금 경로로 넘어간다). 바뀌는 것은 5분마다 남는 오류 로그다

- [ ] **Step 9: 큰 스냅샷의 읽기 시간과 메모리 확인(스펙 §8.3의 7)**

```bash
npx tsx tmp-gw-call.mts "$GW" search_cultural_events '{"keyword":"서울"}'
aws logs filter-log-events --region ap-northeast-2 --log-group-name "/aws/bedrock-agentcore/runtimes/${RID}-DEFAULT" --start-time $(($(date +%s) * 1000 - 600000)) --filter-pattern '"culturalEventInfo"' --query 'events[].message' --output text
```

Expected: `[store] 읽음 culturalEventInfo/_all.json.gz: 압축 약 4000000B, 원본 약 24000000B, 약 19800행, <시간>ms, 힙 <크기>MB`. 시간이 3,000ms보다 충분히 작고 힙이 수백 MB를 넘지 않는다. `초과` 줄이 있으면 첫 요청이 서울 API로 넘어갔다는 뜻이다. 시간이 2,000ms를 넘거나 힙이 400MB를 넘으면 스펙 §9.1대로 문화행사를 페이지 단위 객체로 쪼개는 후속 작업을 사용자에게 제안하고 검증 기록에 적는다

- [ ] **Step 10: 정리와 검증 기록**

```bash
rm tmp-gw-call.mts
npm run workshop:code -- revoke
unset SEOUL_WORKSHOP_CODE
git status --short
```

Expected: `코드를 폐기했습니다`, 작업 트리에 추적되지 않는 파일이 없다

`docs/workshop.md`의 `## 검증 기록` 끝에 절을 추가한다. `<...>`는 Step 3~9에서 실제로 본 값으로 채운다.

```markdown
### 사전 적재 저장소 (0.8.0, <검증한 날짜>)

| 항목 | 결과 |
|---|---|
| `daily` 첫 수집 | 호출 <N>회, 저장 <N>개, 실패 0 |
| `verify` | 통과 <N>, 순서 <N>, 실패 <N>, 호출 <N>회 |
| 검증으로 결정한 자리 | `culturalEventInfo.CODENAME` <결과>, `ListPublicReservationEducation.USETGTINFO` <결과>, `ListPublicReservationEducation.AREANM` <결과>, `OdsnBuildingInfo.SISUL_NM` <결과> |
| `find_pharmacies` 두 번(약국명 다름) | 사전 적재 안내 있음, 장부 `used` 변화 없음 |
| `search_public_reservations` | 사전 적재 안내 있음, 장부 `used` 변화 없음 |
| 저장소에 없는 날짜의 `get_subway_ridership` | 사전 적재 안내 없음, 장부 `used` 1 증가, 런타임 로그에 `AccessDenied` <있음 또는 없음> |
| 문화행사 스냅샷 읽기 | <N>ms, 힙 <N>MB |
| `static` 수집과 `get_subway_schedule` | 아직 하지 않음. 워크숍 당일이 아닌 날 `npm run workshop:collect -- static` 뒤에 확인 |
```

스펙 9.1 표의 네 행(메모리 한도, 목록 권한, 검증으로 결정 자리, 읽기 시간)에 결과를 적는다.

```bash
git add docs/workshop.md docs/superpowers/specs/2026-11-21-snapshot-store-design.md
git commit -m "docs: record snapshot store verification results

Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

- [ ] **Step 11: 정적 묶음은 사용자와 날짜를 정한다**

`static`은 약 1,850회를 부른다. 워크숍 당일이 아닌 날을 사용자와 정해 `npm run workshop:collect -- static --dry-run`, `npm run workshop:collect -- static` 순서로 돌리고, 끝나면 `get_subway_schedule`을 시간표 포함으로 불러 장부가 그대로인지 본 뒤 검증 기록의 마지막 행을 고친다(스펙 §8.3의 8). 이 태스크 안에서 하지 않기로 하면 그 사실을 사용자에게 보고한다

- [ ] **Step 12: 브랜치 마무리**

`superpowers:finishing-a-development-branch` skill로 `feature/snapshot-store`를 어떻게 합칠지 사용자에게 묻는다. `main`으로의 병합, 푸시, 태그는 사용자가 정한다
