# ADR-004: 세션 수와 업스트림 쿼터의 분리 — 2단 캐시 (Decoupling Session Count from Upstream Quota — Two-Tier Cache)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>
# English

## Status
Accepted (2026-08-19)

## Context
The server has a second deployment path (v0.4.0): a Streamable HTTP entrypoint (`src/http.ts`) hosted on [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime.html), where each concurrent caller gets its own isolated microVM session (up to 8h lifetime, 900s idle timeout by default). The original stdio design's per-process in-memory cache (`TtlCache`) assumed exactly one long-lived process serving one client, so its TTL windows were sized only against that one process's own request rate. Under Runtime, N concurrent sessions each start a fresh process with a cold cache, so — with no other change — N sessions would issue up to N times as many upstream calls against the same shared ~1,000-call/day free quota per key. Session count and upstream quota consumption were implicitly coupled; a decision was needed to decouple them without requiring every user (including the zero-config stdio majority) to provision anything.

## Options Considered

### Option 1: Keep the per-session in-memory cache only (do nothing)
- **Pros**: Zero infrastructure, zero code change, already works for both stdio and a naively containerized deployment.
- **Cons**: Upstream call volume scales linearly with concurrent session count; two sessions asking about the same hotspot each pay the full upstream cost; the ~1,000-call/day budget can be exhausted by a handful of concurrent sessions within minutes, with no graceful degradation — just upstream `ERROR-3xx` rejections propagating as tool errors.

### Option 2: A collector/pusher service pre-fetches all datasets on a fixed schedule (push model)
- **Pros**: Request-time reads never synchronously touch the upstream; quota use is bounded and predictable (fetch-job schedule × dataset count, independent of session count); could in principle serve every request from a warm store.
- **Cons**: Requires a separate, always-on ingestion process/scheduler (e.g. Lambda + EventBridge) outside this repo's request-scoped MCP-tool surface; adds a pipeline that itself needs validation, monitoring, and its own failure handling; a session asking for a place/dataset combination the schedule hasn't covered yet still gets nothing. Deferred as a follow-up (a real "push" ingestion pipeline is out of scope for this plan; it needs its own intake-validation design).

