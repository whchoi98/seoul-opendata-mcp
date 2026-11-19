# ADR-005: 워크숍 접근은 Gateway에서 공용 코드로 확인 (Workshop Access by One Shared Code Checked at the Gateway)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>
# English

## Status
Accepted (2026-11-19)

## Context
Workshop and hackathon participants build apps in Claude Code and call this server's tools, and the finished apps call the same tools at run time. A few dozen people use it for a fixed period, the first event was less than two weeks away, and the events repeat. The access code goes straight into a `claude mcp add` command and into an app's request header, so whatever is chosen must work as one static header. The server already runs on Amazon Bedrock AgentCore Runtime, which by default accepts only IAM-signed calls, and participants do not have AWS credentials.

## Options Considered

### Option 1: One code per participant
- **Pros**: Each code has its own rate limit and expiry. One person can be blocked alone, and usage is visible per person.
- **Cons**: The facilitator issues and hands out N codes for every event, and the gateway needs a store of valid codes to check against.

### Option 2: One code per team
- **Pros**: Fewer codes to manage than Option 1. Limits and blocking apply per team.
- **Cons**: Still needs a code store and a distribution step, and a leak inside a team affects that whole team.

### Option 3 (chosen): One shared code per workshop, checked by a gateway REQUEST interceptor
- **Pros**: The simplest to run. One line on a slide registers every participant, and issuing, expiring and revoking the code is one command each. No identity provider and no code store are needed.
- **Cons**: If the code leaks, everyone's code has to change, and the rate limit applies to the gateway as a whole.

A JWT authorizer backed by Amazon Cognito and AWS WAF were left out of scope for this step.

## Decision
Put an AgentCore Gateway with `AuthorizerType: NONE` in front of a dedicated runtime, and check one shared code in a REQUEST interceptor Lambda (`infra/lambda/code-check.mjs`). Callers send `Authorization: Bearer <code>`. The interceptor compares the sha256 of the code with the stored hash in constant time, then checks the expiry, then limits `tools/call` per minute across the gateway. The gateway calls the runtime with its own IAM role, so the code alone never reaches the runtime.

The supporting choices follow from that:

- A wrong or expired code gets HTTP 403 with a JSON-RPC error. 401 is not used, because an MCP client may start OAuth discovery on 401 and this gateway has no OAuth metadata.
- Going over the per-minute limit returns a tool result with `isError: true`, so the model reads the message and waits. A transport error would look like a lost connection.
- The code check fails closed. The per-minute counter fails open, because a DynamoDB outage should not stop a workshop.
- The Lambda holds the hash of the code, not the code, and logs only `{method, tool, decision}`.
- The per-minute limit guards against a runaway loop in a participant's app. The daily upstream quota is protected elsewhere (see [ADR-004](ADR-004-session-scaling-two-tier-cache.md) and [ADR-006](ADR-006-key-pool-with-key-independent-cache-keys.md)).

## Consequences

### Positive
- A participant registers with one command and needs no AWS account.
- A request without a valid code stops at the gateway. The first deploy confirmed that `initialize` also passes through the interceptor.
- Claude Code shows the interceptor's message as the connection failure reason, so a participant can tell a wrong code from an expired one.
- The facilitator rotates or revokes the code with `npm run workshop:code`, without redeploying the image.

### Negative
- A leaked code works for anyone until it expires or is revoked. The mitigations are a short expiry, `revoke`, and the per-minute limit.
- The limit is global. One participant's loop can use up the minute for everyone, and there is no usage figure per participant.
- The code has 40 bits and the hash has no salt. Anyone who can read the Lambda configuration can guess the code offline, and anyone who can read the runtime configuration can read the API keys. Read access to those two configurations is read access to the secrets.
- The gateway may call the interceptor again after a failure, so the per-minute counter can count slightly more than the real number of calls.

## References
- `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md` (sections 1 and 3)
- `infra/lambda/code-check.mjs`, `infra/seoul-workshop.yaml`
- `tests/infra/codeCheck.test.ts`, `tests/infra/workshopTemplate.test.ts`
- [docs/workshop.md](../workshop.md) (verification record of the first deploy)
- [docs/reference/security.md](../reference/security.md), [docs/reference/infrastructure.md](../reference/infrastructure.md)

---

<a id="korean"></a>
# 한국어

## 상태
승인됨 (2026-11-19)

## 배경
워크숍과 해커톤 참가자는 Claude Code로 앱을 만들면서 이 서버의 tool을 쓰고, 완성한 앱도 실행 중에 같은 tool을 부릅니다. 수십 명이 정해진 기간 동안 쓰고, 첫 행사가 2주도 남지 않았고, 행사는 반복됩니다. 접근 코드는 `claude mcp add` 명령과 앱의 요청 헤더에 그대로 들어가므로, 어떤 방식을 고르든 고정된 헤더 하나로 동작해야 합니다. 서버는 이미 Amazon Bedrock AgentCore Runtime에서 실행되는데, 런타임은 기본적으로 IAM 서명 호출만 받고 참가자에게는 AWS 자격 증명이 없습니다.

## 검토한 옵션

