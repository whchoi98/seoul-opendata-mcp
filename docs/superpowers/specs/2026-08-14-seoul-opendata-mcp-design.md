# Seoul-OpenData-MCP 설계 스펙

- 날짜: 2026-08-14
- 상태: 승인된 설계 (채팅 승인) → 구현 계획 대기
- 스택: TypeScript, `@modelcontextprotocol/sdk` (stdio), zod, fast-xml-parser

## 1. 개요

서울 열린데이터광장(data.seoul.go.kr) Open API를 감싸는 공개 MCP 서버.
인증키 관리, 페이지네이션, XML→JSON 정규화를 내부에서 처리하고
도메인별(교통/생활인구/문화/환경) tool 11개를 공개한다.
누구나 Claude Desktop에 붙여 "지금 강남역 혼잡도 어때?"를 물을 수 있게 한다.

### 목표
- `npx -y seoul-opendata-mcp` 한 줄 + 인증키 하나로 연결 완료
- MCPB(.mcpb) 번들로 Claude Desktop 원클릭 설치 지원
- 워크숍 캡스톤(도메인별 tool 확장 실습) + 오픈소스 레포(MIT) 이중 활용

### 비목표 (v1에서 제외)
- 공공데이터포털(data.go.kr) 소속 API (버스 도착, 기상청 직접 호출) — 별도 키가 필요해 온보딩 마찰 증가. 날씨는 citydata `WEATHER_STTS` 재활용으로 커버
- 시계열 축적/DB — 서버는 무상태(stateless), 실시간 스냅샷만 제공
- HTTP/SSE transport — v1은 stdio만

## 2. 데이터 소스 (2026-08-14 샘플 키 실검증 완료)

| 서비스명 | 내용 | 응답 루트 | 커버리지 | 비고 |
|---|---|---|---|---|
| `citydata` | 통합 도시데이터 (인구/상권/교통/날씨/행사/재난) | `SeoulRtd.citydata` (XML 전용) | 핫스팟 121곳 | 호출당 1곳, 인구 15분 지연 |
| `citydata_ppltn` | 실시간 인구·혼잡도·12시간 예측 | `"SeoulRtd.citydata_ppltn"` 배열 (JSON) | 핫스팟 121곳 | `FCST_PPLTN` 배열 포함 |
| `citydata_cmrcl` | 신한카드 실시간 상권 | `LIVE_CMRCL_STTS` 객체 (JSON) | 핫스팟 82곳 | `CMRCL_RSB` 업종별 배열 |
| `bikeList` | 따릉이 실시간 대여현황 | `rentBikeStatus.row` | 전 대여소 (~3천) | 좌표 포함, 1회 최대 1000행 |
| `culturalEventInfo` | 문화행사 | `culturalEventInfo.row` | 19,499건+ | CODENAME/GUNAME/DATE 필터 |
| `GetParkingInfo` | 공영주차장 실시간 | `GetParkingInfo.row` | 실시간 연계 122곳 | `NOW_PRK_VHCL_CNT`/`TPKCT` |
| `RealtimeCityAir` | 권역·자치구 실시간 대기질 | `RealtimeCityAir.row` | 25개 자치구 | PM/FPM/CAI_GRD |
| `realtimeStationArrival` | 지하철 실시간 도착 | `realtimeArrivalList` | 전 역사 | swopenapi.seoul.go.kr, 동일 키 체계 |

검증에서 확인된 사실:
- 응답 봉투가 4가지 형태 → 정규화 층에서 형태별 어댑터 필요
- `GetParkInfo`(2,189곳)는 정보수집중 포함 전체 목록이므로 사용하지 않음
- 샘플 키(`sample`)는 citydata 계열 광화문·덕수궁만, 일반 API 5행 제한

## 3. 아키텍처

```
src/
  index.ts          # 엔트리: McpServer 생성, tool 등록, stdio 연결
  client/
    seoulApi.ts     # SeoulApiClient: 키 주입, URL 조립, XML→JSON,
                    # 페이지네이션 자동 순회, TTL 캐시, 에러 매핑, 재시도
  normalize/
    population.ts   # 도메인별 변환기: 원본 대문자 필드 → camelCase,
    commercial.ts   # 숫자 문자열 → number, 코드 → 라벨
    traffic.ts
    culture.ts
    environment.ts
  tools/
    common.ts       # search_place, get_city_snapshot
    population.ts   # get_population, get_commercial_activity
    traffic.ts      # get_subway_arrivals, get_bike_stations, get_parking, get_road_traffic
    culture.ts      # search_cultural_events
    environment.ts  # get_air_quality, get_weather
  data/
    hotspots.json   # 121개 핫스팟 (매뉴얼 V8.5 표 2-2 기반): 이름, 코드(POIxxx),
                    # 카테고리(고궁·문화유산/관광특구/공원/발달상권/인구밀집지역),
                    # 별칭(영문/축약), 상권 제공 여부(82곳 플래그)
```

### 클라이언트 층 규칙
- **인증키**: `SEOUL_API_KEY` env. 미설정 시 `sample` 폴백 + 모든 응답 notes에 제약·발급 안내 포함. 에러/로그에서 키 마스킹
- **페이지네이션**: `/{START}/{END}/` 패턴 은닉. tool은 `limit`(기본 20, 최대 200)만 노출. 초과분은 자동 순회 후 병합
- **캐시**: 인메모리 TTL — citydata 계열 60초, 대기질/따릉이/주차 5분, 문화행사 1시간. 무료 쿼터(일 1,000회/키) 보호
- **에러 매핑**: `INFO-000` 정상 / `INFO-200` 데이터 없음(빈 결과로 정상 반환 + note) / `ERROR-336` 등 키 오류(발급 안내 포함 메시지) / 그 외 원문 코드+한국어 설명
- **재시도**: 네트워크 오류·5xx에 한해 1회, 타임아웃 15초

