# Infrastructure / 인프라 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview

The infrastructure layer is what the server runs on outside a local stdio session: one `linux/arm64` container image, the Amazon Bedrock AgentCore Runtime that hosts it, and, for workshops, an AgentCore Gateway in front of that runtime with a DynamoDB table, an S3 bucket and an interceptor Lambda. It exists so that many concurrent sessions share one cache and one daily quota ledger, and so that workshop participants reach the server with a single shared code. How these resources are declared and deployed is in [iac.md](iac.md).

### 2. Components

| Component | Path | Purpose |
|---|---|---|
| Container image | `Dockerfile` | Two-stage `node:22-slim` build pinned to `linux/arm64`. The build stage runs `npm ci` and `npm run build`; the final stage installs production dependencies only, copies `dist/`, exposes 8000 and starts `node dist/http.js`. No key is baked into the image |
| Build context filter | `.dockerignore` | Keeps `tests`, `docs`, `scripts`, `infra`, `.env` and the MCPB bundle out of the build context |
| HTTP entry point | `src/http.ts` | AgentCore Runtime MCP contract: `POST /mcp` and `GET /ping` on `0.0.0.0:8000` (`PORT` overrides). Stateless: every request gets its own server and transport. Other methods on `/mcp` return 405 |
| L2 attachment | `src/client/dynamo.ts` (`maybeAttachL2`) | When `CACHE_TABLE_NAME` is set, lazily imports `@aws-sdk/*` and attaches the shared cache and quota ledger. On failure the server keeps running on L1 |
| ECR repository | `seoul-opendata-mcp` (not created by this repo) | Holds the images. The workshop deploy pushes `<version>-workshop-<commit 7>` and never moves `latest` or `X.Y.Z` |
| Workshop runtime | `infra/seoul-workshop.yaml` (`WorkshopRuntime`) | AgentCore Runtime `seoul_workshop_mcp`, platform version V2, public network, MCP protocol, 15-minute idle timeout, 8-hour maximum lifetime. Receives `SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`, `CACHE_TABLE_NAME`, `QUOTA_DAILY_LIMIT` and `STORE_URI` as environment variables |
| Workshop table | `infra/seoul-workshop.yaml` (`WorkshopTable`) | One on-demand DynamoDB table with hash key `pk` and TTL attribute `expireAt`. Holds three item kinds (see Key Decisions) |
| Workshop bucket | `infra/seoul-workshop.yaml` (`WorkshopBucket`) | Holds the Lambda zips under `code/` and the pre-collected snapshots under `store/v1/` (gzip JSON, one object per dataset or partition, deleted after 90 days). Public access blocked, SSE-S3 |
| Interceptor Lambda | `infra/lambda/code-check.mjs`, `CodeCheckFunction` | `nodejs22.x`, arm64, 128 MB, 5 s timeout. Checks the shared code, its expiry and the per-minute `tools/call` limit before the gateway forwards a request |
| Collector Lambda (optional) | `infra/lambda/collect.ts`, `CollectFunction`, `CollectDailySchedule` | Created only when `CollectSchedule` is set. `nodejs22.x`, arm64, 1024 MB, 15-minute timeout. An EventBridge Scheduler schedule in Asia/Seoul runs the daily collection; failed runs are not retried |
| Workshop gateway | `infra/seoul-workshop.yaml` (`WorkshopGateway`, `SeoulTarget`) | AgentCore Gateway with `AuthorizerType: NONE` and one REQUEST interceptor. Target `seoul` points at the workshop runtime, so tools appear as `seoul___<tool>` |
| IAM roles | `infra/seoul-workshop.yaml` (`RuntimeRole`, `CodeCheckRole`, `GatewayRole`, and with a schedule `CollectRole`, `CollectScheduleRole`) | Runtime: pull from the one repository, write its own log groups, get/put/update on the table, read `store/*` in the bucket. Interceptor Lambda: write its log group, `UpdateItem` on the table. Gateway: invoke the interceptor and the workshop runtime. Collector Lambda: write its log group, read and write `store/*` in the bucket, `GetItem` and `UpdateItem` on the table. Schedule role: invoke the collector function only |
| Log groups | CloudWatch Logs | `/aws/lambda/<stack>-code-check` (14-day retention), `/aws/bedrock-agentcore/runtimes/seoul_workshop_mcp-<id>-DEFAULT`, and with a schedule `/aws/lambda/<stack>-collect` (14-day retention) |

