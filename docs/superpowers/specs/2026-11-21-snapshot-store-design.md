# 느린 데이터 수집기와 저장소 모드 설계 스펙 (하위 프로젝트 ②)

- 날짜: 2026-11-21
- 상태: 승인됨 (2026-11-21)
- 기반: v0.7.0 (main `a79ced3`, tool 23개, 카탈로그 52종)
- 앞선 문서: `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md`(하위 프로젝트 ①)
- 근거: 2026-11-21에 `SeoulApiClient`로 실제 API를 불러 잰 데이터셋별 행 수와 행 크기, `src/tools/`의 요청 경로와 범위, `src/data/catalog.ts`의 자리별 인자

## 1. 개요

하루 단위 이상으로 바뀌는 데이터를 미리 받아 S3에 스냅샷으로 저장하고, 워크숍 런타임이 서울 API보다 스냅샷을 먼저 읽게 한다. 스냅샷이 답한 요청은 서울 API 호출이 0회다. 참가자 수와 인자 조합 수가 늘어도 하루 쿼터를 쓰지 않는다.

### 1.1 지금 구조의 한계

모든 tool 호출은 `SeoulApiClient.fetchUnwrapped` 한 곳을 지난다. 지금은 L1 메모리 캐시, L2 DynamoDB 캐시, 서울 API 순서로 읽는 read-through 캐시다. 캐시 키가 요청 URL이라서 두 가지를 막지 못한다.

- 인자 조합마다 캐시 항목이 따로 생긴다. 약국명이나 행사 제목처럼 자유롭게 넣는 인자는 조합마다 서울 API를 한 번씩 부른다.
- L2는 380KB를 넘는 응답을 저장하지 않는다(`MAX_ITEM_BYTES`). 공공예약(최대 6.3MB)과 문화행사 500행(약 520KB 이상)은 컨테이너 사이에 공유되지 않아 세션마다 서울 API를 부른다.

### 1.2 목표

- 저장소가 답한 요청은 캐시, 키 풀, 쿼터 장부를 건드리지 않는다.
- 모든 키의 하루 한도가 바닥나도 저장소에 있는 데이터는 계속 답한다.
- 저장소가 답하지 못하는 요청은 지금 경로(캐시와 서울 API)로 그대로 넘어간다. 규칙이 모자라면 호출이 한 번 더 나갈 뿐이고 틀린 답은 나가지 않는다.
- tool 23개와 정규화 함수는 고치지 않는다. 저장소 응답은 지금의 `Unwrapped`(`rows`, `totalCount`, `note`) 형태를 그대로 쓴다.
- `STORE_URI`를 설정하지 않으면 동작이 지금과 같다. stdio 사용자와 기존 런타임 두 개는 영향을 받지 않는다.
- 수집은 로컬 명령 하나로 한다. 스케줄 실행은 선택 사항이고 기본값은 꺼짐이다.

### 1.3 비목표

- 실시간 데이터 적재(④). 카탈로그 12종: `citydata`, `citydata_ppltn`, `citydata_cmrcl`, `LIVE_DST_MESSAGE`, `bikeList`, `GetParkingInfo`, `RealtimeCityAir`, `realtimeStationArrival`, `AccInfo`, `TimeAverageAirQuality`, `AiRainfallService`, `ListRiverStageService`
- 부동산(③). `tbLnOpendataRtmsV`, `tbLnOpendataRentV`. 개별공시지가(`IndividuallyPostedLandPriceService`)는 필지 단위 조회라 대상에서 뺀다
- 생활인구에서 날짜를 지정하지 않은 요청. 전체가 약 63만 행이라 전체 건수를 정확히 맞출 수 없다. 지금 경로로 보낸다
- tool 추가나 tool 입력 스키마 변경
- npm 배포, mcpb 릴리스, ECR `latest`나 `X.Y.Z` 태그 이동
- 기존 리소스 변경: 런타임 `seoul_opendata_mcp`, `myseoul_mcp`, 테이블 `seoul-mcp-cache`

### 1.4 고른 방식

세 가지를 비교해 A를 골랐다.

| | A. S3 스냅샷과 서버 필터 | B. 기존 캐시 예열 | C. DynamoDB 행 단위 저장 |
|---|---|---|---|
| 자유 인자 | 서버가 직접 걸러서 답함 | 미리 나열한 조합만 적중 | 부분일치는 파티션 전체를 읽어야 함 |
| 큰 응답 | 제한 없음 | 380KB 넘으면 저장 못 함 | 행 단위라 해당 없음 |
| 수명 | 데이터셋별로 정함 | 24시간 뒤 사라짐 | 데이터셋별로 정함 |
| 수집 비용 | S3 객체 약 2,000개 | DynamoDB 쓰기 수천 건 | 쓰기 수십만 건 |

B는 나열한 조합만 막고 380KB 초과 응답을 그대로 둔다. C는 부분일치 필터 때문에 파티션을 통째로 읽게 되어 A보다 비싸다. A의 부담은 서울 API의 필터 규칙을 서버에 다시 적는 일이고, 이를 허용 목록 방식과 실제 API 대비 검사(7절)로 다룬다.

## 2. 구조

```
수집기 (로컬 명령, 선택적으로 스케줄 Lambda)
   └─ SeoulApiClient로 서울 API 호출 ─→ gzip JSON 스냅샷 ─→ S3 (워크숍 버킷의 store/v1/)

워크숍 런타임의 tool 호출
   └─ SeoulApiClient.fetchUnwrapped
        ├─ 저장소가 답할 수 있으면: 스냅샷을 읽고 인자 필터와 범위를 적용해 반환 (서울 API 호출 0)
        └─ 답할 수 없으면: 지금의 캐시와 서울 API 경로 그대로
```

### 2.1 스냅샷 종류

`call_dataset`은 항상 1행부터 최대 50행까지만 요청한다(`clampLimit`). 그래서 인자가 없는 카탈로그 전용 데이터셋은 전체가 81만 행이어도 첫 페이지와 전체 건수만 저장하면 가능한 모든 요청에 답할 수 있다.