### 응답 공통 봉투
```json
{
  "data": { },
  "asOf": "응답 내 측정 시각(가능한 경우) 또는 호출 시각",
  "source": "OA-21778 (citydata_ppltn)",
  "notes": ["실시간 인구는 집계·보정으로 약 15분 지연됩니다."]
}
```

## 4. Tool 사양 (11개)

| # | tool | 입력 | 출력 핵심 | 소스 |
|---|---|---|---|---|
| 1 | `search_place` | `query` | 매칭 핫스팟(이름/코드/카테고리/상권 지원 여부), 실패 시 후보 목록 | hotspots.json (내장) |
| 2 | `get_city_snapshot` | `place` | 인구 혼잡도+날씨+도로+행사 1회 요약 | citydata (XML) |
| 3 | `get_population` | `place`, `includeForecast?` | 혼잡도 4단계, 실시간 인구 min/max, 성·연령 비율, 상주/비상주, 12시간 예측 | citydata_ppltn |
| 4 | `get_commercial_activity` | `place` | 상권 4단계(한산한~분주한), 결제건수/금액대, 업종별 현황, 소비자 성·연령 | citydata_cmrcl |
| 5 | `get_subway_arrivals` | `station` | 상하행 실시간 도착 목록(행선지, 도착예정, 현재위치) | realtimeStationArrival |
| 6 | `get_bike_stations` | `place \| lat,lng`, `radiusM?` | 주변 대여소 거치율/잔여대수 | bikeList (전량 조회 후 좌표 필터) |
| 7 | `get_parking` | `place \| district` | 실시간 주차가능면수(전체면수-현재대수), 요금 | GetParkingInfo |
| 8 | `get_road_traffic` | `place` | 도로소통 평균속도, 소통 등급, 사고·통제 | citydata (ROAD_TRAFFIC_STTS + ACDNT_CNTRL_STTS) |
| 9 | `search_cultural_events` | `keyword?`, `district?`, `category?`, `from?`, `to?`, `freeOnly?` | 행사명/기간/장소/요금/링크 목록 | culturalEventInfo |
| 10 | `get_air_quality` | `district?` | 자치구·권역 PM10/PM2.5/통합지수 등급 | RealtimeCityAir |
| 11 | `get_weather` | `place` | 기온, 강수, 미세먼지, 기상특보, 일출·일몰 | citydata (WEATHER_STTS) |

공통 규칙:
- `place`를 받는 tool은 내부에서 `search_place`와 같은 퍼지 매칭을 먼저 수행. 미확정 시 후보를 에러가 아닌 정상 응답으로 반환해 LLM이 되물을 수 있게 함
- 상권 미지원 39곳에서 `get_commercial_activity` 호출 시: 미지원 안내 + 인접 지원 장소 제안
- 모든 description은 "언제 이 도구를 쓰는가"를 1문장으로 명시 (영문 서술 + 한국어 병기)

## 5. 배포·문서

- npm 패키지 `seoul-opendata-mcp` (bin 포함), Node 18+
- `.mcpb` 번들: manifest에 `SEOUL_API_KEY` user_config 선언 → Desktop 설치 시 키 입력 UI
- README 한/영: 키 발급 5분 가이드(스크린샷), Desktop/Code/기타 클라이언트 설정, 예시 프롬프트 6개+
- 라이선스 MIT, 데이터 출처 고지(서울 열린데이터광장, CC BY)
- 갤러리 등재: MCP Registry, Smithery, Glama 메타데이터 포함

## 6. 테스트

- vitest. 실검증에서 확보한 실제 응답을 `tests/fixtures/`에 저장 → 정규화 스냅샷·단위 테스트 (네트워크 불필요)
- 4가지 응답 봉투 형태별 어댑터 테스트, 에러 코드 매핑 테스트, 퍼지 매칭 테스트(별칭/부분일치/실패 후보)
- `SEOUL_API_KEY` 존재 시에만 도는 라이브 스모크 테스트 (CI 옵션)
- 수동: MCP Inspector로 11개 tool 왕복 확인

## 7. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| API 필드/스키마 변경 (매뉴얼 V8.5 기준) | 정규화 층에 미지 필드 무시 + 필수 필드 누락 시 원문 보존 폴백 |
| 무료 쿼터 초과 (일 1,000회) | TTL 캐시 + limit 기본값 보수적 설정 + 쿼터 초과 에러 안내 |
| 핫스팟 목록 변경 (121곳은 현행) | hotspots.json 버전 명시, README에 갱신 절차 문서화 |
| 상권 82곳 제한 | hotspots.json에 지원 플래그, 미지원 시 대안 제안 |
| 샘플 키 남용 | sample 폴백 응답마다 제약 고지, README에 키 발급 우선 안내 |

## 8. 마일스톤

1. 스캐폴드 + SeoulApiClient + 정규화 어댑터 4형 (픽스처 테스트)
2. hotspots.json 생성(매뉴얼 표 추출) + search_place
3. 생활인구 2종 → 교통 4종 → 문화/환경 3종 tool 구현
4. get_city_snapshot(XML 파싱) + 응답 봉투 통일
5. README(한/영) + npm 패키징 + MCPB 번들
6. MCP Inspector 검증 + Claude Desktop 실사용 검증
