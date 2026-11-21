# 서울 열린데이터 MCP 워크숍 안내

워크숍 참가자와 진행자를 위한 안내입니다. 설계는 [워크숍 Gateway 설계 스펙](superpowers/specs/2026-11-19-workshop-gateway-design.md)에 있습니다.

## 참가자

### Claude Code에 등록

진행자가 알려 준 Gateway URL과 워크숍 코드로 다음 명령을 실행합니다.

```bash
claude mcp add --transport http seoul <Gateway URL> --header "Authorization: Bearer <워크숍 코드>"
```

Claude Code에서 `/mcp`를 입력해 `seoul`이 연결됐는지 확인합니다. Gateway가 tool 이름 앞에 대상 이름을 붙이므로 tool은 `seoul___get_city_snapshot`처럼 보입니다.

### 앱에서 호출

두 예제 모두 환경 변수 `SEOUL_MCP_URL`(Gateway URL)과 `SEOUL_MCP_CODE`(워크숍 코드)를 읽습니다.

TypeScript(`npm install @modelcontextprotocol/sdk`):

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const transport = new StreamableHTTPClientTransport(new URL(process.env.SEOUL_MCP_URL!), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.SEOUL_MCP_CODE}` } },
})
const client = new Client({ name: 'my-app', version: '0.1.0' })
await client.connect(transport)
const result = await client.callTool({ name: 'seoul___get_city_snapshot', arguments: { place: '강남역' } })
console.log(result.content)
await client.close()
```

Python(`pip install "mcp<2"`). 이 예제는 `mcp` 1.x API를 씁니다. 2.x에서 클라이언트 API가 바뀌었으므로 버전을 1.x로 고정합니다.

```python
import asyncio
import os

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


async def main() -> None:
    headers = {"Authorization": f"Bearer {os.environ['SEOUL_MCP_CODE']}"}
    async with streamablehttp_client(os.environ["SEOUL_MCP_URL"], headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool("seoul___get_city_snapshot", {"place": "강남역"})
            print(result.content)


asyncio.run(main())
```

### 주의 사항

- 코드는 서버 쪽 코드에서만 붙입니다. 브라우저 JavaScript에 넣으면 페이지를 연 누구나 코드를 볼 수 있습니다.
- 워크숍 코드는 워크숍이 끝나면 만료됩니다. 앱을 계속 운영하려면 서울 열린데이터광장에서 인증키를 받아 이 서버를 직접 실행하세요(README의 설치 방법).
- "요청이 많습니다" 응답은 Gateway 전체의 분당 한도에 걸렸다는 뜻입니다. 1분 뒤 다시 시도하고, 반복문 안에서 tool을 부르지 않게 합니다.

## 진행자

### 처음 한 번

워크숍용 키는 `.env`가 아니라 별도 파일 `.env.workshop`의 `SEOUL_API_KEY`에 쉼표로 넣습니다. 이 저장소의 `.mcp.json`은 `.env`를 읽으므로, 같은 파일에 두면 로컬 세션이 DynamoDB 장부 없이 워크숍 키의 쿼터를 씁니다. 그다음 배포합니다. 스택 생성은 비용이 드는 작업이므로 실행 전에 범위를 확인합니다.

```bash
npm run workshop:deploy -- --env-file .env.workshop
```

첫 스택 생성이 실패해 `ROLLBACK_COMPLETE` 상태가 되면 `npm run workshop:deploy -- --delete --yes`로 스택을 지운 뒤 다시 배포합니다.

배포한 뒤 시간표 스냅샷을 한 번 받아 둡니다. 약 1,850회를 부르므로 워크숍 당일이 아닌 날에 합니다. 도중에 끊기면 다시 실행해 이어 받습니다.

```bash
npm run workshop:collect -- static --dry-run   # 계획과 남은 한도 확인
npm run workshop:collect -- static
```

### 워크숍 전날

`--days N`은 코드를 발급한 시각부터 N×24시간 뒤에 만료됩니다. 전날 오후에 발급하면 `--days 1`은 워크숍 당일 같은 시각에 끝나므로, 하루짜리 워크숍은 `--days 2`, 이틀짜리 해커톤은 `--days 3`으로 발급합니다.

스냅샷을 새로 받습니다. 약 100회를 부르고 몇 분 걸립니다. 참가자 요청 가운데 약국, 공영주차장 안내, 키워드와 분류 없이 찾는 문화행사, 공공예약, 승하차 통계, 시간표는 이 스냅샷으로 답하므로 서울 API를 부르지 않습니다.

```bash
npm run workshop:collect -- daily
npm run workshop:collect -- status    # 모든 데이터셋이 "기한 내" 또는 "기한 없음"인지 확인
```

공공예약은 기한이 24시간이라 워크숍 당일 아침에 `daily`를 한 번 더 돌리면 좋습니다. 매일 자동으로 받으려면 `npm run workshop:deploy -- --skip-image --collect-schedule "cron(0 5 * * ? *)"`로 스케줄을 켭니다.

```bash
npm run workshop:code -- new --days 2          # 하루짜리 워크숍. 이틀짜리 해커톤이면 --days 3
SEOUL_WORKSHOP_CODE=<새 코드> npm run workshop:deploy -- --skip-image   # 코드 있는 스모크 테스트
```

마지막 줄에 출력되는 Gateway URL과 새 코드를 안내 슬라이드에 넣습니다.

### 워크숍 중

