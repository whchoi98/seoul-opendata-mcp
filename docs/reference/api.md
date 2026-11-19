# API / API 구성 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview

The API layer is the MCP tool surface (23 tools, `src/tools/*.ts`) plus the single HTTP client (`src/client/seoulApi.ts`) it is built on: every tool call ultimately becomes one `SeoulApiClient` request against `openapi.seoul.go.kr:8088` or `swopenapi.seoul.go.kr`, unwrapped into a common shape and returned inside one response envelope.

### 2. Components

| Component | Path | Purpose |
|---|---|---|
| `buildServer` | `src/index.ts:32-45` | Constructs the `McpServer`, calls all 9 `register*Tools()` functions, exposes `TOOL_NAMES` |
| `SeoulApiClient` | `src/client/seoulApi.ts` | Single HTTP entry point (`getJson`/`getXml`/`getSubway`/`fetchAll`) for both upstream bases |
| `unwrap` | `src/client/response.ts:38-86` | Normalizes 8 upstream envelope shapes into `{rows, totalCount, note}` (the raw payload is not retained) |
| `ok` / `fail` | `src/tools/envelope.ts` | The one response shape (`{data, asOf, source, notes}`) every tool returns |
| `resolvePlace` | `src/tools/resolve.ts` | Shared place-resolution helper reused by every `citydata`-family tool |
| `registerCommonTools` | `src/tools/common.ts` | `search_place`, `get_city_snapshot`, `get_disaster_alerts` |
| `registerPopulationTools` | `src/tools/population.ts` | `get_population`, `get_commercial_activity` |
| `registerTrafficTools` | `src/tools/traffic.ts` | `get_subway_arrivals`, `get_subway_schedule`, `get_bike_stations`, `get_parking`, `get_road_traffic` |
| `registerCultureTools` | `src/tools/culture.ts` | `search_cultural_events`, `search_public_reservations` |
| `registerEnvironmentTools` | `src/tools/environment.ts` | `get_weather`, `get_air_quality` |
| `registerStatsTools` | `src/tools/stats.ts` | `get_subway_ridership`, `get_subway_hourly_ridership`, `get_living_population` |
| `registerRealEstateTools` | `src/tools/realestate.ts` | `get_real_estate_prices` (sale + rent), `get_land_price` |
| `registerHealthTools` | `src/tools/health.ts` | `find_pharmacies` |
| `registerMetaTools` | `src/tools/meta.ts` | `search_dataset`, `get_dataset_spec`, `call_dataset` (52-dataset catalog) |
| `CATALOG` | `src/data/catalog.ts:12-70` | The 52-dataset catalog backing the meta tools |

### 3. Key Decisions

- Route every tool through the same `SeoulApiClient` request path (`fetchUnwrapped`) rather than a per-tool HTTP call, so caching, retry, sample-mode clamping, and envelope normalization exist once (see the "One HTTP code path for every service" decision in `docs/architecture.md`).
- Standardize on one response envelope (`ok()`/`fail()`) across all 23 tools instead of a per-tool return shape, so an agent can rely on `{data, asOf, source, notes}` regardless of which tool it called.
- Give 25 high-traffic datasets a dedicated, fully-typed tool (24 also callable via `call_dataset`, plus the tool-only `get_disaster_alerts`) and route the remaining 27 through the generic `search_dataset`/`get_dataset_spec`/`call_dataset` trio (see the "Catalog hybrid" decision in `docs/architecture.md`).
- The "Catalog hybrid" decision above is recorded as [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md).
- Retry policy (`request()`): one retry after `retryDelayMs` (default 300 ms) for HTTP 5xx and network errors, with the discarded body cancelled first; timeouts are not retried and throw `TIMEOUT`, so a tool call waits at most one `timeoutMs` (15 s) per upstream request. 4xx and parse errors throw immediately.
- Cache contract: `Unwrapped` carries only `{rows, totalCount, note}`; the L1 cache (`InMemoryCache`) is an LRU bounded at `MAX_L1_ENTRIES` (1000) on top of the 24 h hard TTL.
- The daily quota is a soft limit: `fetchUnwrapped` reads the ledger before the upstream call and increments it after a successful response, so concurrent requests near the limit can overshoot it slightly. This is intentional; the ledger is a budget guard, not an exact counter.
- Key pool: `SEOUL_API_KEY` may list several keys separated by commas. Each upstream call uses the first key that is under its daily limit and not cooling down; when no key is left the client answers from the cache only. The 80% note and the exhausted note use the pool totals. With two or more keys, `ERROR-337` cools that key down for 10 minutes (process memory only) and retries once with the next key; a single key, sample included, throws as before. The cache key replaces the key segment of the URL with `{key}` (`sample` in sample mode), so switching keys keeps cache hits. Because 0.7.0 changes this format, existing L2 entries miss once and expire within 24 h.
- HTTP entrypoint (`src/http.ts`): a non-JSON `POST /mcp` body returns 400 with JSON-RPC `-32700 Parse error`; a body over 1 MB returns 413; other failures return 500 `-32603`.
- Positional path filters: the Open Data Plaza services filter by position in the URL path. A skipped position must be sent as a single space (`%20`); an empty segment silently drops every filter after it. `buildPath()` in `src/tools/realestate.ts` holds the per-service position table (sale `BLDG_USG` is 11th, rent `BLDG_USG` is 10th), and `validateCall()` checks that each required position is filled instead of counting arguments.
- `positionalPath()` in `src/tools/path.ts` builds the path for services whose filters are a simple ordered list (`SPOP_LOCAL_RESD_DONG`, `TbPharmacyOperateInfo`, `CardSubwayTime`, `GetParkInfo`, the `ListPublicReservation*` services): missing middle positions become a space and trailing ones are dropped.
- `isNoData(u)` in `src/client/response.ts` is true only for an empty `INFO-200` ("no matching rows") result. A tool phrases an empty result as "not found" only when it is true; an empty result with a quota-exhausted note is passed through as that note.
- Real-estate dong filter: the transaction services filter legal dong by code (`STDG_CD`), not name. `lookupDongCode()` gets the code from a 1-row `IndividuallyPostedLandPriceService` call (its `BJDONG_CD` is the same code; soft TTL 24 h). If that lookup fails for a reason other than "no data", the tool falls back to matching the name within the latest 500 rows and says so in `notes`.
- Real-estate normalization contract (`src/normalize/realestate.ts`): `normalizeRealEstate` (sale) adds `landArea`, `buildYear`, `dealMethod`, `rightType`, `cancelDate` to the previous fields; `normalizeRentDeal` and `normalizeLandPrice` are new. Cancelled sales (`cancelDate` set) are dropped by the tool unless `includeCancelled` is true.

