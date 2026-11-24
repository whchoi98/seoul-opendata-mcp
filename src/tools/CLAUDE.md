# Tools Module

## Role
MCP tool 23개를 등록합니다. 도메인 register 파일 6개(`common`, `population`, `traffic`, `culture`, `environment`, `realestate`) + `meta`/`stats`/`health` 3개, 총 9개 파일에서 `registerXTools(server, ctx)` 함수로 나뉘어 있습니다.

## Key Files
- `context.ts` - `Ctx = { client: SeoulApiClient }` 공유 컨텍스트 타입.
- `envelope.ts` - `ok(data, opts)`/`fail(message)`. 모든 tool 응답의 표준 봉투.
- `resolve.ts` - `resolvePlace()`: 자유 텍스트 장소명을 핫스팟으로 해석, 실패 시 조기 반환.
- `common.ts`/`population.ts`/`traffic.ts`/`culture.ts`/`environment.ts` - 도메인별 `registerXTools`.
- `realestate.ts` - `get_real_estate_prices`(매매, 전월세)와 `get_land_price`(개별공시지가). 서비스별 경로 자리 표 `SLOTS`, `buildPath()`, 법정동 코드 조회 `lookupDongCode()`.
- `meta.ts`/`stats.ts`/`health.ts` - 카탈로그 검색/호출, 배치 통계, 약국 tool.
- `kst.ts` - KST 기준 날짜와 시각: `kstYear()`, `kstHHMM()`, `serviceDayType()`(지하철 운행일 요일, 새벽 4시 전은 전날), `kstMonthsAgo()`, `kstDaysAgo()`(오늘에서 'YYYYMMDD'까지 지난 날 수).
- `path.ts` - 경로 자리 공용 도구: `BLANK`(공백 자리), `positionalPath()`(중간 빈 자리는 공백, 끝쪽 빈 자리는 생략).

## Rules — 신규 tool 추가 절차 (5단계)
1. `src/index.ts`의 `TOOL_NAMES`에 tool 이름을 추가합니다.
2. 필요하면 `src/normalize/*.ts`에 정규화 함수를 추가/확장하고 매핑 동등성 테스트를 작성합니다.
3. 해당(또는 신규) register 파일에서 `server.registerTool(...)`을 작성합니다. `description`은 영어(2문장 이하) 다음 한국어 순서로 쓰고, 반환은 `ok(data, { source, asOf?, notes?, sample: ctx.client.isSample })`을 사용합니다.
4. `src/index.ts`의 `buildServer()`에 `registerXTools(server, ctx)`를 연결하고, `scripts/live-sweep.ts`에 호출 예시를 추가합니다.
5. `docs/api-reference.md`와 `README.md`(영문·한국어 통합 문서)의 두 절에 있는 tool 표를 갱신합니다. `README.ko.md`는 `README.md`로 안내만 하는 파일이라 고치지 않습니다.

## Gotcha
- swopenapi(지하철)는 0-based start — `meta.ts`의 `startFor()`를 사용하고, 직접 하드코딩하지 않습니다.
- 열린데이터광장 경로 파라미터는 자리로 구분됩니다. 건너뛰는 자리에는 공백 `' '`을 넣습니다. 빈 문자열을 넣으면 그 뒤 필터가 모두 무시됩니다. 매매(`tbLnOpendataRtmsV`)와 전월세(`tbLnOpendataRentV`)는 뒤쪽 자리 순서가 다르므로 `realestate.ts`의 `SLOTS`를 고쳐 씁니다.
- 실거래가의 자치구는 전체 이름(`강남구`)만, 법정동은 코드(`STDG_CD`)만 서버에서 걸러집니다. 입력은 `normalizeDistrict()`와 `lookupDongCode()`로 바꿔 보냅니다. `lookupDongCode()`는 개별공시지가를 6월부터는 올해, 그 전에는 작년 기준연도로 먼저 조회하고 없으면 다른 연도를 봅니다. 사전 적재 저장소가 받아 둔 연도(올해)와 맞추기 위한 순서입니다.
- 부동산 3종은 연도와 자치구가 모두 있는 요청만 사전 적재 저장소가 답합니다(`src/store/rules.ts`). `year`를 생략한 요청은 서울 API로 갑니다.
- 생활인구(`SPOP_LOCAL_RESD_DONG`: 날짜, 시간대, 행정동)와 약국(`TbPharmacyOperateInfo`: 주소, 약국명 부분일치)도 경로 자리 필터를 받습니다. 단순 순서 배열은 `positionalPath()`를 씁니다.
- 클라이언트 응답의 `u.note`(쿼터, stale 안내)는 성공 경로에서도 `notes`에 넣습니다. `u.rows`가 비었으면 빈 결과를 "없음"으로 단정하는 안내를 붙이지 않습니다(`tests/notes.test.ts`).
- 지하철 첫차·막차와 시간표 서비스는 1~9호선만 데이터를 줍니다(경의선, 공항철도 등은 `INFO-200`). `get_subway_schedule`은 그 밖의 노선을 호출하지 않고 `notes`로 알립니다. 역명 표기가 데이터셋마다 달라(`서울역`, `강남`) `stationNameCandidates()`로 "역"을 붙이거나 떼서 다시 찾습니다.
- `GetParkInfo`는 같은 주차장이 여러 행으로 옵니다(1,000행에 고유 코드 약 200개). `uniqueByCode()`로 중복을 없애고, 실시간 주차장(`GetParkingInfo`)과 코드 체계가 같아 코드로 겹침을 뺍니다.
- 공공서비스예약은 종합 서비스(`tvYeyakCOllect`) 대신 분야별 서비스 5개를 씁니다. 종합 서비스는 상세 HTML 때문에 1,000행이 약 5MB입니다.
- 빈 결과를 "없음"으로 안내할지는 `isNoData(u)`(`client/response.ts`)로 판단합니다.
- `get_air_quality`의 `grade`는 통합대기환경지수 등급입니다. 미세먼지 등급은 `pm10Grade`, `pm25Grade`이고, 장소 단위 미세먼지는 `get_weather`가 줍니다(citydata의 `PM10_INDEX`, `PM25_INDEX`). LLM이 이름만 보고 tool을 고르므로 설명에 갈 곳을 적어 둡니다.
- 일별 승하차(`CardSubwayStatsNew`)는 약 9개월 전부터 3일 전까지만 있습니다(2026-11-24 확인). 빈 날짜의 안내는 `stats.ts`의 `emptyDateNote()`가 날짜가 최근인지 오래됐는지에 따라 고르고, 응답 행이 있는데 걸러서 비었으면 조건을 안내합니다.
- 서버가 못 거르는 조건(`rentType`, district 없는 `dong`, 해제 거래 제외)을 코드에서 거를 때는 그 범위를 `notes`에 적습니다.
