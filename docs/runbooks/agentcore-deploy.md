# Runbook: AgentCore Runtime Deploy

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Overview
How to build, push, deploy, verify, and roll back the `seoul-opendata-mcp` container on [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime.html), and how to respond when the L2 cache or the daily quota misbehaves in that environment. The container is built from the repo's `Dockerfile` (`linux/arm64`, `CMD ["node", "dist/http.js"]`) and implements the AgentCore Runtime MCP contract: `0.0.0.0:8000`, `POST /mcp`, `GET /ping` → `{"status":"Healthy"}`. See [ADR-004](../decisions/ADR-004-session-scaling-two-tier-cache.md) for why the cache/quota design behaves the way it does under this deployment.

> **Warning: check billing before running any command below.** Every step under "Procedure" provisions or updates real AWS resources (ECR image storage, AgentCore Runtime session compute, and optionally a DynamoDB table) that incur cost. Nothing in this runbook runs automatically — each command is a deliberate, billable action.

## When to Use
- Shipping a new container image version (code or dependency change) to an existing AgentCore Runtime.
- Standing up the runtime for the first time.
- Diagnosing a `/ping` or `tools/list` failure, an L2 cache error flood in the logs, or unexpected empty/stale tool responses after deploying.

## Prerequisites
- AWS CLI configured with credentials that can call `bedrock-agentcore-control:CreateAgentRuntime`/`UpdateAgentRuntime`/`GetAgentRuntime`/`ListAgentRuntimeVersions`/`*AgentRuntimeEndpoint`, plus `ecr:*` on the target repository.
- An IAM execution role that trusts `bedrock-agentcore.amazonaws.com` and can pull the ECR image, write CloudWatch Logs, and (if `CACHE_TABLE_NAME` is used) `dynamodb:GetItem`/`PutItem`/`UpdateItem` on that table.
- Docker with `linux/arm64` build support (AgentCore Runtime requires ARM64 images — see the `Dockerfile`'s `--platform=linux/arm64`).
- `npm test && npm run build` passing locally (this runbook does not rebuild TypeScript for you — the `Dockerfile`'s build stage runs `npm run build` inside the image).

## Procedure

### 1. Build the image and push it to ECR

```bash
export AWS_REGION=<region>
export ACCOUNT_ID=<account-id>
export REPO=seoul-opendata-mcp

aws ecr describe-repositories --repository-names "$REPO" --region "$AWS_REGION" \
  || aws ecr create-repository --repository-name "$REPO" --region "$AWS_REGION"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build --platform linux/arm64 -t "$REPO:latest" .
docker tag "$REPO:latest" "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest"
```

### 2. Create the AgentCore Runtime (first deploy only)

```bash
export IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest"
export EXEC_ROLE_ARN=<execution-role-arn>

aws bedrock-agentcore-control create-agent-runtime \
  --agent-runtime-name seoul_opendata_mcp \
  --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"$IMAGE_URI\"}}" \
  --role-arn "$EXEC_ROLE_ARN" \
  --network-configuration '{"networkMode":"PUBLIC"}' \
  --protocol-configuration '{"serverProtocol":"MCP"}' \
  --region "$AWS_REGION"
```

This provisions Version 1 and an automatic `DEFAULT` endpoint, and returns `agentRuntimeId`/`agentRuntimeArn` — record both; every later step needs one of them. (Environment variables — `SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`, `CACHE_TABLE_NAME`, `QUOTA_DAILY_LIMIT` — are supplied to the running container per the AgentCore Runtime environment-variable configuration for your chosen deploy path; see the README's [Deploy to AgentCore Runtime](../../README.md#deploy-to-agentcore-runtime) table for what each one does.)

### 3. Ship a new version (subsequent deploys)

After step 1 pushes a new image to the **same** tag/URI:

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <agent-runtime-id> \
  --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"$IMAGE_URI\"}}" \
  --role-arn "$EXEC_ROLE_ARN" \
  --region "$AWS_REGION"
```

This creates a new immutable version; the `DEFAULT` endpoint moves to it automatically. Run "Verification" below before treating the rollout as complete.

## Verification
- [ ] `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <id> --region "$AWS_REGION"` reports `status: READY` (not `CREATE_FAILED`/`UPDATE_FAILED`).
- [ ] **Local pre-push smoke test** (do this before step 1's push, or against the freshly built local image): `docker run --rm -p 8000:8000 -e SEOUL_API_KEY=YOUR_KEY "$REPO:latest"`, then `curl -s localhost:8000/ping` → `{"status":"Healthy"}`.
- [ ] **Remote `tools/list` check** against the deployed runtime (URL-encode the ARN first):

  ```bash
  export ARN_ENC=$(printf '%s' "<agent-runtime-arn>" | jq -sRr '@uri')
  curl -s -X POST "https://bedrock-agentcore.$AWS_REGION.amazonaws.com/runtimes/$ARN_ENC/invocations?qualifier=DEFAULT" \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
  ```

  Expect `19`.

## Rollback
- [ ] List versions: `aws bedrock-agentcore-control list-agent-runtime-versions --agent-runtime-id <id> --region "$AWS_REGION"`.
- [ ] Pin a named endpoint (e.g. `production`) to the last-known-good version **instead of** moving `DEFAULT` back:

  ```bash
  aws bedrock-agentcore-control create-agent-runtime-endpoint \
    --agent-runtime-id <id> --name production \
    --agent-runtime-version <previous-good-version> --region "$AWS_REGION"
  # or, if `production` already exists:
  aws bedrock-agentcore-control update-agent-runtime-endpoint \
    --agent-runtime-id <id> --endpoint-name production \
    --agent-runtime-version <previous-good-version> --region "$AWS_REGION"
  ```

- [ ] Point clients at the pinned qualifier (`?qualifier=production`) instead of `DEFAULT` until the regression is fixed, then repeat "Ship a new version" once the fix lands, and move `production` forward again.

## Incident Response

### L2 cache errors (DynamoDB unavailable, throttled, or misconfigured)
- **Symptom**: CloudWatch Logs show `[cache] L2 get 실패 — L1 폴백: ...` or `[cache] L2 set 실패 — 무시: ...`.
- These are expected, already-handled failures — `CompositeCache` catches every L2 error and continues on L1 without failing the request (see `src/client/cache.ts`). No action is required for occasional occurrences.
- If the log volume spikes or is sustained: check DynamoDB service health in the region, confirm the runtime's execution role has `dynamodb:GetItem`/`PutItem`/`UpdateItem` on `CACHE_TABLE_NAME`, and confirm the table still exists (it is not created automatically — see the README's DynamoDB step).
- While L2 stays broken, every session falls back to independent L1-only caching — per-session quota consumption rises accordingly. This is the intended "fail open to single-tier" behavior, not a hard outage; it self-heals once DynamoDB access is restored.

### Quota exhaustion (stale-only mode)
- **Symptom**: tool responses carry a note like `일일 API 쿼터(<N>회)가 소진되어 새 데이터를 가져올 수 없습니다` with `data: []`, or a stale note `일일 API 쿼터 소진 — 캐시된 데이터(약 N분 경과)로 응답합니다`.
- This is by design, not an error — it is the intended degradation once `QUOTA_DAILY_LIMIT` is reached (default 1000; see `src/client/quota.ts`).
- Checks: confirm `QUOTA_DAILY_LIMIT` matches the intended daily budget for the key in use, and confirm `CACHE_TABLE_NAME` is set so the quota ledger (`DynamoDbLedger`) is actually shared across sessions — if it is unset, each session/process keeps its own independent counter, which usually understates real usage in a multi-session deployment and is rarely the intended configuration.
- Recovery is automatic at the next KST midnight (the ledger keys on a KST calendar day); no manual reset endpoint is provided.

## Notes
- Last verified: 2026-08-19 (against `npm test` 133 passed + 4 skipped, `npm run build`, `RUN_LIVE=1` live tests, and `scripts/live-sweep.ts`; no live AgentCore Runtime deployment was performed as part of that verification — see the [architecture doc](../architecture.md) and [ADR-004](../decisions/ADR-004-session-scaling-two-tier-cache.md) for the design this runbook operates).

---

<a id="korean"></a>

# 한국어

## 개요
`seoul-opendata-mcp` 컨테이너를 [Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime.html)에 빌드·push·배포·검증·롤백하는 절차와, 이 환경에서 L2 캐시나 일일 쿼터가 이상 동작할 때의 대응 방법입니다. 컨테이너는 저장소의 `Dockerfile`(`linux/arm64`, `CMD ["node", "dist/http.js"]`)로 빌드되며 AgentCore Runtime MCP 계약을 구현합니다: `0.0.0.0:8000`, `POST /mcp`, `GET /ping` → `{"status":"Healthy"}`. 이 배포 환경에서 캐시·쿼터 설계가 왜 이렇게 동작하는지는 [ADR-004](../decisions/ADR-004-session-scaling-two-tier-cache.md)를 참고하세요.

> **주의: 아래 명령을 실행하기 전에 반드시 과금을 확인하세요.** "절차" 아래 모든 단계는 비용이 발생하는 실제 AWS 리소스(ECR 이미지 저장, AgentCore Runtime 세션 컴퓨트, 선택적으로 DynamoDB 테이블)를 생성하거나 갱신합니다. 이 런북의 어떤 명령도 자동으로 실행되지 않으며, 각 명령은 의도적으로 실행해야 하는 과금 대상 작업입니다.

## 사용 시점
- 기존 AgentCore Runtime에 새 컨테이너 이미지 버전(코드 또는 의존성 변경)을 배포할 때.
- Runtime을 처음 구축할 때.
- 배포 후 `/ping`이나 `tools/list` 실패, 로그에 L2 캐시 오류가 몰리는 현상, 또는 예기치 않은 빈/stale tool 응답을 진단할 때.

## 사전 요구 사항
- `bedrock-agentcore-control:CreateAgentRuntime`/`UpdateAgentRuntime`/`GetAgentRuntime`/`ListAgentRuntimeVersions`/`*AgentRuntimeEndpoint`를 호출할 수 있고, 대상 ECR 리포지토리에 대해 `ecr:*` 권한이 있는 AWS CLI 자격 증명.
- `bedrock-agentcore.amazonaws.com`을 신뢰하고 ECR 이미지를 pull하고 CloudWatch Logs에 쓸 수 있으며, `CACHE_TABLE_NAME`을 사용한다면 해당 테이블에 대해 `dynamodb:GetItem`/`PutItem`/`UpdateItem` 권한이 있는 IAM 실행 역할.
- `linux/arm64` 빌드를 지원하는 Docker (AgentCore Runtime은 ARM64 이미지를 요구합니다 — `Dockerfile`의 `--platform=linux/arm64` 참조).
- 로컬에서 통과하는 `npm test && npm run build` (이 런북은 TypeScript를 대신 빌드해주지 않습니다 — `Dockerfile`의 빌드 스테이지가 이미지 내부에서 `npm run build`를 실행합니다).

## 절차

### 1. 이미지 빌드 후 ECR로 push

```bash
export AWS_REGION=<region>
export ACCOUNT_ID=<account-id>
export REPO=seoul-opendata-mcp

aws ecr describe-repositories --repository-names "$REPO" --region "$AWS_REGION" \
  || aws ecr create-repository --repository-name "$REPO" --region "$AWS_REGION"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build --platform linux/arm64 -t "$REPO:latest" .
docker tag "$REPO:latest" "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest"
```

### 2. AgentCore Runtime 생성 (최초 배포만)

```bash
export IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:latest"
export EXEC_ROLE_ARN=<execution-role-arn>

aws bedrock-agentcore-control create-agent-runtime \
  --agent-runtime-name seoul_opendata_mcp \
  --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"$IMAGE_URI\"}}" \
  --role-arn "$EXEC_ROLE_ARN" \
  --network-configuration '{"networkMode":"PUBLIC"}' \
  --protocol-configuration '{"serverProtocol":"MCP"}' \
  --region "$AWS_REGION"
```

이 명령은 버전 1과 자동 `DEFAULT` 엔드포인트를 생성하며 `agentRuntimeId`/`agentRuntimeArn`을 반환합니다 — 이후 모든 단계에서 필요하므로 둘 다 기록해 두세요. (`SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`, `CACHE_TABLE_NAME`, `QUOTA_DAILY_LIMIT` 등 환경 변수는 선택한 배포 경로의 AgentCore Runtime 환경변수 설정을 통해 실행 중인 컨테이너에 전달됩니다. 각 변수의 의미는 README의 [AgentCore Runtime에 배포](../../README.md#agentcore-runtime에-배포) 표를 참고하세요.)

### 3. 새 버전 배포(이후 배포)

1단계에서 **동일한** 태그/URI로 새 이미지를 push한 뒤:

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <agent-runtime-id> \
  --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"$IMAGE_URI\"}}" \
  --role-arn "$EXEC_ROLE_ARN" \
  --region "$AWS_REGION"
```

새로운 불변 버전이 생성되고 `DEFAULT` 엔드포인트가 자동으로 그 버전을 가리키게 됩니다. 배포를 완료로 간주하기 전에 아래 "검증"을 실행하세요.

## 검증
- [ ] `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <id> --region "$AWS_REGION"`가 `status: READY`를 보고합니다(`CREATE_FAILED`/`UPDATE_FAILED`가 아님).
- [ ] **로컬 push 전 스모크 테스트** (1단계의 push 전, 또는 방금 빌드한 로컬 이미지로 실행): `docker run --rm -p 8000:8000 -e SEOUL_API_KEY=YOUR_KEY "$REPO:latest"` 실행 후 `curl -s localhost:8000/ping` → `{"status":"Healthy"}`.
- [ ] **배포된 Runtime 대상 `tools/list` 원격 확인** (먼저 ARN을 URL 인코딩):

  ```bash
  export ARN_ENC=$(printf '%s' "<agent-runtime-arn>" | jq -sRr '@uri')
  curl -s -X POST "https://bedrock-agentcore.$AWS_REGION.amazonaws.com/runtimes/$ARN_ENC/invocations?qualifier=DEFAULT" \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
  ```

  `19`가 나와야 합니다.

## 롤백
- [ ] 버전 목록 확인: `aws bedrock-agentcore-control list-agent-runtime-versions --agent-runtime-id <id> --region "$AWS_REGION"`.
- [ ] `DEFAULT`를 되돌리는 대신, 이름이 있는 엔드포인트(예: `production`)를 마지막으로 정상 동작한 버전에 핀합니다.

  ```bash
  aws bedrock-agentcore-control create-agent-runtime-endpoint \
    --agent-runtime-id <id> --name production \
    --agent-runtime-version <previous-good-version> --region "$AWS_REGION"
  # 이미 production 엔드포인트가 있다면:
  aws bedrock-agentcore-control update-agent-runtime-endpoint \
    --agent-runtime-id <id> --endpoint-name production \
    --agent-runtime-version <previous-good-version> --region "$AWS_REGION"
  ```

- [ ] 회귀가 수정될 때까지 클라이언트가 `DEFAULT` 대신 핀된 qualifier(`?qualifier=production`)를 사용하도록 하고, 수정이 반영되면 "새 버전 배포"를 다시 수행한 뒤 `production`을 다시 최신 버전으로 이동시킵니다.

## 장애 대응

### L2 캐시 오류 (DynamoDB 접근 불가·스로틀링·설정 오류)
- **증상**: CloudWatch Logs에 `[cache] L2 get 실패 — L1 폴백: ...` 또는 `[cache] L2 set 실패 — 무시: ...`가 나타남.
- 이는 이미 처리된, 예상된 실패입니다 — `CompositeCache`가 모든 L2 오류를 잡아 요청을 실패시키지 않고 L1으로 계속 진행합니다(`src/client/cache.ts` 참조). 간헐적인 발생이라면 별도 조치가 필요 없습니다.
- 로그가 급증하거나 지속되면: 해당 리전의 DynamoDB 서비스 상태를 확인하고, Runtime 실행 역할이 `CACHE_TABLE_NAME`에 대해 `dynamodb:GetItem`/`PutItem`/`UpdateItem` 권한을 가지고 있는지, 테이블이 실제로 존재하는지(자동으로 생성되지 않습니다 — README의 DynamoDB 단계 참고) 확인하세요.
- L2가 계속 깨져 있는 동안에는 모든 세션이 독립적인 L1 전용 캐싱으로 폴백하며, 세션별 쿼터 소비가 그만큼 늘어납니다. 이는 의도된 "단일 계층으로 열어 놓는" 동작이며 하드 장애가 아니고, DynamoDB 접근이 복구되면 자동으로 회복됩니다.

### 쿼터 소진 (stale-only 모드)
- **증상**: tool 응답에 `일일 API 쿼터(<N>회)가 소진되어 새 데이터를 가져올 수 없습니다`라는 note와 `data: []`가 붙거나, `일일 API 쿼터 소진 — 캐시된 데이터(약 N분 경과)로 응답합니다`라는 stale note가 붙음.
- 이는 설계된 동작이며 에러가 아닙니다 — `QUOTA_DAILY_LIMIT`(기본 1000, `src/client/quota.ts` 참조)에 도달했을 때의 의도된 저하입니다.
- 확인할 것: 사용 중인 키의 실제 일일 예산과 `QUOTA_DAILY_LIMIT`이 일치하는지, 쿼터 원장(`DynamoDbLedger`)이 세션 간 실제로 공유되도록 `CACHE_TABLE_NAME`이 설정되어 있는지 — 미설정이면 각 세션/프로세스가 독립된 카운터를 가지므로, 다중 세션 배포에서는 실제 사용량을 과소평가하기 쉬우며 보통 의도한 설정이 아닙니다.
- 복구는 다음 KST 자정(원장은 KST 달력일을 기준으로 함)에 자동으로 이루어지며, 수동 초기화 엔드포인트는 제공되지 않습니다.

## 참고
- 최종 검증일: 2026-08-19 (`npm test` 133 passed + 4 skipped, `npm run build`, `RUN_LIVE=1` 라이브 테스트, `scripts/live-sweep.ts` 기준. 이 검증 범위에는 실제 AgentCore Runtime 배포가 포함되지 않았습니다 — 이 런북이 다루는 설계는 [아키텍처 문서](../architecture.md)와 [ADR-004](../decisions/ADR-004-session-scaling-two-tier-cache.md)를 참고하세요.)