| 종류 | 저장하는 것 | 답할 수 있는 요청 |
|---|---|---|
| 전체 | 모든 행 | 어떤 필터와 범위든 |
| 머리 | 첫 1,000행과 서울 API가 알려 준 전체 건수 | 필터 없이 저장된 행 범위 안 |
| 파티션 | 인자 값별로 나눈 스냅샷(각각 전체 또는 머리) | 그 인자 값의 스냅샷이 있는 요청 |

스냅샷이 전체인지 머리인지는 객체 안의 값으로 판단한다. 저장된 행 수가 전체 건수보다 적으면 머리다. 수집 도중 데이터가 바뀌어 행 수가 모자란 전체 스냅샷도 같은 규칙으로 머리가 된다.

### 2.2 대상 37종

행 수와 호출 수는 2026-11-21 기준이다.

| 묶음 | 종류 | 데이터셋 | 수집 호출 |
|---|---|---|---|
| 매일 | 전체 12종 | 약국(5,650행, 6회), 공영주차장 안내(2,244행, 3회), 문화행사(19,782행, 20회), 역 코드(799행, 1회), 공공예약 5종(각 1회), 키즈카페(1회), 모범업소(2회), 경로당(4회) | 42회 |
| 매일 | 머리 19종 | `SPOP_DAILYSUM_JACHI`, `TbPublicWifiInfo`, `TbGtnHwcwP`, `VwsmTrdarSelngQq`, `ListTraditionalMarket`, `ListNecessariesPricesService`, `culturalSpaceInfo`, `SearchParkInfoService`, `SeoulPublicLibraryInfo`, `TbHospitalInfo`, `ChildCareInfo`, `TbGtnCwP`, `tbClicomCnt`, `TvEmgcHospitalInfo`, `mgis1708328729039Point`, `SeoulMetroFaciInfo`, `goodPrices`, `mgisToiletPoi`, `LOCALDATA_020301` | 19회 |
| 매일 | 파티션 4종 | 일별 승하차(날짜, 1회), 시간대별 승하차(월, 1회), 생활인구(날짜, 11회), 버스 승하차(날짜, 머리 1회) | 약 25회(공개 전 날짜 확인 포함) |
| 정적 | 파티션 2종 | 첫차와 막차(호선, 방향, 요일: 54회), 시간표(역, 요일, 방향: 약 1,800회) | 약 1,850회 |

매일 묶음은 약 85회, 첫 실행은 날짜 파티션을 한꺼번에 받아 약 125회다. 수집기가 시작 전에 보여 주는 예상은 상한이라 각각 약 107회, 144회로 나온다(5.4). 정적 묶음은 시간표 개정 때만 바뀌므로 워크숍 당일이 아닌 날에 따로 돌린다.

나머지 15종(1.3의 실시간 12종과 부동산 3종)은 규칙이 없어 저장소를 그냥 지나간다.

### 2.3 모듈

새 디렉터리 `src/store/`에 둔다. 의존 방향은 `src/store`에서 `src/client`로만 향한다. `src/client`는 `src/store`를 import하지 않는다.

| 파일 | 역할 |
|---|---|
| `src/client/snapshotSource.ts` | 클라이언트가 아는 인터페이스 `SnapshotSource`와 `SnapshotHit` |
| `src/store/rules.ts` | 규칙 표 `STORE_RULES`: 서비스별 자리 규칙, 묶음, 기한, 예상 호출 수 |
| `src/store/engine.ts` | 순수 함수. 요청과 규칙으로 스냅샷 키와 필터를 정하고, 스냅샷에 필터와 범위를 적용한다 |
| `src/store/snapshot.ts` | 스냅샷 형식, gzip 직렬화, 객체 키 만들기, 접두사 상수 `store/v1` |
| `src/store/snapshotStore.ts` | 인터페이스 `SnapshotStore`와 디렉터리 구현 |
| `src/store/s3Store.ts` | S3 구현. `@aws-sdk/client-s3`를 lazy import한다 |
| `src/store/reader.ts` | `SnapshotSource` 구현. 메모리 보관, 재확인, 동시 읽기 합치기, 시간 제한 |
| `src/store/attach.ts` | `maybeAttachStore(client)` |
| `src/store/collector.ts` | 수집 계획, 실행, 증분, 쿼터 예산 |
| `src/store/verify.ts` | 실제 API 대비 검사 |
| `src/store/CLAUDE.md` | 모듈 규칙 |
| `scripts/workshop-collect.ts` | 명령줄 껍데기. 인자 해석, 스택 출력 읽기, 결과 출력 |

서버의 읽기 경로, 로컬 명령, 스케줄 Lambda가 같은 규칙 표와 같은 `SnapshotStore`를 쓴다.

## 3. 스냅샷 형식과 저장소 인터페이스

### 3.1 객체

키는 `store/v1/<서비스>/<파티션 키>.json.gz`다. 파티션이 없는 데이터셋의 파티션 키는 `_all`이고, 파티션이 있으면 파티션 자리의 값을 `_`로 잇는다.

```
store/v1/TbPharmacyOperateInfo/_all.json.gz
store/v1/CardSubwayStatsNew/20261116.json.gz
store/v1/SearchFirstAndLastTrainbyLineServiceNew/2호선_1_1.json.gz
store/v1/SearchSTNTimeTableByIDService/0222_1_1.json.gz
```

본문은 gzip으로 압축한 JSON이다.

```json
{ "v": 1, "service": "CardSubwayStatsNew", "partition": ["20261116"],
  "collectedAt": "2026-11-21T01:23:45.000Z", "totalCount": 616, "rows": [ ... ] }
```

`rows`는 서울 API가 준 원본 행을 순서 그대로 담는다. 정규화하지 않는다.

저장소 인터페이스(3.2)에 넘기는 키는 `STORE_URI` 아래의 상대 키(`<서비스>/<파티션 키>.json.gz`)다. S3 구현이 앞에 `store/v1/`을 붙인다.

목록 파일(manifest)은 두지 않는다. 서버는 필요한 키를 바로 읽고, 없으면 지금 경로로 넘긴다. 수집기와 서버가 맞춰야 할 것은 키 규칙 하나다.

### 3.2 `SnapshotStore`

```ts
interface SnapshotStore {
  get(key: string, opts?: { ifNoneMatch?: string }): Promise<
    { body: Buffer; etag?: string } | 'not-modified' | undefined>   // undefined는 없는 객체
  put(key: string, body: Buffer): Promise<void>
  list(prefix: string): Promise<Array<{ key: string; lastModified: number; size: number }>>
}
```