### Option 3 (chosen): Optional shared L2 cache + soft/hard TTL + stale-while-revalidate + single-flight + daily quota ledger
- **Pros**: L1 (in-memory) stays the fast path inside every session; L2 is entirely env-gated (`CACHE_TABLE_NAME`) and lazy-imported (`maybeAttachL2` only imports `@aws-sdk/*` when the env var is set), so stdio/local users pay zero added latency, memory, or dependency cost. A soft TTL (source-aligned refresh cadence per dataset) serves fresh-enough data instantly; once soft-expired, a stale hit is still returned immediately (with a note) while exactly one background refresh fires per URL — single-flight (`SeoulApiClient`'s in-process `inflight` map) collapses concurrent identical requests into one upstream call regardless of how many sessions asked. A hard TTL (24h) caps how old a served entry may ever be. The quota ledger (`QuotaLedger`) tracks real daily usage per key (general/subway isolated) across every session once L2 is active, warns at ≥80%, and degrades to serving only cache (stale if present, otherwise an explanatory empty result) at 100% instead of raising an upstream error.
- **Cons**: Adds two new modules (`cache.ts`'s `CompositeCache`/backends, `quota.ts` + `dynamo.ts`'s ledger) and a DynamoDB table the operator must pre-create and pay for; every L2 failure path (get/set/increment/status) must be caught and downgraded to "log and continue on L1" rather than failing the request — more surface area to keep correct than a single-tier design. Cross-VM single-flight is explicitly not implemented (non-goal, see spec §4.3): two sessions racing on a cold L2 entry can each independently issue one upstream fetch before the first result lands in L2 — the design bounds the stampede to roughly the number of colliding sessions, it does not eliminate it.

## Decision
Decouple "how many AgentCore Runtime sessions are open" from "how much upstream quota is consumed" by adding an optional, env-gated second cache tier (L2/DynamoDB, `src/client/dynamo.ts`'s `DynamoDbCache`) behind the existing L1 (`InMemoryCache`) via `CompositeCache` (`src/client/cache.ts`). Cache entries carry a source-aligned soft TTL under a single hard 24h ceiling (`HARD_TTL_MS`), with stale-while-revalidate (serve immediately, refresh once in the background) and an in-process single-flight per request URL. A daily-quota ledger (`QuotaLedger` — `InMemoryLedger` by default, `DynamoDbLedger` when L2 is active), keyed per API key on a KST calendar day, tracks real usage and serves stale-only responses instead of erroring once the budget (`QUOTA_DAILY_LIMIT`, default 1000) is spent. Grounded in this plan's T1-T4 commits: `6e9ddaf` (cache backend abstraction — `InMemoryCache`/`CompositeCache`), `e3e2b86` (source-aligned soft TTLs, stale-while-revalidate, single-flight), `6df1ce7` (daily quota ledger with warning notes and stale-only exhaustion mode), `baff5bc` (`parseQuotaLimit` guard, subway/general key isolation), `ace9112` (DynamoDB L2 cache and quota ledger behind the `CACHE_TABLE_NAME` gate), `b085fac` (`DynamoDbLedger` uses the same `parseQuotaLimit` guard).

## Consequences

### Positive
- Default behavior (no `CACHE_TABLE_NAME`) for stdio/local users is unchanged — the L2/DynamoDB code path is not even imported until the env var is set, so there is zero added latency, memory, or `@aws-sdk/*` dependency weight for the common case.
- With multiple concurrent AgentCore Runtime sessions and `CACHE_TABLE_NAME` set, upstream call volume is bounded by dataset cardinality × refresh cadence, not by session count — the coupling this ADR set out to break.
- Quota exhaustion degrades to "serve what's cached, note it" instead of an error, matching how a rate-limited public API should be surfaced to an LLM agent (an actionable note, not a crash).

### Negative
- Requires the operator to pre-create a DynamoDB table and enable its TTL attribute by hand (see [`docs/runbooks/agentcore-deploy.md`](../runbooks/agentcore-deploy.md)) — no CloudFormation/CDK template is included in this plan.
- Cross-VM single-flight is out of scope (spec §4.3 non-goal) — a cold-start stampede across sessions can still produce a short burst of duplicate upstream calls before the first result reaches L2.
- Two new failure surfaces (DynamoDB throttling, permission errors, oversized items) must be caught and downgraded to "log and continue on L1" everywhere they occur, which is more code to keep correct than the single-tier design it replaces.

## References
- `src/client/cache.ts` -- `CacheBackend` / `InMemoryCache` / `CompositeCache` / `HARD_TTL_MS`
- `src/client/quota.ts`, `src/client/dynamo.ts` -- `QuotaLedger` / `InMemoryLedger` / `DynamoDbLedger` / `DynamoDbCache` / `maybeAttachL2`
- `src/http.ts` -- AgentCore Runtime entrypoint that wires a process-wide `SeoulApiClient` and calls `maybeAttachL2`
- Commits `6e9ddaf`, `e3e2b86`, `6df1ce7`, `baff5bc`, `ace9112`, `b085fac`
- [`docs/runbooks/agentcore-deploy.md`](../runbooks/agentcore-deploy.md) -- deploy/verify/rollback/incident procedures for this design
- [ADR-003](ADR-003-single-http-path-and-env-keys.md) -- the single HTTP path this cache tier sits behind

---

<a id="korean"></a>
# 한국어

## 상태
승인됨 (2026-08-19)

## 배경
서버에는 v0.4.0부터 두 번째 배포 경로가 있습니다: [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime.html) 위에서 동작하는 Streamable HTTP 진입점(`src/http.ts`)이며, 여기서는 동시 호출자마다 격리된 마이크로VM 세션(기본 유휴 타임아웃 900초, 최대 수명 8시간)이 배정됩니다. 원래 stdio 설계의 프로세스별 인메모리 캐시(`TtlCache`)는 하나의 장기 실행 프로세스가 하나의 클라이언트만 서빙한다고 가정했으므로, TTL 폭도 그 한 프로세스 자체의 요청 빈도만 기준으로 정해졌습니다. Runtime 환경에서는 동시 세션 N개가 각각 새 프로세스와 콜드 캐시로 시작하므로, 다른 조치가 없다면 세션 N개가 키당 공용 하루 약 1,000회 무료 쿼터를 두고 최대 N배의 업스트림 호출을 발생시킵니다. 세션 수와 업스트림 쿼터 소진이 암묵적으로 결합되어 있었고, 무설정 stdio 사용자 다수를 포함한 모든 사용자에게 별도 프로비저닝을 강제하지 않으면서 이 결합을 끊는 결정이 필요했습니다.

## 검토한 옵션

### 옵션 1: 세션별 인메모리 캐시만 유지(아무것도 하지 않음)
- **장점**: 추가 인프라 없음, 코드 변경 없음, stdio와 단순 컨테이너화 배포 양쪽에서 이미 동작합니다.
- **단점**: 업스트림 호출량이 동시 세션 수에 선형으로 비례합니다. 동일 핫스팟을 묻는 세션 두 개가 각각 전체 업스트림 비용을 지불하며, 하루 약 1,000회 예산이 동시 세션 몇 개만으로 몇 분 안에 소진될 수 있고, 우아한 저하 없이 업스트림 `ERROR-3xx` 거부가 그대로 tool 에러로 전파됩니다.

### 옵션 2: 수집기/푸셔 서비스가 고정 스케줄로 모든 데이터셋을 선수집(push 모델)
- **장점**: 요청 시점에 업스트림을 동기 호출하지 않습니다. 쿼터 소비량이 수집 작업 스케줄 × 데이터셋 수로 예측 가능하고 세션 수와 무관합니다. 원칙적으로 모든 요청을 항상 예열된 저장소에서 서빙할 수 있습니다.
- **단점**: 이 저장소의 요청 스코프 MCP tool 범위를 벗어난, 별도의 상시 실행 수집 프로세스/스케줄러(예: Lambda + EventBridge)가 필요합니다. 그 자체로 검증·모니터링·장애 처리가 필요한 파이프라인이 추가되며, 스케줄이 아직 다루지 않은 장소/데이터셋 조합을 묻는 세션은 여전히 빈손입니다. 후속 과제로 유보합니다(실제 "push" 수집 파이프라인은 이 플랜의 범위 밖이며, 별도의 유입 검증 설계가 필요합니다).

### 옵션 3 (채택): 선택적 공유 L2 캐시 + soft/hard TTL + stale-while-revalidate + single-flight + 일일 쿼터 원장
- **장점**: L1(인메모리)이 모든 세션 내부에서 여전히 빠른 경로로 남고, L2는 전적으로 env로 게이트되며(`CACHE_TABLE_NAME`) lazy import됩니다(`maybeAttachL2`는 env 변수가 설정된 경우에만 `@aws-sdk/*`를 import). 그래서 stdio/로컬 사용자는 추가 지연·메모리·의존성 비용을 전혀 지불하지 않습니다. soft TTL(데이터셋별 원천 갱신 주기에 정렬)은 충분히 신선한 데이터를 즉시 서빙하고, soft TTL이 지나면 stale 히트도 즉시 반환하면서(안내 포함) URL당 정확히 한 번의 백그라운드 갱신만 발화합니다 — single-flight(`SeoulApiClient`의 프로세스 내 `inflight` 맵)가 몇 개의 세션이 동시에 요청했든 하나의 업스트림 호출로 병합합니다. hard TTL(24시간)은 서빙 가능한 엔트리의 최대 나이를 제한합니다. 쿼터 원장(`QuotaLedger`)은 L2가 활성화되면 모든 세션에 걸쳐 키별(일반/지하철 분리) 실제 하루 사용량을 추적하고, 80% 이상에서 경고하며, 100%에서는 업스트림 에러 대신 캐시만으로 응답(가능하면 stale, 없으면 안내가 담긴 빈 결과)하도록 저하됩니다.
- **단점**: 신규 모듈 2종(`cache.ts`의 `CompositeCache`/백엔드, `quota.ts` + `dynamo.ts`의 원장)과, 운영자가 미리 만들고 비용을 지불해야 하는 DynamoDB 테이블이 추가됩니다. L2의 모든 실패 경로(get/set/increment/status)를 잡아서 요청을 실패시키지 않고 "로그만 남기고 L1으로 계속"으로 낮춰야 하므로, 단일 계층 설계보다 올바르게 유지해야 할 표면이 늘어납니다. VM 간 single-flight는 명시적으로 구현하지 않습니다(비목표, 스펙 §4.3 참조) — 콜드 L2 엔트리를 두고 경쟁하는 세션 여러 개는 첫 결과가 L2에 반영되기 전까지 각자 독립적으로 업스트림 호출 한 번씩을 낼 수 있습니다. 이 설계는 몰림을 충돌하는 세션 수 정도로 한정할 뿐, 완전히 제거하지는 않습니다.

## 결정
"AgentCore Runtime 세션이 몇 개 열려 있는가"와 "업스트림 쿼터가 얼마나 소진되는가"를 분리하기 위해, 기존 L1(`InMemoryCache`) 뒤에 `CompositeCache`(`src/client/cache.ts`)를 통해 선택적이고 env로 게이트된 2번째 캐시 계층(L2/DynamoDB, `src/client/dynamo.ts`의 `DynamoDbCache`)을 추가합니다. 캐시 엔트리는 하나의 hard 24시간 상한(`HARD_TTL_MS`) 아래에서 원천에 맞춘 soft TTL을 가지며, stale-while-revalidate(즉시 서빙 + 백그라운드에서 한 번만 갱신)와 요청 URL당 프로세스 내 single-flight를 적용합니다. 일일 쿼터 원장(`QuotaLedger` — 기본은 `InMemoryLedger`, L2 활성 시 `DynamoDbLedger`)은 API 키별로 KST 달력일을 기준으로 실제 사용량을 추적하며, 예산(`QUOTA_DAILY_LIMIT`, 기본 1000)이 소진되면 에러 대신 캐시만으로 응답합니다. 이 플랜의 T1~T4 커밋에 근거합니다: `6e9ddaf`(캐시 백엔드 추상화 — `InMemoryCache`/`CompositeCache`), `e3e2b86`(원천 정렬 soft TTL, stale-while-revalidate, single-flight), `6df1ce7`(경고 note와 stale-only 소진 모드가 있는 일일 쿼터 원장), `baff5bc`(`parseQuotaLimit` 가드, 지하철/일반 키 분리), `ace9112`(`CACHE_TABLE_NAME` 게이트 뒤의 DynamoDB L2 캐시·쿼터 원장), `b085fac`(`DynamoDbLedger`도 동일한 `parseQuotaLimit` 가드 사용).

## 영향

### 긍정적
- `CACHE_TABLE_NAME`을 설정하지 않은 stdio/로컬 사용자의 기본 동작은 변하지 않습니다 — env 변수가 설정되기 전까지 L2/DynamoDB 코드 경로는 import조차 되지 않으므로, 일반적인 경우에는 추가 지연·메모리·`@aws-sdk/*` 의존성 부담이 전혀 없습니다.
- AgentCore Runtime에서 동시 세션이 여러 개이고 `CACHE_TABLE_NAME`이 설정된 경우, 업스트림 호출량은 세션 수가 아니라 데이터셋 종수 × 갱신 주기로 제한됩니다 — 이 ADR이 끊고자 한 바로 그 결합입니다.
- 쿼터 소진은 에러가 아니라 "캐시된 것을 서빙하고 안내한다"로 저하되며, 속도 제한이 걸린 공개 API를 LLM 에이전트에게 노출할 때 바람직한 방식(크래시가 아닌 실행 가능한 안내)과 일치합니다.

### 부정적
- 운영자가 DynamoDB 테이블을 직접 미리 만들고 TTL 속성을 수동으로 활성화해야 합니다([`docs/runbooks/agentcore-deploy.md`](../runbooks/agentcore-deploy.md) 참고) — 이 플랜에는 CloudFormation/CDK 템플릿이 포함되어 있지 않습니다.
- VM 간 single-flight는 범위 밖입니다(스펙 §4.3 비목표) — 여러 세션에 걸친 콜드 스타트 몰림은 첫 결과가 L2에 도달하기 전까지 짧게 중복 업스트림 호출을 낼 수 있습니다.
- DynamoDB 스로틀링, 권한 오류, 항목 크기 초과 등 새로운 실패 표면 2종을 발생 지점마다 잡아서 "로그만 남기고 L1으로 계속"으로 낮춰야 하므로, 대체 대상인 단일 계층 설계보다 올바르게 유지해야 할 코드가 늘어납니다.

## 참고 자료
- `src/client/cache.ts` -- `CacheBackend` / `InMemoryCache` / `CompositeCache` / `HARD_TTL_MS`
- `src/client/quota.ts`, `src/client/dynamo.ts` -- `QuotaLedger` / `InMemoryLedger` / `DynamoDbLedger` / `DynamoDbCache` / `maybeAttachL2`
- `src/http.ts` -- 프로세스 전역 `SeoulApiClient`를 구성하고 `maybeAttachL2`를 호출하는 AgentCore Runtime 진입점
- 커밋 `6e9ddaf`, `e3e2b86`, `6df1ce7`, `baff5bc`, `ace9112`, `b085fac`
- [`docs/runbooks/agentcore-deploy.md`](../runbooks/agentcore-deploy.md) -- 이 설계의 배포/검증/롤백/장애 대응 절차
- [ADR-003](ADR-003-single-http-path-and-env-keys.md) -- 이 캐시 계층이 그 뒤에 놓이는 단일 HTTP 경로
