# Client Module

## Role
서울 열린데이터광장 API 전용 HTTP 클라이언트입니다. 키 폴백(일반/지하철), 2단 캐시(L1 인메모리 + 선택적 L2 DynamoDB), 일일 쿼터 원장, 페이지네이션, 1회 재시도, JSON 응답이 XML 에러로 오는 경우의 폴백 파싱, `.env` 로딩을 담당합니다. 이 디렉토리 밖에서는 `fetch`를 직접 호출하지 않습니다. `src/http.ts`(AgentCore Runtime 진입점)도 이 모듈의 `SeoulApiClient`/`maybeAttachL2`를 그대로 사용합니다.

## Key Files
- `seoulApi.ts` - `SeoulApiClient` 본체. `SOFT_TTL` 맵(데이터셋별 원천 정렬 soft TTL), `buildUrl`/`request`(재시도)/`parseJsonWithXmlFallback`, `getJson`/`getXml`/`getSubway`, `maskedKey()`/`maskedSubwayKey()`, URL당 single-flight(`inflight` 맵), stale-while-revalidate·쿼터 소진 처리(`fetchUnwrapped`).
- `cache.ts` - `CacheBackend`(인터페이스) / `InMemoryCache`(L1, `MAX_L1_ENTRIES` 1000개 상한 LRU) / `CompositeCache`(L1+선택적 L2, soft/hard TTL 판정 — `HARD_TTL_MS` 24h). L2 실패는 잡아서 로그만 남기고 L1으로 폴백.
- `quota.ts` - `QuotaLedger`(인터페이스) / `InMemoryLedger`(기본, 프로세스별) / `kstDayKey`(KST 하루 경계) / `keyIdOf`(키를 저장하지 않는 sha256 식별자) / `parseQuotaLimit`(`QUOTA_DAILY_LIMIT` 검증, 기본 1000).
- `dynamo.ts` - `DynamoDbCache`(L2 `CacheBackend` 구현) / `DynamoDbLedger`(L2 `QuotaLedger` 구현) / `maybeAttachL2`(`CACHE_TABLE_NAME` 설정 시에만 `@aws-sdk/*`를 lazy import하여 연결; 실패해도 L1/인메모리 원장으로 계속 동작).
- `response.ts` - `unwrap()`(서울 API 봉투 해제) + `SeoulApiError`, `Unwrapped` 타입(`{ rows, totalCount, note? }`).
- `env.ts` - `loadDotEnv()` (`.env` 로더; 명시적 `process.env` 값이 항상 우선).

## Rules
- 외부 HTTP 호출은 반드시 `SeoulApiClient`를 통해서만 이뤄집니다. `src/tools/**`, `src/normalize/**`에서 `fetch`를 직접 쓰지 않습니다.
- 신규 데이터셋 추가 시 `seoulApi.ts`의 `SOFT_TTL` 맵에 원천 갱신 주기를 등록합니다(주석의 "Global Constraints" 참조). 미등록 서비스는 `DEFAULT_SOFT_TTL`로 폴백합니다.
- 원본 키를 절대 로그에 남기지 않습니다. 항상 `maskedKey()`/`maskedSubwayKey()`로 마스킹된 값만 사용하고, 쿼터 원장 키는 원본이 아니라 `keyIdOf()`로 해시한 값만 사용합니다.
- 5xx/네트워크 오류는 `retryDelayMs`(기본 300ms) 뒤 1회만 재시도하고, 버리는 응답 본문은 `body.cancel()`로 정리합니다. 타임아웃(`TimeoutError`)은 재시도하지 않고 `TIMEOUT`으로 바로 던집니다(최악 대기 = `timeoutMs` 1회). 4xx와 파싱 오류는 즉시 `SeoulApiError`를 던집니다(재시도 없음).
- `Unwrapped`와 캐시 항목에는 `rows`/`totalCount`/`note`만 담습니다. 업스트림 원본 payload를 다시 싣지 않습니다(L1 메모리와 L2 항목 380KB 한도 때문).
- `SEOUL_API_KEY`가 없으면 `key === 'sample'`(sample 모드)로 동작하며, `isSample`로 판별합니다.
- L2(`CACHE_TABLE_NAME`)와 쿼터 원장의 모든 실패 경로는 요청을 실패시키지 않고 로그만 남긴 뒤 L1/인메모리 원장으로 폴백해야 합니다 — 새 실패 지점을 추가할 때도 이 규칙을 지킵니다.
- `@aws-sdk/*`는 `dynamo.ts`의 `maybeAttachL2` 내부에서만, `CACHE_TABLE_NAME`이 설정된 경우에만 import합니다(stdio/로컬 경로에 비용을 지우지 않기 위함). 다른 곳에서 top-level import하지 않습니다.