- S3 구현: 버킷과 접두사를 `STORE_URI`에서 얻는다. `get`은 `GetObject`(조건부 요청은 `IfNoneMatch`), `put`은 `PutObject`, `list`는 `ListObjectsV2`를 끝까지 넘겨 읽는다.
- 디렉터리 구현: 테스트와 로컬 개발용이다. 파일 수정 시각을 `lastModified`로, 내용 해시를 `etag`로 쓴다.

서버는 `get`만 쓰고, 수집기는 셋 다 쓴다.

## 4. 규칙과 요청 처리

### 4.1 자리 규칙

서울 API의 인자는 경로의 자리로 구분된다. 규칙 표는 서비스마다 자리 순서대로 행 필드 이름과 아래 넷 중 하나를 적는다.

| 규칙 | 뜻 |
|---|---|
| 일치 | 행의 그 필드가 인자 값과 같아야 한다. 둘 다 문자열로 바꾸고 앞뒤 공백을 자른 뒤 비교한다 |
| 부분일치 | 행의 그 필드가 인자 값을 포함해야 한다. 대소문자를 구분한다 |
| 파티션 | 이 인자 값으로 스냅샷 객체를 고른다. 자리마다 값 형식(정규식)을 함께 적는다 |
| 미지원 | 이 자리에 값이 오면 저장소가 답하지 않는다 |

값이 비어 있거나 공백뿐인 자리는 값이 없는 것으로 본다. tool은 건너뛰는 자리를 공백 한 칸(`BLANK`)으로 채워 보내기 때문이다.

다만 길이 0인 자리 뒤에 값이 있는 자리가 오면 저장소가 답하지 않는다. 서울 API는 빈 문자열 뒤의 필터를 모두 무시하는데(`src/tools/path.ts`), 저장소는 그 동작을 흉내 내지 않고 지금 경로로 넘긴다.

파티션 값은 참가자가 `call_dataset`으로 넣을 수 있는 문자열이고 객체 키와 파일 경로가 된다. 그래서 형식 검사를 통과한 값만 키에 넣고, 통과하지 못하면 답하지 않는다.

### 4.2 데이터셋별 규칙

자리 이름은 카탈로그의 `pathParams[i].name`이고, 확인한 데이터셋에서는 행 필드 이름과 같다. 문화행사만 카탈로그에 자리가 없어서(tool이 직접 `/{CODENAME}/{TITLE}/{DATE}`를 만든다) 규칙 표가 자리를 정의한다.

| 서비스 | 자리별 규칙 |
|---|---|
| `TbPharmacyOperateInfo` | `DUTYADDR` 부분일치, `DUTYNAME` 부분일치 |
| `GetParkInfo` | `ADDR` 부분일치, `PKLT_CD` 일치, `PRK_NOW_INFO_PVSN_YN` 미지원 |
| `culturalEventInfo` | `CODENAME` 검증으로 결정(미지원 유지), `TITLE` 미지원, `DATE` 미지원 |
| `SearchInfoBySubwayNameService` | `STATION_NM` 일치 |
| `ListPublicReservationCulture`, `ListPublicReservationSport`, `ListPublicReservationInstitution`, `ListPublicReservationMedical` | `MINCLASSNM` 부분일치 |
| `ListPublicReservationEducation` | `MINCLASSNM` 부분일치, `SVCNM` 부분일치, `USETGTINFO` 검증으로 결정(미지원 유지), `AREANM` 부분일치 |
| `tnFcltySttusInfo1011` | `FCLTY_NM` 부분일치 |
| `ListPriceModelStoreService` | `INDUTY_CODE_SE` 일치 |
| `OdsnBuildingInfo` | `SISUL_NM` 부분일치 |
| `CardSubwayStatsNew` | `USE_YMD` 파티션(`^\d{8}$`) |
| `CardBusStatisticsServiceNew` | `USE_YMD` 파티션(`^\d{8}$`), 머리만 저장 |
| `CardSubwayTime` | `USE_MM` 파티션(`^\d{6}$`), `SBWY_ROUT_LN_NM` 일치, `STTN` 일치 |
| `SPOP_LOCAL_RESD_DONG` | `STDR_DE_ID` 파티션(`^\d{8}$`), `TMZON_PD_SE` 일치, `ADSTRD_CODE_SE` 일치 |
| `SearchFirstAndLastTrainbyLineServiceNew` | `SBWY_ROUT_LN` 파티션(`^[1-9]호선$`), `UPLN_DNLN` 파티션(`^[12]$`), `DOW` 파티션(`^[123]$`), `SUBW_CD` 일치, `OTSD_CD` 일치 |
| `SearchSTNTimeTableByIDService` | `STATION_CD` 파티션(`^[0-9A-Za-z]{1,8}$`), `WEEK_TAG` 파티션(`^[123]$`), `INOUT_TAG` 파티션(`^[12]$`) |
| 머리 19종 | 자리 없음 |

"검증으로 결정"은 문서만으로 일치인지 부분일치인지 알 수 없는 자리다. 처음에는 미지원으로 두고, 7.2의 검사 결과로 일치나 부분일치를 정한다. 재현할 수 없으면 미지원으로 남긴다.

2026-11-22의 첫 검사 결과로 다음과 같이 정했다. `AREANM`과 `SISUL_NM`은 부분일치다. `CODENAME`은 건수로는 부분일치와 맞지만 결과가 1,000건을 넘고 행 순서가 달라 재현하지 못했다. `USETGTINFO`는 저장된 값을 그대로 보내도 서울 API가 0건을 돌려줘 재현하지 못했다. 두 자리는 미지원으로 남긴다. `PRK_NOW_INFO_PVSN_YN`과 문화행사의 `TITLE`은 미지원으로 바꿨다. 서울 API가 걸러진 결과의 행 순서를 전체 목록과 다르게 돌려주는데 결과가 요청 범위를 넘어서, 같은 범위에서 다른 행이 나오기 때문이다.

### 4.3 요청 하나를 처리하는 순서

입력은 `(service, start, end, path)`다.

