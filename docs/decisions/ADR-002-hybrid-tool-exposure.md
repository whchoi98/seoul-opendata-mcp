# ADR-002: 하이브리드 도구 노출 (Hybrid Tool Exposure)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>
# English

## Status
Accepted (2026-08-15)

## Context
Seoul Open Data Plaza publishes thousands of datasets. Exposing each as its own MCP tool is a known anti-pattern: every tool's description loads into the LLM's context on every request (context cost scales with dataset count), and LLM tool-selection accuracy collapses as the choice set grows into the hundreds or thousands.

## Options Considered
### Option 1: One MCP tool per dataset
- **Pros**: Each tool's inputs/outputs are dataset-specific and easy to normalize individually.
- **Cons**: Thousands of tool descriptions in context; LLM tool selection degrades sharply as the list grows.

### Option 2: Hybrid — 16 curated tools + 3 meta tools over a catalog
- **Pros**: The 16 highest-frequency datasets keep normalized, high-usability tools; the long tail stays reachable through search without inflating the tool list.
- **Cons**: Responses returned via the meta tools are raw, non-normalized upstream fields, requiring a `notes` disclaimer.

## Decision
We expose the 16 highest-frequency datasets as dedicated, normalized tools (registered across `src/tools/{common,population,traffic,culture,environment,stats,health}.ts`), and cover the long tail through exactly 3 meta tools — `search_dataset`, `get_dataset_spec`, `call_dataset` — backed by `src/data/catalog.ts` (28 entries). Entries marked `callable: false` (e.g. `LIVE_DST_MESSAGE`) cannot be invoked via `call_dataset`; `validateCall` redirects callers to the dedicated tool instead, and ids absent from the catalog cannot be called at all.

## Consequences
### Positive
- 19 total MCP tools (16 dedicated + 3 meta) cover 28 cataloged datasets without one tool per dataset, bounding context cost.
- The `callable` guard keeps a single, consistent access path per dataset instead of two competing routes.

### Negative
- `call_dataset` responses expose raw upstream field names (Korean/abbreviated), which are less usable than the normalized dedicated tools and must be self-documented via `get_dataset_spec`.
- Coverage is capped at the 28 catalog entries; any dataset not added to `catalog.ts` is unreachable through either path.

## References
- `src/data/catalog.ts` — 28-entry catalog, `callable` guard, `searchCatalog`/`validateCall`
- `src/tools/meta.ts` — `search_dataset`/`get_dataset_spec`/`call_dataset` implementation
- `src/tools/CLAUDE.md`, `CLAUDE.md` — 19-tool registration overview
- Commits `34a3622`, `d55b5ad` — meta tools and 28-entry catalog introduced

---

<a id="korean"></a>
# 한국어

## 상태
승인됨 (2026-08-15)

## 배경
서울 열린데이터광장은 수천 개의 데이터셋을 공개합니다. 이를 각각 별도의 MCP tool로 노출하는 방식은 잘 알려진 안티패턴입니다. 모든 tool의 description이 매 요청마다 LLM 컨텍스트에 로드되어 데이터셋 수에 비례해 컨텍스트 비용이 늘어나고, 선택지가 수백~수천 개로 늘어나면 LLM의 tool 선택 정확도가 급격히 붕괴합니다.

## 검토한 옵션
### 옵션 1: 데이터셋마다 개별 MCP tool
- **장점**: 각 tool의 입출력을 데이터셋별로 맞춰 정규화하기 쉽습니다.
- **단점**: 수천 개의 tool description이 컨텍스트에 쌓이고, 목록이 커질수록 LLM의 tool 선택 정확도가 크게 떨어집니다.

### 옵션 2: 하이브리드 — 정식 tool 16개 + 카탈로그 기반 메타 tool 3개
- **장점**: 고빈도 16개 데이터셋은 정규화된 사용성 높은 tool을 유지하고, 롱테일은 tool 목록을 늘리지 않고도 검색으로 도달할 수 있습니다.
- **단점**: 메타 tool을 경유한 응답은 비정규화된 원본 업스트림 필드이며, `notes`로 고지가 필요합니다.

## 결정
고빈도 16개 데이터셋은 정규화된 정식 tool로 노출합니다(`src/tools/{common,population,traffic,culture,environment,stats,health}.ts`에 등록). 나머지 롱테일은 정확히 3개의 메타 tool — `search_dataset`, `get_dataset_spec`, `call_dataset` — 로 커버하며, 이는 `src/data/catalog.ts`(28 entries)를 기반으로 합니다. `callable: false`로 표시된 항목(예: `LIVE_DST_MESSAGE`)은 `call_dataset`으로 호출할 수 없고, `validateCall`이 정식 tool 사용을 안내합니다. 카탈로그에 없는 id는 아예 호출할 수 없습니다.

## 영향
### 긍정적
- 총 19개 MCP tool(정식 16 + 메타 3)이 28개 카탈로그 데이터셋을 커버하여, 데이터셋마다 tool을 만들지 않고도 컨텍스트 비용을 제한합니다.
- `callable` 가드로 데이터셋마다 접근 경로가 하나로 유지되어, 두 경로가 경쟁하는 상황을 막습니다.

### 부정적
- `call_dataset` 응답은 원본 업스트림 필드명(한글/약어)을 그대로 노출해 정식 tool보다 사용성이 떨어지며, `get_dataset_spec`으로 별도 확인이 필요합니다.
- 커버리지는 카탈로그 28개 항목으로 제한되며, `catalog.ts`에 등록되지 않은 데이터셋은 두 경로 어느 쪽으로도 접근할 수 없습니다.

## 참고 자료
- `src/data/catalog.ts` — 28-entry 카탈로그, `callable` 가드, `searchCatalog`/`validateCall`
- `src/tools/meta.ts` — `search_dataset`/`get_dataset_spec`/`call_dataset` 구현
- `src/tools/CLAUDE.md`, `CLAUDE.md` — 19개 tool 등록 개요
- 커밋 `34a3622`, `d55b5ad` — 메타 tool 및 28-entry 카탈로그 도입
