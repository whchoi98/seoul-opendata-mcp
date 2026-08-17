# Project Context

## Overview
seoul-opendata-mcp(v0.2.0, MIT)는 서울 열린데이터광장(Seoul Open Data Plaza) 실시간 도시데이터를 19개 MCP tool로 stdio를 통해 제공하는 MCP 서버입니다. GitHub: whchoi98/Seoul-OpenData-MCP (원격 미푸시).

## Tech Stack
- TypeScript(strict, ESM), Node.js >=18
- @modelcontextprotocol/sdk(stdio transport), zod(입력 스키마 검증), fast-xml-parser(XML 폴백 파싱)
- vitest(단위 테스트 + 선택적 live-smoke 테스트)

## Project Structure
```
src/client/     HTTP 클라이언트: 키 폴백, TTL 캐시, 페이지네이션, 재시도, XML 폴백, .env 로더
src/normalize/  봉투(envelope) unwrap + 도메인별 필드 정규화
src/tools/      MCP tool 19개: 도메인 register 5개 파일 + meta/stats/health
src/data/       핫스팟 121곳, 28개/6카테고리 데이터셋 카탈로그
tests/          vitest 스위트(단위 105+, live 4개); 픽스처=실API 캡처 불변
scripts/        capture-fixtures.ts, live-sweep.ts, setup.sh, install-hooks.sh
```

## Key Commands
- `npm run build` - tsc 컴파일
- `npm run dev` - tsx로 `src/index.ts` 실행
- `npm test` - vitest 스위트 실행
- `npm run inspect` - MCP Inspector 실행
- `npm run bundle` - build 후 mcpb pack/clean -> `seoul-opendata-mcp.mcpb`
- `npm run prepublishOnly` - build (`npm publish` 전 자동 실행)

## Conventions
- `tests/fixtures/`의 픽스처는 실API 캡처 결과로 불변입니다. 직접 수정하지 않고, 재캡처는 `scripts/capture-fixtures.ts`로만 합니다(`tests/CLAUDE.md` 참조).
- 모든 `normalize*` 함수는 출력 필드를 원본 행 필드까지 추적하는 매핑 동등성 테스트를 갖습니다.
- tool 응답은 `ok()` 봉투(`src/tools/envelope.ts`)를 사용합니다: `{ data, asOf, source, notes }`.
- 외부 HTTP 호출은 모두 `SeoulApiClient`(`src/client/seoulApi.ts`)를 거칩니다 - 다른 곳에서 임의 `fetch` 호출 금지.
- tool `description`은 영어(2문장 이하) 다음에 한국어 순서로 작성합니다.
- 커밋 접두사: `feat:` `fix:` `test:` `docs:` `chore:`.
- 실제 API 키를 로그나 커밋에 남기지 않습니다. `maskedKey()`/`maskedSubwayKey()`를 사용하고, `.env`는 git에 커밋하지 않습니다.

## Auto-Sync Rules
- 신규 tool 추가 -> `src/index.ts`의 `TOOL_NAMES`에 추가, 등록하고 `src/tools/CLAUDE.md`를 갱신합니다.
- `src/<module>/` 신규 디렉토리 생성 -> 해당 위치에 `CLAUDE.md`를 만듭니다.
- 클라이언트/정규화 계약 변경 -> `docs/reference/api.md`를 갱신합니다.
- 키 처리 또는 샘플 모드 동작 변경 -> `docs/reference/security.md`를 갱신합니다.
- tool 설명 또는 LLM 대상 문구 변경 -> `docs/reference/agent-llm.md`를 갱신합니다.

<!-- AUTO-MANAGED:references -->
- [docs/reference/security.md](docs/reference/security.md) - API 키 처리, 샘플 모드 제한
- [docs/reference/api.md](docs/reference/api.md) - 서울 열린데이터광장 엔드포인트 계약
- [docs/reference/agent-llm.md](docs/reference/agent-llm.md) - tool 설명 및 LLM 대상 컨벤션
<!-- /AUTO-MANAGED:references -->
