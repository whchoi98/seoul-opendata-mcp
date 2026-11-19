# Scripts Module

## Role
개발과 운영에 쓰는 실행 스크립트입니다. 픽스처 캡처, 전체 tool 라이브 점검, 개발 환경 설정, git 훅 설치, 워크숍 Gateway 스택 배포와 코드 관리를 맡습니다. 서버 코드(`src/`)는 이 디렉터리를 import하지 않습니다.

## Key Files
- `capture-fixtures.ts` - 샘플 키로 실제 응답을 받아 `tests/fixtures/`에 저장합니다. 이미 있는 파일은 건너뜁니다.
- `live-sweep.ts` - 23개 tool을 하나씩 실제로 호출합니다. 호출마다 서버 프로세스를 따로 띄우고 1.3초 간격을 둡니다.
- `setup.sh` - 새 개발자용 설정입니다. 의존성 설치, 빌드, 테스트를 하고 `.env` 설정을 안내합니다.
- `install-hooks.sh` - git `pre-commit`(비밀 검사)과 `commit-msg` 훅을 `.git/hooks`에 설치합니다.
- `workshop-deploy.ts` - `npm run workshop:deploy`. 스택 `seoul-workshop`을 두 단계로 만들거나 갱신하고, 이미지를 빌드해 올리고, Gateway 대상을 동기화한 뒤 스모크 테스트를 합니다.
- `workshop-code.ts` - `npm run workshop:code -- new|revoke|show`. 워크숍 코드를 발급, 폐기, 조회합니다.
- `workshop-lib.ts` - 워크숍 스크립트의 순수 함수와 상수입니다(리전, 스택 이름, 코드 생성, 해시, 만료 계산, 스택 파라미터, 이미지 태그, `stackBlocker`). `tests/workshopLib.test.ts`가 검사합니다.
- `workshop-aws.ts` - `aws` CLI와 `docker` 호출 래퍼입니다(`run`, `aws`, `describeStack`, `createStack`, `updateStack`, `deleteStack`). `tests/workshopAws.test.ts`가 검사합니다.

## Rules
- `workshop-deploy.ts`와 `workshop-code.ts`는 과금되는 AWS 리소스를 만들거나 바꿉니다. 사용자 승인 뒤에만 실행합니다. `--help`는 AWS를 부르지 않습니다.
- 원문 API 키, 워크숍 코드, 코드 해시를 화면, 오류 메시지, 명령 인자에 넣지 않습니다. 비밀 값은 `withSecretFile()`이 만든 0600 임시 파일을 `--parameters file://`로 넘기고 바로 지웁니다.
- 외부 명령은 `run()`에 인자 배열로 넘깁니다. 셸 문자열을 조립하지 않습니다.
- 워크숍 키는 `.env.workshop`에 둡니다. `.env`는 로컬 stdio 서버가 읽으므로 같은 키를 넣으면 DynamoDB 장부 밖에서 쿼터를 씁니다.
- `--skip-image` 없이 배포하려면 작업 트리가 깨끗해야 합니다. 이미지 태그 `<버전>-workshop-<커밋 7자>`가 커밋을 가리키기 때문입니다. ECR의 `latest`와 `X.Y.Z` 태그는 옮기지 않습니다.
- 판단 로직은 `workshop-lib.ts`에 순수 함수로 두고 테스트를 먼저 씁니다. 배포와 코드 스크립트의 main 흐름은 단위 테스트가 없으므로 얇게 유지합니다.
- 픽스처 캡처는 원본 응답이 필요해 `fetch`를 직접 씁니다. 다른 스크립트는 서울 API를 직접 부르지 않고, Gateway 확인은 `@modelcontextprotocol/sdk` 클라이언트로 합니다.
- 픽스처를 다시 받을 때는 갱신할 파일만 먼저 지웁니다(`tests/CLAUDE.md` 참조).
