# Seoul-OpenData-MCP v2 설계 스펙 — 하이브리드 확장

- 날짜: 2026-08-16
- 상태: 승인된 설계 (채팅 승인) → 구현 계획 대기
- 기반: v1 스펙(2026-08-14) + main `8d9f9c8` (tool 11개, 테스트 78개)

## 1. 개요

v1의 11개 정규화 tool에 더해, 서울 열린데이터광장 인기 데이터셋 20개를 하이브리드로 추가한다:
- **승격 tool 5개**: 고빈도 질문 대상 — v1과 동일한 정규화 품질
- **메타 tool 3개** + **카탈로그 28개 인덱스**: 롱테일 커버 — "검색 → 명세 → 호출" 패턴

tool 수는 11 → **19개**로 억제하면서 데이터셋 커버리지는 8 → **28개**.

### 비목표
- 카탈로그 밖 임의 서비스 호출 (call_dataset은 카탈로그 등재 id만 허용 — 봉투 예측 불가·품질 보장 불가)
- 제외 3종: CCTV(safeOpenCCTV)·공중화장실(SearchPublicToiletPOIService)·전기차충전소(tbEvCharger) — 2026-08-16 샘플 검증에서 **서버측 ERROR-500** 지속. 카탈로그 등재 시 사용자 경험 훼손. 복구 확인 후 v2.x에서 재검토
- 승격 tool의 실시간성 보장 — 승하차/생활인구/실거래가는 배치성 데이터(수일 지연 가능)를 그대로 노출하고 note로 고지

## 2. 신규 데이터 소스 (2026-08-16 샘플 키 실검증 완료)

### 승격 tool 대상 (5)

| 서비스명 | 내용 | 검증 | 비고 |
|---|---|---|---|
| `CardSubwayStatsNew` | 지하철 일별 역별 승하차 인원 | ✓ (경로에 날짜 필수: `/{USE_YMD}`) | 618행/일, GTON_TNOPE/GTOFF_TNOPE |
| `SPOP_LOCAL_RESD_DONG` | 생활인구(행정동, 내국인) | ✓ | 대용량(일 1만행+) — limit 필수 |
| `tbLnOpendataRtmsV` | 부동산 실거래가 | ✓ | RCPT_YR/CGG_NM/STDG_NM… |
| `TbPharmacyOperateInfo` | 약국 운영정보 | ✓ | HPID/DUTYNAME/DUTYTEL1/요일별 시간 |
| citydata `LIVE_DST_MESSAGE` | 긴급재난문자 | (기존 citydata 응답 내 블록) | 추가 API 호출 없음 — 파서만 |

### 카탈로그 등재 (15)

| 카테고리 | 서비스명 | 검증 비고 |
|---|---|---|
| 교통·이동 | `CardBusStatisticsServiceNew` | ✓ 경로에 날짜 필수 |
| 교통·이동 | `AccInfo` (실시간 돌발상황) | ✓ **XML 전용** — call_dataset이 자동으로 getXml 사용 |
| 생활·인구 | `SPOP_DAILYSUM_JACHI` (주민등록인구 구별) | ✓ |
| 생활·인구 | `TbPublicWifiInfo` (공공와이파이) | ✓ |
| 생활·인구 | `TbGtnHwcwP` (무더위쉼터) | ✓ |
| 부동산·경제 | `tbLnOpendataRentV` (전월세가) | ✓ |
| 부동산·경제 | `VwsmTrdarSelngQq` (골목상권 추정매출) | ✓ |
| 부동산·경제 | `ListTraditionalMarket` (전통시장) | ✓ |
| 부동산·경제 | `ListNecessariesPricesService` (생필품 물가) | ✓ |
| 문화·여가 | `culturalSpaceInfo` (문화공간) | ✓ |
| 문화·여가 | `SearchParkInfoService` (도시공원) | ✓ |
| 문화·여가 | `SeoulPublicLibraryInfo` (공공도서관) | ✓ |
| 보건·복지 | `TbHospitalInfo` (병원) | ✓ |
| 보건·복지 | `ChildCareInfo` (어린이집) | ✓ |
| 안전·환경 | `TimeAverageAirQuality` (시간평균 대기질) | ✓ 경로에 측정시각(YYYYMMDDHH00) 필수 |

카테고리 6종: `교통·이동` `생활·인구` `부동산·경제` `문화·여가` `보건·복지` `안전·환경` (기존 8개 데이터셋도 이 체계로 재분류해 카탈로그에 포함)

## 3. 신규 구조

```
src/data/catalog.ts        # DatasetEntry 28개 (기존 8 + 신규 20)
src/tools/meta.ts          # search_dataset / get_dataset_spec / call_dataset
src/tools/stats.ts         # get_subway_ridership / get_living_population / get_real_estate_prices
src/normalize/stats.ts     # 위 3종 정규화
(find_pharmacies → tools/health.ts + normalize/health.ts)
(get_disaster_alerts → tools/common.ts + normalize/citydata.ts에 extractDisasterAlerts 추가)
```

### catalog.ts 스키마

