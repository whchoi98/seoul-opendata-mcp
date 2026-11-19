# 워크숍 Gateway와 코드 인증 설계 스펙 (하위 프로젝트 ①)

- 날짜: 2026-11-19
- 상태: 설계 승인됨, 스펙 검토 대기
- 기반: v0.6.0 (main `8c73baf`, tool 23개)
- 근거 문서: AgentCore Gateway 인터셉터 계약, MCP 서버 대상, tool 이름 규칙(공식 개발자 가이드), my-seoul `infra/myseoul-core.yaml`과 `scripts/deploy.py`

## 1. 개요

워크숍과 해커톤 참가자가 Claude Code로 앱을 만들면서 이 서버의 tool을 쓰고, 완성한 앱도 실행 중에 같은 tool을 부르게 한다. 참가자는 공용 코드 하나를 `Authorization: Bearer <코드>` 헤더에 넣어 AgentCore Gateway에 접속한다. Gateway는 IAM 서명으로 워크숍 전용 AgentCore Runtime을 호출한다.

전체 작업은 하위 프로젝트 네 개로 나누고, 이 문서는 ①만 다룬다.

| 순서 | 하위 프로젝트 | 내용 |
|---|---|---|
| ① | Gateway와 코드 인증 | 이 문서. 워크숍 전용 런타임, Gateway, 코드 검사 인터셉터, 여러 키 순환 |
| ② | 느린 데이터 수집기와 서버 저장소 모드 | 하루 단위 이상으로 바뀌는 데이터를 미리 DynamoDB나 S3에 적재하고 서버가 그곳에서 읽음 |
| ③ | my-seoul 부동산 tool 연결 | my-seoul이 수집한 부동산 집계를 Gateway로 제공 |
| ④ | 실시간 데이터 적재 | 실시간 데이터를 주기적으로 적재해 호출 수를 참가자 수와 무관하게 만듦 |

첫 워크숍은 2주 안에 열리고 이후 반복된다. ①은 첫 워크숍 전에 끝내야 하고, ②도 가능하면 그 전에 끝낸다.

### 목표

- 참가자는 다음 한 줄로 등록을 마친다.
  `claude mcp add --transport http seoul <Gateway URL> --header "Authorization: Bearer <코드>"`
- 코드 발급, 만료, 즉시 폐기는 각각 명령 한 번으로 한다.
- 코드가 없거나 틀리거나 만료된 요청은 런타임에 닿지 않는다.
- 참가자 앱이 같은 tool을 반복 호출하는 사고는 분당 한도로 막는다.
- `SEOUL_API_KEY`에 키를 여러 개 넣으면 앞 키가 하루 한도에 닿을 때 다음 키로 넘어간다. 키가 바뀌어도 캐시는 계속 적중한다.
- 키가 하나일 때 서버 동작은 지금과 같다. stdio 사용자(npx, MCPB, Claude Code 로컬 등록)는 영향을 받지 않는다.

### 비목표

- 참가자별 코드, JWT(Cognito) 인증, WAF
- 저장소 모드(②), 부동산 tool(③), 실시간 적재(④)
- Gateway 의미 검색(semantic search). 내장 검색 tool이 하나 더 생기고 색인 비용이 붙는다
- npm 배포, mcpb 릴리스, ECR `latest`나 `X.Y.Z` 태그 이동
- 기존 리소스 변경: 런타임 `seoul_opendata_mcp`, `myseoul_mcp`, 테이블 `seoul-mcp-cache`

## 2. 구성 요소와 흐름

이 저장소에 `infra/seoul-workshop.yaml`을 두고, 스택 `seoul-workshop` 하나로 배포한다. 리전은 `ap-northeast-2`다.

### 2.1 리소스

