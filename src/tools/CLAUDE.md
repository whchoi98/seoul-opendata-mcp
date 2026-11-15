# Tools Module

## Role
MCP tool 20개를 등록합니다. 도메인 register 파일 6개(`common`, `population`, `traffic`, `culture`, `environment`, `realestate`) + `meta`/`stats`/`health` 3개, 총 9개 파일에서 `registerXTools(server, ctx)` 함수로 나뉘어 있습니다.

## Key Files
- `context.ts` - `Ctx = { client: SeoulApiClient }` 공유 컨텍스트 타입.
- `envelope.ts` - `ok(data, opts)`/`fail(message)`. 모든 tool 응답의 표준 봉투.
- `resolve.ts` - `resolvePlace()`: 자유 텍스트 장소명을 핫스팟으로 해석, 실패 시 조기 반환.
- `common.ts`/`population.ts`/`traffic.ts`/`culture.ts`/`environment.ts` - 도메인별 `registerXTools`.
- `realestate.ts` - `get_real_estate_prices`(매매, 전월세)와 `get_land_price`(개별공시지가). 서비스별 경로 자리 표 `SLOTS`, `buildPath()`, 법정동 코드 조회 `lookupDongCode()`.
- `meta.ts`/`stats.ts`/`health.ts` - 카탈로그 검색/호출, 배치 통계, 헬스체크 tool.

## Rules — 신규 tool 추가 절차 (5단계)
1. `src/index.ts`의 `TOOL_NAMES`에 tool 이름을 추가합니다.
2. 필요하면 `src/normalize/*.ts`에 정규화 함수를 추가/확장하고 매핑 동등성 테스트를 작성합니다.
3. 해당(또는 신규) register 파일에서 `server.registerTool(...)`을 작성합니다. `description`은 영어(2문장 이하) 다음 한국어 순서로 쓰고, 반환은 `ok(data, { source, asOf?, notes?, sample: ctx.client.isSample })`을 사용합니다.
4. `src/index.ts`의 `buildServer()`에 `registerXTools(server, ctx)`를 연결하고, `scripts/live-sweep.ts`에 호출 예시를 추가합니다.
5. `docs/api-reference.md`와 `README.md`(영문·한국어 통합 문서)의 두 절에 있는 tool 표를 갱신합니다. `README.ko.md`는 `README.md`로 안내만 하는 파일이라 고치지 않습니다.

## Gotcha
- swopenapi(지하철)는 0-based start — `meta.ts`의 `startFor()`를 사용하고, 직접 하드코딩하지 않습니다.
- 열린데이터광장 경로 파라미터는 자리로 구분됩니다. 건너뛰는 자리에는 공백 `' '`을 넣습니다. 빈 문자열을 넣으면 그 뒤 필터가 모두 무시됩니다. 매매(`tbLnOpendataRtmsV`)와 전월세(`tbLnOpendataRentV`)는 뒤쪽 자리 순서가 다르므로 `realestate.ts`의 `SLOTS`를 고쳐 씁니다.
- 실거래가의 자치구는 전체 이름(`강남구`)만, 법정동은 코드(`STDG_CD`)만 서버에서 걸러집니다. 입력은 `normalizeDistrict()`와 `lookupDongCode()`로 바꿔 보냅니다.
- 서버가 못 거르는 조건(`rentType`, district 없는 `dong`, 해제 거래 제외)을 코드에서 거를 때는 그 범위를 `notes`에 적습니다.
