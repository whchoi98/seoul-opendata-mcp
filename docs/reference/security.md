# Security / 보안 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview

The security layer governs how the two Seoul Open Data Plaza API keys (`SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`) are loaded, selected, masked, and degraded to a scope-limited sample key, so that no real key can leak into logs, error messages, or the MCPB-bundled package.

### 2. Components

| Component | Path | Purpose |
|---|---|---|
| `loadDotEnv` | `src/client/env.ts` | Reads a local `.env` file and fills only the environment variables not already set on `process.env` |
| `SeoulApiClient` constructor | `src/client/seoulApi.ts` | Builds the general key pool from `opts.apiKey ?? process.env.SEOUL_API_KEY` (comma-separated, `parseKeys`) and a one-key subway pool; `isSample` is true only when the general pool is the sample key alone |
| `KeyPool` | `src/client/keyPool.ts` | Picks the first key under its daily limit that is not cooling down; raw keys stay in memory and the ledger sees only `keyIdOf()` hashes |
| `maskKey` / `maskedKey` / `maskedSubwayKey` | `src/client/keyPool.ts`, `src/client/seoulApi.ts` | Expose only the first 4 characters of a real key (or the literal `sample`); `maskedKey()` appends `외 N개` when the pool holds more keys |
| `request` error paths | `src/client/seoulApi.ts` | Embed only the masked key that was actually used in `HTTP-<status>`, `TIMEOUT` and `NETWORK` `SeoulApiError` messages |
| Cache key | `src/client/seoulApi.ts` (`fetchUnwrapped`) | The request URL with the key segment replaced by `{key}` (`sample` in sample mode), so neither L1, L2 nor the single-flight map holds a raw key |
| `fetchUnwrapped` sample clamp | `src/client/seoulApi.ts` | Clamps `end` to `start + 4` when the pool is the sample key alone, limiting every request to at most 5 rows |
| `KEY_GUIDE` | `src/normalize/util.ts:9-10` | Shared key-signup URL string surfaced in `SAMPLE_NOTE` and in `INFO-100`/key-related error hints |
| `SAMPLE_NOTE` | `src/tools/envelope.ts:3` | Sample-mode advisory string appended to every tool response's `notes[]` when `ctx.client.isSample` is `true` |
| `.env.example` | `.env.example` | Committed placeholder template; real `.env` is listed in `.gitignore` and never committed |
| `user_config` | `manifest.json:21-36` | Declares both keys as `sensitive: true`, optional inputs for the MCPB one-click installer |
| `secret-scan.sh` | `.claude/hooks/secret-scan.sh` | Blocks a commit whose staged files contain a secret: Claude Code PreToolUse hook on `git commit` (exit 2) and git `pre-commit` hook (`--pre-commit`, exit 1) |
| `install-hooks.sh` | `scripts/install-hooks.sh` | Installs the git `pre-commit` (secret scan) and `commit-msg` hooks into `.git/hooks` |
| `code-check.mjs` | `infra/lambda/code-check.mjs` | Workshop gateway REQUEST interceptor: compares the sha256 of the `Bearer` code with `CODE_SHA256` in constant time, checks `VALID_UNTIL`, limits `tools/call` per minute, and logs only `{method, tool, decision}` |

### 3. Key Decisions