| 리소스 | 종류 | 내용 |
|---|---|---|
| `WorkshopTable` | DynamoDB | 온디맨드, 키 `pk`(S), TTL `expireAt`. L2 캐시, 쿼터 장부, 분당 카운터를 함께 담는다 |
| `WorkshopBucket` | S3 | 공개 차단, SSE-S3. 인터셉터 코드 zip을 `code/code-check-<sha16>.zip`에 둔다 |
| `RuntimeRole` | IAM | ECR 이미지 읽기, 로그 쓰기, `WorkshopTable` 읽기와 쓰기 |
| `WorkshopRuntime` | AgentCore Runtime | 이름 `seoul_workshop_mcp`, `PlatformVersion: V2`, `ProtocolConfiguration: MCP`, `NetworkMode: PUBLIC`, 수명 설정은 my-seoul과 같음(유휴 900초, 최대 28800초). 인바운드 인증을 설정하지 않으므로 기본값인 IAM 인증이 적용된다. 조건 `HasImage` |
| `CodeCheckRole` | IAM | 로그 쓰기, `WorkshopTable`의 `dynamodb:UpdateItem` |
| `CodeCheckLogGroup` | CloudWatch Logs | `/aws/lambda/<함수 이름>`, 보존 14일 |
| `CodeCheckFunction` | Lambda | Node.js 22, arm64, 메모리 128MB, 제한 시간 5초, 핸들러 `code-check.handler`. 조건 `HasCode` |
| `GatewayRole` | IAM | `CodeCheckFunction`의 `lambda:InvokeFunction`, `WorkshopRuntime`의 `bedrock-agentcore:InvokeAgentRuntime`. 이 둘만 허용한다 |
| `WorkshopGateway` | AgentCore Gateway | `ProtocolType: MCP`, `AuthorizerType: NONE`, REQUEST 인터셉터 하나(`PassRequestHeaders: true`). 의미 검색은 설정하지 않는다. 조건 `HasAll` |
| `SeoulTarget` | Gateway 대상 | 이름 `seoul`, MCP 서버 대상, `ListingMode: DEFAULT`. 자격 증명은 `GATEWAY_IAM_ROLE`과 `IamCredentialProvider {Service: bedrock-agentcore}`. 조건 `HasAll` |

조건은 `HasImage`(이미지 digest가 주어짐), `HasCode`(코드 키가 주어짐), `HasAll`(둘 다)이다. my-seoul이 쓰는 2단계 생성 방식과 같다.

### 2.2 파라미터

| 파라미터 | NoEcho | 기본값 | 용도 |
|---|---|---|---|
| `McpImageUri` | 아니요 | `""` | `<저장소>@sha256:<digest>` |
| `CodeKey` | 아니요 | `""` | 버킷 안 인터셉터 zip 키 |
| `SeoulApiKey` | 예 | `""` | 쉼표로 구분한 키 목록 |
| `SeoulSubwayApiKey` | 예 | `""` | 지하철 키 하나 |
| `CodeSha256` | 예 | `""` | 워크숍 코드의 sha256 16진수. 비어 있으면 모든 요청을 거부한다 |
| `CodeValidUntil` | 아니요 | `""` | 코드 만료 시각(ISO 8601, `+09:00`). 비어 있으면 모든 요청을 거부한다 |
| `RatePerMinute` | 아니요 | `120` | 분당 `tools/call` 한도(Gateway 전체) |
| `QuotaDailyLimit` | 아니요 | `1000` | 키 하나의 하루 호출 한도. 런타임 `QUOTA_DAILY_LIMIT`로 전달 |

런타임 환경 변수는 `SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`, `CACHE_TABLE_NAME`(`WorkshopTable`), `QUOTA_DAILY_LIMIT`이다.

### 2.3 대상 endpoint

MCP 서버 대상의 URL은 인코딩된 형태여야 하고, Gateway는 그 URL을 그대로 호출한다. 템플릿에서는 ARN 구분자를 미리 인코딩한 문자열을 `!Sub`로 조립한다.

```yaml
Endpoint: !Sub "https://bedrock-agentcore.${AWS::Region}.amazonaws.com/runtimes/arn%3A${AWS::Partition}%3Abedrock-agentcore%3A${AWS::Region}%3A${AWS::AccountId}%3Aruntime%2F${WorkshopRuntime.AgentRuntimeId}/invocations?qualifier=DEFAULT"
```

`DEFAULT` 목록 모드에서는 대상을 만들거나 갱신할 때 Gateway가 `tools/list`로 tool을 가져와 목록에 넣는다. 런타임 이미지만 바뀌면 대상은 갱신되지 않으므로, 배포 스크립트가 `synchronize-gateway-targets`를 호출한다.

### 2.4 요청 흐름

1. 참가자의 Claude Code나 앱이 Gateway URL로 `POST /mcp`를 보낸다.
2. Gateway가 `CodeCheckFunction`을 호출한다. 인터셉터는 코드, 만료, 분당 한도를 확인하고, 실패하면 Gateway가 런타임을 부르지 않고 바로 응답하도록 한다.
3. 통과한 요청은 Gateway 역할의 SigV4 서명으로 런타임에 전달된다.
4. 런타임은 캐시를 확인하고, 캐시에 없으면 키 풀에서 키를 골라 서울 API를 호출한다.

tool 이름은 `${대상 이름}___${tool 이름}` 형식이 되므로 참가자에게는 `seoul___get_city_snapshot`처럼 보인다.

