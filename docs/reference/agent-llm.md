# Agent · LLM / Agent · LLM 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview

The agent/LLM layer is everything in this codebase written specifically to be read and driven by an LLM tool-caller rather than a human developer: bilingual tool descriptions tuned for tool selection, a response envelope with a `notes[]` channel for steering follow-up calls, and a "return candidates instead of an error" recovery pattern used throughout the place-resolution and catalog tools.

### 2. Components

| Component | Path | Purpose |
|---|---|---|
| Tool `description` fields | `src/tools/*.ts` (all `registerTool()` calls) | Bilingual (EN + KO), intent-oriented descriptions written for LLM tool-selection, e.g. `search_place`'s "Use FIRST when the user mentions a Seoul location" |
| `ok()` `notes[]` channel | `src/tools/envelope.ts:5-10` | Structured advisory strings (sample-mode, empty-result, filter-scope explanations) an agent can read and relay without another round trip |
| `resolvePlace` early-return | `src/tools/resolve.ts:6-15` | Returns a `{requested, match: null, candidates, hint}` payload instead of throwing when a place name is ambiguous, so the agent can retry in the same conversation turn |
| `searchPlace` / `ALIASES` | `src/data/placeMatcher.ts` | Alias table + bigram fuzzy matcher so casual user phrasing (`"코엑스"`, `"gangnam"`) resolves without the agent needing exact hotspot names |
| `search_dataset` / `get_dataset_spec` / `call_dataset` | `src/tools/meta.ts` | Three-tool discovery-then-call pattern giving an agent access to 29 datasets without 29 dedicated tool schemas |
| Relative-level fields | `Population.congestionLevel`, `Commercial.level` (`src/normalize/population.ts`, `src/normalize/commercial.ts`) | Categorical levels plus an explicit interpretive note, so an agent is nudged toward "busier than usual" phrasing instead of presenting a sampled count as an exact figure |

### 3. Key Decisions

- Write every tool `description` as a short natural-language sentence plus a Korean paraphrase and a concrete "use when" trigger phrase, so an LLM choosing among 20 tools has enough signal without needing to read source code.
- Prefer an "early candidates" return over a thrown error for ambiguous input (`resolvePlace`), so an agent can self-correct within the same tool-call loop instead of surfacing a hard failure to the end user.
- Prefer a small number of generic, composable tools (`search_dataset` → `get_dataset_spec` → `call_dataset`) over one tool per dataset, keeping the tool list within what a model can reliably reason about while still exposing all 29 datasets (see the "Catalog hybrid" decision in `docs/architecture.md`).
- Always explain a limited or empty result in `notes[]` (sample mode, unsupported place, no data for date) rather than returning a bare empty array, so the agent has enough context to explain the limitation to the user instead of guessing at a cause.
- The "Catalog hybrid" decision behind the `search_dataset`/`get_dataset_spec`/`call_dataset` trio is recorded as [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md).
- Real-estate tools accept the names a user says and convert them to what the API needs: `district` takes `강남` or `강남구`, `dong` is a legal-dong name resolved to a code, `lotNumber` is written `633-7`. `dealType`, `buildingUse`, and `rentType` are enums holding the only values upstream accepts, so the model cannot send a value that silently matches nothing.
- Every tool forwards the client's own advisory (`Unwrapped.note`: quota warning, quota exhausted, stale cache age, and the rate-limit note "서울 API 호출 제한으로 새 데이터를 가져올 수 없습니다. 약 N분 뒤 다시 시도하세요." or its cached variant "서울 API 호출 제한 — 캐시된 데이터(약 N분 경과)로 응답합니다") into `notes[]`, including on success. When the upstream returned no rows, a tool does not phrase the empty result as a fact about the world ("no alerts", "unknown district").
- `get_real_estate_prices` separates `totalCount` (rows matching the upstream filters) from `count` (rows returned), and every step applied in code (cancelled-sale removal, the 500-row window for `rentType`, the name-match fallback for `dong`) is disclosed in `notes[]`, so the agent does not present a windowed result as complete.
- The `search_dataset` description takes the catalog size from `CATALOG.length`, and `get_dataset_spec` examples come from `exampleParams()`, which fills skipped path positions with a space; neither is hand-written text that can drift from the catalog.
- In the workshop stack the gateway interceptor answers before the server does, with three LLM-facing messages: a bad code (HTTP 403, "워크숍 코드가 올바르지 않습니다 ..."), an expired code (HTTP 403, "워크숍 코드가 만료되었습니다 ..."), and the per-minute limit (a normal `isError` tool result, "요청이 많습니다. 1분 뒤 다시 시도하세요.", so the model reads it and waits). The texts live in `MESSAGES` in `infra/lambda/code-check.mjs`.
- Input schemas are generated from `zod` v4 (since v0.4.0). Descriptions, types and numeric/pattern constraints are unchanged from v3, but the generated JSON Schema no longer carries `additionalProperties: false`; unknown arguments are still stripped at runtime, so an extra key from the model is ignored rather than rejected.