- Prefer explicit environment variables over `.env` values (`loadDotEnv` only fills unset keys), so a key injected by an MCP client's own env/`user_config` mechanism is never silently overridden by a stray checked-in `.env`.
- Fail open into a scope-limited sample key rather than throwing on missing configuration, so a first-time user gets a working server immediately and discovers the key-signup flow from the response `notes[]` instead of a crash.
- Mask keys at the source (`maskedKey()`/`maskedSubwayKey()`) rather than redacting at a logging boundary, so there is no code path — including error messages — that can construct a string containing the full key.
- Treat the subway key as an optional override of the general key, not a second mandatory credential, keeping the common case (one key) simple while still allowing quota isolation for `get_subway_arrivals`.
- The single HTTP path and env-key handling decisions above are recorded as [ADR-003](../decisions/ADR-003-single-http-path-and-env-keys.md).
- In the workshop stack the Seoul API keys sit in the AgentCore runtime's environment variables and the code's sha256 in the Lambda's environment variables. `NoEcho` only hides CloudFormation output, so `bedrock-agentcore:GetAgentRuntime` and `lambda:GetFunctionConfiguration` on those two resources are effectively read access to the secrets. The 40-bit unsalted code hash resists casual viewing, not an offline guess.
- Scan the staged blob (`git show :path`) at commit time, on two layers: the PreToolUse hook gives Claude an immediate, explained block, and the git `pre-commit` hook covers `git add -A && git commit` in one command, which PreToolUse cannot see because it runs before the command stages anything.
- Seoul keys are 32-char lowercase hex, which also matches fixture image ids (`atchFileId=…`). The scan therefore checks the literal values of `*_KEY`/`*_SECRET`/`*_TOKEN` variables from the local `.env` (reported by variable name only) and flags 32-hex runs only in key context: an `api_key`-style assignment or an `…seoul.go.kr/<key>/` URL path.
- **Partition values are checked before they become a key.** A participant can pass any string through `call_dataset`, and a partition value becomes part of an S3 key or a file path. Each partition position has a format (`^\d{8}$`, `^[1-9]호선$`, and so on) and only values that pass are used; anything else is not answered by the store. `DirectoryStore` also refuses keys that resolve outside its root.
- **The collector shows keys only masked.** `npm run workshop:collect` reads keys from `.env.workshop`, prints them through `maskKey()`, and records its calls in the same quota ledger as the runtime. With the schedule enabled, the collector Lambda holds the Seoul API keys in its environment, so `lambda:GetFunctionConfiguration` on it is equivalent to reading the keys.

### 4. Code Pointers

- `src/client/env.ts:4-18` — `.env` parsing and precedence rule
- `src/client/seoulApi.ts` — key selection and `isSample` derivation
- `src/client/seoulApi.ts` — `maskedKey()` / `maskedSubwayKey()`
- `src/client/seoulApi.ts` — `request()`, masked key embedded in error messages
- `src/client/seoulApi.ts` — `fetchUnwrapped()` sample-mode row clamp
- `src/normalize/util.ts:9-10` — `KEY_GUIDE`
- `src/tools/envelope.ts:1-10` — `SAMPLE_NOTE` and its attachment in `ok()`
- `manifest.json:21-36` — MCPB `user_config` key declarations

### 5. Cross-references
- Related modules: `src/client/response.ts` (`SeoulApiError`, `INFO-100` key-related hint)
- Related ADRs: [ADR-003](../decisions/ADR-003-single-http-path-and-env-keys.md) (single HTTP path and env keys), [ADR-005](../decisions/ADR-005-workshop-shared-code-at-the-gateway.md) (workshop access by one shared code), [ADR-006](../decisions/ADR-006-key-pool-with-key-independent-cache-keys.md) (key pool and key-independent cache keys)
- Related runbooks: none recorded yet — see `docs/architecture.md` Operations section for a suggested "key rotation / sample-mode diagnosis" runbook

<a id="korean"></a>
## 한국어

### 1. 개요

보안 계층은 서울 열린데이터광장 API 키 두 종류(`SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`)를 어떻게 로드·선택·마스킹하고, 범위가 제한된 샘플 키로 어떻게 폴백시키는지를 담당합니다. 이를 통해 실제 키가 로그, 에러 메시지, MCPB 번들 패키지 어디에도 유출되지 않도록 합니다.

### 2. 구성요소