1. 규칙이 없는 서비스면 답하지 않는다.
2. 값이 온 자리가 규칙의 자리 수를 넘거나, 값이 온 자리 중 미지원이 하나라도 있으면 답하지 않는다.
3. 파티션 자리가 비어 있거나 값이 형식에 맞지 않으면 답하지 않는다.
4. 해당 스냅샷이 없으면 답하지 않는다. 데이터셋별 기한(6.3)보다 오래됐으면 6.3의 예외가 아닌 한 답하지 않는다.
5. 머리 스냅샷인데 필터가 필요하거나 `end`가 저장된 행 수를 넘으면 답하지 않는다.
6. 필터를 적용하고 `rows.slice(start - 1, end)`로 자른다. `totalCount`는 필터가 있으면 걸러진 행 수, 없으면 스냅샷의 `totalCount`다.
7. 자른 결과가 0건이면 `note`에 서울 API와 같은 문구 `해당하는 데이터가 없습니다 (<서비스>)`만 넣는다.

"답하지 않는다"는 모두 지금의 캐시와 서울 API 경로로 넘어간다는 뜻이다.

7번의 문구는 여러 tool이 분기에 쓴다. `isNoData`는 빈 응답의 `note`가 이 문구로 시작하는지로 "조건에 맞는 행 없음"과 "쿼터 소진"을 구분하고, `get_subway_schedule`은 다른 문구가 붙은 빈 응답을 만나면 역명 후보 탐색을 멈춘다. 그래서 문구를 `src/client/response.ts`의 함수 하나로 만들고 `assertOk`와 저장소가 함께 쓴다.

## 5. 수집기

### 5.1 명령

```
npm run workshop:collect -- daily     # 매일 묶음: 전체와 머리 스냅샷, 새 날짜와 월 파티션
npm run workshop:collect -- static    # 첫차와 막차, 시간표 (약 1,850회, 워크숍 당일 아닌 날)
npm run workshop:collect -- status    # 데이터셋별 스냅샷 수, 수집 시각, 기한 내 여부
npm run workshop:collect -- verify    # 실제 API 대비 검사 (약 70회)
```

| 옵션 | 뜻 |
|---|---|
| `--env-file <경로>` | 키를 읽을 파일. 기본 `.env.workshop` |
| `--store <URI>` | 스냅샷을 둘 곳. 기본은 스택 버킷의 `s3://<버킷>/store/v1`. 디렉터리 경로를 주면 로컬에 저장한다(개발과 `verify`용) |
| `--only <서비스,...>` | 지정한 서비스만 |
| `--dry-run` | 계획(데이터셋별 예상 호출 수, 건너뛸 것, 남은 한도)만 출력 |
| `--days N` | 날짜 파티션 세 종(일별 승하차, 생활인구, 버스 승하차)의 개수를 N일로 바꿈 |
| `--force` | 예상 호출 수가 남은 한도를 넘어도 시작 |

버킷 이름과 테이블 이름은 스택 출력(`BucketName`, `TableName`)에서, 키 하나의 하루 한도는 스택 파라미터 `QuotaDailyLimit`에서 읽는다. 키 값은 출력하지 않고 `maskKey()`로만 표시한다.

### 5.2 수집 절차

수집기는 캐시(L2)와 저장소를 붙이지 않은 새 `SeoulApiClient`를 쓴다. 프로세스를 새로 띄우므로 L1도 비어 있어 항상 서울 API에서 받는다. 호출 사이에 200ms를 둔다.

- 전체: 1,000행씩 `totalCount`까지 받는다.
- 머리: 1행부터 1,000행까지 한 번만 받는다.
- 파티션: 파티션 값마다 위와 같이 받는다. 시간표의 역 목록은 저장소의 역 코드 스냅샷에서 1호선부터 9호선까지의 역을 읽어 만든다. 역 코드 스냅샷이 없으면 먼저 받는다.

스냅샷은 모든 페이지를 받은 뒤에만 쓴다. 중간에 실패하면 이전 스냅샷이 그대로 남는다.

### 5.3 증분

수집 전에 `list`로 이미 있는 객체와 수정 시각을 읽고 아래 기준으로 건너뛴다.

| 대상 | 건너뛰는 조건 |
|---|---|
| 날짜와 월 파티션 | 객체가 있으면 건너뜀. 지난 날짜의 통계는 바뀌지 않는다 |
| 매일 묶음의 전체와 머리 스냅샷 | 수집한 지 1시간 이내면 건너뜀. 도중에 끊긴 실행을 이어 받기 위한 값이다 |
| 정적 묶음 | 수집한 지 7일 이내면 건너뜀. `static`이 끊겨도 다시 실행하면 이어 받는다 |

날짜 파티션은 어제(KST)부터 거꾸로 가며 저장소에 없는 날짜를 요청한다. 공개된 날짜(이미 저장된 것 포함)가 아래 개수만큼 채워지거나, 개수에 10일을 더한 만큼 거슬러 올라가면 멈춘다. 월 파티션은 지난달부터 같은 방식으로 가고, 개수에 2개월을 더한 만큼 거슬러 올라가면 멈춘다.

| 데이터셋 | 기본 개수 |
|---|---|
| 일별 승하차 | 14일 |
| 생활인구 | 3일 |
| 버스 승하차 | 1일 |
| 시간대별 승하차 | 3개월(지난달부터 거꾸로) |

아직 공개되지 않은 날짜는 서울 API가 "데이터 없음"으로 답한다. 이 날짜는 저장하지 않아 다음 실행이 다시 시도한다.

### 5.4 쿼터 보호

- 시작할 때 데이터셋별 예상 호출 수와 키별 남은 한도를 보여 준다. 예상 합계가 남은 한도 합계를 넘으면 `--force` 없이는 시작하지 않는다. 예상 호출 수는 규칙 표에 적은 스냅샷당 호출 수(2.2의 수치)로 계산한 상한이다. 날짜와 월 파티션은 `max(1, 목표 개수 - 저장된 수) x 스냅샷당 호출 수 + 탐색 여유(10일 또는 2개월)`로 센다.
- 수집 호출도 워크숍 테이블의 쿼터 장부(`quota#<keyId>#<KST 날짜>`)에 기록한다. 런타임의 키 풀은 장부만 보고 키를 고르므로, 수집에 쓴 양을 알아야 다음 키로 넘어간다.
- 이를 위해 `src/client/dynamo.ts`에서 DynamoDB 연결을 만드는 부분을 함수로 떼어 낸다. `maybeAttachL2`는 캐시와 장부를 둘 다 붙이고, 수집기는 장부만 붙인다.
- 실제 호출 수가 예상 합계의 2배에 10회를 더한 값에 닿으면 실행을 끝낸다. 원천의 전체 건수가 규칙 표의 가정보다 크게 늘었을 때 쿼터를 다 쓰지 않게 하는 상한이다.