### 4. Code Pointers

- `src/tools/common.ts:14-17` — `search_place` description, written to be picked first by an agent
- `src/tools/resolve.ts:6-15` — `resolvePlace()` early-candidates pattern
- `src/tools/envelope.ts:5-10` — `ok()`, the `notes[]` channel
- `src/tools/meta.ts:23-121` — the `search_dataset`/`get_dataset_spec`/`call_dataset` trio
- `src/data/placeMatcher.ts:4-19` — `ALIASES` casual-name table
- `src/data/placeMatcher.ts:38-62` — `searchPlace()` exact/alias/partial/fuzzy resolution order
- `src/normalize/population.ts:27` — `congestionLevel` categorical field
- `src/normalize/commercial.ts:18` — `level` categorical field

### 5. Cross-references
- Related modules: `src/tools/envelope.ts`, `src/data/hotspots.ts`
- Related ADRs: [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md) (hybrid tool exposure)
- Related runbooks: none recorded yet — see `docs/architecture.md` Operations section

<a id="korean"></a>
## 한국어

### 1. 개요

Agent · LLM 계층은 이 코드베이스에서 사람 개발자가 아니라 LLM tool 호출자가 읽고 판단하도록 특별히 작성된 부분 전체를 가리킵니다: tool 선택에 최적화된 이중 언어 tool 설명, 후속 호출을 유도하는 `notes[]` 채널을 가진 응답 봉투, 그리고 장소 확정·카탈로그 tool 전반에 쓰이는 "에러 대신 candidates 반환" 복구 패턴입니다.

### 2. 구성요소

| 구성요소 | 경로 | 목적 |
|---|---|---|
| tool `description` 필드 | `src/tools/*.ts`의 모든 `registerTool()` 호출 | LLM의 tool 선택을 위해 작성된 이중 언어(영/한) 의도 지향 설명. 예: `search_place`의 "Use FIRST when the user mentions a Seoul location" |
| `ok()`의 `notes[]` 채널 | `src/tools/envelope.ts:5-10` | 에이전트가 추가 호출 없이 읽고 전달할 수 있는 구조화된 안내 문자열(샘플 모드, 빈 결과, 필터 범위 설명) |
| `resolvePlace`의 조기 반환 | `src/tools/resolve.ts:6-15` | 장소명이 모호할 때 예외를 던지는 대신 `{requested, match: null, candidates, hint}`를 반환하여, 에이전트가 같은 대화 턴 안에서 재시도할 수 있게 합니다 |
| `searchPlace` / `ALIASES` | `src/data/placeMatcher.ts` | 별칭 테이블 + 2-gram 유사도 매처로, 에이전트가 정확한 핫스팟명을 몰라도 `"코엑스"`, `"gangnam"` 같은 편한 표현이 확정됩니다 |
| `search_dataset` / `get_dataset_spec` / `call_dataset` | `src/tools/meta.ts` | 52개 데이터셋 전용 스키마 없이도 에이전트가 접근할 수 있게 하는 탐색-후-호출 3단계 패턴 |
| 상대 수준 필드 | `Population.congestionLevel`, `Commercial.level` (`src/normalize/population.ts`, `src/normalize/commercial.ts`) | 범주형 수준과 명시적 해석 안내를 함께 제공하여, 에이전트가 표본 데이터의 카운트를 정확한 숫자처럼 제시하지 않고 "평소보다 붐빈다" 식으로 표현하도록 유도합니다 |

### 3. 주요 결정

