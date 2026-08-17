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
| `search_dataset` / `get_dataset_spec` / `call_dataset` | `src/tools/meta.ts` | Three-tool discovery-then-call pattern giving an agent access to 28 datasets without 28 dedicated tool schemas |
| Relative-level fields | `Population.congestionLevel`, `Commercial.level` (`src/normalize/population.ts`, `src/normalize/commercial.ts`) | Categorical levels plus an explicit interpretive note, so an agent is nudged toward "busier than usual" phrasing instead of presenting a sampled count as an exact figure |

### 3. Key Decisions

- Write every tool `description` as a short natural-language sentence plus a Korean paraphrase and a concrete "use when" trigger phrase, so an LLM choosing among 19 tools has enough signal without needing to read source code.
- Prefer an "early candidates" return over a thrown error for ambiguous input (`resolvePlace`), so an agent can self-correct within the same tool-call loop instead of surfacing a hard failure to the end user.
- Prefer a small number of generic, composable tools (`search_dataset` → `get_dataset_spec` → `call_dataset`) over one tool per dataset, keeping the tool list within what a model can reliably reason about while still exposing all 28 datasets (see the "Catalog hybrid" decision in `docs/architecture.md`).
- Always explain a limited or empty result in `notes[]` (sample mode, unsupported place, no data for date) rather than returning a bare empty array, so the agent has enough context to explain the limitation to the user instead of guessing at a cause.
- The "Catalog hybrid" decision behind the `search_dataset`/`get_dataset_spec`/`call_dataset` trio is recorded as [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md).

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
| `search_dataset` / `get_dataset_spec` / `call_dataset` | `src/tools/meta.ts` | 28개 데이터셋 전용 스키마 없이도 에이전트가 접근할 수 있게 하는 탐색-후-호출 3단계 패턴 |
| 상대 수준 필드 | `Population.congestionLevel`, `Commercial.level` (`src/normalize/population.ts`, `src/normalize/commercial.ts`) | 범주형 수준과 명시적 해석 안내를 함께 제공하여, 에이전트가 표본 데이터의 카운트를 정확한 숫자처럼 제시하지 않고 "평소보다 붐빈다" 식으로 표현하도록 유도합니다 |

### 3. 주요 결정

- 모든 tool `description`을 짧은 자연어 문장 + 한글 병기 + 구체적인 "언제 사용" 트리거 문구로 작성하여, 19개 tool 중에서 고르는 LLM이 소스 코드를 읽지 않고도 충분한 근거를 갖게 합니다.
- 모호한 입력에 대해 예외를 던지는 대신 "조기 candidates" 반환을 우선합니다(`resolvePlace`). 이를 통해 에이전트는 최종 사용자에게 실패를 노출하지 않고 같은 tool 호출 루프 안에서 스스로 교정할 수 있습니다.
- 데이터셋마다 tool을 만드는 대신 소수의 범용·조합 가능한 tool(`search_dataset` → `get_dataset_spec` → `call_dataset`)을 우선합니다. 이를 통해 모델이 신뢰성 있게 추론할 수 있는 tool 개수를 유지하면서도 28개 데이터셋 전체를 노출합니다(`docs/architecture.md`의 "카탈로그 하이브리드" 결정 참고).
- 제한적이거나 빈 결과는 항상 `notes[]`에서 설명합니다(샘플 모드, 미지원 장소, 해당 날짜 데이터 없음 등). 빈 배열만 반환하지 않음으로써 에이전트가 원인을 추측하지 않고 사용자에게 제한 사항을 설명할 수 있는 맥락을 갖게 합니다.
- `search_dataset`/`get_dataset_spec`/`call_dataset` 트리오의 "카탈로그 하이브리드" 결정은 [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md)로 기록되어 있습니다.

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
