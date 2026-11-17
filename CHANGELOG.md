# Changelog

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-11-17

### Added

- `get_subway_schedule` tool: first and last train times for both directions on lines 1-9, with an optional timetable of upcoming departures (`SearchInfoBySubwayNameService`, `SearchFirstAndLastTrainbyLineServiceNew`, `SearchSTNTimeTableByIDService`).
- `get_subway_hourly_ridership` tool: monthly boarding/alighting counts by hour for a station, with the busiest and quietest hours (`CardSubwayTime`).
- `search_public_reservations` tool: bookable public services on yeyak.seoul.go.kr by category, subcategory, district, target, free-only, and open-only (`ListPublicReservation*`, five services). The server now exposes 23 tools.
- `get_parking`: `otherLots` with fees and operating hours of public lots that have no realtime feed (`GetParkInfo`, matched on address, one row per lot code), and an `includeNonRealtime` input (default `true`).
- Catalog: 23 new entries (52 datasets). Ten back the new and extended tools; 13 are catalog-only: cold-wave shelters (`TbGtnCwP`), climate shelters (`tbClicomCnt`), Seoul kids cafés (`tnFcltySttusInfo1011`), emergency rooms (`TvEmgcHospitalInfo`), pediatric care (`mgis1708328729039Point`), rainfall (`AiRainfallService`), river levels (`ListRiverStageService`), subway elevator status (`SeoulMetroFaciInfo`), good-price shops (`goodPrices`), price-model shops (`ListPriceModelStoreService`), senior centers (`OdsnBuildingInfo`), public toilets (`mgisToiletPoi`), and animal hospitals (`LOCALDATA_020301`).
- `find_pharmacies` and `get_living_population` responses gain `totalCount` (rows matching the filters upstream).
- Catalog: path-parameter specs for `TbPharmacyOperateInfo` (`DUTYADDR`, `DUTYNAME`).
- `isNoData()` is exported from `src/client/response.ts`; `src/tools/path.ts` (`positionalPath()`) and `src/tools/kst.ts` hold shared path and KST helpers.

### Changed

- `get_parking` makes one more upstream call by default (`GetParkInfo`, cached for 24 h). Pass `includeNonRealtime: false` for the previous single-call behavior.
- `find_pharmacies` replaces the fixed "within the latest 1,000 rows" note with a note that appears only when more pharmacies match than one request returns.

### Fixed

- Quota warnings, quota-exhausted notices, and stale-cache disclosures now reach `notes` on successful responses of `get_population`, `get_commercial_activity`, `get_disaster_alerts`, `get_air_quality`, and `get_subway_arrivals`.
- `get_disaster_alerts` no longer reports "no alerts" and `get_air_quality` no longer blames the district name when the upstream returned no rows (for example, quota exhausted).
- `find_pharmacies` filters `district` and `name` upstream instead of within the first 1,000 of about 5,600 pharmacies.
- `get_living_population` filters any combination of `date`, `timeSlot`, and `dongCode` upstream. Previously only a leading run of them was sent, and `dongCode` alone matched almost nothing.

## [0.5.0] - 2026-11-14

### Added

- `get_land_price` tool: officially assessed individual land price (KRW per m²) by district, legal dong, and lot number (`IndividuallyPostedLandPriceService`). The server now exposes 20 tools.
- `get_real_estate_prices`: `dealType: 'rent'` for jeonse / monthly-rent transactions (`tbLnOpendataRentV`), plus `building`, `buildingUse`, `rentType`, and `includeCancelled` inputs. Sale rows gain `landArea`, `buildYear`, `dealMethod`, `rightType`, `cancelDate`; the response gains `totalCount`.
- Catalog: `IndividuallyPostedLandPriceService` entry (29 datasets), and path-parameter specs for the sale and rent datasets.

### Changed

- `get_real_estate_prices` moved to `src/tools/realestate.ts` / `src/normalize/realestate.ts`. Cancelled sales are excluded by default.
- `call_dataset` validation checks that each required path position is filled instead of counting arguments, and `get_dataset_spec` examples fill skipped positions with a space.

### Fixed

- `get_real_estate_prices` filtered only the newest 200 rows in code, so a past `year` always returned nothing and `district` covered about six days of data. Year, district, legal dong, building name, and building type are now sent as upstream path filters.

