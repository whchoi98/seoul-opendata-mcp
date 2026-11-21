# Store Module

## Role
사전 적재 저장소입니다. 하루 단위 이상으로 바뀌는 데이터셋 37종을 미리 받아 gzip JSON 스냅샷으로 저장하고, 서버가 서울 API보다 스냅샷을 먼저 읽게 합니다. 설계는 `docs/superpowers/specs/2026-11-21-snapshot-store-design.md`입니다.

## Key Files
- `rules.ts` - 규칙 표 `STORE_RULES`. 서비스별 자리 규칙(일치, 부분일치, 파티션, 미지원), 묶음, 범위, 기한, 스냅샷당 호출 수.
- `engine.ts` - 순수 함수 `planRequest()`(읽을 스냅샷과 필터 결정)와 `answerFrom()`(필터, 범위, 기한 적용).
- `snapshot.ts` - 스냅샷 형식, gzip 직렬화, 객체 키(`<서비스>/<파티션 키>.json.gz`), 접두사 `store/v1`.
- `snapshotStore.ts` - `SnapshotStore` 인터페이스(`get`, `put`, `list`)와 디렉터리 구현 `DirectoryStore`(테스트와 로컬 개발용).
- `s3Store.ts` - S3 구현 `S3Store`. `createS3Store()` 안에서만 `@aws-sdk/client-s3`를 lazy import합니다. 없는 객체(404)는 `undefined`, 그 밖의 오류는 던집니다.
- `reader.ts` - `SnapshotReader`. 메모리 보관(96MB, 오래 안 쓴 것부터 버림), 10분 뒤 ETag 재확인, 없는 객체와 오류 5분 기억, 동시 읽기 합치기, 3초 시간 제한.
- `attach.ts` - `openStore()`(주소가 `s3://`면 S3, 아니면 디렉터리)와 `maybeAttachStore()`(`STORE_URI`가 있을 때만 `SeoulApiClient.attachStore()` 호출, 실패해도 서버는 계속 동작).

## Rules
- 허용 목록 방식입니다. 규칙 표에 없는 서비스, 미지원 자리, 형식에 맞지 않는 파티션 값은 답하지 않고 지금 경로(캐시와 서울 API)로 넘깁니다. 추측으로 답하지 않습니다.
- 0건으로 답할 때 `note`는 `noDataNote()`가 만든 문구 하나입니다. 다른 문구를 붙이면 `isNoData()`와 tool의 분기가 깨집니다.
- 파티션 값은 객체 키와 파일 경로가 됩니다. 규칙의 정규식을 통과한 값만 `snapshotKey()`에 넘깁니다.
- 저장소의 실패는 요청을 실패시키지 않습니다. 로그만 남기고 답하지 않음으로 처리합니다.
- `src/client`만 import합니다(`verify.ts`는 `src/data/catalog.ts`도). `src/tools`와 `src/normalize`는 import하지 않습니다. `src/client`는 이 디렉터리를 import하지 않습니다.
- 규칙을 바꾸면 `tests/store/rules.test.ts`를 먼저 고치고, 배포 전에 `npm run workshop:collect -- verify`로 실제 API와 비교합니다.
