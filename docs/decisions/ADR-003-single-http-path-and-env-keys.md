# ADR-003: 단일 HTTP 경로와 키 2종 .env 관리 (Single HTTP Path and Two-Key .env Management)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>
# English

## Status
Accepted (2026-08-16)

## Context
Live testing against the Seoul Open Data Plaza APIs (general and subway `swopenapi`) surfaced real API contract deviations that unit tests against assumed shapes had missed: a JSON endpoint returning an XML `<RESULT>` error body on rate-limit/error (commit `4ab0979`), `swopenapi` returning a bare top-level `{status, code, message}` error with no `errorMessage` wrapper (also `4ab0979`), and the sample key rejecting any request wider than 5 rows with `ERROR-335` (commit `8d9f9c8`). Each dataset call also needs the same key handling, caching, and retry logic.

## Options Considered
### Option 1: Each tool/domain module calls `fetch` directly
- **Pros**: Low coupling between modules; simplest initial implementation.
- **Cons**: Caching, retry, key masking, and XML-fallback parsing must be duplicated per call site; a newly discovered contract deviation risks being fixed in only one place.
### Option 2: Single `SeoulApiClient` HTTP path + two-key `.env` management
- **Pros**: TTL caching, retry, key masking, sample-key row clamping, and XML-error fallback are absorbed once; a new deviation is fixed in one file for every tool.
- **Cons**: Every caller, including the catalog meta tools, must fit the client's three call shapes (`getJson`/`getXml`/`getSubway`); the client becomes a single point of failure.

## Decision
All outbound HTTP calls go through `src/client/seoulApi.ts` (`SeoulApiClient`) exclusively — no other module calls `fetch` directly (per `CLAUDE.md` Conventions). It provides a per-service TTL cache to protect quota, one retry on network/5xx errors, key masking via `maskedKey()`/`maskedSubwayKey()`, a 5-row clamp for the sample key (avoiding `ERROR-335`), and XML-error fallback parsing on JSON endpoints. Keys are split into `SEOUL_API_KEY` (general) and `SEOUL_SUBWAY_API_KEY` (subway-only, falling back to the general key, then to `'sample'`). `.env` is read by a dependency-free loader (`src/client/env.ts`) that only fills variables not already set in `process.env`, and `.env` is excluded from both `.gitignore` and `.mcpbignore`.

## Consequences
### Positive
- The three API contract deviations found through live testing are absorbed once in `SeoulApiClient`, so every tool inherits the same protection automatically.
- Key masking happens at construction time (`maskedKey`/`maskedSubwayKey`), so no error-message code path can ever assemble a string containing a real key.

### Negative
- Adding a new upstream base URL or response shape requires extending `SeoulApiClient` itself; a client-level failure blocks every tool, not just one dataset.
- The subway key's fallback to the general key is silent — if `SEOUL_SUBWAY_API_KEY` is unset, subway calls quietly consume the general key's quota without a visible warning.

## References
- `src/client/seoulApi.ts` — `SeoulApiClient`, TTL cache, retry, masking, sample clamp, XML fallback
- `src/client/env.ts` — dependency-free `.env` loader, explicit-env precedence
- `docs/reference/security.md` — key handling design notes
- Commits `4ab0979` (XML fallback, bare error shape), `8d9f9c8` (ERROR-335 clamp), `3dceb94` (two-key `.env` loader)
- `.gitignore`, `.mcpbignore`, `.env.example`

---

<a id="korean"></a>
# 한국어

## 상태
승인됨 (2026-08-16)

## 배경
서울 열린데이터광장 API(일반, 지하철 `swopenapi`)를 대상으로 라이브 테스트를 진행하며, 가정한 형태만으로는 놓쳤던 실제 API 계약 이탈이 드러났습니다: JSON 엔드포인트가 호출 제한/에러 시 XML `<RESULT>` 본문을 반환(커밋 `4ab0979`), `swopenapi`가 `errorMessage` 래퍼 없이 top-level `{status, code, message}` 형태로 에러를 반환(역시 `4ab0979`), 샘플 키가 5행을 넘는 요청을 `ERROR-335`로 거부(커밋 `8d9f9c8`). 또한 모든 데이터셋 호출은 동일한 키 처리, 캐싱, 재시도 로직을 필요로 합니다.

