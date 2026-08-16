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
| `SeoulApiClient` constructor | `src/client/seoulApi.ts:32-39` | Selects the active key (`opts.apiKey ?? process.env.SEOUL_API_KEY ?? 'sample'`) and derives `isSample` |
| `maskedKey` / `maskedSubwayKey` | `src/client/seoulApi.ts:41-47` | Expose only the first 4 characters of a real key (or the literal `sample`), never the full value |
| `request` error paths | `src/client/seoulApi.ts:54-67` | Embed only the masked key in `HTTP-<status>` and `NETWORK` `SeoulApiError` messages |
| `fetchUnwrapped` sample clamp | `src/client/seoulApi.ts:79-91` | Clamps `end` to `start + 4` when the active key is `sample`, limiting every request to at most 5 rows |
| `KEY_GUIDE` | `src/normalize/util.ts:9-10` | Shared key-signup URL string surfaced in `SAMPLE_NOTE` and in `INFO-100`/key-related error hints |
| `SAMPLE_NOTE` | `src/tools/envelope.ts:3` | Sample-mode advisory string appended to every tool response's `notes[]` when `ctx.client.isSample` is `true` |
| `.env.example` | `.env.example` | Committed placeholder template; real `.env` is listed in `.gitignore` and never committed |
| `user_config` | `manifest.json:21-36` | Declares both keys as `sensitive: true`, optional inputs for the MCPB one-click installer |

### 3. Key Decisions

- Prefer explicit environment variables over `.env` values (`loadDotEnv` only fills unset keys), so a key injected by an MCP client's own env/`user_config` mechanism is never silently overridden by a stray checked-in `.env`.
- Fail open into a scope-limited sample key rather than throwing on missing configuration, so a first-time user gets a working server immediately and discovers the key-signup flow from the response `notes[]` instead of a crash.
- Mask keys at the source (`maskedKey()`/`maskedSubwayKey()`) rather than redacting at a logging boundary, so there is no code path — including error messages — that can construct a string containing the full key.
- Treat the subway key as an optional override of the general key, not a second mandatory credential, keeping the common case (one key) simple while still allowing quota isolation for `get_subway_arrivals`.
- No ADRs are recorded yet for these decisions — see `docs/decisions/.template.md` to formalize one (e.g. "Sample-key fallback over startup failure").

### 4. Code Pointers

- `src/client/env.ts:4-18` — `.env` parsing and precedence rule
- `src/client/seoulApi.ts:32-39` — key selection and `isSample` derivation
- `src/client/seoulApi.ts:41-47` — `maskedKey()` / `maskedSubwayKey()`
- `src/client/seoulApi.ts:54-67` — `request()`, masked key embedded in error messages
- `src/client/seoulApi.ts:79-91` — `fetchUnwrapped()` sample-mode row clamp
- `src/normalize/util.ts:9-10` — `KEY_GUIDE`
- `src/tools/envelope.ts:1-10` — `SAMPLE_NOTE` and its attachment in `ok()`
- `manifest.json:21-36` — MCPB `user_config` key declarations

### 5. Cross-references
- Related modules: `src/client/response.ts` (`SeoulApiError`, `INFO-100` key-related hint)
- Related ADRs: none recorded yet
- Related runbooks: none recorded yet — see `docs/architecture.md` Operations section for a suggested "key rotation / sample-mode diagnosis" runbook

<a id="korean"></a>
## 한국어

### 1. 개요

보안 계층은 서울 열린데이터광장 API 키 두 종류(`SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`)를 어떻게 로드·선택·마스킹하고, 범위가 제한된 샘플 키로 어떻게 폴백시키는지를 담당합니다. 이를 통해 실제 키가 로그, 에러 메시지, MCPB 번들 패키지 어디에도 유출되지 않도록 합니다.

### 2. 구성요소