### 5.5 실패 처리

- 빈 응답인데 `isNoData`가 아니면(쿼터 소진, 호출 제한) 실패로 처리하고 실행을 끝낸다. 키 풀 전체를 쓸 수 없는 상태라서 남은 데이터셋도 같은 결과가 나온다.
- 한 데이터셋에서 `SeoulApiError`(시간 초과, 서버 오류 등)가 나면 그 데이터셋만 실패로 적고 다음으로 넘어간다.
- 받은 행 수가 `totalCount`보다 적으면 경고를 내고 그대로 저장한다. 2.1의 규칙에 따라 머리 스냅샷으로 취급되어 필터 요청은 지금 경로로 간다.
- 끝날 때 데이터셋별 결과(저장, 건너뜀, 실패, 경고)와 실제 호출 수를 표로 출력한다. 실패가 하나라도 있으면 종료 코드가 0이 아니다.

### 5.6 선택적 스케줄

스택 파라미터 `CollectSchedule`에 스케줄 식을 넣으면 EventBridge 스케줄이 Lambda를 불러 `daily`만 실행한다. 기본값은 빈 문자열이고 이때는 리소스를 만들지 않는다. `static`은 Lambda 제한 시간 15분을 넘으므로 로컬 명령으로만 돌린다.

Lambda의 진입점은 `infra/lambda/collect.ts`다. `src/store/`의 수집 로직과 함께 `esbuild`로 한 파일(`collect.mjs`)로 묶어 버킷의 `code/` 아래에 올린다. 인터셉터 zip을 올리는 방식과 같다. 실패한 실행은 다시 부르지 않는다(`AWS::Lambda::EventInvokeConfig`의 `MaximumRetryAttempts: 0`). 다음 스케줄 실행이 이어 받는다. 이 작업은 마지막 단계로 분리하고, 없어도 워크숍에 쓸 수 있게 한다.

## 6. 서버 읽기 경로

### 6.1 켜는 방법

환경변수 `STORE_URI` 하나로 켠다. 값은 `s3://<버킷>/store/v1` 또는 디렉터리 경로다. 두 진입점(`src/index.ts`, `src/http.ts`)이 `maybeAttachL2`를 부른 바로 다음에 `maybeAttachStore(client)`를 부른다. 변수가 없으면 아무것도 붙지 않고 S3 SDK도 불러오지 않는다. 연결에 실패하면 로그를 남기고 저장소 없이 계속 동작한다.

### 6.2 끼우는 자리

```ts
interface SnapshotHit { value: Unwrapped; collectedAt: number; expired: boolean }
interface SnapshotSource {
  lookup(service: string, start: number, end: number, path: string[],
         opts?: { allowExpired?: boolean }): Promise<SnapshotHit | undefined>
}
```

`SeoulApiClient`에 `attachStore(source)`를 추가하고, `fetchUnwrapped`를 아래 순서로 바꾼다.

```
fetchUnwrapped(base, type, service, start, end, path)
  1. 샘플 모드면 범위를 5행으로 줄임 (지금 그대로)
  2. 저장소 조회 ── 답하면 바로 반환. 캐시, 키 풀, 쿼터 장부를 건드리지 않음
  3. 캐시 조회, 키 선택 (지금 그대로)
  4. 쓸 키가 없고 캐시에도 없으면: 기한 지난 스냅샷이라도 있는지 한 번 더 조회 (6.3)
  5. 서울 API 호출 (지금 그대로)
```

- 2번은 일반 API의 JSON 요청(`getJson`)에서만 한다. 규칙이 있는 서비스는 모두 이 조합이다. 지하철 실시간 도착(`getSubway`)과 XML 서비스는 지나간다.
- 저장소 조회가 키 선택보다 앞이라서, 모든 키가 소진돼도 저장소에 있는 데이터는 답한다. 뒤에 두면 "쓸 키가 없음" 분기에서 먼저 빠져나가 빈 응답이 나간다.
- 샘플 모드의 5행 제한을 먼저 적용하므로 "샘플은 5행"이라는 동작이 유지된다.
- 저장소가 답한 요청에는 쿼터 80% 안내를 붙이지 않는다. 쿼터를 쓰지 않았기 때문이다.

### 6.3 기한

| 데이터 | 기한 | 이유 |
|---|---|---|
| 공공예약 5종 | 24시간 | 접수 상태가 하루 안에도 바뀜 |
| 문화행사, `SeoulMetroFaciInfo` | 3일 | 일정과 가동 상태가 며칠 단위로 바뀜 |
| 약국, 공영주차장 안내, 역 코드, 키즈카페, 모범업소, 경로당, 나머지 머리 18종 | 7일 | 거의 바뀌지 않음 |
| 첫차와 막차, 시간표 | 30일 | 시간표 개정 때만 바뀜 |
| 날짜와 월 파티션(승하차, 생활인구, 버스) | 없음 | 지난 날짜의 통계는 바뀌지 않음 |

기한은 스냅샷 본문의 `collectedAt`으로 판단한다. 기한이 지난 스냅샷은 쓰지 않고 지금 경로로 넘긴다.

예외가 하나 있다. 서울 API를 쓸 수 없는 상태(쿼터 소진, 호출 제한)이고 캐시에도 없으면 기한 지난 스냅샷으로 답한다(6.2의 4번). 지금 캐시가 쿼터 소진 때 오래된 값을 돌려주는 것과 같은 원칙이다.

### 6.4 응답 안내 문구

