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

### 워크숍 전날

`--days N`은 코드를 발급한 시각부터 N×24시간 뒤에 만료됩니다. 전날 오후에 발급하면 `--days 1`은 워크숍 당일 같은 시각에 끝나므로, 하루짜리 워크숍은 `--days 2`, 이틀짜리 해커톤은 `--days 3`으로 발급합니다.

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
