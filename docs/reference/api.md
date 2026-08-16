# API / API 구성 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview

The API layer is the MCP tool surface (19 tools, `src/tools/*.ts`) plus the single HTTP client (`src/client/seoulApi.ts`) it is built on: every tool call ultimately becomes one `SeoulApiClient` request against `openapi.seoul.go.kr:8088` or `swopenapi.seoul.go.kr`, unwrapped into a common shape and returned inside one response envelope.

### 2. Components

| Component | Path | Purpose |
|---|---|---|
| `buildServer` | `src/index.ts:31-43` | Constructs the `McpServer`, calls all 8 `register*Tools()` functions, exposes `TOOL_NAMES` |
| `SeoulApiClient` | `src/client/seoulApi.ts` | Single HTTP entry point (`getJson`/`getXml`/`getSubway`/`fetchAll`) for both upstream bases |
| `unwrap` | `src/client/response.ts:34-82` | Normalizes 8 upstream envelope shapes into `{rows, totalCount, raw, note}` |
| `ok` / `fail` | `src/tools/envelope.ts` | The one response shape (`{data, asOf, source, notes}`) every tool returns |
| `resolvePlace` | `src/tools/resolve.ts` | Shared place-resolution helper reused by every `citydata`-family tool |
| `registerCommonTools` | `src/tools/common.ts` | `search_place`, `get_city_snapshot`, `get_disaster_alerts` |
| `registerPopulationTools` | `src/tools/population.ts` | `get_population`, `get_commercial_activity` |
| `registerTrafficTools` | `src/tools/traffic.ts` | `get_subway_arrivals`, `get_bike_stations`, `get_parking`, `get_road_traffic` |
| `registerCultureTools` | `src/tools/culture.ts` | `search_cultural_events` |
| `registerEnvironmentTools` | `src/tools/environment.ts` | `get_weather`, `get_air_quality` |
| `registerStatsTools` | `src/tools/stats.ts` | `get_subway_ridership`, `get_living_population`, `get_real_estate_prices` |
| `registerHealthTools` | `src/tools/health.ts` | `find_pharmacies` |
| `registerMetaTools` | `src/tools/meta.ts` | `search_dataset`, `get_dataset_spec`, `call_dataset` (28-dataset catalog) |
| `CATALOG` | `src/data/catalog.ts:12-44` | The 28-dataset catalog backing the meta tools |

### 3. Key Decisions

- Route every tool through the same `SeoulApiClient` request path (`fetchUnwrapped`) rather than a per-tool HTTP call, so caching, retry, sample-mode clamping, and envelope normalization exist once (see the "One HTTP code path for every service" decision in `docs/architecture.md`).
- Standardize on one response envelope (`ok()`/`fail()`) across all 19 tools instead of a per-tool return shape, so an agent can rely on `{data, asOf, source, notes}` regardless of which tool it called.
- Give 8 high-traffic datasets a dedicated, fully-typed tool and route the remaining 20 through the generic `search_dataset`/`get_dataset_spec`/`call_dataset` trio (see the "Catalog hybrid" decision in `docs/architecture.md`).
- No ADRs are recorded yet for these decisions — see `docs/decisions/.template.md`.

### 4. Code Pointers

- `src/index.ts:21-43` — `TOOL_NAMES`, `buildServer()`
- `src/client/seoulApi.ts:93-114` — `getJson`/`getXml`/`getSubway`/`fetchAll` (the four call shapes every tool uses)
- `src/client/response.ts:34-82` — `unwrap()`, all 8 envelope shapes
- `src/tools/envelope.ts:5-14` — `ok()`/`fail()`
- `src/tools/resolve.ts:6-15` — `resolvePlace()`
- `src/tools/meta.ts:23-121` — `search_dataset`/`get_dataset_spec`/`call_dataset`
- `src/data/catalog.ts:55-84` — `searchCatalog()`/`validateCall()`

### 5. Cross-references
- Related modules: `src/normalize/*.ts` (domain mappers consumed by every tool)
- Related ADRs: none recorded yet
- Related runbooks: none recorded yet — see `docs/architecture.md` Operations section

<a id="korean"></a>
## 한국어

### 1. 개요

API 계층은 MCP tool 표면(19개, `src/tools/*.ts`)과 그 기반이 되는 단일 HTTP 클라이언트(`src/client/seoulApi.ts`)로 구성됩니다. 모든 tool 호출은 결국 `openapi.seoul.go.kr:8088` 또는 `swopenapi.seoul.go.kr`에 대한 하나의 `SeoulApiClient` 요청이 되고, 공통 형태로 언랩된 뒤 하나의 응답 봉투로 반환됩니다.