### 3. Key Decisions

- The image targets `linux/arm64` only, because AgentCore Runtime requires it. Keys reach the process as runtime environment variables and are never copied into the image.
- The HTTP server is stateless. Each AgentCore session is its own process with a cold L1 cache, so the shared DynamoDB tier is what keeps upstream call volume from growing with session count. Recorded as [ADR-004](../decisions/ADR-004-session-scaling-two-tier-cache.md).
- One table serves three purposes, separated by the shape of `pk`: cache entries (`pk` is the sha256 of the cache key, expiring 24 hours after they were stored), daily quota counters (`quota#<keyId>#<KST date>`, attribute `used`) and the interceptor's per-minute counters (`rate#<UTC minute>`, attribute `n`, expiring after two minutes).
- The workshop runtime is separate from any other runtime of this server. The stack never references or changes runtimes or tables it did not create.
- The gateway uses no built-in authorizer. A REQUEST interceptor compares the sha256 of the `Authorization: Bearer` code instead, so a participant needs one header and no identity provider. The interceptor fails closed on the code check and fails open on the counter.
- The gateway calls the runtime with its own IAM role (`GATEWAY_IAM_ROLE`), so the runtime is not reachable with the workshop code alone.
- Secrets sit in the runtime's and the Lambda's environment variables. Read access to those two configurations is read access to the secrets. See [security.md](security.md).

### 4. Code Pointers

- `Dockerfile` - image build and start command
- `src/http.ts` - `/ping`, `/mcp`, per-request server and transport
- `src/client/dynamo.ts` - `DynamoDbCache`, `DynamoDbLedger`, `maybeAttachL2`
- `infra/seoul-workshop.yaml` - every workshop resource and its IAM policy
- `infra/lambda/code-check.mjs` - `createHandler` (decision order) and `minuteKey` (counter key)
- `scripts/workshop-deploy.ts` - image build and push, runtime readiness check, target synchronization, smoke test

### 5. Cross-references

- Related modules: `infra/CLAUDE.md`, `scripts/CLAUDE.md`, `src/client/CLAUDE.md`
- Related ADRs: [ADR-004](../decisions/ADR-004-session-scaling-two-tier-cache.md) (two-tier cache and quota ledger), [ADR-005](../decisions/ADR-005-workshop-shared-code-at-the-gateway.md) (workshop access by one shared code)
- Related runbooks: [agentcore-deploy.md](../runbooks/agentcore-deploy.md) (a standalone runtime deployed by hand), [workshop.md](../workshop.md) (workshop stack: facilitator steps and the verification record)
- Related references: [iac.md](iac.md), [security.md](security.md)

<a id="korean"></a>
## 한국어

### 1. 개요

인프라 계층은 로컬 stdio 세션 밖에서 서버가 돌아가는 환경입니다. `linux/arm64` 컨테이너 이미지 하나와 이를 실행하는 Amazon Bedrock AgentCore Runtime이 기본이고, 워크숍용으로 그 앞에 AgentCore Gateway, DynamoDB 테이블, S3 버킷, 인터셉터 Lambda가 붙습니다. 여러 동시 세션이 캐시와 하루 쿼터 장부를 함께 쓰게 하고, 워크숍 참가자가 공용 코드 하나로 서버에 닿게 하려고 둡니다. 이 리소스를 선언하고 배포하는 방법은 [iac.md](iac.md)에 있습니다.

### 2. 구성요소