런타임 URL은 IAM 인증만 받으므로 참가자가 인터셉터를 건너뛰고 런타임을 직접 부를 수 없다.

### 2.5 Gateway 프로토콜 버전

Gateway가 지원하는 MCP 버전은 생성할 때 정해진다. `ProtocolConfiguration.Mcp.SupportedVersions`에 문서가 지원한다고 밝힌 네 버전(`2025-03-26`, `2025-06-18`, `2025-11-25`, `2026-07-28`)을 모두 넣는다. 참가자 클라이언트의 버전이 제각각이기 때문이다.

## 3. 코드 검사 인터셉터

파일은 `infra/lambda/code-check.mjs` 하나다. 의존성은 Lambda 런타임에 포함된 AWS SDK v3(`@aws-sdk/client-dynamodb`)뿐이다.

### 3.1 계약 (문서에서 확인함)

- 입력: `event.mcp.gatewayRequest.headers`(헤더 전달을 켰을 때만 있음), `event.mcp.gatewayRequest.body`(JSON-RPC 객체).
- 통과: `{ interceptorOutputVersion: "1.0", mcp: { transformedGatewayRequest: { body } } }`. 받은 `body`를 바꾸지 않고 돌려준다.
- 거부: `mcp.transformedGatewayResponse: { statusCode, body }`를 넣는다. 이 필드가 있으면 Gateway는 대상을 호출하지 않고 그 내용으로 바로 응답한다.
- Gateway는 실패나 시간 초과 때 인터셉터를 다시 호출할 수 있다. 분당 카운터가 실제보다 조금 더 셀 수 있으며, 이는 허용한다.

### 3.2 처리 순서

| 단계 | 확인 | 실패 응답 |
|---|---|---|
| 1 | 헤더 이름의 대소문자를 무시하고 `Authorization`을 찾는다. `Bearer ` 뒤 문자열의 sha256을 `CODE_SHA256`과 `crypto.timingSafeEqual`로 비교한다. `CODE_SHA256`이 비어 있으면 실패로 본다 | HTTP 403, JSON-RPC `error {code: -32001, message: 코드 안내}` |
| 2 | 현재 시각이 `VALID_UNTIL` 이전인지 확인한다. 비어 있거나 해석할 수 없으면 실패로 본다 | HTTP 403, `error {code: -32001, message: 만료 안내}` |
| 3 | 메서드가 `tools/call`이면 `WorkshopTable`에서 `pk = rate#<UTC YYYYMMDDHHmm>`을 `ADD n :1`로 올린다. `expireAt`은 지금부터 120초 뒤로 둔다. 돌려받은 `n`이 `RATE_PER_MINUTE`를 넘으면 실패로 본다 | HTTP 200, `result {isError: true, content: [{type: "text", text: 한도 안내}]}` |
| 4 | 통과 | 없음 |

JSON-RPC 응답의 `id`는 요청 `body.id`를 그대로 쓰고, 없으면 `null`이다.

안내 문구는 한국어 다음에 영어를 둔다.

- 코드: "워크숍 코드가 올바르지 않습니다. Authorization: Bearer <코드> 헤더를 확인하세요. / Invalid workshop code."
- 만료: "워크숍 코드가 만료되었습니다. 진행자에게 새 코드를 받으세요. / Workshop code expired."
- 한도: "요청이 많습니다. 1분 뒤 다시 시도하세요. / Too many requests, retry in a minute."

### 3.3 판단 근거

- 환경 변수에는 코드 원문이 아니라 해시를 둔다. Lambda 설정을 조회할 수 있는 사람도 코드를 알 수 없다.
- 3단계의 DynamoDB 호출이 실패하면 요청을 통과시키고 로그를 남긴다. 서버의 L2 캐시와 쿼터 장부가 같은 원칙을 따른다. 1, 2단계는 외부 호출이 없고, 판단할 수 없으면 거부한다.
- 한도 초과를 `isError` 결과로 돌려주는 이유는 LLM이 안내 문구를 읽고 기다리게 하기 위해서다. 전송 오류로 돌려주면 클라이언트가 연결 실패로 처리한다.
- 분당 한도는 하루 쿼터 보호 장치가 아니다. 하루 쿼터는 서버 캐시, 키 순환, ②가 지킨다. 인터셉터는 캐시 적중 여부를 모르므로 기본값을 넉넉하게 120으로 둔다.
- 401은 쓰지 않는다. MCP 클라이언트는 401을 받으면 OAuth 탐색을 시도할 수 있고, 이 Gateway에는 OAuth 메타데이터가 없다.

