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

[Unreleased]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/whchoi98/seoul-opendata-mcp/releases/tag/v0.1.0

---

<a id="korean"></a>

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

## [Unreleased]

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

[Unreleased]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/whchoi98/seoul-opendata-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/whchoi98/seoul-opendata-mcp/releases/tag/v0.1.0