### 2. 구성요소

| 구성요소 | 경로 | 목적 |
|---|---|---|
| `buildServer` | `src/index.ts:31-43` | `McpServer`를 구성하고 8개의 `register*Tools()` 함수를 호출하며 `TOOL_NAMES`를 노출합니다 |
| `SeoulApiClient` | `src/client/seoulApi.ts` | 두 업스트림 베이스에 대한 단일 HTTP 진입점(`getJson`/`getXml`/`getSubway`/`fetchAll`) |
| `unwrap` | `src/client/response.ts:34-82` | 업스트림 8가지 봉투 형태를 `{rows, totalCount, raw, note}`로 정규화합니다 |
| `ok` / `fail` | `src/tools/envelope.ts` | 모든 tool이 반환하는 단일 응답 형태(`{data, asOf, source, notes}`) |
| `resolvePlace` | `src/tools/resolve.ts` | 모든 `citydata` 계열 tool이 공유하는 장소 확정 헬퍼 |
| `registerCommonTools` | `src/tools/common.ts` | `search_place`, `get_city_snapshot`, `get_disaster_alerts` |
| `registerPopulationTools` | `src/tools/population.ts` | `get_population`, `get_commercial_activity` |
| `registerTrafficTools` | `src/tools/traffic.ts` | `get_subway_arrivals`, `get_bike_stations`, `get_parking`, `get_road_traffic` |
| `registerCultureTools` | `src/tools/culture.ts` | `search_cultural_events` |
| `registerEnvironmentTools` | `src/tools/environment.ts` | `get_weather`, `get_air_quality` |
| `registerStatsTools` | `src/tools/stats.ts` | `get_subway_ridership`, `get_living_population`, `get_real_estate_prices` |
| `registerHealthTools` | `src/tools/health.ts` | `find_pharmacies` |
| `registerMetaTools` | `src/tools/meta.ts` | `search_dataset`, `get_dataset_spec`, `call_dataset` (28개 데이터셋 카탈로그) |
| `CATALOG` | `src/data/catalog.ts:12-44` | meta tool들의 기반이 되는 28개 데이터셋 카탈로그 |

### 3. 주요 결정

- tool마다 개별 HTTP 호출을 두지 않고 모든 tool을 동일한 `SeoulApiClient` 요청 경로(`fetchUnwrapped`)로 라우팅합니다. 이를 통해 캐싱, 재시도, 샘플 모드 클램핑, 봉투 정규화가 한 곳에만 존재합니다(`docs/architecture.md`의 "모든 서비스가 거치는 단 하나의 HTTP 경로" 결정 참고).
- tool마다 다른 반환 형태를 두지 않고 19개 tool 전체에 하나의 응답 봉투(`ok()`/`fail()`)를 표준화합니다. 이를 통해 에이전트는 어떤 tool을 호출했든 `{data, asOf, source, notes}` 형태를 신뢰할 수 있습니다.
- 트래픽이 많은 8개 데이터셋에는 전용 타입 tool을 제공하고, 나머지 20개는 범용 트리오(`search_dataset`/`get_dataset_spec`/`call_dataset`)로 라우팅합니다(`docs/architecture.md`의 "카탈로그 하이브리드" 결정 참고).
- 위 결정들에 대한 ADR은 아직 기록되지 않았습니다 -- `docs/decisions/.template.md` 참고.

### 4. 코드 포인터

- `src/index.ts:21-43` -- `TOOL_NAMES`, `buildServer()`
- `src/client/seoulApi.ts:93-114` -- `getJson`/`getXml`/`getSubway`/`fetchAll` (모든 tool이 사용하는 4가지 호출 형태)
- `src/client/response.ts:34-82` -- `unwrap()`, 8가지 봉투 형태 전체
- `src/tools/envelope.ts:5-14` -- `ok()`/`fail()`
- `src/tools/resolve.ts:6-15` -- `resolvePlace()`
- `src/tools/meta.ts:23-121` -- `search_dataset`/`get_dataset_spec`/`call_dataset`
- `src/data/catalog.ts:55-84` -- `searchCatalog()`/`validateCall()`

### 5. 상호 참조
- 관련 모듈: `src/normalize/*.ts` (모든 tool이 사용하는 도메인 매퍼)
- 관련 ADR: 아직 없음
- 관련 런북: 아직 없음 -- `docs/architecture.md`의 운영 절 참고
