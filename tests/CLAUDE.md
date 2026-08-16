# Tests Module

## Role
vitest 스위트입니다. 픽스처 기반 단위 테스트 105개 이상과, 기본적으로 스킵되는 live-smoke 테스트 4개(`RUN_LIVE=1`)로 구성됩니다.

## Key Files
- `fixtures/` - 데이터셋별 실API(샘플 키) 캡처 결과. `*.json`/`*.xml`.
- `live.test.ts` - `RUN_LIVE=1`일 때만 실행되는 실제 API 호출 테스트(`describe.skip` 게이트).
- `smoke.test.ts`, `cli.test.ts` - 프로세스/CLI 레벨 점검.
- 그 외 `*.test.ts` - `src/normalize/**`, `src/tools/**` 도메인별 1:1 대응.

## Rules — 픽스처 불변 원칙 및 재캡처 절차
- `tests/fixtures/`의 파일은 실API 캡처 결과로 취급하며 직접 수정하지 않습니다.
- 재캡처가 필요하면 갱신할 파일만 먼저 삭제한 뒤 `npx tsx scripts/capture-fixtures.ts`를 실행합니다(이미 존재하는 파일은 건너뛰므로 삭제가 선행되어야 합니다).
- 매핑 동등성 테스트 관례: `normalize*` 함수마다 출력 필드를 원본 행 필드와 정확히 대응시켜 검증합니다(`subway.test.ts` 참조). 재캡처로 필드가 조용히 깨지는 것을 방지합니다.
- live 테스트는 `RUN_LIVE=1`로만 실행되어, `npm test`가 네트워크/API 키 유무에 의존하지 않습니다.