| 구성요소 | 경로 | 목적 |
|---|---|---|
| 컨테이너 이미지 | `Dockerfile` | `linux/arm64`로 고정한 2단계 `node:22-slim` 빌드입니다. 빌드 단계에서 `npm ci`와 `npm run build`를 실행하고, 최종 단계는 운영 의존성만 설치한 뒤 `dist/`를 복사하고 8000번 포트를 열어 `node dist/http.js`로 시작합니다. 이미지에 키를 넣지 않습니다 |
| 빌드 컨텍스트 필터 | `.dockerignore` | `tests`, `docs`, `scripts`, `infra`, `.env`, MCPB 번들을 빌드 컨텍스트에서 뺍니다 |
| HTTP 진입점 | `src/http.ts` | AgentCore Runtime MCP 계약인 `0.0.0.0:8000`의 `POST /mcp`와 `GET /ping`을 구현합니다(`PORT`로 바꿀 수 있음). 상태가 없어서 요청마다 서버와 transport를 새로 만듭니다. `/mcp`의 다른 메서드는 405를 돌려줍니다 |
| L2 연결 | `src/client/dynamo.ts`(`maybeAttachL2`) | `CACHE_TABLE_NAME`이 있으면 `@aws-sdk/*`를 lazy import해 공유 캐시와 쿼터 장부를 붙입니다. 실패해도 서버는 L1만으로 계속 동작합니다 |
| ECR 저장소 | `seoul-opendata-mcp`(이 저장소가 만들지 않음) | 이미지를 보관합니다. 워크숍 배포는 `<버전>-workshop-<커밋 7자>` 태그만 올리고 `latest`와 `X.Y.Z`는 옮기지 않습니다 |
| 워크숍 런타임 | `infra/seoul-workshop.yaml`(`WorkshopRuntime`) | AgentCore Runtime `seoul_workshop_mcp`입니다. 플랫폼 버전 V2, 공용 네트워크, MCP 프로토콜, 유휴 제한 15분, 최대 수명 8시간입니다. `SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`, `CACHE_TABLE_NAME`, `QUOTA_DAILY_LIMIT`, `STORE_URI`를 환경 변수로 받습니다 |
| 워크숍 테이블 | `infra/seoul-workshop.yaml`(`WorkshopTable`) | 해시 키 `pk`와 TTL 속성 `expireAt`을 가진 온디맨드 DynamoDB 테이블 하나입니다. 세 종류의 항목을 담습니다(주요 결정 참조) |
| 워크숍 버킷 | `infra/seoul-workshop.yaml`(`WorkshopBucket`) | Lambda zip을 `code/` 아래에, 사전 적재 스냅샷을 `store/v1/` 아래에 둡니다(gzip JSON, 데이터셋이나 파티션마다 객체 하나, 90일 뒤 삭제). 퍼블릭 액세스 차단, SSE-S3 |
| 인터셉터 Lambda | `infra/lambda/code-check.mjs`, `CodeCheckFunction` | `nodejs22.x`, arm64, 128MB, 제한 시간 5초입니다. Gateway가 요청을 넘기기 전에 공용 코드, 만료, 분당 `tools/call` 한도를 확인합니다 |
| 수집 Lambda(선택) | `infra/lambda/collect.ts`, `CollectFunction`, `CollectDailySchedule` | `CollectSchedule`을 넣었을 때만 만듭니다. `nodejs22.x`, arm64, 1024MB, 제한 시간 15분. EventBridge Scheduler 스케줄(Asia/Seoul)이 매일 수집을 실행하고, 실패한 실행은 다시 시도하지 않습니다 |
| 워크숍 Gateway | `infra/seoul-workshop.yaml`(`WorkshopGateway`, `SeoulTarget`) | `AuthorizerType: NONE`에 REQUEST 인터셉터 하나를 둔 AgentCore Gateway입니다. 대상 `seoul`이 워크숍 런타임을 가리키므로 tool 이름은 `seoul___<tool>`로 보입니다 |
| IAM 역할 | `infra/seoul-workshop.yaml`(`RuntimeRole`, `CodeCheckRole`, `GatewayRole`, 스케줄을 켜면 `CollectRole`, `CollectScheduleRole`) | 런타임은 저장소 하나에서 이미지를 받고, 자기 로그 그룹에 쓰고, 테이블에 get, put, update를 하고, 버킷의 `store/*`를 읽습니다. 인터셉터 Lambda는 자기 로그 그룹에 쓰고 테이블에 `UpdateItem`만 합니다. Gateway는 인터셉터와 워크숍 런타임만 호출합니다. 수집 Lambda는 자기 로그 그룹에 쓰고, 버킷의 `store/*`를 읽고 쓰고, 테이블에 `GetItem`과 `UpdateItem`을 합니다. 스케줄 역할은 수집 함수만 호출합니다 |
| 로그 그룹 | CloudWatch Logs | `/aws/lambda/<스택>-code-check`(14일 보관)와 `/aws/bedrock-agentcore/runtimes/seoul_workshop_mcp-<id>-DEFAULT`입니다. 스케줄을 켜면 `/aws/lambda/<스택>-collect`(14일 보관)가 더해집니다 |