### 옵션 1: 참가자별 코드
- **장점**: 코드마다 호출 제한과 만료를 둘 수 있습니다. 한 사람만 따로 막을 수 있고 사람별 사용량이 보입니다.
- **단점**: 진행자가 행사마다 코드 N개를 발급해 나눠 줘야 하고, Gateway가 대조할 유효 코드 저장소가 필요합니다.

### 옵션 2: 팀별 코드
- **장점**: 옵션 1보다 관리할 코드가 적습니다. 제한과 차단이 팀 단위로 걸립니다.
- **단점**: 코드 저장소와 배포 단계가 여전히 필요하고, 팀 안에서 코드가 새면 그 팀 전체가 영향을 받습니다.

### 옵션 3 (채택): 워크숍 공용 코드 하나를 Gateway REQUEST 인터셉터가 확인
- **장점**: 운영이 가장 간단합니다. 슬라이드의 한 줄로 모든 참가자가 등록하고, 코드 발급과 만료와 폐기를 각각 명령 하나로 합니다. ID 공급자와 코드 저장소가 필요 없습니다.
- **단점**: 코드가 새면 모두의 코드를 바꿔야 하고, 호출 제한이 Gateway 전체에만 걸립니다.

Amazon Cognito 기반 JWT authorizer와 AWS WAF는 이번 단계의 범위에서 뺐습니다.

## 결정
전용 런타임 앞에 `AuthorizerType: NONE`인 AgentCore Gateway를 두고, REQUEST 인터셉터 Lambda(`infra/lambda/code-check.mjs`)에서 공용 코드 하나를 확인합니다. 호출하는 쪽은 `Authorization: Bearer <코드>`를 보냅니다. 인터셉터는 코드의 sha256을 저장된 해시와 상수 시간으로 비교하고, 만료를 확인하고, Gateway 전체의 분당 `tools/call` 횟수를 제한합니다. Gateway는 자기 IAM 역할로 런타임을 호출하므로 코드만으로는 런타임에 닿지 못합니다.

여기서 따라 나온 세부 선택은 다음과 같습니다.

- 코드가 틀리거나 만료되면 HTTP 403과 JSON-RPC 오류를 돌려줍니다. 401은 쓰지 않습니다. MCP 클라이언트가 401을 받으면 OAuth 탐색을 시작할 수 있는데 이 Gateway에는 OAuth 메타데이터가 없습니다.
- 분당 한도를 넘으면 `isError: true`인 tool 결과를 돌려줍니다. 모델이 안내를 읽고 기다리게 하기 위해서입니다. 전송 오류로 돌려주면 연결이 끊긴 것처럼 보입니다.
- 코드 확인은 판단할 수 없으면 거부합니다. 분당 카운터는 실패하면 통과시킵니다. DynamoDB 장애로 워크숍이 멈추면 안 되기 때문입니다.
- Lambda에는 코드 원문이 아니라 해시를 두고, 로그에는 `{method, tool, decision}`만 남깁니다.
- 분당 한도는 참가자 앱의 무한 반복을 막는 장치입니다. 하루 업스트림 쿼터는 다른 곳에서 지킵니다([ADR-004](ADR-004-session-scaling-two-tier-cache.md), [ADR-006](ADR-006-key-pool-with-key-independent-cache-keys.md) 참조).

## 영향

### 긍정적
- 참가자는 명령 하나로 등록하고 AWS 계정이 필요 없습니다.
- 유효한 코드가 없는 요청은 Gateway에서 멈춥니다. 첫 배포에서 `initialize`도 인터셉터를 거친다는 것을 확인했습니다.
- Claude Code가 인터셉터의 안내 문구를 연결 실패 사유로 보여 주므로, 참가자가 틀린 코드와 만료된 코드를 구분할 수 있습니다.
- 진행자는 이미지를 다시 배포하지 않고 `npm run workshop:code`로 코드를 바꾸거나 폐기합니다.

### 부정적
- 코드가 새면 만료되거나 폐기될 때까지 누구나 쓸 수 있습니다. 짧은 만료, `revoke`, 분당 한도로 줄입니다.
- 한도가 전체에 걸립니다. 한 참가자의 반복 호출이 그 1분의 한도를 모두 쓸 수 있고, 참가자별 사용량은 알 수 없습니다.
- 코드는 40비트이고 해시에 솔트가 없습니다. Lambda 설정을 읽을 수 있는 사람은 오프라인으로 코드를 대입해 알아낼 수 있고, 런타임 설정을 읽을 수 있는 사람은 API 키를 읽을 수 있습니다. 두 설정을 읽는 권한은 비밀을 읽는 권한과 같습니다.
- Gateway가 실패 뒤에 인터셉터를 다시 부를 수 있어, 분당 카운터가 실제 호출 수보다 조금 더 셀 수 있습니다.

## 참고 자료
- `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md` (1절과 3절)
- `infra/lambda/code-check.mjs`, `infra/seoul-workshop.yaml`
- `tests/infra/codeCheck.test.ts`, `tests/infra/workshopTemplate.test.ts`
- [docs/workshop.md](../workshop.md) (첫 배포의 검증 기록)
- [docs/reference/security.md](../reference/security.md), [docs/reference/infrastructure.md](../reference/infrastructure.md)