## 검토한 옵션
### 옵션 1: 각 tool/도메인 모듈이 직접 `fetch` 호출
- **장점**: 모듈 간 결합도가 낮고, 초기 구현이 가장 단순합니다.
- **단점**: 캐싱·재시도·키 마스킹·XML 폴백 파싱을 호출부마다 중복 구현해야 하며, 새로 발견된 계약 이탈을 한 곳에서만 고치고 다른 곳에 누락시킬 위험이 있습니다.
### 옵션 2: 단일 `SeoulApiClient` HTTP 경로 + 키 2종 `.env` 관리
- **장점**: TTL 캐싱, 재시도, 키 마스킹, 샘플 키 행 수 클램프, XML 에러 폴백을 한 곳에서 흡수해, 새 계약 이탈도 파일 하나만 고치면 모든 tool에 적용됩니다.
- **단점**: 카탈로그 메타 tool을 포함한 모든 호출부가 클라이언트의 3가지 호출 형태(`getJson`/`getXml`/`getSubway`)에 맞춰야 하고, 클라이언트가 단일 실패점이 됩니다.

## 결정
모든 외부 HTTP 호출은 `src/client/seoulApi.ts`(`SeoulApiClient`)만을 거칩니다 — 다른 모듈에서 직접 `fetch`를 호출하지 않습니다(`CLAUDE.md` Conventions 참조). 이 클라이언트는 서비스별 TTL 캐시로 쿼터를 보호하고, 네트워크/5xx 오류 시 1회 재시도하며, `maskedKey()`/`maskedSubwayKey()`로 키를 마스킹하고, 샘플 키는 5행으로 클램프해 `ERROR-335`를 피하며, JSON 엔드포인트의 XML 에러 응답을 폴백 파싱합니다. 키는 `SEOUL_API_KEY`(일반)와 `SEOUL_SUBWAY_API_KEY`(지하철 전용, 미설정 시 일반 키로, 그다음 `'sample'`로 폴백)로 분리합니다. `.env`는 의존성 없는 로더(`src/client/env.ts`)가 읽으며 `process.env`에 이미 설정된 값만 존중해 덮어쓰지 않고, `.env`는 `.gitignore`와 `.mcpbignore` 양쪽에서 제외됩니다.

## 영향
### 긍정적
- 라이브 테스트로 발견된 3건의 API 계약 이탈이 `SeoulApiClient` 한 곳에서 흡수되어, 모든 tool이 동일한 방어를 자동으로 상속합니다.
- 키 마스킹이 생성 시점(`maskedKey`/`maskedSubwayKey`)에 결정되어, 에러 메시지를 포함한 어떤 코드 경로도 실제 키 전체를 담은 문자열을 만들 수 없습니다.

### 부정적
- 새로운 업스트림 base URL이나 응답 형태를 추가하려면 `SeoulApiClient` 자체를 확장해야 하며, 클라이언트 장애는 특정 데이터셋이 아니라 모든 tool을 막습니다.
- 지하철 키의 일반 키 폴백은 조용히 이루어져, `SEOUL_SUBWAY_API_KEY`가 없으면 지하철 호출이 눈에 보이는 경고 없이 일반 키 쿼터를 소진합니다.

## 참고 자료
- `src/client/seoulApi.ts` — `SeoulApiClient`, TTL 캐시, 재시도, 마스킹, 샘플 클램프, XML 폴백
- `src/client/env.ts` — 의존성 없는 `.env` 로더, 명시적 env 우선
- `docs/reference/security.md` — 키 처리 설계 노트
- 커밋 `4ab0979`(XML 폴백, bare 에러 형태), `8d9f9c8`(ERROR-335 클램프), `3dceb94`(키 2종 `.env` 로더)
- `.gitignore`, `.mcpbignore`, `.env.example`
