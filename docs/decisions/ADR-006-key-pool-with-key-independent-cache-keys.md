# ADR-006: 키 풀과 키에 의존하지 않는 캐시 키 (Key Pool with Key-Independent Cache Keys)

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>
# English

## Status
Accepted (2026-11-19)

## Context
One Seoul Open Data Plaza key allows about 1,000 calls a day. [ADR-004](ADR-004-session-scaling-two-tier-cache.md) already keeps upstream calls from growing with the number of sessions, but every cache miss still spends one call. A workshop with a few dozen participants asking about different places produces many misses, and the first workshop was less than two weeks away. The plan to read slow-changing data from a preloaded store (the next sub-project) might not be finished by then.

The cache key was the full request URL, which contains the API key. Two keys would therefore have kept two separate caches, and the raw key sat inside every cache key held in memory.

## Options Considered

### Option 1: Rotate several keys
- **Pros**: The server takes several keys and moves to the next when one is used up. The per-key ledger already existed. With N keys the daily budget is about N times larger.
- **Cons**: Several keys must be obtainable. Every miss still costs a call, so the budget is larger but still tied to demand.

### Option 2: Finish the preloaded store before the first workshop
- **Pros**: Slow-changing data is read from a snapshot and only real-time data calls the Seoul API, which removes most calls.
- **Cons**: Both the gateway and the store would have to be finished within two weeks.

### Option 3 (chosen): Both, with key rotation first
- **Pros**: Key rotation ships together with the gateway, so the first workshop is protected even if the store is late. The store then lowers the call count further.
- **Cons**: Two mechanisms to build and maintain.

### Option 4: No extra defense
- **Pros**: Nothing to build.
- **Cons**: When the limit is reached, only cached answers go out for the rest of the day.

## Decision
`SEOUL_API_KEY` accepts several keys separated by commas (`src/client/keyPool.ts`). Each upstream call uses the first key in the list that is under its daily limit and not cooling down. The 80% note and the exhausted state use the pool totals. When no key is left, the client answers from the cache only, as before.

The cache key no longer contains the API key. The key segment of the URL is replaced by `{key}` (`sample` in sample mode) for the L1 cache, the L2 cache and the single-flight map, so a response fetched with one key serves a request that would have used another. The real URL is built only for the call and is not stored.

With two or more keys, a key that returns `ERROR-337` is set aside for 10 minutes and the call is retried once with the next key. What `ERROR-337` means on a real key is not confirmed, and 10 minutes keeps the loss small whether it is a per-second limit or a daily one. The cooldown lives in process memory only. When every key that is still under its limit is cooling down, the response says the call is rate-limited and when to retry, not that the daily quota is spent.

With a single key, the sample key included, the server behaves exactly as before. The subway API keeps its own one-key pool.

## Consequences

### Positive
- The daily budget grows with the number of keys, and switching keys keeps cache hits. The first deploy confirmed that the third call moved to the second key after the first key reached a limit of 2.
- No cache key, in memory or in DynamoDB, contains a raw API key any more.
- stdio users and single-key deployments see no change.

### Negative
- Because the cache key format changed, existing L2 entries made with a real key miss once after the upgrade and expire within 24 hours. Sample-mode entries keep their key and still hit.
- The benefit depends on having several keys. The first deploy ran with three general keys; how many one account can obtain is not confirmed.
- The cooldown is per process. Each AgentCore session learns about a rate-limited key separately.
- The daily limit stays a soft limit: concurrent calls right at the limit can go slightly over.

## References
- `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md` (section 4 and section 10.1)
- `src/client/keyPool.ts`, `src/client/seoulApi.ts` (`fetchUnwrapped`, `fetchWithFailover`)
- `tests/keyPool.test.ts`, `tests/seoulApi.test.ts`
- [docs/reference/api.md](../reference/api.md), [docs/reference/security.md](../reference/security.md)
- [docs/workshop.md](../workshop.md) (verification record of the first deploy)

---

<a id="korean"></a>
# 한국어

## 상태
승인됨 (2026-11-19)

## 배경
서울 열린데이터광장 키 하나는 하루 약 1,000회를 허용합니다. [ADR-004](ADR-004-session-scaling-two-tier-cache.md)로 세션 수가 늘어도 업스트림 호출이 따라 늘지 않게 했지만, 캐시가 빗나갈 때마다 여전히 한 번씩 호출합니다. 수십 명이 서로 다른 장소를 묻는 워크숍에서는 빗나가는 요청이 많고, 첫 워크숍은 2주도 남지 않았습니다. 느리게 바뀌는 데이터를 미리 적재한 저장소에서 읽는 계획(다음 하위 프로젝트)은 그때까지 끝나지 않을 수 있었습니다.

