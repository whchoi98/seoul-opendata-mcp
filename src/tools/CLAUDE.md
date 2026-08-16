# Tools Module

## Role
MCP tool 19개를 등록합니다. 도메인 register 파일 5개(`common`, `population`, `traffic`, `culture`, `environment`) + `meta`/`stats`/`health` 3개, 총 8개 파일에서 `registerXTools(server, ctx)` 함수로 나뉘어 있습니다.

## Key Files
- `context.ts` - `Ctx = { client: SeoulApiClient }` 공유 컨텍스트 타입.
- `envelope.ts` - `ok(data, opts)`/`fail(message)`. 모든 tool 응답의 표준 봉투.
- `resolve.ts` - `resolvePlace()`: 자유 텍스트 장소명을 핫스팟으로 해석, 실패 시 조기 반환.
- `common.ts`/`population.ts`/`traffic.ts`/`culture.ts`/`environment.ts` - 도메인별 `registerXTools`.
- `meta.ts`/`stats.ts`/`health.ts` - 카탈로그 검색/호출, 배치 통계, 헬스체크 tool.

## Rules — 신규 tool 추가 절차 (4단계)
1. `src/index.ts`의 `TOOL_NAMES`에 tool 이름을 추가합니다.
2. 필요하면 `src/normalize/*.ts`에 정규화 함수를 추가/확장하고 매핑 동등성 테스트를 작성합니다.
3. 해당(또는 신규) register 파일에서 `server.registerTool(...)`을 작성합니다. `description`은 영어(2문장 이하) 다음 한국어 순서로 쓰고, 반환은 `ok(data, { source, asOf?, notes?, sample: ctx.client.isSample })`을 사용합니다.
4. `src/index.ts`의 `buildServer()`에 `registerXTools(server, ctx)`를 연결하고, `scripts/live-sweep.ts`에 호출 예시를 추가합니다.