### 4. Code Pointers

- `src/index.ts:22-45` — `TOOL_NAMES`, `buildServer()`
- `src/client/seoulApi.ts:204-227` — `getJson`/`getXml`/`getSubway`/`fetchAll` (the four call shapes every tool uses)
- `src/client/seoulApi.ts:112-136` — `backoff()`/`request()` (retry and timeout policy)
- `src/client/cache.ts` — `MAX_L1_ENTRIES`, LRU `InMemoryCache`, `CompositeCache`
- `src/client/response.ts:38-86` — `unwrap()`, all 8 envelope shapes
- `src/tools/envelope.ts:5-14` — `ok()`/`fail()`
- `src/tools/resolve.ts:6-15` — `resolvePlace()`
- `src/tools/meta.ts:23-121` — `search_dataset`/`get_dataset_spec`/`call_dataset`
- `src/data/catalog.ts:81-120` — `searchCatalog()`/`exampleParams()`/`validateCall()`
- `src/tools/realestate.ts` — `SLOTS`/`buildPath()` (positional path filters), `lookupDongCode()`, `get_real_estate_prices`, `get_land_price`
- `src/normalize/realestate.ts` — `normalizeDistrict()`, `normalizeRealEstate()`, `normalizeRentDeal()`, `normalizeLandPrice()`

### 5. Cross-references
- Related modules: `src/normalize/*.ts` (domain mappers consumed by every tool)
- Related ADRs: [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md) (hybrid tool exposure)
- Related runbooks: none recorded yet — see `docs/architecture.md` Operations section

<a id="korean"></a>
## 한국어

### 1. 개요

API 계층은 MCP tool 표면(23개, `src/tools/*.ts`)과 그 기반이 되는 단일 HTTP 클라이언트(`src/client/seoulApi.ts`)로 구성됩니다. 모든 tool 호출은 결국 `openapi.seoul.go.kr:8088` 또는 `swopenapi.seoul.go.kr`에 대한 하나의 `SeoulApiClient` 요청이 되고, 공통 형태로 언랩된 뒤 하나의 응답 봉투로 반환됩니다.

### 2. 구성요소