## [0.4.0] - 2026-11-12

### Added

- Add a Streamable HTTP entrypoint (`src/http.ts` → `dist/http.js`) satisfying the Amazon Bedrock AgentCore Runtime contract (`0.0.0.0:8000`, `POST /mcp` stateless, `GET /ping`)
- Add a multi-stage, `linux/arm64` `Dockerfile` for AgentCore Runtime container deployment
- Add an optional DynamoDB-backed L2 cache and daily quota ledger, gated by `CACHE_TABLE_NAME` and lazily imported so stdio/local users are unaffected
- Add stale-while-revalidate serving and in-process single-flight request de-duplication to the cache layer
- Add `docs/runbooks/agentcore-deploy.md` and [ADR-004](docs/decisions/ADR-004-session-scaling-two-tier-cache.md) documenting the AgentCore Runtime deploy/rollback/incident procedure and the session-scaling cache design

### Changed

- Align per-service soft cache TTLs with each source's real refresh cadence (e.g. `citydata` 60s → 300s)
- Bound the in-process L1 cache to `MAX_L1_ENTRIES` (1000) with LRU eviction so long-running HTTP processes no longer grow without limit
- Stop carrying the raw upstream payload (`raw`) in `Unwrapped` results and cache entries; nothing read it, and it roughly doubled L1 memory and DynamoDB item size
- Wait `retryDelayMs` (default 300 ms) before the single 5xx/network retry and cancel the discarded response body; upstream timeouts are no longer retried and fail fast with the new `TIMEOUT` code, capping worst-case latency at one `timeoutMs`
- Upgrade `zod` to v4 and `vitest` to v5, and refresh transitive dependencies (`npm audit`: 0 vulnerabilities). With zod v4, tool input JSON schemas no longer emit `additionalProperties: false`; unknown arguments are still stripped at runtime as before

### Fixed

- Return HTTP 400 with JSON-RPC `-32700 Parse error` for a non-JSON `POST /mcp` body instead of 500 `-32603`
- The `secret-scan.sh` PreToolUse hook could never block: `|| true` swallowed its exit code and it exited 1 (Claude Code blocks only on exit 2). It now scans only `git commit` commands, exits 2, reads the staged blob instead of the working tree, checks literal `.env` key values, and flags 32-hex Seoul keys only in key context so fixture image ids are not false positives
- `scripts/install-hooks.sh` now also installs a git `pre-commit` hook running the same scan, which covers `git add -A && git commit` in a single command

## [0.3.0] - 2026-08-17

### Added

- Codex CLI and Kiro CLI setup instructions in the README
- Architecture Decision Records (ADR-001 fixtures-as-truth, ADR-002 hybrid tool exposure, ADR-003 single HTTP path and dual keys) and a full docs set (architecture, onboarding, API reference)

### Changed

- Restructure the README as a single bilingual document with an expanded Claude Code install guide (dual keys, user scope, Claude Desktop import)
- Lowercase the GitHub repository URL (`whchoi98/seoul-opendata-mcp`)

### Fixed