- 모든 tool `description`을 짧은 자연어 문장 + 한글 병기 + 구체적인 "언제 사용" 트리거 문구로 작성하여, 23개 tool 중에서 고르는 LLM이 소스 코드를 읽지 않고도 충분한 근거를 갖게 합니다.
- 모호한 입력에 대해 예외를 던지는 대신 "조기 candidates" 반환을 우선합니다(`resolvePlace`). 이를 통해 에이전트는 최종 사용자에게 실패를 노출하지 않고 같은 tool 호출 루프 안에서 스스로 교정할 수 있습니다.
- 데이터셋마다 tool을 만드는 대신 소수의 범용·조합 가능한 tool(`search_dataset` → `get_dataset_spec` → `call_dataset`)을 우선합니다. 이를 통해 모델이 신뢰성 있게 추론할 수 있는 tool 개수를 유지하면서도 29개 데이터셋 전체를 노출합니다(`docs/architecture.md`의 "카탈로그 하이브리드" 결정 참고).
- 제한적이거나 빈 결과는 항상 `notes[]`에서 설명합니다(샘플 모드, 미지원 장소, 해당 날짜 데이터 없음 등). 빈 배열만 반환하지 않음으로써 에이전트가 원인을 추측하지 않고 사용자에게 제한 사항을 설명할 수 있는 맥락을 갖게 합니다.
- `search_dataset`/`get_dataset_spec`/`call_dataset` 트리오의 "카탈로그 하이브리드" 결정은 [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md)로 기록되어 있습니다.
- 부동산 tool은 사용자가 말하는 이름을 받아 API가 요구하는 형태로 바꿉니다. `district`는 `강남`과 `강남구`를 모두 받고, `dong`은 법정동 이름을 받아 코드로 바꾸며, `lotNumber`는 `633-7`처럼 씁니다. `dealType`, `buildingUse`, `rentType`은 업스트림이 받는 값만 담은 enum이라서, 모델이 조용히 0건이 되는 값을 보낼 수 없습니다.
- 모든 tool은 클라이언트가 붙인 안내(`Unwrapped.note`: 쿼터 경고, 쿼터 소진, stale 캐시 경과, 호출 제한 안내 "서울 API 호출 제한으로 새 데이터를 가져올 수 없습니다. 약 N분 뒤 다시 시도하세요."와 캐시 응답용 "서울 API 호출 제한 — 캐시된 데이터(약 N분 경과)로 응답합니다")를 성공 응답에서도 `notes[]`로 전달합니다. 업스트림이 행을 주지 않았으면 빈 결과를 사실처럼("재난문자 없음", "없는 자치구") 표현하지 않습니다.
- `get_real_estate_prices`는 `totalCount`(업스트림 필터에 맞는 전체 건수)와 `count`(돌려준 건수)를 구분합니다. 코드에서 적용한 단계(해제 거래 제외, `rentType`의 500건 범위, `dong` 이름 매칭 대체 경로)는 모두 `notes[]`에 적어, 에이전트가 일부 범위의 결과를 전체인 것처럼 전하지 않게 합니다.
- `search_dataset` 설명의 카탈로그 개수는 `CATALOG.length`에서 가져오고, `get_dataset_spec` 예시는 건너뛰는 경로 자리를 공백으로 채우는 `exampleParams()`가 만듭니다. 둘 다 카탈로그와 어긋날 수 있는 손으로 쓴 문구가 아닙니다.
- 워크숍 스택에서는 Gateway 인터셉터가 서버보다 먼저 응답하며, LLM이 읽는 메시지가 세 가지입니다. 코드 오류(HTTP 403, "워크숍 코드가 올바르지 않습니다 ..."), 만료(HTTP 403, "워크숍 코드가 만료되었습니다 ..."), 분당 한도(정상 `isError` tool 결과, "요청이 많습니다. 1분 뒤 다시 시도하세요.")입니다. 한도 안내를 오류 코드가 아니라 결과로 돌려주므로 모델이 읽고 기다립니다. 문구는 `infra/lambda/code-check.mjs`의 `MESSAGES`에 있습니다.
- 입력 스키마는 v0.4.0부터 `zod` v4로 생성합니다. 설명, 타입, 수치와 패턴 제약은 v3와 같지만, 생성된 JSON Schema에 `additionalProperties: false`가 더 이상 들어가지 않습니다. 정의되지 않은 인자는 런타임에 여전히 버려지므로, 모델이 여분의 키를 보내도 거부하지 않고 무시합니다.

### 4. 코드 포인터

- `src/tools/common.ts:14-17` -- 에이전트가 가장 먼저 선택하도록 작성된 `search_place` 설명
- `src/tools/resolve.ts:6-15` -- `resolvePlace()`의 조기 candidates 패턴
- `src/tools/envelope.ts:5-10` -- `ok()`, `notes[]` 채널
- `src/tools/meta.ts:23-121` -- `search_dataset`/`get_dataset_spec`/`call_dataset` 트리오
- `src/data/placeMatcher.ts:4-19` -- 편한 이름을 위한 `ALIASES` 테이블
- `src/data/placeMatcher.ts:38-62` -- `searchPlace()`의 정확일치/별칭/부분일치/유사도 확정 순서
- `src/normalize/population.ts:27` -- `congestionLevel` 범주형 필드
- `src/normalize/commercial.ts:18` -- `level` 범주형 필드

### 5. 상호 참조
- 관련 모듈: `src/tools/envelope.ts`, `src/data/hotspots.ts`
- 관련 ADR: [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md) (하이브리드 tool 노출)
- 관련 런북: 아직 없음 -- `docs/architecture.md`의 운영 절 참고