### 3.4 로그

한 요청에 한 줄을 남긴다. 내용은 `{method, tool, decision}`이고, `decision`은 `pass`, `bad_code`, `expired`, `rate_limited`, `rate_check_failed` 중 하나다. 헤더, 코드, 요청 인자는 남기지 않는다.

### 3.5 구조

```js
export function createHandler({ codeSha256, validUntil, ratePerMinute, incr, now, log }) { ... }
export const handler = createHandler({ /* process.env와 DynamoDB 기반 incr */ })
```

`incr(pk, expireAt)`은 증가한 값을 돌려준다. 테스트는 `incr`, `now`, `log`를 주입한다.

## 4. 서버 변경

### 4.1 키 풀

새 파일 `src/client/keyPool.ts`에 `KeyPool`을 둔다.

| 항목 | 동작 |
|---|---|
| 파싱 | `parseKeys(raw)`는 쉼표로 나누고 공백을 자르고 빈 항목과 중복을 지운다. 결과가 비면 `['sample']` |
| 샘플 판정 | 풀이 `['sample']`일 때만 샘플 모드다 |
| 쿨다운 | `cooldown(key, ms)`. 메모리에만 기록한다. 쿨다운 중인 키는 선택하지 않는다 |
| 선택 | `pick(ledger)`는 모든 키의 `status`를 병렬로 읽고, 쿨다운이 아닌 키 가운데 목록 순서에서 처음 만나는 `ratio < 1` 키를 고른다. 결과는 `{ key, keyId, pool }` 또는 `{ exhausted: true, pool }` |
| 풀 상태 | `pool = { used: 합, limit: 합, ratio }`. 쿨다운 중인 키도 합계에 넣는다 |

장부 조회가 실패하면 지금처럼 그 키를 무제한(`ratio 0`)으로 본다.

일반 API와 지하철 API는 풀을 따로 둔다. 지하철 풀은 `SEOUL_SUBWAY_API_KEY` 하나이고, 비어 있으면 일반 풀의 첫 키 하나를 쓴다. 지금 동작과 같다.

### 4.2 `SeoulApiClient` 변경

- 캐시 키: `buildCacheKey`는 `buildUrl`과 같은 문자열을 만들되 키 자리에 `{key}`를 넣는다. 샘플 모드에서는 `sample`을 넣는다. 캐시 조회와 저장, single-flight 맵이 모두 이 키를 쓴다.
- 호출 URL: 고른 키로 `buildUrl`을 만든다. 이 URL은 `request()`에만 쓰고 저장하지 않는다.
- 쿼터 판정: 지금의 `budget` 자리에 `pick` 결과를 쓴다. `exhausted`이면 지금처럼 캐시만으로 응답하고, 80% 안내는 `pool.ratio`로 계산한다.
- `ERROR-337` 처리: 풀에 키가 둘 이상일 때 `SeoulApiError.code === 'ERROR-337'`이 나면 그 키를 10분 쿨다운에 넣고, 고를 수 있는 다른 키가 있으면 한 번만 다시 호출한다. 다시 호출해도 실패하면 오류를 그대로 던진다. 키가 하나(샘플 포함)면 쿨다운 없이 지금처럼 오류를 던진다. 키가 하나일 때 동작을 바꾸지 않기 위해서다. 이 코드는 샘플 키의 초당 제한에서 확인됐고, 실제 키에서의 의미는 확인되지 않았다(10.1). 초당 제한이든 하루 한도든 손실이 작도록 10분으로 정했다. 한도가 남은 키가 모두 쿨다운 중이면 일일 쿼터 소진 안내 대신 호출 제한이라는 점과 다시 시도할 시점을 안내한다.
- 마스킹: `maskKey(k)` 함수를 둔다. 오류 메시지에는 실제로 호출한 키만 마스킹해 넣는다. `maskedKey()`는 첫 키를 마스킹하고, 키가 여러 개면 `외 N개`를 붙인다.
- `isSample`, `maskedSubwayKey()`, 공개 메서드 시그니처는 바꾸지 않는다.

### 4.3 캐시 키 변경의 영향

DynamoDB `pk`는 지금처럼 캐시 키의 sha256이다. 캐시 키 형식이 바뀌므로 기존 L2 항목은 더 이상 적중하지 않고 TTL(24시간)로 지워진다.

- 워크숍 테이블은 새로 만들므로 영향이 없다.
- my-seoul의 `myseoul_mcp`가 이 버전으로 올라가면 첫날 캐시를 다시 쌓는 동안 서울 API 호출이 늘어난다. CHANGELOG에 적는다.