| 경우 | `note` |
|---|---|
| 저장소가 답했고 1건 이상 | `사전 적재 데이터(11월 21일 수집)` |
| 기한 지난 스냅샷으로 답했고 1건 이상, 쿼터 소진 | `일일 API 쿼터 소진. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다` |
| 기한 지난 스냅샷으로 답했고 1건 이상, 호출 제한 | `서울 API 호출 제한. 기한이 지난 사전 적재 데이터(11월 18일 수집, 약 3일 경과)로 응답합니다` |
| 0건(기한과 무관) | `해당하는 데이터가 없습니다 (<서비스>)`만 |

- tool 봉투의 `asOf`는 기본값으로 현재 시각을 쓴다. 문구가 없으면 이틀 전 데이터가 방금 받은 것처럼 보인다. tool은 지금도 `note`를 `notes`에 옮겨 싣기 때문에 tool 코드는 고치지 않는다.
- 수집 날짜는 KST 기준이고 날짜 단위로만 적는다. 한 tool이 스냅샷 여러 개를 읽어도 같은 문구는 하나로 합쳐진다.
- 0건에 다른 문구를 붙이지 않는 이유는 4.3에 적었다.

### 6.5 메모리와 갱신 (`reader.ts`)

- 읽은 스냅샷은 풀어서 파싱한 채로 프로세스 메모리에 둔다. 크기는 압축을 푼 JSON 바이트 수로 세고, 합계가 96MB를 넘으면 오래 안 쓴 것부터 버린다. 가장 큰 것이 문화행사 약 24MB, 공공예약 약 6MB이고 시간표는 파티션당 약 80KB다.
- 한 번 읽은 스냅샷은 10분 동안 그대로 쓴다. 그 뒤 첫 요청에서 ETag 조건부 요청으로 바뀌었는지만 확인한다. 워크숍 중에 다시 수집하면 10분 안에 반영된다.
- 없는 객체라는 결과와 읽기 오류는 5분 동안 기억한다. 오류는 로그를 남긴다.
- 같은 키를 동시에 여러 요청이 찾으면 읽기 한 번으로 합친다. `SeoulApiClient`의 `inflight` 맵과 같은 방식이다.
- 스냅샷을 읽을 때마다 한 줄을 남긴다: 키, 압축 크기와 푼 크기, 행 수, 걸린 시간, 힙 사용량. 요청 인자는 남기지 않는다.

### 6.6 장애 시 동작

S3 오류, 압축 해제나 파싱 실패, 형식 버전 불일치는 로그만 남기고 "답하지 않음"으로 처리한다. 읽기가 3초를 넘으면 그 요청은 지금 경로로 넘긴다. 읽기는 계속 진행해 끝나면 메모리에 둔다. `src/client/CLAUDE.md`의 기존 규칙(L2와 장부의 실패가 요청을 실패시키지 않는다)을 저장소에도 적용한다. 재확인이 3초를 넘거나 이미 진행 중이면 메모리에 가진 스냅샷으로 답한다. S3 연결에는 2초, 객체 읽기와 목록 조회에는 요청마다 10초의 시간 제한을 둬서 읽기가 반드시 끝나게 한다. 쓰기는 2분까지 기다린다.

## 7. 검증

### 7.1 단위 테스트 (CI)

모든 코드는 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다. 픽스처는 고치지 않고, 스냅샷 테스트 데이터는 기존 픽스처의 행을 그대로 가져다 만든다.

| 파일 | 내용 |
|---|---|
| `tests/store/rules.test.ts` | 규칙의 서비스가 모두 카탈로그에 있음. 자리 수와 필드 이름이 카탈로그의 `pathParams`와 같음(문화행사는 예외로 명시). 1.3의 15종에 규칙이 없음. 모든 규칙에 기한과 예상 호출 수가 있음 |
| `tests/store/engine.test.ts` | 일치와 부분일치, 공백 자리, 파티션 선택과 형식 검사(`..`, `/`가 든 값 거부), 미지원 자리, 자리 수 초과, 머리 스냅샷의 한계, 범위 자르기, 필터가 있을 때와 없을 때의 `totalCount`, 0건 문구, 기한 초과 표시 |
| `tests/store/snapshotStore.test.ts` | 디렉터리 구현의 왕복과 목록, 가짜 클라이언트로 S3 구현의 `get`(없음, 조건부 304), `put`, `list` 페이지 넘김 |
| `tests/store/reader.test.ts` | 메모리 상한에서 오래 안 쓴 것부터 버림, 10분 뒤 조건부 재확인, 없는 객체와 오류를 5분 기억, 동시 읽기 합치기, 오류와 손상된 본문과 3초 초과가 예외를 던지지 않음, 로그에 요청 인자가 없음 |
| `tests/seoulApi.test.ts` 추가분 | 저장소가 답하면 `fetch`와 쿼터 장부가 호출되지 않음. 답하지 않으면 지금 경로로 감. 키가 모두 소진돼도 저장소 데이터는 답함. 소진이고 캐시가 없을 때 기한 지난 스냅샷이 6.4의 문구와 함께 나감. 샘플 모드에서 5행. 저장소를 붙이지 않으면 기존 테스트가 그대로 통과 |
| `tests/store/parity.test.ts` | 같은 픽스처 행을 서울 API 응답으로 줬을 때와 스냅샷으로 줬을 때 `find_pharmacies`, `get_subway_schedule`, `search_public_reservations`의 출력이 안내 문구 말고는 같음 |
| `tests/store/collector.test.ts` | 예상 호출 수 계산, 끝 페이지까지 받기, 증분 건너뛰기 세 가지, 공개 전 날짜를 저장하지 않음, 실패 시 이전 스냅샷 보존, 쿼터 소진 응답을 실패로 처리, 예산 초과 시 시작하지 않음, 출력에 원문 키가 없음 |
| `tests/infra/workshopTemplate.test.ts` 추가분 | 8절의 권한, 환경변수, 수명 규칙, 스케줄 리소스의 조건 |

### 7.2 실제 API 대비 검사 (`verify`, 수동)

수집 직후 같은 요청을 저장소와 서울 API 양쪽에 보내 비교한다. 쿼터를 쓰므로 CI에 넣지 않는다. 이 저장소의 live 테스트가 `RUN_LIVE`로만 도는 것과 같은 원칙이다.