| 구성요소 | 경로 | 목적 |
|---|---|---|
| `loadDotEnv` | `src/client/env.ts` | 로컬 `.env` 파일을 읽어 `process.env`에 아직 설정되지 않은 변수만 채웁니다 |
| `SeoulApiClient` 생성자 | `src/client/seoulApi.ts` | `opts.apiKey ?? process.env.SEOUL_API_KEY`(쉼표 목록, `parseKeys`)로 일반 키 풀을, 키 하나로 지하철 풀을 만듭니다. 일반 풀이 샘플 키 하나일 때만 `isSample`이 참입니다 |
| `KeyPool` | `src/client/keyPool.ts` | 하루 한도 미만이고 쿨다운 중이 아닌 첫 키를 고릅니다. 원문 키는 메모리에만 두고 장부에는 `keyIdOf()` 해시만 넘깁니다 |
| `maskKey` / `maskedKey` / `maskedSubwayKey` | `src/client/keyPool.ts`, `src/client/seoulApi.ts` | 실제 키의 앞 4글자만(또는 리터럴 `sample`) 보여 줍니다. 풀에 키가 더 있으면 `maskedKey()`가 `외 N개`를 붙입니다 |
| `request` 에러 경로 | `src/client/seoulApi.ts` | `HTTP-<status>`, `TIMEOUT`, `NETWORK` `SeoulApiError` 메시지에 실제로 호출에 쓴 키의 마스킹만 넣습니다 |
| 캐시 키 | `src/client/seoulApi.ts`(`fetchUnwrapped`) | 요청 URL의 키 자리를 `{key}`(샘플 모드는 `sample`)로 바꾼 값입니다. L1, L2, single-flight 맵 어디에도 원문 키가 남지 않습니다 |
| `fetchUnwrapped` 샘플 클램프 | `src/client/seoulApi.ts` | 키 풀이 샘플 키 하나일 때 `end`를 `start + 4`로 클램프하여 요청당 최대 5행으로 제한합니다 |
| `KEY_GUIDE` | `src/normalize/util.ts:9-10` | `SAMPLE_NOTE`와 `INFO-100` 등 키 관련 에러 힌트에 사용되는 공용 키 발급 URL 문자열 |
| `SAMPLE_NOTE` | `src/tools/envelope.ts:3` | `ctx.client.isSample`이 `true`일 때 모든 tool 응답의 `notes[]`에 추가되는 샘플 모드 안내 문자열 |
| `.env.example` | `.env.example` | 커밋되는 플레이스홀더 템플릿; 실제 `.env`는 `.gitignore`에 등록되어 절대 커밋되지 않습니다 |
| `user_config` | `manifest.json:21-36` | 두 키를 모두 `sensitive: true`인 선택적 입력으로 선언하여 MCPB 원클릭 설치에 사용합니다 |
| `secret-scan.sh` | `.claude/hooks/secret-scan.sh` | stage된 파일에 비밀이 있으면 커밋을 막습니다. `git commit`에 걸리는 Claude Code PreToolUse 훅(exit 2)과 git `pre-commit` 훅(`--pre-commit`, exit 1) 두 경로로 동작합니다 |
| `install-hooks.sh` | `scripts/install-hooks.sh` | git `pre-commit`(비밀 검사)과 `commit-msg` 훅을 `.git/hooks`에 설치합니다 |
| `code-check.mjs` | `infra/lambda/code-check.mjs` | 워크숍 Gateway REQUEST 인터셉터. `Bearer` 코드의 sha256을 `CODE_SHA256`과 상수 시간으로 비교하고, `VALID_UNTIL`과 분당 `tools/call` 한도를 확인합니다. 로그에는 `{method, tool, decision}`만 남깁니다 |

### 3. 주요 결정