캐시 키에서 원문 API 키가 빠지므로 L1 메모리의 키 문자열에도 API 키가 남지 않는다.

### 4.4 버전

①을 마치면 `0.7.0`으로 올린다(새 기능, 하위 호환). `package.json`, `manifest.json`, README 두 개, CHANGELOG를 함께 맞춘다. 워크숍 이미지 태그는 이 버전을 쓴다.

## 5. 배포와 운영

### 5.1 파일

| 파일 | 역할 |
|---|---|
| `infra/seoul-workshop.yaml` | 스택 템플릿 |
| `infra/lambda/code-check.mjs` | 인터셉터 |
| `infra/CLAUDE.md` | 이 디렉터리의 규칙(승인 없이 스택 변경 금지, 템플릿에 계정 ID와 ARN을 쓰지 않음, 기존 리소스를 건드리지 않음) |
| `scripts/workshop-lib.ts` | 순수 함수: 코드 생성, 해시, 만료 시각 계산, 파라미터 목록 구성, 임시 비밀 파일 |
| `scripts/workshop-aws.ts` | aws CLI와 docker 호출 래퍼, 스택 생성, 갱신, 삭제 |
| `scripts/workshop-deploy.ts` | 배포와 삭제 |
| `scripts/workshop-code.ts` | 코드 `new`, `revoke`, `show` |
| `docs/workshop.md` | 참가자와 진행자 안내 |

npm `files`는 `dist`와 README만 포함하므로 위 파일은 패키지에 들어가지 않는다. `.mcpbignore`에 `/infra/`를 추가한다.

`package.json` 스크립트에 `workshop:deploy`(`tsx scripts/workshop-deploy.ts`)와 `workshop:code`(`tsx scripts/workshop-code.ts`)를 추가한다. 두 스크립트는 aws CLI와 docker를 `execFileSync`에 인자 배열로 넘겨 호출한다. 셸 문자열은 만들지 않는다.

### 5.2 배포 (`npm run workshop:deploy -- --env-file ../seoul-opendata-mcp/.env`)

1. 작업 트리가 깨끗한지 확인한다. 깨끗하지 않으면 멈춘다. 이미지 태그와 커밋을 일대일로 맞추기 위해서다.
2. 스택이 없으면 이미지와 코드 없이 만든다. 이 단계에서는 테이블, 버킷, 역할만 생긴다.
3. 이미지를 빌드해(호스트가 arm64이므로 `docker build`) 기존 ECR 저장소 `seoul-opendata-mcp`에 `<버전>-workshop-<커밋 7자>` 태그로 올리고 digest를 얻는다. 같은 태그가 이미 있으면 그 digest를 쓴다.
4. `code-check.mjs`를 zip으로 묶어 `code/code-check-<code-check.mjs sha256 앞 16자>.zip`으로 올린다. 같은 키가 있으면 올리지 않는다. zip은 만들 때마다 안에 든 시각이 달라 해시가 바뀌므로 원본 파일의 해시를 쓴다.
5. 스택을 digest와 코드 키로 갱신한다. 키는 env 파일에서 읽고, 파라미터는 권한 0600인 임시 JSON 파일로 `--parameters file://`에 넘긴 뒤 지운다. 키와 코드 해시는 화면에 출력하지 않는다. 스택을 처음 만들 때는 `--env-file`이 반드시 있어야 하고, 없으면 2단계 전에 멈춘다. 이미 있는 스택에서 `--env-file`을 빼면 키 파라미터는 `UsePreviousValue`로 넘긴다. 코드 관련 파라미터는 항상 `UsePreviousValue`다.
6. 런타임이 `READY`이고 `PlatformVersion`이 `V2`인지 확인한다.
7. `synchronize-gateway-targets`를 호출하고, 대상 상태가 `READY`가 될 때까지 기다린다.
8. 스모크 테스트를 `@modelcontextprotocol/sdk` 클라이언트로 한다. 저장소 규칙상 임의 `fetch`를 쓰지 않는다. 코드 없이 접속해 거부되는지 확인한다. 코드가 발급돼 있으면 `SEOUL_WORKSHOP_CODE` 환경 변수로 받아 `tools/list` 23개와 `seoul___search_place` 호출을 확인한다. `search_place`는 내장 핫스팟만 조회하므로 서울 API 쿼터를 쓰지 않는다.
9. Gateway URL과 참가자 등록 명령(코드 자리는 `<코드>`)을 출력한다.

