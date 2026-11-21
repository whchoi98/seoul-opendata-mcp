# ADR-007: S3 스냅샷과 서버 필터로 느린 데이터에 답하기 (Snapshot Store with Server-Side Filters)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>
# English

## Status
Accepted (2026-11-21)

## Context
The cache is read-through and keyed by the request URL. Two kinds of request therefore still reach the Seoul API in every session: requests with free-text arguments (a pharmacy name, an event title), because every argument combination is its own cache entry, and responses larger than 380 KB (public reservations, cultural events), because the DynamoDB tier does not store them. With a workshop of many participants these spend the daily quota even though the data changes once a day or less.

## Options Considered

### Option A (chosen): Snapshots in S3 and filtering in the server
- **Pros**: Free-text arguments are filtered by the server, so any combination is answered. No size limit. A maximum age per dataset. About 2,000 objects.
- **Cons**: The filter behavior of the Seoul API has to be written again in the server.

### Option B: Warm the existing cache
- **Pros**: No new read path.
- **Cons**: Only the listed argument combinations hit. Responses over 380 KB are still not shared. Entries expire after 24 hours.

### Option C: Store rows in DynamoDB
- **Pros**: A maximum age per dataset, no item size problem.
- **Cons**: A contains filter has to read a whole partition, and collection writes hundreds of thousands of items.

## Decision
Slow-changing datasets (37 of the 52 in the catalog) are collected ahead of time into gzip JSON snapshots under `store/v1/` in the workshop bucket. `SeoulApiClient.fetchUnwrapped` asks the store after the sample clamp and before the cache and the key pool, so a request the store answers makes no upstream call and stored data keeps answering when every key is exhausted.

The store answers only what an allowlist permits (`src/store/rules.ts`): a service with a rule, positions marked equal or contains, and partition values that pass a format check. A request with a zero-length position before a value is not answered from the store, because the live API ignores every filter after an empty string. Everything else falls through to the existing path, so a missing rule costs one extra call and never a wrong answer. `npm run workshop:collect -- verify` compares the store with the live API and decides the positions whose meaning the documentation does not state.

The feature is off unless `STORE_URI` is set. Collection is a local command; a scheduled Lambda is optional and off by default.

## Consequences
- The filter rules must be kept in step with the Seoul API. `verify` is the check, and the tools keep their own duplicate filters.
- Data can be up to its maximum age old. Every store answer carries the collection date in `notes`.
- `@aws-sdk/client-s3` is a new dependency, imported lazily.
- Real-time datasets and real-estate datasets are not covered; they belong to later sub-projects.

---

<a id="korean"></a>
# 한국어

## 상태
채택 (2026-11-21)

## 배경
캐시는 요청 URL을 키로 쓰는 read-through 방식입니다. 그래서 두 종류의 요청은 세션마다 서울 API까지 갑니다. 하나는 약국명이나 행사 제목 같은 자유 인자가 든 요청입니다. 인자 조합마다 캐시 항목이 따로 생기기 때문입니다. 다른 하나는 380KB를 넘는 응답(공공예약, 문화행사)입니다. DynamoDB 계층이 저장하지 않기 때문입니다. 참가자가 많은 워크숍에서는 하루에 한 번도 바뀌지 않는 데이터가 하루 쿼터를 씁니다.

## 검토한 선택지

### 선택지 A (채택): S3 스냅샷과 서버 필터
- **장점**: 자유 인자를 서버가 직접 걸러 어떤 조합에도 답합니다. 크기 제한이 없습니다. 데이터셋별로 기한을 정합니다. 객체는 약 2,000개입니다.
- **단점**: 서울 API의 필터 동작을 서버에 다시 적어야 합니다.

### 선택지 B: 기존 캐시 예열
- **장점**: 새 읽기 경로가 없습니다.
- **단점**: 미리 나열한 조합만 적중합니다. 380KB를 넘는 응답은 여전히 공유되지 않습니다. 항목이 24시간 뒤 사라집니다.

### 선택지 C: DynamoDB에 행 단위 저장
- **장점**: 데이터셋별 기한, 항목 크기 문제 없음.
- **단점**: 부분일치 필터는 파티션 전체를 읽어야 하고, 수집 때 쓰기가 수십만 건입니다.

## 결정
하루 단위 이상으로 바뀌는 데이터셋(카탈로그 52종 중 37종)을 미리 받아 워크숍 버킷의 `store/v1/` 아래에 gzip JSON 스냅샷으로 둡니다. `SeoulApiClient.fetchUnwrapped`는 샘플 범위 제한 다음, 캐시와 키 풀보다 앞에서 저장소를 조회합니다. 저장소가 답한 요청은 서울 API 호출이 0회이고, 모든 키가 소진돼도 저장된 데이터는 계속 답합니다.

저장소는 허용 목록(`src/store/rules.ts`)이 허용한 것만 답합니다. 규칙이 있는 서비스, 일치나 부분일치로 표시한 자리, 형식 검사를 통과한 파티션 값입니다. 길이 0인 자리 뒤에 값이 오는 요청은 저장소가 답하지 않습니다. 서울 API가 빈 문자열 뒤의 필터를 모두 무시하기 때문입니다. 나머지는 기존 경로로 넘어가므로 규칙이 모자라면 호출이 한 번 더 나갈 뿐 틀린 답은 나가지 않습니다. `npm run workshop:collect -- verify`가 저장소와 실제 API를 비교하고, 문서에 의미가 적혀 있지 않은 자리를 정합니다.

`STORE_URI`를 설정하지 않으면 꺼져 있습니다. 수집은 로컬 명령으로 하고, 스케줄 Lambda는 선택 사항이며 기본값은 꺼짐입니다.

## 결과
- 필터 규칙을 서울 API와 맞춰 두어야 합니다. `verify`가 그 검사이고, tool은 자기 쪽의 중복 필터를 그대로 둡니다.
- 데이터는 기한만큼 오래됐을 수 있습니다. 저장소가 답한 응답은 `notes`에 수집 날짜를 싣습니다.
- 새 의존성 `@aws-sdk/client-s3`가 생기고 lazy import합니다.
- 실시간 데이터셋과 부동산 데이터셋은 대상이 아닙니다. 뒤의 하위 프로젝트에서 다룹니다.