- `.env` 값보다 명시적 환경변수를 우선합니다(`loadDotEnv`는 미설정 키만 채움). 이를 통해 MCP 클라이언트 자체의 env/`user_config` 메커니즘으로 주입된 키가 저장소에 커밋된 우연한 `.env`에 의해 조용히 덮어씌워지지 않습니다.
- 설정이 없을 때 예외를 던지는 대신 범위가 제한된 샘플 키로 정상 동작하도록 합니다. 이를 통해 첫 사용자도 즉시 동작하는 서버를 경험하고, 크래시가 아니라 응답 `notes[]`를 통해 키 발급 절차를 알게 됩니다.
- 로깅 경계에서 마스킹하는 대신 소스 시점에서 키를 마스킹합니다(`maskedKey()`/`maskedSubwayKey()`). 이를 통해 에러 메시지를 포함한 어떤 코드 경로도 전체 키를 담은 문자열을 만들 수 없습니다.
- 지하철 키를 두 번째 필수 자격증명이 아니라 일반 키의 선택적 오버라이드로 취급하여, 일반적인 경우(키 1개)를 단순하게 유지하면서도 `get_subway_arrivals`의 쿼터 분리는 필요할 때 가능하게 합니다.
- 위 단일 HTTP 경로 및 env 키 처리 결정은 [ADR-003](../decisions/ADR-003-single-http-path-and-env-keys.md)로 기록되어 있습니다.
- 워크숍 스택에서는 서울 API 키가 AgentCore 런타임의 환경 변수에, 코드의 sha256이 Lambda의 환경 변수에 들어 있습니다. `NoEcho`는 CloudFormation 출력만 가리므로, 두 리소스에 대한 `bedrock-agentcore:GetAgentRuntime`과 `lambda:GetFunctionConfiguration` 권한은 사실상 비밀을 읽는 권한입니다. 40비트에 솔트가 없는 코드 해시는 가벼운 열람을 막을 뿐 오프라인 대입은 막지 못합니다.
- 커밋 시점에 stage된 내용(`git show :path`)을 두 단계로 검사합니다. PreToolUse 훅은 Claude에게 이유와 함께 바로 막았음을 알리고, git `pre-commit` 훅은 한 명령 안의 `git add -A && git commit`을 막습니다. PreToolUse는 명령이 파일을 stage하기 전에 실행되므로 이 경우를 볼 수 없습니다.
- 서울 키는 32자리 소문자 hex라서 픽스처의 이미지 ID(`atchFileId=…`)와 형식이 같습니다. 그래서 로컬 `.env`의 `*_KEY`/`*_SECRET`/`*_TOKEN` 변수 값 자체를 찾고(보고에는 변수 이름만 씀), 32자리 hex는 `api_key` 형태의 대입문이나 `…seoul.go.kr/<key>/` URL 경로처럼 키 문맥에서만 잡습니다.
- **파티션 값은 키가 되기 전에 형식을 검사합니다.** 참가자는 `call_dataset`으로 어떤 문자열이든 넘길 수 있고, 파티션 값은 S3 키나 파일 경로의 일부가 됩니다. 파티션 자리마다 형식(`^\d{8}$`, `^[1-9]호선$` 등)이 있어 통과한 값만 쓰고, 나머지는 저장소가 답하지 않습니다. `DirectoryStore`도 루트 밖으로 풀리는 키를 거부합니다.
- **수집기는 키를 마스킹해서만 보여 줍니다.** `npm run workshop:collect`는 `.env.workshop`에서 키를 읽어 `maskKey()`로만 출력하고, 호출을 런타임과 같은 쿼터 장부에 기록합니다. 스케줄을 켜면 수집 Lambda의 환경 변수에도 서울 API 키가 들어가므로, 그 함수의 `lambda:GetFunctionConfiguration` 권한은 키 읽기 권한과 같습니다.

### 4. 코드 포인터

- `src/client/env.ts:4-18` -- `.env` 파싱 및 우선순위 규칙
- `src/client/seoulApi.ts` -- 키 선택 및 `isSample` 도출
- `src/client/seoulApi.ts` -- `maskedKey()` / `maskedSubwayKey()`
- `src/client/seoulApi.ts` -- `request()`, 에러 메시지에 마스킹된 키 포함
- `src/client/seoulApi.ts` -- `fetchUnwrapped()` 샘플 모드 행 수 클램프
- `src/normalize/util.ts:9-10` -- `KEY_GUIDE`
- `src/tools/envelope.ts:1-10` -- `SAMPLE_NOTE`와 `ok()`에서의 부착 로직
- `manifest.json:21-36` -- MCPB `user_config` 키 선언

### 5. 상호 참조
- 관련 모듈: `src/client/response.ts` (`SeoulApiError`, `INFO-100` 키 관련 힌트)
- 관련 ADR: [ADR-003](../decisions/ADR-003-single-http-path-and-env-keys.md) (단일 HTTP 경로 및 env 키), [ADR-005](../decisions/ADR-005-workshop-shared-code-at-the-gateway.md) (워크숍 접근을 공용 코드 하나로 확인), [ADR-006](../decisions/ADR-006-key-pool-with-key-independent-cache-keys.md) (키 풀과 키에 의존하지 않는 캐시 키)
- 관련 런북: 아직 없음 -- `docs/architecture.md`의 운영 절에서 제안하는 "키 회전 / 샘플 모드 진단" 런북 참고