`--skip-image`는 3단계를 건너뛰고 현재 digest를 유지한다. `--delete`는 지울 대상(스택과 버킷 객체)을 먼저 출력하고, `--yes`가 함께 있을 때만 버킷을 비운 뒤 스택을 지운다. ECR 이미지는 지우지 않는다.

### 5.3 코드 명령 (`npm run workshop:code -- <명령>`)

| 명령 | 동작 |
|---|---|
| `new [--days N]` | 새 코드를 만들고 `CodeSha256`, `CodeValidUntil`(지금부터 N일, 기본 1일, 최대 14일)을 갱신한다. 스택 갱신이 끝난 뒤 코드를 한 번만 출력한다 |
| `revoke` | `CodeValidUntil`을 지금 시각으로 바꾼다 |
| `show` | `CodeValidUntil`과 남은 시간을 출력한다 |

스택 갱신은 `update-stack --use-previous-template`으로 하고, 나머지 파라미터는 `UsePreviousValue`로 넘긴다. Lambda 환경 변수를 직접 고치지 않는다. 직접 고치면 다음 스택 배포 때 되돌아간다. 갱신에는 1분 정도 걸린다.

코드 형식은 `seoul-XXXX-XXXX`이다. 문자는 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`(32자, 0, 1, O, I 제외)에서 `crypto.randomInt`로 뽑는다. 8자로 40비트이고, 만료와 분당 한도를 함께 적용하므로 워크숍 용도로 충분하다.

### 5.4 운영

- 워크숍과 워크숍 사이에는 스택을 그대로 두고 `revoke`만 실행한다.
- 코드가 유출되면 `new`로 바꾼다. 이전 코드는 해시가 바뀌는 즉시 거부된다.
- 참가자 수가 많아 분당 한도에 자주 걸리면 `RatePerMinute`만 올려 다시 배포한다(`--skip-image`).

### 5.5 참가자 안내 (`docs/workshop.md`)

- Claude Code 등록 명령 한 줄과 `/mcp`로 확인하는 방법
- tool 이름에 `seoul___` 접두사가 붙는다는 설명
- 앱 예제 두 개: TypeScript(`@modelcontextprotocol/sdk`의 `StreamableHTTPClientTransport`에 `requestInit.headers`로 코드를 넣음)와 Python(`mcp` 패키지의 Streamable HTTP 클라이언트에 `headers`를 넣음)
- 주의: 코드는 브라우저 JS가 아니라 서버 쪽에서 붙인다. 코드는 만료되므로 앱을 계속 운영하려면 각자 서울 열린데이터광장 키로 서버를 직접 띄워야 한다

## 6. 테스트

모든 코드는 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.

### 6.1 키 풀과 클라이언트 (`tests/keyPool.test.ts`, `tests/seoulApi.test.ts` 추가분)

- 쉼표 파싱: 공백, 빈 항목, 중복, 빈 문자열이면 샘플
- 키가 하나일 때 기존 `seoulApi`, `dynamo`, `quota` 테스트가 모두 그대로 통과
- k1이 100%면 호출 URL에 k2가 들어감
- 모든 키가 소진되면 캐시만으로 응답하고 소진 안내를 붙임. 캐시가 없으면 빈 결과와 안내를 돌려줌
- 80% 안내가 풀 합계로 계산됨(예: 한도 5, 키 2개, 사용 4와 4면 80%)
- k1으로 저장한 캐시가, k1이 소진돼 k2를 고르는 상태에서도 적중함
- 같은 요청 두 개가 서로 다른 키를 고르더라도 업스트림 호출이 한 번으로 합쳐짐
- `ERROR-337`이 나면 k2로 한 번 재시도하고, k1은 10분 동안 선택되지 않다가 10분 뒤 다시 선택됨
- 키가 하나(샘플 포함)일 때 `ERROR-337`이 나면 재시도도 쿨다운도 하지 않음
- 오류 메시지와 `console.error` 출력에 원문 키가 없음
- 샘플 모드의 캐시 키와 실제 키 모드의 캐시 키가 다름

### 6.2 인터셉터 (`tests/infra/codeCheck.test.ts`)

- 헤더 없음, `Bearer` 없음, 틀린 코드는 403과 `-32001`
- `CODE_SHA256`이 비어 있으면 403
- 만료됨, `VALID_UNTIL`이 비어 있거나 해석할 수 없으면 403
- 소문자 `authorization` 헤더도 인식함
- 정상 요청은 `body`가 그대로 통과함(깊은 비교)
- 한도를 넘은 `tools/call`은 200과 `isError: true`, `id` 유지
- 한도를 넘은 상태에서도 `tools/list`는 통과함
- `incr`가 예외를 던지면 통과하고 `rate_check_failed`를 남김
- 모든 경우에 `log`로 넘긴 내용에 코드 문자열과 헤더 값이 없음

### 6.3 템플릿 구조 (`tests/infra/workshopTemplate.test.ts`)

`js-yaml`과 `@types/js-yaml`을 devDependency로 추가하고, `!Ref`, `!Sub`, `!GetAtt` 같은 짧은 태그를 객체로 읽는 사용자 타입을 등록한다.

- 런타임: V2, MCP, PUBLIC, `AuthorizerConfiguration` 없음, 이름이 `seoul_workshop_`으로 시작
- Gateway: `AuthorizerType: NONE`, REQUEST 인터셉터가 정확히 하나, `PassRequestHeaders: true`, `SearchType` 없음
- 대상: 이름 `seoul`, `GATEWAY_IAM_ROLE`, `IamCredentialProvider.Service`가 `bedrock-agentcore`
- `GatewayRole`의 액션은 `lambda:InvokeFunction`과 `bedrock-agentcore:InvokeAgentRuntime` 두 가지뿐이고, 리소스는 각각 이 스택의 함수와 런타임
- 모든 역할에서 `Resource: "*"`인 액션은 `ecr:GetAuthorizationToken`뿐
- 템플릿 원문에 12자리 숫자와 `arn:aws:` 리터럴이 없음
- `seoul_opendata_mcp`, `myseoul_mcp`, `seoul-mcp-cache`라는 문자열이 없음
- 테이블 TTL 속성이 `expireAt`
- `SeoulApiKey`, `SeoulSubwayApiKey`, `CodeSha256`이 `NoEcho: true`
- 런타임, Lambda, Gateway, 대상에 붙은 조건이 각각 `HasImage`, `HasCode`, `HasAll`, `HasAll`

### 6.4 스크립트 순수 함수 (`tests/workshopLib.test.ts`)

- 코드 형식이 `^seoul-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$`
- 해시가 Node `crypto`의 sha256과 같음
- `--days` 범위(1~14) 밖이면 오류
- 만료 시각이 `+09:00` 형식
- 파라미터 파일에서 지정하지 않은 파라미터는 `UsePreviousValue: true`
- env 파일 읽기: `src/client/env.ts`에서 분리한 `parseDotEnv`를 서버와 스크립트가 함께 쓴다. 따옴표, 주석, 빈 줄, `=`가 없는 줄을 검사한다

## 7. 문서 갱신

| 문서 | 내용 |
|---|---|
| `docs/reference/security.md` | 키 풀, 키를 뺀 캐시 키, 오류 메시지 마스킹, 인터셉터의 코드 해시 저장 |
| `docs/reference/api.md` | `SEOUL_API_KEY` 쉼표 목록, `ERROR-337` 처리 |
| `src/client/CLAUDE.md` | 캐시 키에 원문 키를 넣지 않는다는 규칙, 키 선택은 `KeyPool`만 한다는 규칙 |
| `infra/CLAUDE.md` | 새로 만듦(5.1) |
| `docs/workshop.md` | 새로 만듦(5.5) |
| `README.md`, `README.ko.md` | 환경 변수 표에 쉼표 목록 설명 한 줄, 워크숍 문서 링크 |
| `CHANGELOG.md` | 0.7.0 항목. 캐시 키 형식 변경으로 기존 L2 캐시가 한 번 비워진다는 내용 포함 |

## 8. 비용 추정

모든 구성 요소가 사용량 과금이고 시간당 고정 요금이 없다. 아래 단가는 us-east-1 기준으로 제3자 자료에서 확인한 값이다. 서울 리전 단가는 배포 전에 공식 가격 페이지에서 확인한다.

| 항목 | 단가 | 워크숍 1회 가정 | 추정 |
|---|---|---|---|
| Gateway 호출 | 1,000회당 0.005달러 | 참가자 30명, 1인당 200회, 6,000회 | 0.03달러 |
| Runtime CPU | vCPU 시간당 0.0895~0.1276달러(V2 단가 자료가 엇갈림) | 4시간, 평균 0.1 vCPU 사용 | 0.05달러 이하 |
| Runtime 메모리 | GB 시간당 0.00945~0.0169달러 | 4시간, 2GB 상주 | 0.14달러 이하 |
| Lambda, DynamoDB, S3, 로그 | 요청 단위 | 위 호출 수 기준 | 0.1달러 이하 |

워크숍 1회에 1달러 미만으로 추정한다. 쉬는 동안에는 S3 보관료와 로그 보관료만 남는다.

## 9. 배포 후 검증 순서

스택 생성과 변경은 사용자 승인 뒤에만 한다.

1. 코드 없이 `initialize`와 `tools/list`를 호출해 거부되는지 본다. `initialize`가 인터셉터를 거치는지 기록한다.
2. 틀린 코드와 만료된 코드로 Claude Code에 등록해 본다. 안내 문구가 화면에 보이는지 확인하고, 보이지 않으면 거부 응답을 HTTP 200과 JSON-RPC 오류로 바꾼다.
3. 올바른 코드로 `claude mcp add`를 실행하고, `/mcp`에서 `seoul___` 접두사가 붙은 tool 23개를 확인한다.
4. `seoul___search_place`를 한 번, 실제 서울 API를 부르는 `seoul___get_city_snapshot`을 한 번 호출한다.
5. `RatePerMinute`를 3으로 내려 배포하고, 같은 분 안의 네 번째 `tools/call`이 `isError`로 돌아오는지 본다.
6. `QuotaDailyLimit`를 2로 내려 배포하고, 세 번째 업스트림 호출부터 두 번째 키를 쓰는지 장부 항목(`quota#<keyId>#<날짜>`)으로 확인한다.
7. `revoke`를 실행한 뒤 거부되는지 본다.
8. 5, 6에서 바꾼 파라미터를 원래 값으로 되돌린다.