- 요청은 카탈로그의 예시 값에서 자동으로 만든다. 서비스마다 인자 없는 요청, 자리 하나씩 채운 요청, 전부 채운 요청이다. 문화행사는 규칙 표에 예시 값을 따로 적는다. 일치로 비교하는 자리(일치로 적은 자리와 "검증으로 결정" 자리)는 예시 값과 똑같은 값을 가진 행이, 부분일치로 적은 자리는 예시 값을 포함한 행이 스냅샷에 있어야 그 예시 값을 쓴다. 없으면 스냅샷에서 그 필드의 첫 값을 대신 쓴다. 전부 채운 요청의 값을 모두 가진 행이 없으면 한 행에서 값을 모은다. 필드가 모든 행에서 비어 있으면 서울 API를 부르지 않고 건너뜀으로 보고한다.
- 일치나 부분일치로 적은 자리도 값 전체와 앞부분, 두 값으로 시험한다. 일치로 적은 자리를 서울 API가 부분일치로 거르면 앞부분 요청에서 서울 API만 행을 돌려줘 실패로 드러난다.
- 필터가 있는 요청에서 양쪽이 모두 0건이면 스냅샷에 그 값을 포함한 행이 있을 때만 통과로 센다. 그런 행이 없으면 근거가 되지 않으므로 건너뜀으로 보고한다.
- 전체 건수가 다르거나 행 집합이 다르면 실패, 순서만 다르면 경고로 보고한다.
- "검증으로 결정" 자리는 일치와 부분일치 두 가정으로 각각 비교해 어느 쪽이 맞는지 보고한다. 예시 값 전체와 그 앞부분, 두 값으로 시험한다. 전체 값만으로는 두 가정이 같은 행을 고르기 때문이다. 결과를 보고 규칙 표를 고친다. 건너뛴 요청은 어느 가정의 근거로도 세지 않는다. 근거가 하나도 없으면 "근거 없음"으로 보고한다.
- 출력의 각 줄에는 보낸 값을 함께 적는다.
- 약 70회 호출이 든다. 규칙을 바꾸거나 처음 수집했을 때 돌린다.

## 8. 스택과 배포

### 8.1 템플릿 변경 (`infra/seoul-workshop.yaml`)

| 대상 | 변경 |
|---|---|
| `RuntimeRole` | `store/*` 객체의 `s3:GetObject`, 버킷의 `s3:ListBucket`(조건 `s3:prefix`가 `store/*`). 목록 권한은 없는 키를 읽을 때 403이 아니라 404를 받기 위한 것이다 |
| `WorkshopRuntime` 환경변수 | `STORE_URI`를 `s3://<버킷>/store/v1`로 설정 |
| `WorkshopBucket` | `store/` 접두사에 90일 만료 수명 규칙. `code/` 객체는 그대로 |
| 파라미터 | `CollectSchedule`(기본 `""`), `CollectCodeKey`(기본 `""`) |
| 조건 `HasSchedule` | 두 파라미터가 모두 비어 있지 않을 때 |
| 스케줄 리소스(조건 `HasSchedule`) | 수집 Lambda(Node.js 22, arm64, 1,024MB, 제한 시간 15분), 역할(`store/*` 읽기와 쓰기, 목록, 테이블 `GetItem`과 `UpdateItem`, 로그), 로그 그룹(보존 14일), 재시도 없는 호출 설정, EventBridge 스케줄(Asia/Seoul)과 호출 역할 |

90일은 서버가 쓰는 기한(최대 30일)보다 길어서 쓸 수 있는 스냅샷이 지워지지 않는다. 지워진 날짜 파티션이 기본 개수 범위 안에 있으면 다음 `daily`가 다시 받는다.

템플릿에 계정 ID, ARN 리터럴, 버킷 이름을 적지 않는 기존 규칙을 지킨다. 새 AWS 리소스 종류는 스케줄을 켤 때만 생긴다.

CloudFormation은 스택에 아직 없는 파라미터에 `UsePreviousValue`를 받지 않는다. 그래서 `stackParameters()`가 스택의 현재 파라미터 이름을 받아, 값을 주지 않았고 스택에도 없는 파라미터는 빼고 보낸다(템플릿 기본값 적용). `workshop:deploy`와 `workshop:code`가 함께 쓴다.

### 8.2 의존성과 이미지

- `@aws-sdk/client-s3`를 `dependencies`에 추가한다. DynamoDB SDK와 같은 방식으로, `STORE_URI`가 `s3://`로 시작할 때만 `s3Store.ts` 안에서 lazy import한다.
- `esbuild`를 `devDependencies`에 추가한다. 수집 Lambda를 묶을 때만 쓴다.
- 서버 코드가 바뀌므로 이미지를 새로 빌드한다. 태그는 배포 스크립트 규칙대로 `0.8.0-workshop-<커밋 7자>`가 되도록, 배포 전에 버전을 `0.8.0`으로 올린다.
- 스택 변경과 ECR 푸시는 사용자 승인 뒤에만 한다.

### 8.3 배포 후 검증 순서

판정은 쿼터 장부의 `used` 값으로 한다. 장부는 서울 API를 실제로 부른 횟수라서 "호출 0"을 직접 잰다.

1. `daily --dry-run`으로 계획을 보고, 실제 수집한 뒤 `status`로 확인한다.
2. `verify`를 돌려 "검증으로 결정" 자리를 확정한다.
3. 스택을 갱신한다.
4. Gateway로 `find_pharmacies`를 서로 다른 약국명으로 두 번 부른다. 장부의 `used`가 그대로이고 응답에 사전 적재 문구가 있어야 한다.
5. `search_public_reservations`(지금은 380KB 초과로 공유되지 않는 응답)를 부르고 장부가 그대로인지 본다.
6. 저장소에 없는 날짜로 `get_subway_ridership`을 부른다. 장부가 1 늘고 문구가 없어야 한다. 런타임 로그에 `AccessDenied`가 없는지도 본다(9.1).
7. 런타임 로그에서 문화행사 스냅샷을 읽은 줄의 걸린 시간과 힙 사용량을 확인한다.
8. 다른 날 `static`을 수집한 뒤 `get_subway_schedule`을 시간표 포함으로 부르고 장부가 그대로인지 본다.

## 9. 미확인 사항과 리스크

### 9.1 미확인 사항

