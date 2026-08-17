# ADR-001: 픽스처 = 진실 원칙 (Fixtures as Source of Truth)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>
# English

## Status
Accepted (2026-08-15)

## Context
`tests/fixtures/*` holds real API responses captured with a sample key. While implementing bike station normalization, an implementer discovered the code did not match the fixture and edited the fixture's envelope key (`rentBikeStatus` → `bikeList`) to fit the code instead of fixing the code. Code review caught this before merge; commit `6c2bd15` reverted the fixture and fixed the unwrap logic instead. Left unnoticed, this would have shipped a normalizer that passes tests against a fabricated shape while breaking on the real API.

## Options Considered
### Option 1: Allow fixtures to be edited to match code
- **Pros**: Easier to make a failing normalizer pass quickly.
- **Cons**: Tests become circular (code validates itself); real API contract drift goes undetected, as the `6c2bd15` incident proved.

### Option 2: Fixtures are immutable; code conforms to fixtures
- **Pros**: A passing test means the code handles the real captured response; re-capture-safe mapping-equality tests catch silent field drift.
- **Cons**: Response shapes absent from any fixture (e.g. a non-empty disaster-alert block) remain unverified until captured.

## Decision
`tests/fixtures/*` are treated as an immutable record of real API captures and are never hand-edited. Client and normalization code must conform to what the fixtures actually contain, never the reverse. Every `normalize*`/`extract*` function carries a mapping-equality test asserting its output fields trace back to the same row's raw fields (see `tests/subway.test.ts`). `scripts/capture-fixtures.ts` skips any file that already exists, so re-capturing a dataset requires deleting the target file first — an explicit, reviewable action.

## Consequences
### Positive
- The exact class of bug seen in `6c2bd15` (code-driven fixture tampering) is structurally prevented going forward.
- Passing unit tests are strong evidence of real API contract compliance, not just internal consistency.

### Negative
- Response shapes not present in any captured fixture (e.g. a populated `LIVE_DST_MESSAGE` block, currently empty in `tests/fixtures/citydata.xml`) stay unverified until a future re-capture happens to observe them.
- Fixtures age with the live API; catching upstream shape changes depends on someone re-running `scripts/capture-fixtures.ts` after deleting stale files.

## References
- Commit `6c2bd15` — fix: unwrap rentBikeStatus envelope for bikeList, restore real fixture
- `tests/CLAUDE.md` — fixture immutability and re-capture procedure
- `scripts/capture-fixtures.ts` — existing-file skip guard
- `src/normalize/CLAUDE.md`, `tests/subway.test.ts` — mapping-equality test convention

---

<a id="korean"></a>
# 한국어

## 상태
승인됨 (2026-08-15)

## 배경
`tests/fixtures/*`는 샘플 키로 캡처한 실제 API 응답입니다. 따릉이 대여소 정규화를 구현하던 중, 코드가 기대하는 형태와 픽스처가 다르다는 것을 발견한 구현자가 코드를 고치는 대신 픽스처의 봉투 키(`rentBikeStatus` → `bikeList`)를 코드에 맞게 변조했습니다. 코드 리뷰가 병합 전 이를 적발했고, 커밋 `6c2bd15`가 픽스처를 원복하고 unwrap 로직을 수정했습니다. 발견되지 않았다면 조작된 형태를 기준으로 테스트는 통과하지만 실서비스에서는 깨지는 정규화 코드가 배포될 뻔했습니다.

## 검토한 옵션
### 옵션 1: 코드에 맞게 픽스처를 수정 허용
- **장점**: 실패하는 정규화 코드를 빠르게 통과시킬 수 있습니다.
- **단점**: 테스트가 코드를 스스로 검증하는 순환 구조가 되어, 실제 API 계약 이탈을 감지하지 못합니다(`6c2bd15` 사고로 실증됨).

### 옵션 2: 픽스처는 불변, 코드가 픽스처에 맞춤
- **장점**: 테스트 통과가 실제 캡처된 응답을 코드가 올바르게 처리한다는 뜻이 됩니다; 재캡처-안전 매핑 동등성 테스트가 필드가 조용히 깨지는 것을 막습니다.
- **단점**: 어떤 픽스처에도 없는 응답 형태(예: 비어있지 않은 재난문자 블록)는 캡처되기 전까지 미검증으로 남습니다.

## 결정
`tests/fixtures/*`는 실제 API 캡처본의 불변 기록으로 취급하며 직접 수정하지 않습니다. 클라이언트/정규화 코드는 픽스처가 실제로 담고 있는 내용에 맞춰야 하며, 그 역은 금지됩니다. 모든 `normalize*`/`extract*` 함수는 출력 필드가 같은 행의 원본 필드로 정확히 추적되는지 검증하는 매핑 동등성 테스트를 가집니다(`tests/subway.test.ts` 참조). `scripts/capture-fixtures.ts`는 이미 존재하는 파일을 건너뛰므로, 재캡처하려면 대상 파일을 먼저 삭제해야 합니다 — 명시적이고 리뷰 가능한 행위입니다.

## 영향
### 긍정적
- `6c2bd15`에서 발생한 종류의 사고(코드 주도 픽스처 변조)가 구조적으로 재발 방지됩니다.
- 단위 테스트 통과가 내부 일관성뿐 아니라 실제 API 계약 준수의 강한 근거가 됩니다.

### 부정적
- 어떤 픽스처에도 없는 응답 형태(예: 현재 `tests/fixtures/citydata.xml`에서는 비어있는 `LIVE_DST_MESSAGE` 블록이 실제로 값을 채워 반환되는 경우)는 향후 재캡처로 관찰되기 전까지 미검증으로 남습니다.
- 픽스처는 실제 API와 함께 낡아가며, 업스트림 형태 변화를 잡아내는 것은 누군가 오래된 파일을 지우고 `scripts/capture-fixtures.ts`를 다시 실행하는지에 의존합니다.

## 참고 자료
- 커밋 `6c2bd15` — fix: unwrap rentBikeStatus envelope for bikeList, restore real fixture
- `tests/CLAUDE.md` — 픽스처 불변 원칙 및 재캡처 절차
- `scripts/capture-fixtures.ts` — 기존 파일 skip 가드
- `src/normalize/CLAUDE.md`, `tests/subway.test.ts` — 매핑 동등성 테스트 관례
