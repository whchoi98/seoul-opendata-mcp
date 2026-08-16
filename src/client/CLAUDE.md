# Client Module

## Role
서울 열린데이터광장 API 전용 HTTP 클라이언트입니다. 키 폴백(일반/지하철), 데이터셋별 TTL 캐시, 페이지네이션, 1회 재시도, JSON 응답이 XML 에러로 오는 경우의 폴백 파싱, `.env` 로딩을 담당합니다. 이 디렉토리 밖에서는 `fetch`를 직접 호출하지 않습니다.

## Key Files
- `seoulApi.ts` - `SeoulApiClient` 본체. `TTL` 맵(데이터셋별 캐시 유효시간), `buildUrl`/`request`(재시도)/`parseJsonWithXmlFallback`, `getJson`/`getXml`/`getSubway`, `maskedKey()`/`maskedSubwayKey()`.
- `cache.ts` - `TtlCache` (만료 기반 인메모리 캐시).
- `response.ts` - `unwrap()`(서울 API 봉투 해제) + `SeoulApiError`, `Unwrapped` 타입.
- `env.ts` - `loadDotEnv()` (`.env` 로더; 명시적 `process.env` 값이 항상 우선).

## Rules
- 외부 HTTP 호출은 반드시 `SeoulApiClient`를 통해서만 이뤄집니다. `src/tools/**`, `src/normalize/**`에서 `fetch`를 직접 쓰지 않습니다.
- 신규 데이터셋 추가 시 `seoulApi.ts`의 `TTL` 맵에 갱신 주기를 등록합니다(주석의 "Global Constraints" 참조).
- 원본 키를 절대 로그에 남기지 않습니다. 항상 `maskedKey()`/`maskedSubwayKey()`로 마스킹된 값만 사용합니다.
- 5xx/네트워크 오류는 1회만 재시도합니다. 4xx와 파싱 오류는 즉시 `SeoulApiError`를 던집니다(재시도 없음).
- `SEOUL_API_KEY`가 없으면 `key === 'sample'`(sample 모드)로 동작하며, `isSample`로 판별합니다.