| 항목 | 확인 방법 | 결과에 따른 조치 |
|---|---|---|
| AgentCore Runtime 컨테이너의 메모리 한도 | 검증 7단계의 힙 사용량 | 여유가 없으면 96MB 상한을 낮추고 문화행사를 페이지 단위 객체로 쪼갠다 |
| 접두사 조건이 붙은 `s3:ListBucket`으로도 없는 키에 404가 오는지 | 검증 6단계의 런타임 로그 | 403이 오면 조건을 빼고 버킷 전체 목록 권한을 준다. 버킷에는 `code/`와 `store/`만 있다 |
| "검증으로 결정" 자리 네 개의 의미 | `verify` | 확인함(2026-11-22): `AREANM`과 `SISUL_NM`은 부분일치로 정했다. `CODENAME`과 `USETGTINFO`는 재현하지 못해 미지원으로 남겼다(4.2) |
| 필터를 건 요청과 걸지 않은 요청의 행 순서가 같은지 | `verify`의 순서 경고 | 확인함(2026-11-22): 서울 API는 걸러진 결과에서 정렬 키가 같은 행의 순서를 전체 목록과 다르게 돌려준다(콘서트 1,392건에서 최대 5칸, 주차장 주소 153건에서 최대 34칸, 실시간 제공 여부 1,480건에서 최대 73칸). 결과가 요청 범위를 넘는 `PRK_NOW_INFO_PVSN_YN`과 문화행사 `TITLE`은 미지원으로 바꿨다. `GetParkInfo`의 `ADDR`은 tool이 1,000행을 요청하고 결과가 그 안에 들어와 그대로 둔다 |
| 세션 첫 호출에서 문화행사 스냅샷(약 4MB 압축)을 읽는 시간 | 검증 7단계 | 3초에 가까우면 페이지 단위 객체로 쪼갠다 |
| EventBridge 스케줄과 Lambda 묶음의 템플릿 속성 | 구현 계획에서 공식 문서로 확인 | 확인함(2026-11-21): `AWS::Scheduler::Schedule`은 `ScheduleExpression`, `FlexibleTimeWindow`, `Target`(`Arn`, `RoleArn`)이 필수다. 묶음은 `esbuild`로 만들고 테스트가 `handler`를 불러 본다 |

### 9.2 리스크

| 리스크 | 대응 |
|---|---|
| 서울 API의 필터 의미를 잘못 재현 | 허용 목록 방식, `verify`, tool 쪽의 중복 필터(`find_pharmacies` 등) |
| 참가자가 오래된 데이터를 최신으로 오해 | 수집 날짜 문구, 데이터별 기한 |
| 수집이 워크숍 당일 쿼터를 씀 | `daily`는 약 85회로 키 3개 한도(3,000회)의 3% 미만. `static`은 다른 날 실행. 시작 전 예산 확인 |
| 파티션 값으로 엉뚱한 키나 경로를 읽게 됨 | 자리별 형식 검사를 통과한 값만 키에 넣음 |
| `@aws-sdk/client-s3`가 npm 설치 크기와 mcpb 크기를 키움 | lazy import로 실행 비용은 없음. 빌드 뒤 크기를 재서 CHANGELOG에 적고, 지나치면 `optionalDependencies`로 옮긴다 |
| 수집을 잊어 스냅샷이 기한을 넘김 | 지금 경로로 넘어가 동작은 유지된다. `status`가 기한 초과를 보여 주고, 워크숍 안내의 전날 절차에 `daily`를 넣는다 |

## 10. 문서 갱신

| 문서 | 내용 |
|---|---|
| `src/store/CLAUDE.md` | 새로 만듦. 모듈 역할, 허용 목록 원칙, 0건 문구 규칙, 실패가 요청을 실패시키지 않는다는 규칙 |
| `src/client/CLAUDE.md` | 저장소 조회 순서, `@aws-sdk/*` import 규칙에 `src/store/s3Store.ts` 추가 |
| `docs/reference/api.md` | 클라이언트 계약: 저장소 우선 조회, 안내 문구 |
| `docs/reference/agent-llm.md` | 사전 적재 안내 문구 |
| `docs/reference/security.md` | 수집기의 키 처리, 파티션 값 형식 검사 |
| `docs/reference/infrastructure.md`, `docs/reference/iac.md`, `infra/CLAUDE.md` | 버킷의 `store/`, 런타임 권한과 환경변수, 선택적 스케줄 |
| `scripts/CLAUDE.md`, `docs/workshop.md` | `workshop:collect` 명령, 진행자의 전날 절차에 수집 추가 |
| `docs/decisions/ADR-007-*.md`, `docs/architecture.md` | S3 스냅샷과 서버 필터를 고른 결정, 구성요소와 다이어그램 |
| `docs/images/`, `docs/images/src/arch_ko.py`, `arch_en.py` | README 인포그래픽 다시 만듦 |
| `README.md`, `README.ko.md` | 환경변수 표에 `STORE_URI`, 구조 절 |
| `CHANGELOG.md`, `package.json`, `manifest.json` | 0.8.0 |

## 11. 비용 추정

스냅샷 전체는 압축해서 50MB 안팎으로 추정한다(시간표 약 1,800개가 대부분). S3 보관료, 수집 때의 쓰기 약 2,000건, 런타임의 읽기를 합쳐 한 달 0.1달러 미만이다. 스케줄을 켜면 Lambda 실행이 하루 한 번 몇 분 더해진다. 시간당 고정 요금이 붙는 리소스는 없다.

## 12. 작업 순서

1. 규칙 표와 규칙 엔진(4절, 7.1)
2. 저장소 계층: 스냅샷 형식, 디렉터리와 S3 구현, `reader.ts`(3절, 6.5, 6.6)
3. 클라이언트 연결과 두 진입점(6.1~6.4)
4. 수집기와 `workshop:collect`의 `daily`, `static`, `status`(5.1~5.5)
5. `verify`와 실제 API로 규칙 확정(7.2). 실제 API를 부르므로 사용자 승인 뒤에 돌린다
6. 템플릿과 배포 스크립트 변경, 버전 0.8.0. 승인 뒤 배포와 검증(8절)
7. 선택적 스케줄 Lambda(5.6)
8. 문서(10절)

6번까지 끝나면 워크숍에 쓸 수 있고, 7번은 빠져도 된다.
