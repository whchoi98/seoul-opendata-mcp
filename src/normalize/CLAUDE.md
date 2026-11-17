# Normalize Module

## Role
`client/response.ts`의 `unwrap()`이 벗겨낸 원본 행(raw row, 한글/약어 필드명)을 tool이 반환할 도메인 형태로 매핑합니다. 도메인마다 파일이 분리되어 있고, 네트워크 호출은 하지 않습니다(순수 함수).

## Key Files
- `util.ts` - 공용 헬퍼: `toArray()`, `num()`(숫자 강제 변환, 실패 시 `null`), `decodeEntities()`(HTML 엔티티 일부 해제), `KEY_GUIDE`.
- `citydata.ts` - 가장 큰 파일. `extractSnapshot`, `extractDisasterAlerts`, `extractRoadTraffic`, `extractWeather` (citydata 통합 봉투 분해).
- `population.ts`, `commercial.ts`, `subway.ts`, `bike.ts`, `parking.ts`, `air.ts`, `culture.ts`, `stats.ts`, `health.ts` - 도메인별 정규화 함수. `parking.ts`에는 공영주차장 안내(`normalizeParkInfo`, `uniqueByCode`), `stats.ts`에는 시간대별 승하차(`normalizeSubwayHourly`, `HOUR_ORDER`)도 있습니다.
- `subwaySchedule.ts` - 지하철 역 검색, 첫차·막차, 역별 시간표(`normalizeSubwayStations`, `normalizeFirstLast`, `normalizeTimetable`), 시각 변환 `formatHms`(24시 이후는 `nextDay`), 역명 후보 `stationNameCandidates`, 호선 표기 `lineLabel`/`lineInput`.
- `reservation.ts` - 공공서비스예약 `normalizeReservations`. 상세 HTML(`DTLCONT`)은 버립니다.
- `realestate.ts` - `normalizeRealEstate`(매매), `normalizeRentDeal`(전월세), `normalizeLandPrice`(개별공시지가), `normalizeDistrict`(자치구 전체 이름, 25개 목록 `SEOUL_DISTRICTS`), `formatLot`(지번 표기).

## Rules
- 모든 `normalize*`/`extract*` 함수는 출력 필드를 원본 행 필드까지 1:1로 추적하는 매핑 동등성 테스트를 가져야 합니다(`tests/subway.test.ts` 참조).
- 숫자/배열 변환은 `util.ts`의 `num()`/`toArray()`를 사용합니다. 임시 파싱 로직을 인라인으로 만들지 않습니다.
- 필드가 없거나 알 수 없는 값이면 예외를 던지지 않고 `null` 또는 `''`로 완화합니다(`subway.ts`의 `secondsToArrival` 참조).
- 신규 도메인은 기존 파일에 덧붙이지 않고 새 파일로 분리합니다.