### 3. 주요 결정

- 이미지는 `linux/arm64`만 대상으로 합니다. AgentCore Runtime의 요구 사항입니다. 키는 런타임 환경 변수로 프로세스에 전달하고 이미지에는 넣지 않습니다.
- HTTP 서버는 상태가 없습니다. AgentCore 세션은 저마다 L1 캐시가 비어 있는 별도 프로세스이므로, 공유 DynamoDB 계층이 있어야 세션 수가 늘어도 업스트림 호출이 따라 늘지 않습니다. [ADR-004](../decisions/ADR-004-session-scaling-two-tier-cache.md)에 기록되어 있습니다.
- 테이블 하나를 세 용도로 쓰고 `pk` 모양으로 구분합니다. 캐시 항목은 캐시 키의 sha256을 `pk`로 쓰고 저장한 지 24시간 뒤에 만료됩니다. 하루 쿼터 카운터는 `quota#<keyId>#<KST 날짜>`에 `used` 속성을 둡니다. 인터셉터의 분당 카운터는 `rate#<UTC 분>`에 `n` 속성을 두고 2분 뒤에 만료됩니다.
- 워크숍 런타임은 이 서버의 다른 런타임과 분리되어 있습니다. 스택은 자기가 만들지 않은 런타임이나 테이블을 참조하지도 바꾸지도 않습니다.
- Gateway는 내장 authorizer를 쓰지 않습니다. 대신 REQUEST 인터셉터가 `Authorization: Bearer` 코드의 sha256을 비교합니다. 참가자에게는 헤더 하나만 필요하고 ID 공급자가 필요 없습니다. 인터셉터는 코드 확인에 실패하면 거부하고, 카운터 호출에 실패하면 통과시킵니다.
- Gateway는 자기 IAM 역할(`GATEWAY_IAM_ROLE`)로 런타임을 호출합니다. 워크숍 코드만으로는 런타임에 직접 닿을 수 없습니다.
- 비밀 값은 런타임과 Lambda의 환경 변수에 있습니다. 두 설정을 읽는 권한은 비밀을 읽는 권한과 같습니다. [security.md](security.md)를 참고하세요.

### 4. 코드 포인터

- `Dockerfile` - 이미지 빌드와 시작 명령
- `src/http.ts` - `/ping`, `/mcp`, 요청별 서버와 transport
- `src/client/dynamo.ts` - `DynamoDbCache`, `DynamoDbLedger`, `maybeAttachL2`
- `infra/seoul-workshop.yaml` - 워크숍 리소스 전체와 IAM 정책
- `infra/lambda/code-check.mjs` - `createHandler`(판정 순서)와 `minuteKey`(카운터 키)
- `scripts/workshop-deploy.ts` - 이미지 빌드와 푸시, 런타임 준비 확인, 대상 동기화, 스모크 테스트

### 5. 상호 참조

- 관련 모듈: `infra/CLAUDE.md`, `scripts/CLAUDE.md`, `src/client/CLAUDE.md`
- 관련 ADR: [ADR-004](../decisions/ADR-004-session-scaling-two-tier-cache.md) (2단 캐시와 쿼터 장부), [ADR-005](../decisions/ADR-005-workshop-shared-code-at-the-gateway.md) (워크숍 접근을 공용 코드 하나로 확인)
- 관련 런북: [agentcore-deploy.md](../runbooks/agentcore-deploy.md) (손으로 배포하는 단독 런타임), [workshop.md](../workshop.md) (워크숍 스택의 진행자 절차와 검증 기록)
- 관련 참조 문서: [iac.md](iac.md), [security.md](security.md)