캐시 키는 API 키가 들어 있는 요청 URL 전체였습니다. 그래서 키가 둘이면 캐시도 둘로 나뉘었고, 메모리에 있는 모든 캐시 키 안에 원문 키가 들어 있었습니다.

## 검토한 옵션

### 옵션 1: 키 여러 개 순환
- **장점**: 서버가 키를 여러 개 받아 한 키를 다 쓰면 다음 키로 넘어갑니다. 키별 장부는 이미 있었습니다. 키가 N개면 하루 예산이 약 N배가 됩니다.
- **단점**: 키를 여러 개 발급받을 수 있어야 합니다. 빗나갈 때마다 호출하는 것은 그대로라서, 예산이 커질 뿐 수요에 묶여 있습니다.

### 옵션 2: 첫 워크숍 전에 사전 적재 저장소까지 완성
- **장점**: 느린 데이터는 스냅샷에서 읽고 실시간 데이터만 서울 API를 부르므로 호출 대부분이 사라집니다.
- **단점**: 2주 안에 Gateway와 저장소를 모두 끝내야 합니다.

### 옵션 3 (채택): 둘 다 하되 키 순환 먼저
- **장점**: 키 순환은 Gateway와 함께 나가므로, 저장소가 늦어져도 첫 워크숍을 지킵니다. 그 뒤 저장소가 호출 수를 더 줄입니다.
- **단점**: 만들고 유지할 장치가 둘입니다.

### 옵션 4: 추가 방어 없음
- **장점**: 만들 것이 없습니다.
- **단점**: 한도에 닿으면 그날 남은 시간에는 캐시된 응답만 나갑니다.

## 결정
`SEOUL_API_KEY`에 쉼표로 여러 키를 넣을 수 있습니다(`src/client/keyPool.ts`). 업스트림 호출마다 목록에서 하루 한도 미만이고 쿨다운 중이 아닌 첫 키를 씁니다. 80% 안내와 소진 판정은 풀 합계를 기준으로 합니다. 남은 키가 없으면 이전처럼 캐시로만 응답합니다.

캐시 키에 API 키를 넣지 않습니다. L1 캐시, L2 캐시, single-flight 맵 모두 URL의 키 자리를 `{key}`(샘플 모드는 `sample`)로 바꾼 값을 씁니다. 그래서 한 키로 받은 응답이 다른 키를 썼을 요청에도 쓰입니다. 실제 URL은 호출할 때만 만들고 저장하지 않습니다.

키가 둘 이상일 때 `ERROR-337`을 돌려준 키는 10분 동안 빼 두고 다음 키로 한 번 다시 호출합니다. 실제 키에서 `ERROR-337`이 무엇을 뜻하는지는 확인되지 않았습니다. 초당 제한이든 하루 한도든 손실이 작도록 10분으로 정했습니다. 쿨다운은 프로세스 메모리에만 둡니다. 한도가 남은 키가 모두 쿨다운 중이면 일일 쿼터 소진이 아니라 호출 제한이라는 점과 다시 시도할 시점을 안내합니다.

키가 하나면 샘플 키를 포함해 이전과 똑같이 동작합니다. 지하철 API는 키 하나짜리 풀을 따로 둡니다.

## 영향

### 긍정적
- 하루 예산이 키 수만큼 늘고, 키가 바뀌어도 캐시가 적중합니다. 첫 배포에서 한도를 2로 두었을 때 첫 키가 한도에 닿은 뒤 세 번째 호출이 두 번째 키로 넘어가는 것을 확인했습니다.
- 메모리와 DynamoDB의 어떤 캐시 키에도 원문 API 키가 남지 않습니다.
- stdio 사용자와 키 하나짜리 배포는 달라지는 것이 없습니다.

### 부정적
- 캐시 키 형식이 바뀌어, 실제 키로 만든 기존 L2 항목은 업그레이드 뒤 한 번 빗나가고 24시간 안에 만료됩니다. 샘플 모드 항목은 키가 그대로라 계속 적중합니다.
- 효과는 키가 여러 개 있어야 납니다. 첫 배포는 일반 키 세 개로 했고, 한 계정에서 몇 개까지 발급받을 수 있는지는 확인되지 않았습니다.
- 쿨다운이 프로세스별입니다. AgentCore 세션마다 호출이 제한된 키를 따로 알게 됩니다.
- 하루 한도는 여전히 느슨한 한도입니다. 한도 직전의 동시 호출은 조금 넘을 수 있습니다.

## 참고 자료
- `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md` (4절과 10.1절)
- `src/client/keyPool.ts`, `src/client/seoulApi.ts` (`fetchUnwrapped`, `fetchWithFailover`)
- `tests/keyPool.test.ts`, `tests/seoulApi.test.ts`
- [docs/reference/api.md](../reference/api.md), [docs/reference/security.md](../reference/security.md)
- [docs/workshop.md](../workshop.md) (첫 배포의 검증 기록)