## 10. 미확인 사항과 리스크

### 10.1 미확인 사항

| 항목 | 확인 방법 | 결과에 따른 조치 |
|---|---|---|
| `initialize`가 REQUEST 인터셉터를 거치는지 | 검증 1단계 | 거치지 않아도 `tools/list`와 `tools/call`이 막히므로 데이터는 보호된다. 문서에 기록만 한다 |
| Claude Code가 403 응답의 안내 문구를 보여 주는지 | 검증 2단계 | 보여 주지 않으면 HTTP 200과 JSON-RPC 오류로 바꾼다 |
| Gateway와 런타임 사이의 MCP 버전 협상 | 대상 생성 시 암묵적 동기화가 성공하는지 | 실패하면 `SupportedVersions`를 서버 SDK가 지원하는 버전으로 좁힌다. CloudFormation이 버전 값을 거부해도 같은 방법으로 좁힌다 |
| 실제 키에서 `ERROR-337`의 의미, 하루 한도 초과 시 돌아오는 코드 | 서울 열린데이터광장 운영팀 문의 또는 운영 로그 | 하루 한도 코드가 따로 있으면 그 코드를 쿨다운 대상에 추가하고 쿨다운을 KST 자정까지로 늘린다 |
| 계정당 받을 수 있는 인증키 수 | 서울 열린데이터광장 마이페이지 | 키를 하나만 받을 수 있으면 키 순환은 효과가 없고, 캐시와 ②가 주된 방어가 된다 |
| 서울 리전 AgentCore 단가 | 공식 가격 페이지 | 8절 표를 고친다 |

