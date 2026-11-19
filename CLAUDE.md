# Project Context

## Overview
seoul-opendata-mcp(v0.7.0, MIT)는 서울 열린데이터광장(Seoul Open Data Plaza) 실시간 도시데이터를 23개 MCP tool로 제공하는 MCP 서버입니다. 로컬 클라이언트는 stdio(`src/index.ts`)로, Amazon Bedrock AgentCore Runtime은 Streamable HTTP(`src/http.ts`, `:8000`)로 연결합니다. GitHub: https://github.com/whchoi98/seoul-opendata-mcp.

## Tech Stack
- TypeScript(strict, ESM), Node.js >=18
- @modelcontextprotocol/sdk(stdio와 Streamable HTTP transport), zod(입력 스키마 검증), fast-xml-parser(XML 폴백 파싱)
- vitest(단위 테스트 + 선택적 live-smoke 테스트), js-yaml(템플릿 테스트)
- 배포: Docker(`linux/arm64`), Amazon Bedrock AgentCore Runtime과 Gateway, CloudFormation(`infra/`), DynamoDB(선택적 L2 캐시와 쿼터 장부, `@aws-sdk/*`는 lazy import)

## Project Structure
```
src/client/     HTTP 클라이언트: 키 풀과 폴백, 2단 캐시, 쿼터 장부, 페이지네이션, 재시도, XML 폴백, .env 로더
src/normalize/  봉투(envelope) unwrap + 도메인별 필드 정규화
src/tools/      MCP tool 23개: 도메인 register 6개 파일 + meta/stats/health
src/data/       핫스팟 121곳, 52개/6카테고리 데이터셋 카탈로그
tests/          vitest 스위트(단위 290+, live 9개) + harness/(훅·구조 검사); 픽스처=실API 캡처 불변
scripts/        capture-fixtures.ts, live-sweep.ts, setup.sh, install-hooks.sh, workshop-*.ts(워크숍 스택 배포와 코드 관리)
infra/          워크숍 Gateway 스택 템플릿(seoul-workshop.yaml)과 인터셉터 Lambda(lambda/code-check.mjs)
docs/           architecture, api-reference, onboarding, workshop 안내, decisions/(ADR), runbooks/, reference/(계층별 구현 참조), images/(README 인포그래픽과 생성 스크립트)
```

## Key Commands
- `npm run build` - tsc 컴파일
- `npm run dev` - tsx로 `src/index.ts` 실행
- `npm test` - vitest 스위트 실행
- `npm run inspect` - MCP Inspector 실행
- `npm run bundle` - build 후 mcpb pack/clean -> `seoul-opendata-mcp.mcpb`
- `npm run prepublishOnly` - build (`npm publish` 전 자동 실행)
- `bash tests/harness/run-all.sh` - 훅·스크립트·프로젝트 구조 하네스 테스트
- `bash scripts/install-hooks.sh` - git `pre-commit`(비밀 검사)과 `commit-msg` 훅 설치 (clone 직후 1회)
- `npm run workshop:deploy` - 워크숍 Gateway 스택 배포(승인 후에만 실행, `docs/workshop.md` 참조)
- `npm run workshop:code -- new|revoke|show` - 워크숍 코드 발급, 폐기, 조회

## Conventions
- `tests/fixtures/`의 픽스처는 실API 캡처 결과로 불변입니다. 직접 수정하지 않고, 재캡처는 `scripts/capture-fixtures.ts`로만 합니다(`tests/CLAUDE.md` 참조).
- 모든 `normalize*` 함수는 출력 필드를 원본 행 필드까지 추적하는 매핑 동등성 테스트를 갖습니다.
- tool 응답은 `ok()` 봉투(`src/tools/envelope.ts`)를 사용합니다: `{ data, asOf, source, notes }`.
- 외부 HTTP 호출은 모두 `SeoulApiClient`(`src/client/seoulApi.ts`)를 거칩니다 - 다른 곳에서 임의 `fetch` 호출 금지.
- tool `description`은 영어(2문장 이하) 다음에 한국어 순서로 작성합니다.
- 커밋 접두사: `feat:` `fix:` `test:` `docs:` `chore:`.
- 실제 API 키, 워크숍 코드, 코드 해시를 로그나 커밋에 남기지 않습니다. 키는 `maskKey()`와 `maskedKey()`/`maskedSubwayKey()`로만 표시하고, `.env`와 `.env.workshop`은 git에 커밋하지 않습니다.

## Auto-Sync Rules
- 신규 tool 추가 -> `src/index.ts`의 `TOOL_NAMES`에 추가, 등록하고 `src/tools/CLAUDE.md`를 갱신합니다.
- `src/<module>/` 신규 디렉토리 생성 -> 해당 위치에 `CLAUDE.md`를 만듭니다.
- 클라이언트/정규화 계약 변경 -> `docs/reference/api.md`를 갱신합니다.
- 키 처리 또는 샘플 모드 동작 변경 -> `docs/reference/security.md`를 갱신합니다.
- tool 설명 또는 LLM 대상 문구 변경 -> `docs/reference/agent-llm.md`를 갱신합니다.
- 되돌리기 어려운 설계 결정 -> `docs/decisions/ADR-NNN-제목.md`를 추가하고(번호는 가장 큰 번호 다음) `docs/architecture.md`의 주요 설계 결정에 연결합니다.
- `infra/` 템플릿 또는 인터셉터 변경 -> `infra/CLAUDE.md`, `docs/reference/iac.md`, `docs/reference/infrastructure.md`를 갱신합니다.
- `Dockerfile` 또는 `src/http.ts`의 런타임 계약 변경 -> `docs/reference/infrastructure.md`와 `docs/runbooks/agentcore-deploy.md`를 갱신합니다.
- `scripts/` 스크립트 추가 또는 옵션 변경 -> `scripts/CLAUDE.md`를 갱신하고, 워크숍 절차가 바뀌면 `docs/workshop.md`도 고칩니다.
- 구조나 계층이 바뀌는 변경 -> `docs/architecture.md`의 구성요소와 다이어그램을 갱신하고, README 인포그래픽(`docs/images/`, 문구는 `docs/images/src/arch_ko.py`와 `arch_en.py`)도 다시 만듭니다.

<!-- AUTO-MANAGED:references -->
- [docs/reference/security.md](docs/reference/security.md) - API 키 처리, 샘플 모드 제한
- [docs/reference/api.md](docs/reference/api.md) - 서울 열린데이터광장 엔드포인트 계약
- [docs/reference/agent-llm.md](docs/reference/agent-llm.md) - tool 설명 및 LLM 대상 컨벤션
- [docs/reference/infrastructure.md](docs/reference/infrastructure.md) - 컨테이너 이미지, AgentCore Runtime, 워크숍 Gateway와 테이블
- [docs/reference/iac.md](docs/reference/iac.md) - 워크숍 스택 템플릿과 배포 스크립트
<!-- /AUTO-MANAGED:references -->