```ts
export interface DatasetParam { name: string; required: boolean; example: string; description: string }
export interface DatasetEntry {
  id: string                 // 서비스명 (API 경로 세그먼트)
  name: string               // 한국어 표시명
  category: '교통·이동' | '생활·인구' | '부동산·경제' | '문화·여가' | '보건·복지' | '안전·환경'
  description: string        // 검색 매칭 대상 (동의어 포함)
  responseType: 'json' | 'xml'
  pathParams: DatasetParam[] // 경로 파라미터 (순서 = API 경로 순서)
  sampleFields: string[]     // 응답 필드 예시 (픽스처에서 추출)
  tool?: string              // 정식 tool이 있으면 그 이름 — search가 안내
  callable: boolean          // call_dataset 허용 여부 — 파생 항목(예: 재난문자=citydata 블록)은 false로 tool 안내만
}
```

id 유일성: 재난문자는 API가 아니라 citydata 응답 블록이므로 id `LIVE_DST_MESSAGE`, `callable: false`, `tool: 'get_disaster_alerts'`로 등재한다(검색은 되지만 call_dataset은 거부하고 tool 안내). 따라서 카탈로그 entry 28개 = API 27종 + 파생 1종, id 중복 없음.

```ts
```

### 메타 tool 3개

| tool | 입력 | 동작 |
|---|---|---|
| `search_dataset` | `query` | name/description/category 부분일치+2그램으로 상위 5개. 정식 tool이 있는 항목은 "→ ○○ tool 사용" 안내 |
| `get_dataset_spec` | `id` | 해당 entry의 pathParams/sampleFields/responseType/호출 예시 반환. 미등재 id → 후보 제안 |
| `call_dataset` | `id`, `params?: string[]`, `limit?` | **카탈로그 등재 id만** 허용. required pathParams 누락 시 명세와 함께 정상 응답으로 안내. responseType에 따라 getJson/getXml. 원본 rows 그대로 + note "비정규화 원본 필드입니다". limit 기본 10, 최대 50 |

### 승격 tool 5개

| tool | 입력 | 출력(정규화) | 소스 |
|---|---|---|---|
| `get_subway_ridership` | `date`(YYYYMMDD 필수), `station?`, `line?`, `limit?` | {date, line, station, boardings, alightings} | CardSubwayStatsNew/{date}, 역/호선은 클라이언트 필터. note: "보통 2~4일 전 데이터까지 제공" |
| `get_living_population` | `date?`, `dongCode?`, `limit?`(기본 20) | {date, timeSlot, dongCode, total, …성연령 필드는 픽스처 기준} | SPOP_LOCAL_RESD_DONG — 경로 파라미터 순서는 픽스처 캡처로 확정 |
| `get_real_estate_prices` | `district?`, `dong?`, `year?`, `limit?`(기본 10) | {year, district, dong, price, area, floor, contractDate, use} — 필드명은 픽스처 기준 | tbLnOpendataRtmsV, 클라이언트 필터 |
| `find_pharmacies` | `district?`, `name?`, `limit?`(기본 10) | {name, address, tel, hours(요일 요약)} | TbPharmacyOperateInfo, 클라이언트 필터 |
| `get_disaster_alerts` | `place` | {alerts: [{message, sentAt, category}], count} — 필드명은 픽스처/매뉴얼 기준, 없으면 빈 배열+note | citydata LIVE_DST_MESSAGE (기존 getXml 재사용) |

공통: v1 규칙 전부 승계 — ok() 봉투, SeoulApiClient 경유, resolvePlace(place 받는 tool), 영어 ≤2문장+한국어 설명, 픽스처 불변, 매핑 동등성 테스트.

## 4. 테스트

- 신규 픽스처 캡처: scripts/capture-fixtures.ts 확장 (승격 4종 + 카탈로그 대표 2종. 검증된 파라미터 포함: 승하차 `20260801`, 대기질 `202608151100`)
- 카탈로그 무결성 테스트: 28개, id 유일, 카테고리 6종 한정, required 파라미터 example 존재, tool 필드가 실제 TOOL_NAMES와 일치
- 메타 tool 가드 테스트: 미등재 id 거부, required 누락 안내, XML 자동 경로
- 매핑 동등성: 승격 tool 정규화 전부
- RUN_LIVE 확장: 승하차 1건 + call_dataset 1건 추가
- tools/list 스모크: TOOL_NAMES 19개

## 5. 리스크

| 리스크 | 대응 |
|---|---|
| 배치 데이터 지연(승하차 2~4일, 생활인구 ~5일) | note 고지 + INFO-200을 빈 결과+안내로 |
| 생활인구·버스 대용량 | limit 기본값 보수적, fetchAll 상한 |
| call_dataset 응답 비대 | limit max 50, 원본 필드 그대로라 행당 크기 큼 — note로 필드 명세 참조 유도 |
| 경로 파라미터 순서 오류 | 픽스처 캡처 = 검증. 캡처 실패 시 해당 항목 카탈로그 보류 |
| 샘플 키 5건 클램프 | v1 클라이언트가 이미 처리 — 승격 tool도 자동 적용 |

## 6. 마일스톤

1. 픽스처 캡처 확장 + catalog.ts(28개) + 무결성 테스트
2. 메타 tool 3개 (tools/meta.ts) + 가드 테스트
3. 승격 tool: get_subway_ridership + get_living_population + get_real_estate_prices (stats)
4. 승격 tool: find_pharmacies + get_disaster_alerts
5. index.ts 조립(TOOL_NAMES 19) + README 한/영 갱신(카테고리 표) + manifest 버전 0.2.0
6. 라이브 전수 스위프(19개 tool) + 최종 리뷰
