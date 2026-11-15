# Data Module

## Role
네트워크 호출이 없는 정적 참조 데이터입니다. 실시간 도시데이터 핫스팟 121곳, 데이터셋 카탈로그 29개(6카테고리), 자유 텍스트 장소명 매칭을 담당합니다.

## Key Files
- `hotspots.ts` - `HOTSPOTS: Hotspot[]`. 5개 `Category`(고궁·문화유산/관광특구/공원/발달상권/인구밀집지역), `commercial` 플래그(citydata_cmrcl 지원 여부).
- `catalog.ts` - `CATALOG: DatasetEntry[]`, `searchCatalog()`, `exampleParams()`, `validateCall()`. `Category6` 6종.
- `placeMatcher.ts` - `searchPlace(query)`: 자유 텍스트 → `HOTSPOTS` 퍼지 매칭, 후보 목록 반환.

## Rules
- `CATALOG`은 정확히 29개, `Category6` 6종만 사용합니다(`tests/catalog.test.ts`가 개수를 검증합니다). 항목을 추가/삭제하면 그 테스트의 기대값도 함께 갱신합니다.
- `callable: false`인 항목은 반드시 `tool` 필드로 대체 tool을 안내해야 합니다.
- `pathParams`는 API의 자리 순서 그대로 적습니다. `validateCall()`과 `exampleParams()`가 배열 위치로 필수 인자를 판단하므로, 필수 인자 앞의 선택 인자도 빠뜨리지 않습니다(예: 공시지가는 1번째와 6번째가 필수).
- `tool` 필드가 있는 항목은 반드시 `src/index.ts`의 `TOOL_NAMES`에 존재하는 이름이어야 합니다(테스트로 상호 검증됨).
- `HOTSPOTS`를 변경할 때는 `NON_COMMERCIAL`(citydata_cmrcl 미지원 39곳)을 실제 지원 범위와 함께 갱신합니다.