| 상황 | 명령 |
|---|---|
| 분당 한도에 자주 걸림 | `npm run workshop:deploy -- --skip-image --rate-per-minute 240` |
| 코드가 유출됨 | `npm run workshop:code -- new` 후 새 코드를 다시 안내 |
| 만료 시각 확인 | `npm run workshop:code -- show` |
| 스냅샷이 오래됨(응답의 수집 날짜가 지난 날짜) | `npm run workshop:collect -- daily`. 10분 안에 런타임에 반영됩니다 |

### 워크숍 후

```bash
npm run workshop:code -- revoke
```

스택은 그대로 둡니다. 쉬는 동안에는 S3와 로그 보관료만 듭니다.

### 서버 버전을 올릴 때

변경을 커밋한 뒤 `npm run workshop:deploy`를 실행합니다. 이미지를 새로 빌드해 올리고, Gateway 대상을 동기화하고, 스모크 테스트까지 합니다.

## 검증 기록

배포 후 확인한 동작을 날짜(KST)와 함께 적습니다.

| 항목 | 결과 | 날짜 |
|---|---|---|
| `initialize`가 인터셉터를 거치는지 | 거칩니다. 코드 없는 `initialize`가 HTTP 403과 안내 문구로 거부되고, 인터셉터 로그에 `initialize`의 `bad_code` 판정이 남습니다. JSON-RPC 배치 본문은 Gateway가 인터셉터보다 먼저 `-32600`으로 거부하므로 분당 한도를 우회하지 못합니다. | 2026-11-19 |
| Claude Code가 거부 안내 문구를 보여 주는지 | 보여 줍니다. `claude mcp list`가 연결 실패와 HTTP 403을 표시하고, Error detail에 "워크숍 코드가 올바르지 않습니다" 문구를 그대로 붙입니다. 올바른 코드로는 연결됨으로 표시됩니다. | 2026-11-19 |
| 분당 한도 초과 시 `isError` 응답 | 한도 3에서 같은 분의 1~3번째 호출은 성공하고 4번째는 `isError`와 "1분 뒤 다시 시도하세요" 문구를 받습니다. 판정 로그는 `rate_limited`입니다. | 2026-11-19 |
| 첫 키 한도 도달 시 다음 키 사용 | 키 3개, 키당 하루 한도 2에서 첫 키가 2회를 채운 뒤 세 번째 호출은 두 번째 키를 썼습니다. 장부의 `quota#` 항목으로 확인했습니다. | 2026-11-20 |
| `revoke` 후 거부 | 폐기한 코드는 `initialize`에서 "워크숍 코드가 만료되었습니다" 안내로 거부되고, probe는 종료 코드 1로 끝났습니다. | 2026-11-20 |

### 사전 적재 저장소 (0.8.0, 2026-11-22)

| 항목 | 결과 |
|---|---|
| `daily` 첫 수집 | 호출 98회(예상 상한 144회), 스냅샷 49개 저장, 실패 0. 생활인구는 후보 날짜 13개가 모두 데이터 없음이라 저장하지 못했습니다(아래 행) |
| `verify` 첫 실행 | 통과 54, 순서 4, 실패 10(가정을 시험한 요청 9, 지원 자리 1), 건너뜀 3, 호출 60회 |
| 검증으로 결정한 자리 | `ListPublicReservationEducation.AREANM` 부분일치, `OdsnBuildingInfo.SISUL_NM` 부분일치. `culturalEventInfo.CODENAME`과 `ListPublicReservationEducation.USETGTINFO`는 재현하지 못해 미지원으로 남겼습니다 |
| 미지원으로 내린 자리 | `GetParkInfo.PRK_NOW_INFO_PVSN_YN`과 `culturalEventInfo.TITLE`. 서울 API가 걸러진 결과에서 정렬 키가 같은 행의 순서를 전체 목록과 다르게 돌려줍니다. 결과가 요청 범위를 넘으면 같은 범위에서 다른 행이 나옵니다. `GetParkInfo.ADDR`도 순서가 다르지만(153건에서 최대 34칸) 결과가 요청 범위 1,000행 안에 들어와 그대로 둡니다 |
| 규칙을 고친 뒤 `verify --only` | 네 서비스에서 통과 17, 순서 2, 가정이 아닌 실패 0, 호출 22회 |
| `find_pharmacies` 두 번(약국명 다름) | 사전 적재 안내 있음, 장부 `used` 변화 없음 |
| `search_public_reservations` | 사전 적재 안내 있음, 장부 `used` 변화 없음 |
| 저장소에 없는 날짜의 `get_subway_ridership` | 사전 적재 안내 없음, 장부 `used` 1 증가, 런타임 로그에 `AccessDenied` 없음 |
| 문화행사 스냅샷 읽기 | 377ms, 힙 47MB(압축 4.0MB, 원본 19.5MB, 19,781행). 세션에서 처음 읽는 스냅샷은 S3 SDK를 불러오는 시간이 더해져 약 2초가 걸렸습니다(약국, 압축 0.4MB) |
| 생활인구(`SPOP_LOCAL_RESD_DONG`) | 수집되지 않았습니다. 서울 API의 가장 최근 날짜가 2026-07-31이라 수집 범위(최근 13일) 밖입니다. 날짜를 지정한 `get_living_population` 요청은 서울 API로 갑니다. 매일 수집은 이 데이터를 찾는 데 13회를 씁니다 |
| `static` 수집과 `get_subway_schedule` | 아직 하지 않음. 워크숍 당일이 아닌 날 `npm run workshop:collect -- static` 뒤에 확인 |