| 구성요소 | 경로 | 목적 |
|---|---|---|
| `buildServer` | `src/index.ts:32-45` | `McpServer`를 구성하고 9개의 `register*Tools()` 함수를 호출하며 `TOOL_NAMES`를 노출합니다 |
| `SeoulApiClient` | `src/client/seoulApi.ts` | 두 업스트림 베이스에 대한 단일 HTTP 진입점(`getJson`/`getXml`/`getSubway`/`fetchAll`) |
| `unwrap` | `src/client/response.ts:38-86` | 업스트림 8가지 봉투 형태를 `{rows, totalCount, note}`로 정규화합니다(원본 payload는 보관하지 않음) |
| `ok` / `fail` | `src/tools/envelope.ts` | 모든 tool이 반환하는 단일 응답 형태(`{data, asOf, source, notes}`) |
| `resolvePlace` | `src/tools/resolve.ts` | 모든 `citydata` 계열 tool이 공유하는 장소 확정 헬퍼 |
| `registerCommonTools` | `src/tools/common.ts` | `search_place`, `get_city_snapshot`, `get_disaster_alerts` |
| `registerPopulationTools` | `src/tools/population.ts` | `get_population`, `get_commercial_activity` |
| `registerTrafficTools` | `src/tools/traffic.ts` | `get_subway_arrivals`, `get_subway_schedule`, `get_bike_stations`, `get_parking`, `get_road_traffic` |
| `registerCultureTools` | `src/tools/culture.ts` | `search_cultural_events`, `search_public_reservations` |
| `registerEnvironmentTools` | `src/tools/environment.ts` | `get_weather`, `get_air_quality` |
| `registerStatsTools` | `src/tools/stats.ts` | `get_subway_ridership`, `get_subway_hourly_ridership`, `get_living_population` |
| `registerRealEstateTools` | `src/tools/realestate.ts` | `get_real_estate_prices` (sale + rent), `get_land_price` |
| `registerHealthTools` | `src/tools/health.ts` | `find_pharmacies` |
| `registerMetaTools` | `src/tools/meta.ts` | `search_dataset`, `get_dataset_spec`, `call_dataset` (52개 데이터셋 카탈로그) |
| `CATALOG` | `src/data/catalog.ts:12-70` | meta tool들의 기반이 되는 52개 데이터셋 카탈로그 |

### 3. 주요 결정

- tool마다 개별 HTTP 호출을 두지 않고 모든 tool을 동일한 `SeoulApiClient` 요청 경로(`fetchUnwrapped`)로 라우팅합니다. 이를 통해 캐싱, 재시도, 샘플 모드 클램핑, 봉투 정규화가 한 곳에만 존재합니다(`docs/architecture.md`의 "모든 서비스가 거치는 단 하나의 HTTP 경로" 결정 참고).
- tool마다 다른 반환 형태를 두지 않고 23개 tool 전체에 하나의 응답 봉투(`ok()`/`fail()`)를 표준화합니다. 이를 통해 에이전트는 어떤 tool을 호출했든 `{data, asOf, source, notes}` 형태를 신뢰할 수 있습니다.
- 트래픽이 많은 25개 데이터셋에는 전용 타입 tool을 제공하고(이 중 24개는 `call_dataset`으로도 호출 가능, 나머지 1개인 재난문자 전용 `get_disaster_alerts`는 tool 전용), 나머지 27개는 범용 트리오(`search_dataset`/`get_dataset_spec`/`call_dataset`)로 라우팅합니다(`docs/architecture.md`의 "카탈로그 하이브리드" 결정 참고).
- 위 "카탈로그 하이브리드" 결정은 [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md)로 기록되어 있습니다.
- 재시도 정책(`request()`): HTTP 5xx와 네트워크 오류는 버리는 응답 본문을 정리한 뒤 `retryDelayMs`(기본 300ms) 후 1회 재시도합니다. 타임아웃은 재시도하지 않고 `TIMEOUT`을 던지므로, tool 호출은 업스트림 요청 하나당 최대 `timeoutMs`(15초) 1회만 기다립니다. 4xx와 파싱 오류는 바로 던집니다.
- 캐시 계약: `Unwrapped`는 `{rows, totalCount, note}`만 담습니다. L1 캐시(`InMemoryCache`)는 24시간 hard TTL에 더해 `MAX_L1_ENTRIES`(1000개) 상한의 LRU입니다.
- 일일 쿼터는 soft 한도입니다. `fetchUnwrapped`가 업스트림 호출 전에 원장을 읽고 성공 응답 뒤에 증가시키므로, 한도 근처에서 동시 요청이 몰리면 한도를 조금 넘을 수 있습니다. 의도한 동작이며, 원장은 정확한 계수기가 아니라 예산 경보 장치입니다.
- 키 풀: `SEOUL_API_KEY`에 쉼표로 여러 키를 넣을 수 있습니다. 업스트림 호출마다 하루 한도 미만이고 쿨다운 중이 아닌 첫 키를 쓰고, 남은 키가 없으면 캐시로만 응답합니다. 80% 안내와 소진 안내는 풀 합계를 기준으로 합니다. 키가 둘 이상일 때 `ERROR-337`이 나면 그 키를 10분 동안 빼고(프로세스 메모리에만 기록) 다음 키로 한 번 다시 호출합니다. 키가 하나면(샘플 포함) 지금처럼 오류를 던집니다. 캐시 키는 URL의 키 자리를 `{key}`(샘플 모드는 `sample`)로 바꾼 값이라 키를 바꿔도 캐시가 적중합니다. 0.7.0에서 이 형식이 바뀌므로 기존 L2 항목은 한 번 빗나가고 24시간 안에 만료됩니다.
- HTTP 진입점(`src/http.ts`): `POST /mcp` 본문이 JSON이 아니면 400과 JSON-RPC `-32700 Parse error`, 1MB를 넘으면 413, 그 밖의 실패는 500 `-32603`을 반환합니다.
- 자리 기반 경로 필터: 열린데이터광장 서비스는 URL 경로의 자리로 필터를 구분합니다. 건너뛰는 자리는 공백 한 칸(`%20`)으로 보내야 하고, 빈 세그먼트를 보내면 그 뒤 필터가 모두 무시됩니다. `src/tools/realestate.ts`의 `buildPath()`가 서비스별 자리 표를 갖고(매매 `BLDG_USG`는 11번째, 전월세 `BLDG_USG`는 10번째), `validateCall()`은 인자 개수가 아니라 필수 인자의 자리가 채워졌는지 검사합니다.
- 필터가 단순한 순서 배열인 서비스(`SPOP_LOCAL_RESD_DONG`, `TbPharmacyOperateInfo`, `CardSubwayTime`, `GetParkInfo`, `ListPublicReservation*`)는 `src/tools/path.ts`의 `positionalPath()`로 경로를 만듭니다. 중간 빈 자리는 공백으로 채우고 끝쪽 빈 자리는 보내지 않습니다.
- `src/client/response.ts`의 `isNoData(u)`는 비어 있는 `INFO-200`(조건에 맞는 행 없음) 응답일 때만 참입니다. tool은 이 값이 참일 때만 빈 결과를 "없음"으로 안내하고, 쿼터 소진 안내가 붙은 빈 결과는 그 안내를 그대로 전달합니다.
- 부동산 법정동 필터: 실거래가 서비스는 법정동을 이름이 아닌 코드(`STDG_CD`)로 거릅니다. `lookupDongCode()`가 `IndividuallyPostedLandPriceService`를 1행만 호출해 코드를 얻습니다(`BJDONG_CD`가 같은 코드, soft TTL 24시간). 이 조회가 "데이터 없음"이 아닌 이유로 실패하면 최신 500건 안에서 이름으로 거르고 그 사실을 `notes`에 적습니다.
- 부동산 정규화 계약(`src/normalize/realestate.ts`): `normalizeRealEstate`(매매)는 기존 필드에 `landArea`, `buildYear`, `dealMethod`, `rightType`, `cancelDate`를 더했습니다. `normalizeRentDeal`과 `normalizeLandPrice`는 새로 추가했습니다. 해제된 매매(`cancelDate`가 있는 행)는 `includeCancelled`가 true가 아니면 tool이 뺍니다.