- **MCPB bundle was fatally broken at runtime** — unanchored `src/` pattern in `.mcpbignore` stripped `node_modules/*/src` (including `fast-xml-parser`'s entry point) from the bundle; all ignore patterns are now root-anchored and the release pipeline verifies the unpacked bundle by executing it

## [0.2.0] - 2026-08-16

### Added
- Add five promoted tools for subway ridership statistics, living population, real estate transaction prices, pharmacy search, and disaster alert messages (`get_subway_ridership`, `get_living_population`, `get_real_estate_prices`, `find_pharmacies`, `get_disaster_alerts`)
- Add three metadata tools (`search_dataset`, `get_dataset_spec`, `call_dataset`) and a 28-entry dataset catalog spanning 6 categories
- Add automatic `.env` loading and a dedicated subway API key with fallback chain
- Add a live-sweep script that exercises all 19 tools

### Changed
- Add the subway-specific API key as a `user_config` entry in the MCPB manifest
- Overhaul the bilingual README

### Fixed
- Fix `call_dataset` sending a 0-based `start` parameter to the subway endpoint

## [0.1.0] - 2026-08-15

### Added
- Add 11 MCP tools for Seoul Open Data Plaza access
- Add fuzzy matching across 121 hotspots for `search_place`
- Add `SeoulApiClient` with TTL caching, pagination, retry, and API key masking
- Add tests built from captured real API fixtures
- Add npx and MCPB one-click deployment
- Add a bilingual (Korean/English) README

### Fixed
- Fix CLI entry-point detection for npx symlinks using realpath resolution
- Clamp requested row count to 5 rows in sample-key mode
- Add an XML error fallback for JSON endpoints
- Fall back to sample mode when the API key is empty

[Unreleased]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/whchoi98/seoul-opendata-mcp/releases/tag/v0.1.0

---

<a id="korean"></a>

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

## [Unreleased]

## [0.6.0] - 2026-11-17

### Added

- `get_subway_schedule` tool: 1~9호선 역의 양방향 첫차·막차 시간과, 선택하면 다음 열차 시간표를 조회합니다(`SearchInfoBySubwayNameService`, `SearchFirstAndLastTrainbyLineServiceNew`, `SearchSTNTimeTableByIDService`).
- `get_subway_hourly_ridership` tool: 역의 시간대별 승하차 인원 월 합계와 가장 붐비는, 한산한 시간대를 조회합니다(`CardSubwayTime`).
- `search_public_reservations` tool: 서울시 공공서비스예약(yeyak.seoul.go.kr)을 분야, 소분류, 자치구, 이용 대상, 무료 여부, 접수중 여부로 검색합니다(`ListPublicReservation*` 분야별 서비스 5개). tool이 23개가 됐습니다.
- `get_parking`: 실시간 연계가 없는 공영주차장의 요금과 운영시간을 `otherLots`로 함께 돌려줍니다(`GetParkInfo`, 주소로 검색, 주차장 코드당 1행). `includeNonRealtime` 입력(기본 `true`)을 추가했습니다.
- 카탈로그: 항목 23개를 추가했습니다(총 52종). 10개는 새로 만들거나 확장한 tool이 쓰는 데이터셋이고, 13개는 카탈로그 전용입니다: 한파쉼터(`TbGtnCwP`), 기후동행쉼터(`tbClicomCnt`), 서울형 키즈카페(`tnFcltySttusInfo1011`), 응급실(`TvEmgcHospitalInfo`), 서울형 소아의료체계(`mgis1708328729039Point`), 강우량(`AiRainfallService`), 하천 수위(`ListRiverStageService`), 지하철 승강기 가동현황(`SeoulMetroFaciInfo`), 착한가격업소(`goodPrices`), 가격안정 모범업소(`ListPriceModelStoreService`), 경로당(`OdsnBuildingInfo`), 공중화장실(`mgisToiletPoi`), 동물병원(`LOCALDATA_020301`).
- `find_pharmacies`와 `get_living_population` 응답에 `totalCount`(업스트림 필터에 맞는 전체 건수)를 더했습니다.
- 카탈로그: `TbPharmacyOperateInfo`의 경로 파라미터 명세(`DUTYADDR`, `DUTYNAME`)를 추가했습니다.
- `src/client/response.ts`가 `isNoData()`를 내보냅니다. 경로와 KST 공용 도구는 `src/tools/path.ts`(`positionalPath()`)와 `src/tools/kst.ts`에 있습니다.

### Changed

- `get_parking`이 기본으로 업스트림을 한 번 더 호출합니다(`GetParkInfo`, 24시간 캐시). 예전처럼 한 번만 호출하려면 `includeNonRealtime: false`를 줍니다.
- `find_pharmacies`의 고정 안내 "최근 1,000건 내 필터 결과"를 없애고, 조건에 맞는 약국이 한 번에 받는 건수보다 많을 때만 범위 안내를 붙입니다.

### Fixed

- `get_population`, `get_commercial_activity`, `get_disaster_alerts`, `get_air_quality`, `get_subway_arrivals`의 정상 응답에서 쿼터 경고, 쿼터 소진 안내, stale 캐시 경과 안내가 `notes`에 남도록 고쳤습니다.
- 업스트림이 행을 주지 않았을 때(쿼터 소진 등) `get_disaster_alerts`가 "재난문자 없음"으로, `get_air_quality`가 "자치구명 확인"으로 안내하지 않습니다.
- `find_pharmacies`가 약 5,600곳 중 앞 1,000곳 안에서 거르지 않고 `district`와 `name`을 업스트림에서 거릅니다.
- `get_living_population`이 `date`, `timeSlot`, `dongCode`를 어떤 조합으로 주든 업스트림에서 거릅니다. 전에는 앞에서부터 이어진 인자만 보내서 `dongCode`만 주면 결과가 거의 비었습니다.

## [0.5.0] - 2026-11-14

### Added

- `get_land_price` tool: 자치구, 법정동, 지번으로 개별공시지가(원/㎡)를 조회합니다(`IndividuallyPostedLandPriceService`). tool이 20개가 됐습니다.
- `get_real_estate_prices`: `dealType: 'rent'`로 전월세 실거래(`tbLnOpendataRentV`)를 조회하고, `building`, `buildingUse`, `rentType`, `includeCancelled` 입력을 추가했습니다. 매매 행에 `landArea`, `buildYear`, `dealMethod`, `rightType`, `cancelDate`를, 응답에 `totalCount`를 더했습니다.
- 카탈로그: `IndividuallyPostedLandPriceService` 항목(총 29종)과 매매, 전월세 데이터셋의 경로 파라미터 명세를 추가했습니다.

### Changed

- `get_real_estate_prices`를 `src/tools/realestate.ts`와 `src/normalize/realestate.ts`로 옮겼습니다. 해제된 매매 거래는 기본으로 뺍니다.
- `call_dataset` 검증이 인자 개수 대신 필수 경로 자리가 채워졌는지 확인하고, `get_dataset_spec` 예시는 건너뛰는 자리를 공백으로 채웁니다.

### Fixed

- `get_real_estate_prices`가 최신 200건만 받아 코드에서 걸러서, 과거 `year`는 항상 0건이었고 `district`는 약 6일치 안에서만 걸렸습니다. 이제 연도, 자치구, 법정동, 건물명, 건물 용도를 업스트림 경로 필터로 보냅니다.

## [0.4.0] - 2026-11-12

### Added

- Streamable HTTP 진입점(`src/http.ts` → `dist/http.js`) 추가 — Amazon Bedrock AgentCore Runtime 계약 충족(`0.0.0.0:8000`, `POST /mcp` stateless, `GET /ping`)
- AgentCore Runtime 컨테이너 배포용 멀티스테이지 `linux/arm64` `Dockerfile` 추가
- `CACHE_TABLE_NAME`으로 게이트되고 lazy import되어 stdio/로컬 사용자에게 영향이 없는, 선택적 DynamoDB 기반 L2 캐시 및 일일 쿼터 원장 추가
- 캐시 계층에 stale-while-revalidate 서빙과 프로세스 내 single-flight 요청 중복 제거 추가
- AgentCore Runtime 배포/롤백/장애 대응 절차와 세션 스케일링 캐시 설계를 다루는 `docs/runbooks/agentcore-deploy.md` 및 [ADR-004](docs/decisions/ADR-004-session-scaling-two-tier-cache.md) 추가

### Changed

- 서비스별 soft 캐시 TTL을 각 원천의 실제 갱신 주기에 맞춰 정렬(예: `citydata` 60초 → 300초)
- 프로세스 내 L1 캐시에 `MAX_L1_ENTRIES`(1000개) 상한과 LRU 제거를 적용해, 장기 실행 HTTP 프로세스에서 캐시가 끝없이 커지지 않게 함
- `Unwrapped` 결과와 캐시 항목에서 업스트림 원본(`raw`)을 제거. 읽는 코드가 없었고 L1 메모리와 DynamoDB 항목 크기를 두 배 가까이 키우고 있었음
- 5xx·네트워크 오류의 1회 재시도 전에 `retryDelayMs`(기본 300ms)만큼 대기하고 버리는 응답 본문을 정리함. 업스트림 타임아웃은 더 이상 재시도하지 않고 새 `TIMEOUT` 코드로 바로 실패해, 최악 지연이 `timeoutMs` 1회로 줄어듦
- `zod`를 v4로, `vitest`를 v5로 올리고 전이 의존성을 갱신함(`npm audit` 0건). zod v4에서는 tool 입력 JSON 스키마에 `additionalProperties: false`가 더 이상 나오지 않지만, 정의되지 않은 인자를 런타임에 버리는 동작은 이전과 같음

### Fixed

- `POST /mcp` 본문이 JSON이 아니면 500 `-32603` 대신 HTTP 400과 JSON-RPC `-32700 Parse error`로 응답
- `secret-scan.sh` PreToolUse 훅이 아무것도 막지 못하던 문제 수정. `|| true`가 종료 코드를 버렸고, 스크립트도 exit 1로 끝났음(Claude Code는 exit 2에서만 막음). 이제 `git commit` 명령에서만 검사하고 exit 2로 막으며, 작업 트리가 아닌 stage된 내용을 읽고, `.env`의 실제 키 값을 직접 찾음. 32자리 hex 서울 키는 키 문맥에서만 잡아 픽스처 이미지 ID 오탐을 없앰
- `scripts/install-hooks.sh`가 같은 검사를 돌리는 git `pre-commit` 훅도 설치함. 한 명령 안의 `git add -A && git commit`까지 막음

## [0.3.0] - 2026-08-17

### Added

- README에 Codex CLI·Kiro CLI 설치 안내 추가
- 아키텍처 결정 기록 3건(ADR-001 픽스처 원칙, ADR-002 하이브리드 도구 노출, ADR-003 단일 HTTP 경로·키 2종) 및 문서 세트(아키텍처, 온보딩, API 레퍼런스) 추가

### Changed

- README를 단일 이중 언어 문서로 개편, Claude Code 설치 안내 확장(키 2종·user scope·Claude Desktop 가져오기)
- GitHub 저장소 URL 소문자 통일(`whchoi98/seoul-opendata-mcp`)

### Fixed

- **MCPB 번들 런타임 치명 결함 수정** — `.mcpbignore`의 비앵커 `src/` 패턴이 번들에서 `node_modules/*/src`(fast-xml-parser 진입점 포함)를 제거하던 문제. 전 패턴 루트 앵커화 및 릴리스 파이프라인에 언팩 번들 실행 검증 추가

## [0.2.0] - 2026-08-16

### Added
- 지하철 승하차 통계, 생활인구, 부동산 실거래가, 약국 검색, 긴급재난문자 승격 tool 5종 추가 (`get_subway_ridership`, `get_living_population`, `get_real_estate_prices`, `find_pharmacies`, `get_disaster_alerts`)
- 메타 tool 3종(`search_dataset`, `get_dataset_spec`, `call_dataset`)과 6개 카테고리로 구성된 28종 데이터셋 카탈로그 추가
- `.env` 자동 로드 및 지하철 전용 API 키 폴백 체인 추가
- 19개 tool 전체를 점검하는 라이브 스위프 스크립트 추가

### Changed
- MCPB manifest의 `user_config`에 지하철 전용 API 키 항목 추가
- 한/영 bilingual README 개편

### Fixed
- `call_dataset`이 지하철 엔드포인트에 0-based `start` 파라미터를 전달하던 오류 수정

## [0.1.0] - 2026-08-15

### Added
- 서울 열린데이터광장 접근용 MCP tool 11종 추가
- `search_place`용 121개 핫스팟 퍼지 매칭 추가
- TTL 캐시, 페이지네이션, 재시도, API 키 마스킹을 지원하는 `SeoulApiClient` 추가
- 실제 API 응답을 캡처한 픽스처 기반 테스트 추가
- npx 및 MCPB 원클릭 배포 지원 추가
- 한/영 bilingual README 추가

### Fixed
- realpath 기반 경로 해석으로 npx 심링크 CLI 진입점 감지 오류 수정
- 샘플 키 모드에서 요청 행 수를 5행으로 제한하도록 수정
- JSON 엔드포인트에 대한 XML 에러 응답 폴백 처리 추가
- API 키가 비어 있을 때 sample 모드로 폴백하도록 수정

[Unreleased]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/whchoi98/seoul-opendata-mcp/releases/tag/v0.1.0