| 구성요소 | 경로 | 목적 |
|---|---|---|
| `loadDotEnv` | `src/client/env.ts` | 로컬 `.env` 파일을 읽어 `process.env`에 아직 설정되지 않은 변수만 채웁니다 |
| `SeoulApiClient` 생성자 | `src/client/seoulApi.ts:32-39` | 활성 키(`opts.apiKey ?? process.env.SEOUL_API_KEY ?? 'sample'`)를 선택하고 `isSample`을 도출합니다 |
| `maskedKey` / `maskedSubwayKey` | `src/client/seoulApi.ts:41-47` | 실제 키의 앞 4글자만(또는 리터럴 `sample`) 노출하며, 전체 값은 절대 노출하지 않습니다 |
| `request` 에러 경로 | `src/client/seoulApi.ts:54-67` | `HTTP-<status>`, `NETWORK` `SeoulApiError` 메시지에 마스킹된 키만 포함시킵니다 |
| `fetchUnwrapped` 샘플 클램프 | `src/client/seoulApi.ts:79-91` | 활성 키가 `sample`일 때 `end`를 `start + 4`로 클램프하여 요청당 최대 5행으로 제한합니다 |
| `KEY_GUIDE` | `src/normalize/util.ts:9-10` | `SAMPLE_NOTE`와 `INFO-100` 등 키 관련 에러 힌트에 사용되는 공용 키 발급 URL 문자열 |
| `SAMPLE_NOTE` | `src/tools/envelope.ts:3` | `ctx.client.isSample`이 `true`일 때 모든 tool 응답의 `notes[]`에 추가되는 샘플 모드 안내 문자열 |
| `.env.example` | `.env.example` | 커밋되는 플레이스홀더 템플릿; 실제 `.env`는 `.gitignore`에 등록되어 절대 커밋되지 않습니다 |
| `user_config` | `manifest.json:21-36` | 두 키를 모두 `sensitive: true`인 선택적 입력으로 선언하여 MCPB 원클릭 설치에 사용합니다 |

### 3. 주요 결정

- `.env` 값보다 명시적 환경변수를 우선합니다(`loadDotEnv`는 미설정 키만 채움). 이를 통해 MCP 클라이언트 자체의 env/`user_config` 메커니즘으로 주입된 키가 저장소에 커밋된 우연한 `.env`에 의해 조용히 덮어씌워지지 않습니다.
- 설정이 없을 때 예외를 던지는 대신 범위가 제한된 샘플 키로 정상 동작하도록 합니다. 이를 통해 첫 사용자도 즉시 동작하는 서버를 경험하고, 크래시가 아니라 응답 `notes[]`를 통해 키 발급 절차를 알게 됩니다.
- 로깅 경계에서 마스킹하는 대신 소스 시점에서 키를 마스킹합니다(`maskedKey()`/`maskedSubwayKey()`). 이를 통해 에러 메시지를 포함한 어떤 코드 경로도 전체 키를 담은 문자열을 만들 수 없습니다.
- 지하철 키를 두 번째 필수 자격증명이 아니라 일반 키의 선택적 오버라이드로 취급하여, 일반적인 경우(키 1개)를 단순하게 유지하면서도 `get_subway_arrivals`의 쿼터 분리는 필요할 때 가능하게 합니다.
- 위 결정들에 대한 ADR은 아직 기록되지 않았습니다 -- `docs/decisions/.template.md`를 참고하여 (예: "샘플 키 폴백 vs. 시작 실패") 하나를 정식화할 수 있습니다.

### 4. 코드 포인터

- `src/client/env.ts:4-18` -- `.env` 파싱 및 우선순위 규칙
- `src/client/seoulApi.ts:32-39` -- 키 선택 및 `isSample` 도출
- `src/client/seoulApi.ts:41-47` -- `maskedKey()` / `maskedSubwayKey()`
- `src/client/seoulApi.ts:54-67` -- `request()`, 에러 메시지에 마스킹된 키 포함
- `src/client/seoulApi.ts:79-91` -- `fetchUnwrapped()` 샘플 모드 행 수 클램프
- `src/normalize/util.ts:9-10` -- `KEY_GUIDE`
- `src/tools/envelope.ts:1-10` -- `SAMPLE_NOTE`와 `ok()`에서의 부착 로직
- `manifest.json:21-36` -- MCPB `user_config` 키 선언

### 5. 상호 참조
- 관련 모듈: `src/client/response.ts` (`SeoulApiError`, `INFO-100` 키 관련 힌트)
- 관련 ADR: 아직 없음
- 관련 런북: 아직 없음 -- `docs/architecture.md`의 운영 절에서 제안하는 "키 회전 / 샘플 모드 진단" 런북 참고
