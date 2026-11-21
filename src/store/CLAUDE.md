# Store Module

## Role
사전 적재 저장소입니다. 하루 단위 이상으로 바뀌는 데이터셋 37종을 미리 받아 gzip JSON 스냅샷으로 저장하고, 서버가 서울 API보다 스냅샷을 먼저 읽게 합니다. 설계는 `docs/superpowers/specs/2026-11-21-snapshot-store-design.md`입니다.

## Key Files
- `rules.ts` - 규칙 표 `STORE_RULES`. 서비스별 자리 규칙(일치, 부분일치, 파티션, 미지원), 묶음, 범위, 기한, 스냅샷당 호출 수.
- `engine.ts` - 순수 함수 `planRequest()`(읽을 스냅샷과 필터 결정)와 `answerFrom()`(필터, 범위, 기한 적용).
- `snapshot.ts` - 스냅샷 형식, gzip 직렬화, 객체 키(`<서비스>/<파티션 키>.json.gz`), 접두사 `store/v1`.
- `snapshotStore.ts` - `SnapshotStore` 인터페이스(`get`, `put`, `list`)와 디렉터리 구현 `DirectoryStore`(테스트와 로컬 개발용).
- `s3Store.ts` - S3 구현 `S3Store`. `createS3Store()` 안에서만 `@aws-sdk/client-s3`를 lazy import합니다. 없는 객체(404)는 `undefined`, 그 밖의 오류는 던집니다. 클라이언트의 시간 제한은 연결 2초, 요청 10초이며 본문 읽기까지 포함합니다.
- `reader.ts` - `SnapshotReader`. 메모리 보관(96MB, 오래 안 쓴 것부터 버림), 10분 뒤 ETag 재확인, 없는 객체와 오류 5분 기억, 동시 읽기 합치기, 3초 시간 제한. 재확인이 3초를 넘거나 이미 진행 중이면 가진 스냅샷으로 답합니다.
- `attach.ts` - `openStore()`(주소가 `s3://`면 S3, 아니면 디렉터리)와 `maybeAttachStore()`(`STORE_URI`가 있을 때만 `SeoulApiClient.attachStore()` 호출, 실패해도 서버는 계속 동작).
- `collector.ts` - 수집 계획(`planCollection`), 실행(`collect`), 증분 건너뛰기, 예산 검사, 상태(`statusOf`), 출력 문자열. `scripts/workshop-collect.ts`와 수집 Lambda가 함께 씁니다.
- `verify.ts` - 실제 API 대비 검사. 카탈로그 예시 값으로 요청을 만듭니다(`casesFor`, 그 값을 가진 행이 없으면 스냅샷의 첫 값). 스냅샷과 서울 API의 답은 전체 건수와 행으로 비교합니다(`runVerify`). 지원 자리와 "검증으로 결정" 자리(일치와 부분일치 두 가정)는 값 전체와 앞부분으로 시험합니다. 양쪽 모두 0건이면 그 값을 포함한 행이 있을 때만 통과로 셉니다.

## Rules
- 허용 목록 방식입니다. 규칙 표에 없는 서비스, 미지원 자리, 형식에 맞지 않는 파티션 값은 답하지 않고 지금 경로(캐시와 서울 API)로 넘깁니다. 추측으로 답하지 않습니다.
- 길이 0인 자리 뒤에 값이 있는 요청은 답하지 않습니다. 서울 API가 빈 문자열 뒤의 필터를 모두 무시하기 때문입니다(`src/tools/path.ts`). 공백 한 칸은 값이 없는 자리입니다.
- 0건으로 답할 때 `note`는 `noDataNote()`가 만든 문구 하나입니다. 다른 문구를 붙이면 `isNoData()`와 tool의 분기가 깨집니다.
- 파티션 값은 객체 키와 파일 경로가 됩니다. 규칙의 정규식을 통과한 값만 `snapshotKey()`에 넘깁니다.
- 저장소의 실패는 요청을 실패시키지 않습니다. 로그만 남기고 답하지 않음으로 처리합니다.
- `src/client`만 import합니다(`verify.ts`는 `src/data/catalog.ts`도). `src/tools`와 `src/normalize`는 import하지 않습니다. `src/client`는 이 디렉터리를 import하지 않습니다.
- 규칙을 바꾸면 `tests/store/rules.test.ts`를 먼저 고치고, 배포 전에 `npm run workshop:collect -- verify`로 실제 API와 비교합니다.
- 수집기는 `client.getJson()`만 씁니다. 빈 응답이 `isNoData()`가 아니면 쿼터 소진이나 호출 제한이므로 실행을 끝냅니다. 스냅샷은 모든 페이지를 받은 뒤에만 씁니다.
- 수집기의 출력과 로그에 원문 키를 넣지 않습니다. 키는 `maskKey()`로만 보여 줍니다.
