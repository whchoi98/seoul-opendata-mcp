# Tests Module

## Role
vitest 스위트입니다. 픽스처 기반 단위 테스트 290개 이상과, 기본적으로 스킵되는 live-smoke 테스트 9개(`RUN_LIVE=1`)로 구성됩니다.

## Key Files
- `fixtures/` - 데이터셋별 실API(샘플 키) 캡처 결과. `*.json`/`*.xml`.
- `live.test.ts` - `RUN_LIVE=1`일 때만 실행되는 실제 API 호출 테스트(`describe.skip` 게이트).
- `smoke.test.ts`, `cli.test.ts` - 프로세스/CLI 레벨 점검.
- 그 외 `*.test.ts` - `src/normalize/**`, `src/tools/**` 도메인별 1:1 대응.
- `realestate.test.ts` - 부동산 정규화 3종의 매핑 동등성과, 가짜 업스트림으로 `get_real_estate_prices`/`get_land_price`가 보내는 경로 자리를 검사합니다.
- `notes.test.ts` - 단건 호출 tool 5개가 쿼터 경고와 쿼터 소진 안내를 `notes`까지 전달하는지 tool 호출 전체 경로로 검사합니다.
- `helpers/mcp.ts` - tool 경로 테스트 공용 도구: `callTool()`(in-memory McpServer와 Client), `fixtureUpstream()`(서비스별 픽스처 응답), `rowsUpstream()`(표준 봉투 직접 생성).
- `version.test.ts` - `package.json`, `manifest.json`, `SERVER_VERSION`, CHANGELOG 두 절의 버전 일치 검사.
- `keyPool.test.ts` - 키 목록 파싱, 마스킹, 하루 한도와 쿨다운에 따른 키 선택을 검사합니다.
- `infra/codeCheck.test.ts` - 워크숍 인터셉터의 판정 순서(코드, 만료, 분당 한도)와 로그에 비밀 값이 없는지 검사합니다.
- `infra/workshopTemplate.test.ts` - `infra/seoul-workshop.yaml`을 `js-yaml`로 읽어 런타임, Gateway, IAM 범위, `NoEcho`, 출력 같은 불변 조건을 검사합니다.
- `workshopLib.test.ts`, `workshopAws.test.ts` - 워크숍 스크립트의 순수 함수와 `run` 래퍼를 검사합니다. AWS를 부르지 않습니다.
- `harness/` - vitest와 별개인 bash 하네스(`bash tests/harness/run-all.sh`). 훅 등록, secret-scan 패턴과 실제 차단 동작(임시 git 저장소에서 종료 코드 확인), 프로젝트 구조를 검사합니다. 구조 검사는 코드 디렉터리마다 `CLAUDE.md`가 있는지, `docs/reference/` 문서가 인덱스와 루트 `CLAUDE.md`에 연결되어 있는지도 봅니다.

## Rules — 픽스처 불변 원칙 및 재캡처 절차
- `tests/fixtures/`의 파일은 실API 캡처 결과로 취급하며 직접 수정하지 않습니다.
- 재캡처가 필요하면 갱신할 파일만 먼저 삭제한 뒤 `npx tsx scripts/capture-fixtures.ts`를 실행합니다(이미 존재하는 파일은 건너뛰므로 삭제가 선행되어야 합니다).
- 매핑 동등성 테스트 관례: `normalize*` 함수마다 출력 필드를 원본 행 필드와 정확히 대응시켜 검증합니다(`subway.test.ts` 참조). 재캡처로 필드가 조용히 깨지는 것을 방지합니다.
- live 테스트는 `RUN_LIVE=1`로만 실행되어, `npm test`가 네트워크/API 키 유무에 의존하지 않습니다.