### 10.2 리스크

| 리스크 | 대응 |
|---|---|
| 공용 코드가 유출되면 만료 전까지 누구나 쓸 수 있다 | 짧은 만료(기본 1일), `revoke`, 분당 한도 |
| Gateway URL이 공개되어 있어 코드를 무작위로 대입해 볼 수 있다 | 코드 40비트. 시도마다 Lambda 호출 비용만 생긴다. 문제가 되면 WAF를 별도 작업으로 붙인다(`WafConfiguration`) |
| 하루 쿼터가 워크숍 중에 바닥난다 | 키 순환, 캐시, ②의 사전 적재. 서울 열린데이터광장 FAQ에 따르면 활용사례 갤러리에 서비스를 등록해 승인받으면 호출 제한 없이 쓸 수 있으므로 함께 신청한다 |
| 인터셉터 콜드 스타트로 첫 호출이 느리다 | 128MB, 의존성 없음으로 줄인다. 체감되면 진행자가 시작 전에 한 번 호출한다 |
| 캐시 키 형식 변경으로 `myseoul_mcp`의 캐시가 한 번 비워진다 | CHANGELOG에 적고, my-seoul이 업그레이드 시점을 고른다 |

## 11. 작업 순서

1. 키 풀과 캐시 키 변경(4절, 6.1)
2. 인터셉터(3절, 6.2)
3. 템플릿과 구조 테스트(2절, 6.3)
4. 스크립트(5절, 6.4)
5. 문서(5.5, 7절)와 0.7.0 버전 맞춤
6. 배포와 검증(9절). 사용자 승인 뒤에 진행한다