### 4. 코드 포인터

- `src/index.ts:22-45` -- `TOOL_NAMES`, `buildServer()`
- `src/client/seoulApi.ts:204-227` -- `getJson`/`getXml`/`getSubway`/`fetchAll` (모든 tool이 사용하는 4가지 호출 형태)
- `src/client/seoulApi.ts:112-136` -- `backoff()`/`request()` (재시도와 타임아웃 정책)
- `src/client/cache.ts` -- `MAX_L1_ENTRIES`, LRU `InMemoryCache`, `CompositeCache`
- `src/client/response.ts:38-86` -- `unwrap()`, 8가지 봉투 형태 전체
- `src/tools/envelope.ts:5-14` -- `ok()`/`fail()`
- `src/tools/resolve.ts:6-15` -- `resolvePlace()`
- `src/tools/meta.ts:23-121` -- `search_dataset`/`get_dataset_spec`/`call_dataset`
- `src/data/catalog.ts:81-120` -- `searchCatalog()`/`exampleParams()`/`validateCall()`
- `src/tools/realestate.ts` -- `SLOTS`/`buildPath()`(자리 기반 경로 필터), `lookupDongCode()`, `get_real_estate_prices`, `get_land_price`
- `src/normalize/realestate.ts` -- `normalizeDistrict()`, `normalizeRealEstate()`, `normalizeRentDeal()`, `normalizeLandPrice()`

### 5. 상호 참조
- 관련 모듈: `src/normalize/*.ts` (모든 tool이 사용하는 도메인 매퍼)
- 관련 ADR: [ADR-002](../decisions/ADR-002-hybrid-tool-exposure.md) (하이브리드 tool 노출)
- 관련 런북: 아직 없음 -- `docs/architecture.md`의 운영 절 참고
