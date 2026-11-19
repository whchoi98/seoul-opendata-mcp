# 워크숍 Gateway와 코드 인증 구현 계획 (하위 프로젝트 ①)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자가 공용 코드 하나로 AgentCore Gateway에 접속해 이 서버의 tool 23개를 쓰게 하고, 서버는 여러 API 키를 순환하면서 키와 무관한 캐시 키로 캐시를 유지한다.

**Architecture:** 서버는 `KeyPool`(새 파일)로 키를 고르고, 캐시 키에서 원문 키를 뺀다. 인프라는 CloudFormation 템플릿 하나(`infra/seoul-workshop.yaml`)에 워크숍 전용 런타임, 테이블, 버킷, 인터셉터 Lambda, Gateway, 대상을 둔다. 배포와 코드 교체는 `tsx`로 실행하는 스크립트 두 개가 aws CLI를 호출해 처리한다.

**Tech Stack:** TypeScript(strict, ESM), vitest, `@modelcontextprotocol/sdk` 1.32, Lambda Node.js 22(ESM `.mjs`, 런타임 내장 AWS SDK v3), CloudFormation(`AWS::BedrockAgentCore::Runtime`, `Gateway`, `GatewayTarget`), aws CLI 2, docker, `js-yaml`(devDependency).

**Spec:** `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md`

## Global Constraints

- 리전 `ap-northeast-2`, 스택 이름 `seoul-workshop`, 런타임 이름 `seoul_workshop_mcp`, 대상 이름 `seoul`, ECR 저장소 `seoul-opendata-mcp`.
- 이미지 태그는 `<버전>-workshop-<커밋 7자>`. ECR의 `latest`, `X.Y.Z` 태그는 옮기지 않는다.
- 기존 리소스 `seoul_opendata_mcp`, `myseoul_mcp`, `seoul-mcp-cache`는 읽지도 바꾸지도 않는다. 템플릿에 이 이름이 나오면 안 된다.
- 스택 생성, 변경, 삭제와 ECR 푸시는 Task 8에서 사용자 승인을 받은 뒤에만 한다. Task 1~7은 AWS 리소스를 만들거나 바꾸지 않는다.
- 원문 API 키, 워크숍 코드, 코드 해시를 로그, 오류 메시지, 커밋, 명령 인자에 넣지 않는다. 키는 `maskKey()`로만 보여 준다. 쿼터 장부는 `keyIdOf()` 해시만 쓴다.
- `src/` 밖에서도 서울 API를 부르는 임의 `fetch`를 쓰지 않는다. Gateway 스모크 호출은 `@modelcontextprotocol/sdk` 클라이언트로 한다.
- `@aws-sdk/*`는 `src/client/dynamo.ts`의 `maybeAttachL2` 안에서만 lazy import한다. Lambda도 DynamoDB 클라이언트를 처음 쓸 때 lazy import한다.
- 템플릿에 12자리 계정 ID, `arn:aws:` 리터럴, 버킷 이름을 쓰지 않는다. ARN은 `!Sub "arn:${AWS::Partition}:..."`로 만든다.
- `tests/fixtures/`는 수정하지 않는다. tool `description`은 바꾸지 않는다.
- 커밋 접두사는 `feat:` `fix:` `test:` `docs:` `chore:`. 모든 커밋 메시지 마지막 줄은 `Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs`.
- 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다. 각 태스크 끝에 `npm test` 전체가 통과해야 한다.

## File Structure

| 파일 | 작업 | 책임 |
|---|---|---|
| `src/client/keyPool.ts` | 생성 | 키 목록 파싱, 마스킹, 키 선택, 쿨다운 |
| `src/client/seoulApi.ts` | 수정 | `KeyPool` 사용, 키와 무관한 캐시 키, `ERROR-337` 쿨다운과 재시도 |
| `src/client/env.ts` | 수정 | `.env` 문자열 파서 `parseDotEnv` 분리(스크립트와 공유) |
| `src/http.ts` | 수정 | 기동 로그에 마스킹한 키 표시 |
| `infra/lambda/code-check.mjs` | 생성 | 코드 검사, 만료, 분당 한도 인터셉터 |
| `infra/seoul-workshop.yaml` | 생성 | 스택 템플릿 |
| `infra/CLAUDE.md` | 생성 | infra 디렉터리 규칙 |
| `scripts/workshop-lib.ts` | 생성 | 순수 함수(코드 생성, 해시, 시각, 파라미터, 임시 비밀 파일) |
| `scripts/workshop-aws.ts` | 생성 | aws CLI와 스택 조작 래퍼 |
| `scripts/workshop-deploy.ts` | 생성 | 배포, 동기화, 스모크, 삭제 |
| `scripts/workshop-code.ts` | 생성 | 코드 `new`, `revoke`, `show` |
| `docs/workshop.md` | 생성 | 참가자와 진행자 안내, 검증 기록 |
| `tests/keyPool.test.ts` | 생성 | Task 1 |
| `tests/seoulApi.test.ts` | 수정 | Task 2 |
| `tests/infra/codeCheck.test.ts` | 생성 | Task 3 |
| `tests/infra/workshopTemplate.test.ts` | 생성 | Task 4 |
| `tests/env.test.ts`, `tests/workshopLib.test.ts` | 수정, 생성 | Task 5 |

---

### Task 1: KeyPool 모듈

**Files:**
- Create: `src/client/keyPool.ts`
- Test: `tests/keyPool.test.ts`

**Interfaces:**
- Consumes: `keyIdOf(apiKey: string): string`, `QuotaStatus { used; limit; ratio }` (`src/client/quota.ts`)
- Produces:
  - `SAMPLE_KEY = 'sample'`
  - `parseKeys(raw: string | undefined): string[]`
  - `maskKey(key: string): string`
  - `interface PoolStatus { used: number; limit: number; ratio: number }`
  - `interface PickedKey { exhausted: false; key: string; keyId: string; pool: PoolStatus }`
  - `type Pick = PickedKey | { exhausted: true; pool: PoolStatus }`
  - `class KeyPool { constructor(keys: string[], now?: () => number); readonly keys: readonly string[]; get isSample(): boolean; get first(): string; cooldown(key: string, ms: number): void; pick(status: (keyId: string) => Promise<QuotaStatus>): Promise<Pick> }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/keyPool.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { KeyPool, parseKeys, maskKey, SAMPLE_KEY } from '../src/client/keyPool.js'
import { InMemoryLedger, keyIdOf } from '../src/client/quota.js'

const statusOf = (ledger: InMemoryLedger) => (id: string) => ledger.status(id)

describe('parseKeys', () => {
  it('쉼표로 나누고 공백을 자르며 빈 항목과 중복을 지운다', () => {
    expect(parseKeys(' K1, K2 ,,K1 ')).toEqual(['K1', 'K2'])
  })

  it('키가 없으면 샘플 키 하나를 돌려준다', () => {
    expect(parseKeys(undefined)).toEqual([SAMPLE_KEY])
    expect(parseKeys('')).toEqual([SAMPLE_KEY])
    expect(parseKeys(' , ')).toEqual([SAMPLE_KEY])
  })
})

describe('maskKey', () => {
  it('앞 4자만 남기고 sample은 그대로 둔다', () => {
    expect(maskKey('SECRETKEY123')).toBe('SECR…(masked)')
    expect(maskKey('sample')).toBe('sample')
  })
})

describe('KeyPool', () => {
  it('샘플 키 하나일 때만 isSample', () => {
    expect(new KeyPool(['sample']).isSample).toBe(true)
    expect(new KeyPool(['K1']).isSample).toBe(false)
    expect(new KeyPool(['K1', 'sample']).isSample).toBe(false)
  })

  it('빈 목록으로는 만들 수 없다', () => {
    expect(() => new KeyPool([])).toThrow()
  })

  it('목록 순서에서 처음 만나는 한도 미만 키를 고른다', async () => {
    const ledger = new InMemoryLedger(2)
    await ledger.increment(keyIdOf('K1'))
    await ledger.increment(keyIdOf('K1'))
    const picked = await new KeyPool(['K1', 'K2', 'K3']).pick(statusOf(ledger))
    expect(picked).toMatchObject({ exhausted: false, key: 'K2', keyId: keyIdOf('K2') })
  })

  it('풀 상태는 모든 키의 사용량과 한도를 더한 값이다', async () => {
    const ledger = new InMemoryLedger(5)
    for (let i = 0; i < 4; i++) {
      await ledger.increment(keyIdOf('K1'))
      await ledger.increment(keyIdOf('K2'))
    }
    const picked = await new KeyPool(['K1', 'K2']).pick(statusOf(ledger))
    expect(picked.pool).toEqual({ used: 8, limit: 10, ratio: 0.8 })
  })

  it('모든 키가 한도에 닿으면 exhausted', async () => {
    const ledger = new InMemoryLedger(1)
    await ledger.increment(keyIdOf('K1'))
    await ledger.increment(keyIdOf('K2'))
    const picked = await new KeyPool(['K1', 'K2']).pick(statusOf(ledger))
    expect(picked).toEqual({ exhausted: true, pool: { used: 2, limit: 2, ratio: 1 } })
  })

  it('쿨다운 중인 키는 건너뛰고, 시간이 지나면 다시 고른다', async () => {
    let t = 0
    const ledger = new InMemoryLedger(10)
    const pool = new KeyPool(['K1', 'K2'], () => t)
    pool.cooldown('K1', 600_000)
    expect(await pool.pick(statusOf(ledger))).toMatchObject({ key: 'K2' })
    t = 599_999
    expect(await pool.pick(statusOf(ledger))).toMatchObject({ key: 'K2' })
    t = 600_000
    expect(await pool.pick(statusOf(ledger))).toMatchObject({ key: 'K1' })
  })

  it('쿨다운 중인 키도 풀 합계에는 들어간다', async () => {
    const ledger = new InMemoryLedger(10)
    await ledger.increment(keyIdOf('K1'))
    const pool = new KeyPool(['K1', 'K2'], () => 0)
    pool.cooldown('K1', 1000)
    expect((await pool.pick(statusOf(ledger))).pool).toEqual({ used: 1, limit: 20, ratio: 0.05 })
  })

  it('고를 수 있는 키가 모두 쿨다운 중이면 exhausted', async () => {
    const pool = new KeyPool(['K1'], () => 0)
    pool.cooldown('K1', 1000)
    expect(await pool.pick(statusOf(new InMemoryLedger(10)))).toMatchObject({ exhausted: true })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/keyPool.test.ts`
Expected: FAIL, `Failed to resolve import "../src/client/keyPool.js"`

- [ ] **Step 3: 구현**

`src/client/keyPool.ts`:

```ts
import { keyIdOf, type QuotaStatus } from './quota.js'

export const SAMPLE_KEY = 'sample'

/** 쉼표로 구분한 키 목록. 공백을 자르고 빈 항목과 중복을 지운다. 남는 키가 없으면 샘플 키 하나 */
export function parseKeys(raw: string | undefined): string[] {
  const keys = [...new Set((raw ?? '').split(',').map(k => k.trim()).filter(Boolean))]
  return keys.length > 0 ? keys : [SAMPLE_KEY]
}

/** 로그와 오류 메시지에 쓰는 유일한 키 표기. 실제 키는 앞 4자만 남긴다 */
export function maskKey(key: string): string {
  return key === SAMPLE_KEY ? SAMPLE_KEY : `${key.slice(0, 4)}…(masked)`
}

export interface PoolStatus { used: number; limit: number; ratio: number }
export interface PickedKey { exhausted: false; key: string; keyId: string; pool: PoolStatus }
export type Pick = PickedKey | { exhausted: true; pool: PoolStatus }

/**
 * 같은 API의 키 묶음. 목록 앞쪽 키부터 하루 한도까지 쓰고 다음 키로 넘어간다.
 * 원문 키는 메모리에만 두고, 장부 조회는 keyIdOf() 해시로 한다.
 */
export class KeyPool {
  readonly keys: readonly string[]
  private cooling = new Map<string, number>()

  constructor(keys: string[], private now: () => number = Date.now) {
    if (keys.length === 0) throw new Error('KeyPool에는 키가 하나 이상 있어야 합니다')
    this.keys = [...keys]
  }

  get isSample(): boolean {
    return this.keys.length === 1 && this.keys[0] === SAMPLE_KEY
  }

  get first(): string {
    return this.keys[0]
  }

  /** 이 프로세스 안에서만 ms 동안 그 키를 고르지 않는다 */
  cooldown(key: string, ms: number): void {
    this.cooling.set(key, this.now() + ms)
  }

  private isCooling(key: string): boolean {
    const until = this.cooling.get(key)
    if (until === undefined) return false
    if (this.now() >= until) {
      this.cooling.delete(key)
      return false
    }
    return true
  }

  /** 모든 키의 장부를 병렬로 읽고, 쿨다운이 아닌 키 가운데 목록 순서로 처음 만나는 한도 미만 키를 고른다 */
  async pick(status: (keyId: string) => Promise<QuotaStatus>): Promise<Pick> {
    const statuses = await Promise.all(this.keys.map(k => status(keyIdOf(k))))
    const used = statuses.reduce((sum, s) => sum + s.used, 0)
    const limit = statuses.reduce((sum, s) => sum + s.limit, 0)
    const pool: PoolStatus = { used, limit, ratio: limit > 0 ? used / limit : 1 }
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[i]
      if (statuses[i].ratio < 1 && !this.isCooling(key)) {
        return { exhausted: false, key, keyId: keyIdOf(key), pool }
      }
    }
    return { exhausted: true, pool }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/keyPool.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/client/keyPool.ts tests/keyPool.test.ts
git commit -m "feat: add KeyPool for comma-separated Seoul API keys" -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---
### Task 2: SeoulApiClient에 키 풀과 키와 무관한 캐시 키 적용

**Files:**
- Modify: `src/client/seoulApi.ts` (전체 교체, 아래 Step 3)
- Modify: `src/http.ts:84-87` (기동 로그)
- Modify: `src/client/CLAUDE.md`, `docs/reference/security.md`, `docs/reference/api.md`, `README.md`
- Test: `tests/seoulApi.test.ts` (끝에 describe 블록 추가)

**Interfaces:**
- Consumes: Task 1의 `KeyPool`, `parseKeys`, `maskKey`, `SAMPLE_KEY`, `PickedKey`
- Produces:
  - `export const KEY_COOLDOWN_MS = 600_000` (`src/client/seoulApi.ts`)
  - `SeoulApiClient`의 공개 API(`isSample`, `maskedKey()`, `maskedSubwayKey()`, `getJson`, `getXml`, `getSubway`, `fetchAll`, `attachL2`, `setLedger`)는 시그니처 그대로. `ClientOptions.apiKey`는 쉼표 목록을 받는다.
  - 캐시 키 형식: `buildUrl`과 같은 문자열이되 키 자리가 `{key}`(샘플 모드면 `sample`)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/seoulApi.test.ts` 맨 위 import 두 줄 아래에 추가:

```ts
import { InMemoryLedger, keyIdOf } from '../src/client/quota.js'
```

(기존 테스트 안의 `const { InMemoryLedger, keyIdOf } = await import(...)`는 블록 안에서 이름을 가리므로 그대로 둔다.)

파일 끝에 추가:

```ts
describe('SeoulApiClient 키 풀', () => {
  const pageOf = (service: string) =>
    jsonResponse({ [service]: { list_total_count: 1, RESULT: { CODE: 'INFO-000', MESSAGE: 'ok' }, row: [{ a: 1 }] } })
  const serviceOf = (url: string) => url.split('/')[5]
  const xml337 = () =>
    new Response('<RESULT><CODE>ERROR-337</CODE><MESSAGE>호출 제한</MESSAGE></RESULT>', { status: 200 })

  it('SEOUL_API_KEY 환경 변수의 쉼표 목록을 읽는다', () => {
    delete process.env.SEOUL_SUBWAY_API_KEY
    process.env.SEOUL_API_KEY = 'AAAA1111,BBBB2222'
    try {
      const c = new SeoulApiClient({ fetchFn: vi.fn() as any })
      expect(c.isSample).toBe(false)
      expect(c.maskedKey()).toBe('AAAA…(masked) 외 1개')
      expect(c.maskedSubwayKey()).toBe('AAAA…(masked)')
    } finally {
      delete process.env.SEOUL_API_KEY
    }
  })

  it('첫 키가 하루 한도에 닿으면 다음 키로 호출한다', async () => {
    const ledger = new InMemoryLedger(1)
    await ledger.increment(keyIdOf('K1'))
    const fetchFn = vi.fn().mockResolvedValue(pageOf('bikeList'))
    const c = new SeoulApiClient({ apiKey: 'K1,K2', fetchFn: fetchFn as any, ledger })
    await c.getJson('bikeList', 1, 5)
    expect(fetchFn.mock.calls[0][0]).toBe('http://openapi.seoul.go.kr:8088/K2/json/bikeList/1/5')
  })

  it('모든 키가 소진되면 업스트림을 부르지 않고 풀 한도를 안내한다', async () => {
    const ledger = new InMemoryLedger(1)
    await ledger.increment(keyIdOf('K1'))
    await ledger.increment(keyIdOf('K2'))
    const fetchFn = vi.fn()
    const c = new SeoulApiClient({ apiKey: 'K1,K2', fetchFn: fetchFn as any, ledger })
    const u = await c.getJson('bikeList', 1, 5)
    expect(u.rows).toHaveLength(0)
    expect(u.note).toContain('일일 API 쿼터(2회)')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('80% 안내는 풀 전체 합계로 계산한다', async () => {
    const ledger = new InMemoryLedger(5)
    for (let i = 0; i < 4; i++) {
      await ledger.increment(keyIdOf('K1'))
      await ledger.increment(keyIdOf('K2'))
    }
    const fetchFn = vi.fn().mockResolvedValue(pageOf('bikeList'))
    const c = new SeoulApiClient({ apiKey: 'K1,K2', fetchFn: fetchFn as any, ledger })
    const u = await c.getJson('bikeList', 1, 5)
    expect(u.note).toContain('80% 사용(8/10)')
  })

  it('k1으로 저장한 캐시가 k2를 고르는 상태에서도 적중한다', async () => {
    const ledger = new InMemoryLedger(1)
    const fetchFn = vi.fn().mockResolvedValue(pageOf('bikeList'))
    const c = new SeoulApiClient({ apiKey: 'K1,K2', fetchFn: fetchFn as any, ledger })
    await c.getJson('bikeList', 1, 5) // K1으로 호출, K1 1/1 소진
    const again = await c.getJson('bikeList', 1, 5) // 이제 K2를 고르지만 캐시가 fresh
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(again.rows).toHaveLength(1)
  })

  it('동시 요청이 서로 다른 키를 골라도 업스트림 호출은 한 번이다', async () => {
    const ledger = new InMemoryLedger(1)
    let resolveFetch!: (r: Response) => void
    const fetchFn = vi.fn().mockReturnValue(new Promise<Response>(res => { resolveFetch = res }))
    const c = new SeoulApiClient({ apiKey: 'K1,K2', fetchFn: fetchFn as any, ledger })
    const first = c.getJson('bikeList', 1, 5) // K1을 고르고 응답 대기
    await new Promise(r => setTimeout(r, 10))
    await ledger.increment(keyIdOf('K1')) // 그사이 K1 소진
    const second = c.getJson('bikeList', 1, 5) // K2를 고르지만 같은 캐시 키라 진행 중인 호출에 합류
    await new Promise(r => setTimeout(r, 10))
    resolveFetch(pageOf('bikeList'))
    await Promise.all([first, second])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('ERROR-337이면 그 키를 10분 쉬게 하고 다음 키로 한 번 다시 부른다', async () => {
    let t = 0
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('/K1/') && t < 600_000 ? xml337() : pageOf(serviceOf(url)))
    const c = new SeoulApiClient({ apiKey: 'K1,K2', fetchFn: fetchFn as any, now: () => t })
    const u = await c.getJson('bikeList', 1, 5)
    expect(u.rows).toHaveLength(1)
    expect(fetchFn.mock.calls.map(([url]) => (url.includes('/K1/') ? 'K1' : 'K2'))).toEqual(['K1', 'K2'])
    await c.getJson('GetParkingInfo', 1, 5) // 쿨다운 중이라 바로 K2
    expect(fetchFn.mock.calls[2][0]).toContain('/K2/')
    t = 600_000
    await c.getJson('AccInfo', 1, 5) // 10분이 지나 다시 K1
    expect(fetchFn.mock.calls[3][0]).toContain('/K1/')
  })

  it('키가 하나면 ERROR-337에 쿨다운 없이 오류를 그대로 던진다', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(xml337()).mockResolvedValueOnce(pageOf('GetParkingInfo'))
    const c = new SeoulApiClient({ apiKey: 'K1', fetchFn: fetchFn as any })
    await expect(c.getJson('bikeList', 1, 5)).rejects.toMatchObject({ code: 'ERROR-337' })
    const u = await c.getJson('GetParkingInfo', 1, 5) // 쿨다운이 없으므로 바로 업스트림 호출
    expect(u.rows).toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('샘플 모드는 ERROR-337을 재시도하지 않는다', async () => {
    delete process.env.SEOUL_API_KEY
    const fetchFn = vi.fn().mockResolvedValue(xml337())
    const c = new SeoulApiClient({ fetchFn: fetchFn as any })
    await expect(c.getJson('bikeList', 1, 5)).rejects.toMatchObject({ code: 'ERROR-337' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('캐시 키에는 원문 키 대신 자리 표시가 들어가고, 샘플과 실제 키는 서로 다른 항목이다', async () => {
    delete process.env.SEOUL_API_KEY
    const keys: string[] = []
    const l2 = { async get() { return undefined }, async set(k: string) { keys.push(k) } }
    for (const apiKey of [undefined, 'SECRETKEY123,OTHERKEY456']) {
      const c = new SeoulApiClient({ apiKey, fetchFn: vi.fn().mockResolvedValue(pageOf('bikeList')) as any })
      c.attachL2(l2)
      await c.getJson('bikeList', 1, 5)
    }
    expect(keys).toEqual([
      'http://openapi.seoul.go.kr:8088/sample/json/bikeList/1/5',
      'http://openapi.seoul.go.kr:8088/{key}/json/bikeList/1/5',
    ])
  })

  it('오류 메시지와 로그에는 실제로 쓴 키의 마스킹만 남고 원문 키는 없다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const timeout = new DOMException('timeout', 'TimeoutError')
      const fetchFn = vi.fn(async (url: string) => {
        if (url.includes('/SECRETKEY123/')) return xml337()
        throw timeout
      })
      const c = new SeoulApiClient({ apiKey: 'SECRETKEY123,OTHERKEY456', fetchFn: fetchFn as any, retryDelayMs: 0 })
      const e = await c.getJson('bikeList', 1, 5).catch(x => x)
      expect(e).toMatchObject({ code: 'TIMEOUT' })
      expect(e.message).toContain('OTHE…(masked)')
      const text = [e.message, ...err.mock.calls.flat().map(String)].join('\n')
      expect(text).not.toContain('SECRETKEY123')
      expect(text).not.toContain('OTHERKEY456')
    } finally {
      err.mockRestore()
    }
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/seoulApi.test.ts`
Expected: 새 블록의 테스트 대부분이 FAIL. 예: `maskedKey()`가 `'AAAA…(masked)'`를 돌려줘 `외 1개`가 없음, 호출 URL에 `K1,K2`가 들어감. 기존 테스트는 PASS.

- [ ] **Step 3: `src/client/seoulApi.ts` 교체**

파일 전체를 아래 내용으로 바꾼다. `SOFT_TTL`, `withNote`, `backoff`, `parseJsonWithXmlFallback`, `getJson`/`getXml`/`getSubway`, `fetchAll`은 기존과 같다.

```ts
import { XMLParser } from 'fast-xml-parser'
import { CompositeCache, InMemoryCache, type CacheBackend } from './cache.js'
import { unwrap, SeoulApiError, type Unwrapped } from './response.js'
import { InMemoryLedger, type QuotaLedger, type QuotaStatus } from './quota.js'
import { KeyPool, SAMPLE_KEY, maskKey, parseKeys, type PickedKey } from './keyPool.js'

const OPEN_BASE = 'http://openapi.seoul.go.kr:8088'
const SUBWAY_BASE = 'http://swopenapi.seoul.go.kr/api/subway'

/** ERROR-337을 받은 키를 풀에서 빼 두는 시간. 이 코드가 초당 제한이든 하루 한도든 손실이 작도록 10분으로 둔다 */
export const KEY_COOLDOWN_MS = 600_000

export const DEFAULT_SOFT_TTL = 3_600_000
// 원천 데이터 갱신 주기에 정렬 — 스펙 §5
export const SOFT_TTL: Record<string, number> = {
  citydata: 300_000, citydata_ppltn: 300_000, citydata_cmrcl: 300_000,
  realtimeStationArrival: 15_000,
  bikeList: 300_000, GetParkingInfo: 300_000, RealtimeCityAir: 300_000, AccInfo: 300_000,
  culturalEventInfo: 21_600_000,
  tbLnOpendataRtmsV: 21_600_000, tbLnOpendataRentV: 21_600_000,
  IndividuallyPostedLandPriceService: 86_400_000, // 연 1회 공시
  CardSubwayStatsNew: 86_400_000, CardBusStatisticsServiceNew: 86_400_000,
  SPOP_LOCAL_RESD_DONG: 86_400_000, SPOP_DAILYSUM_JACHI: 86_400_000,
  TbPharmacyOperateInfo: 86_400_000, TbHospitalInfo: 86_400_000, ChildCareInfo: 86_400_000,
  TimeAverageAirQuality: 3_600_000,
  // 시간표와 역 정보는 자료 변경 시에만 바뀐다. 시간대별 승하차는 월 1회 갱신
  SearchInfoBySubwayNameService: 86_400_000, SearchFirstAndLastTrainbyLineServiceNew: 86_400_000,
  SearchSTNTimeTableByIDService: 86_400_000, CardSubwayTime: 86_400_000,
  GetParkInfo: 86_400_000,
  // 공공서비스예약은 접수 상태가 하루 중에도 바뀐다
  ListPublicReservationCulture: 3_600_000, ListPublicReservationSport: 3_600_000, ListPublicReservationInstitution: 3_600_000,
  ListPublicReservationEducation: 3_600_000, ListPublicReservationMedical: 3_600_000,
}

/** 기존 note를 보존하며 안내를 병합한 사본 반환 */
export function withNote(u: Unwrapped, note: string): Unwrapped {
  return { ...u, note: u.note ? `${u.note} | ${note}` : note }
}

export interface ClientOptions {
  /** 일반 API 키. 쉼표로 구분한 여러 키도 받는다(앞 키부터 하루 한도까지 사용) */
  apiKey?: string
  subwayApiKey?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  /** 5xx·네트워크 오류 재시도 전 대기(ms). 기본 300 */
  retryDelayMs?: number
  now?: () => number
  ledger?: QuotaLedger
}

/** 업스트림 요청 하나를 키와 무관하게 기술한다. cacheKey는 URL의 키 자리를 {key}(샘플이면 sample)로 바꾼 값 */
interface Call {
  base: string
  pool: KeyPool
  type: 'json' | 'xml'
  service: string
  start: number
  end: number
  path: string[]
  cacheKey: string
}

export class SeoulApiClient {
  readonly isSample: boolean
  private pool: KeyPool
  private subwayPool: KeyPool
  private fetchFn: typeof fetch
  private timeoutMs: number
  private retryDelayMs: number
  private cache: CompositeCache
  private xml = new XMLParser({ ignoreDeclaration: true })
  private inflight = new Map<string, Promise<Unwrapped>>()
  private nowFn: () => number
  private ledger: QuotaLedger

  constructor(opts: ClientOptions = {}) {
    this.nowFn = opts.now ?? Date.now
    this.pool = new KeyPool(parseKeys(opts.apiKey ?? process.env.SEOUL_API_KEY), this.nowFn)
    this.isSample = this.pool.isSample
    // 지하철 키는 하나만 쓴다. 없으면 일반 풀의 첫 키(샘플 모드면 샘플)
    const subway = parseKeys(opts.subwayApiKey ?? process.env.SEOUL_SUBWAY_API_KEY)[0]
    this.subwayPool = new KeyPool([subway === SAMPLE_KEY ? this.pool.first : subway], this.nowFn)
    this.fetchFn = opts.fetchFn ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 15_000
    this.retryDelayMs = opts.retryDelayMs ?? 300
    this.cache = new CompositeCache(new InMemoryCache(opts.now), undefined, this.nowFn)
    this.ledger = opts.ledger ?? new InMemoryLedger(undefined, opts.now)
  }

  /** 캐시 원장(전역 L2 등) 교체용 — 실패해도 요청 자체는 계속 동작해야 한다 */
  setLedger(l: QuotaLedger): void {
    this.ledger = l
  }

  /** L2 캐시(DynamoDB 등) 연결용 — 캐시의 private 필드를 우회하기 위한 위임 */
  attachL2(l2: CacheBackend): void {
    this.cache.setL2(l2)
  }

  private async safeStatus(keyId: string): Promise<QuotaStatus> {
    try {
      return await this.ledger.status(keyId)
    } catch (e) {
      console.error(`[quota] status 조회 실패 — 무제한으로 폴백: ${(e as Error).message}`)
      return { used: 0, limit: Infinity, ratio: 0 }
    }
  }

  private async safeIncrement(keyId: string): Promise<void> {
    try {
      await this.ledger.increment(keyId)
    } catch (e) {
      console.error(`[quota] increment 실패 — 무시: ${(e as Error).message}`)
    }
  }

  /** 일반 풀의 첫 키를 마스킹한다. 키가 여러 개면 나머지 개수를 붙인다 */
  maskedKey(): string {
    const head = maskKey(this.pool.first)
    const rest = this.pool.keys.length - 1
    return rest > 0 ? `${head} 외 ${rest}개` : head
  }

  maskedSubwayKey(): string {
    return maskKey(this.subwayPool.first)
  }

  private buildUrl(base: string, key: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): string {
    const segs = [key, type, service, String(start), String(end), ...path.map(encodeURIComponent)]
    return `${base}/${segs.join('/')}`
  }

  private async backoff(): Promise<void> {
    if (this.retryDelayMs > 0) await new Promise(r => setTimeout(r, this.retryDelayMs))
  }

  /** 5xx·네트워크 오류는 retryDelayMs 후 1회 재시도. 타임아웃은 재시도하지 않는다 — 최악 대기를 timeoutMs 1회로 묶기 위함 */
  private async request(url: string, key: string): Promise<string> {
    const masked = maskKey(key)
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) })
        if (!res.ok) {
          await res.body?.cancel().catch(() => {}) // 버리는 본문이 커넥션을 붙잡지 않도록 정리
          if (res.status >= 500 && attempt === 0) { await this.backoff(); continue }
          throw new SeoulApiError(`HTTP-${res.status}`, `HTTP ${res.status} (key=${masked})`)
        }
        return await res.text()
      } catch (e) {
        if (e instanceof SeoulApiError) throw e
        if ((e as Error)?.name === 'TimeoutError') {
          throw new SeoulApiError('TIMEOUT', `응답 시간 초과(${this.timeoutMs / 1000}초) (key=${masked})`)
        }
        if (attempt === 0) { await this.backoff(); continue } // 네트워크 오류 1회 재시도
        throw new SeoulApiError('NETWORK', `네트워크 오류: ${(e as Error).message} (key=${masked})`)
      }
    }
  }

  /** API가 호출 제한 등 에러를 JSON 요청에도 XML(<RESULT>...)로 반환하는 경우가 있어 폴백 파싱한다 */
  private parseJsonWithXmlFallback(service: string, text: string): any {
    try {
      return JSON.parse(text)
    } catch {
      if (text.trimStart().startsWith('<')) return this.xml.parse(text)
      throw new SeoulApiError('PARSE', `응답 파싱 실패 (${service}): ${text.slice(0, 120)}`)
    }
  }

  private async fetchUnwrapped(base: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): Promise<Unwrapped> {
    const pool = base === SUBWAY_BASE ? this.subwayPool : this.pool
    // 샘플 키는 요청당 최대 5건 제한(ERROR-335) — 범위를 클램프해 맛보기 모드로 동작시킨다
    if (pool.isSample) end = Math.min(end, start + 4)
    // 캐시 키에는 원문 키 대신 자리 표시를 넣는다. 키가 바뀌어도 같은 요청은 같은 캐시 항목을 쓴다.
    // 샘플 응답(5건 제한)이 실제 키 응답 자리에 섞이지 않도록 샘플 모드는 별도 표시를 쓴다
    const cacheKey = this.buildUrl(base, pool.isSample ? SAMPLE_KEY : '{key}', type, service, start, end, path)
    const call: Call = { base, pool, type, service, start, end, path, cacheKey }

    const cached = await this.cache.get(cacheKey)
    // ledger 예외는 safeStatus 내부에서 무제한으로 폴백.
    // soft 한도: 확인(여기)과 증가(fetchWithKey 성공 후)가 분리돼 있어, 한도 직전의 동시 요청은 한도를 조금 넘을 수 있다(의도된 동작)
    const picked = await pool.pick(id => this.safeStatus(id))
    const budget = picked.pool

    if (picked.exhausted) {
      if (cached) {
        const ageMin = Math.round((this.nowFn() - cached.entry.storedAt) / 60_000)
        return withNote(cached.entry.value, `일일 API 쿼터 소진 — 캐시된 데이터(약 ${ageMin}분 경과)로 응답합니다`)
      }
      return {
        rows: [], totalCount: 0,
        note: `일일 API 쿼터(${budget.limit}회)가 소진되어 새 데이터를 가져올 수 없습니다. 내일 자정(KST) 이후 재시도하세요.`,
      }
    }

    if (cached?.freshness === 'fresh') return cached.entry.value

    if (cached) {
      // stale: 즉시 반환 + 백그라운드 갱신 (실패는 로그만 — 다음 요청이 재시도). 고를 키가 있으므로 갱신 발화 허용
      void this.fetchFresh(call, picked).catch(e =>
        console.error(`[cache] 백그라운드 갱신 실패(${service}): ${(e as Error).message}`))
      const ageMin = Math.round((this.nowFn() - cached.entry.storedAt) / 60_000)
      return withNote(cached.entry.value, `캐시된 데이터(약 ${ageMin}분 경과) — 백그라운드 갱신 중`)
    }

    const result = await this.fetchFresh(call, picked)
    if (budget.ratio >= 0.8) {
      return withNote(result, `일일 API 쿼터 ${Math.round(budget.ratio * 100)}% 사용(${budget.used}/${budget.limit})`)
    }
    return result
  }

  /** 실제 업스트림 호출 — 같은 캐시 키의 동시 요청은 고른 키가 달라도 1회로 병합(single-flight) */
  private fetchFresh(call: Call, picked: PickedKey): Promise<Unwrapped> {
    const existing = this.inflight.get(call.cacheKey)
    if (existing) return existing
    const p = this.fetchWithFailover(call, picked).finally(() => this.inflight.delete(call.cacheKey))
    this.inflight.set(call.cacheKey, p)
    return p
  }

  /** 키가 둘 이상일 때 ERROR-337이면 그 키를 쿨다운에 넣고 다른 키로 한 번만 다시 부른다. 키가 하나면 오류를 그대로 던진다 */
  private async fetchWithFailover(call: Call, picked: PickedKey): Promise<Unwrapped> {
    try {
      return await this.fetchWithKey(call, picked)
    } catch (e) {
      if (!(e instanceof SeoulApiError) || e.code !== 'ERROR-337' || call.pool.keys.length < 2) throw e
      call.pool.cooldown(picked.key, KEY_COOLDOWN_MS)
      console.error(`[quota] ERROR-337: 키 ${maskKey(picked.key)}를 ${KEY_COOLDOWN_MS / 60_000}분 동안 빼고 다른 키로 다시 호출합니다`)
      const next = await call.pool.pick(id => this.safeStatus(id))
      if (next.exhausted) throw e
      return await this.fetchWithKey(call, next)
    }
  }

  private async fetchWithKey(call: Call, picked: PickedKey): Promise<Unwrapped> {
    const url = this.buildUrl(call.base, picked.key, call.type, call.service, call.start, call.end, call.path)
    const text = await this.request(url, picked.key)
    await this.safeIncrement(picked.keyId) // 원장 장애는 요청을 죽이지 않는다
    const payload = call.type === 'xml' ? this.xml.parse(text) : this.parseJsonWithXmlFallback(call.service, text)
    const result = unwrap(call.service, payload)
    await this.cache.set(call.cacheKey, result, SOFT_TTL[call.service] ?? DEFAULT_SOFT_TTL)
    return result
  }

  getJson(service: string, start: number, end: number, path: string[] = []) {
    return this.fetchUnwrapped(OPEN_BASE, 'json', service, start, end, path)
  }
  getXml(service: string, start: number, end: number, path: string[] = []) {
    return this.fetchUnwrapped(OPEN_BASE, 'xml', service, start, end, path)
  }
  getSubway(service: string, start: number, end: number, path: string[] = []) {
    return this.fetchUnwrapped(SUBWAY_BASE, 'json', service, start, end, path)
  }

  /** 표준 봉투 서비스의 페이지를 totalCount 또는 max까지 자동 순회 병합 — note도 페이지 전체에서 손실 없이 병합 */
  async fetchAll(service: string, opts: { max: number; pageSize?: number; path?: string[] }): Promise<{ rows: any[]; note?: string }> {
    const pageSize = opts.pageSize ?? 1000
    const max = this.isSample ? Math.min(opts.max, 5) : opts.max
    const rows: any[] = []
    let note: string | undefined
    for (let start = 1; rows.length < max; start += pageSize) {
      const u = await this.getJson(service, start, Math.min(start + pageSize - 1, max), opts.path ?? [])
      rows.push(...u.rows)
      if (u.note) note = note && !note.includes(u.note) ? `${note} | ${u.note}` : (note ?? u.note)
      if (rows.length >= u.totalCount || u.rows.length === 0) break
    }
    return { rows: rows.slice(0, max), note }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/seoulApi.test.ts tests/keyPool.test.ts tests/dynamo.test.ts tests/notes.test.ts`
Expected: PASS. 기존 테스트도 모두 통과해야 한다(키가 하나일 때 동작이 같다는 증거).

Run: `npm run build && npm test`
Expected: tsc 오류 없음, 전체 PASS.

- [ ] **Step 5: 기동 로그에 마스킹한 키 표시**

`src/http.ts`의 `listen` 콜백에서 아래 한 줄을

```ts
  if (client.isSample) console.error(`[${SERVER_NAME}] SEOUL_API_KEY 미설정 — 샘플 키로 동작합니다.`)
```

다음으로 바꾼다.

```ts
  if (client.isSample) console.error(`[${SERVER_NAME}] SEOUL_API_KEY 미설정 — 샘플 키로 동작합니다.`)
  else console.error(`[${SERVER_NAME}] SEOUL_API_KEY ${client.maskedKey()}`)
```

Run: `npx vitest run tests/http.test.ts`
Expected: PASS

- [ ] **Step 6: 문서 갱신**

`src/client/CLAUDE.md`의 Key Files에서 `seoulApi.ts` 항목 다음 줄에 추가:

```md
- `keyPool.ts` - `parseKeys`(쉼표 목록, 비면 `['sample']`) / `maskKey`(로그와 오류 메시지의 유일한 키 표기) / `KeyPool`(앞 키부터 하루 한도까지 쓰고 다음 키로, `ERROR-337` 쿨다운은 프로세스 메모리에만).
```

같은 파일 Rules 끝에 두 줄 추가:

```md
- 캐시 키(L1, L2, single-flight 맵)에는 원문 키를 넣지 않습니다. URL의 키 자리를 `{key}`(샘플 모드는 `sample`)로 바꾼 값을 씁니다.
- 호출에 쓸 키는 `KeyPool.pick()`만 고릅니다. 오류 메시지에는 실제로 호출에 쓴 키를 `maskKey()`로만 넣습니다.
```

`docs/reference/security.md`의 English 표에서 아래 세 행을 바꾸고 한 행을 추가한다.

바꿀 행(기존):
```md
| `SeoulApiClient` constructor | `src/client/seoulApi.ts:53-63` | Selects the active key (`opts.apiKey ?? process.env.SEOUL_API_KEY ?? 'sample'`) and derives `isSample` |
| `maskedKey` / `maskedSubwayKey` | `src/client/seoulApi.ts:92-98` | Expose only the first 4 characters of a real key (or the literal `sample`), never the full value |
| `request` error paths | `src/client/seoulApi.ts:110-129` | Embed only the masked key in `HTTP-<status>`, `TIMEOUT` and `NETWORK` `SeoulApiError` messages |
```
새 행:
```md
| `SeoulApiClient` constructor | `src/client/seoulApi.ts` | Builds the general key pool from `opts.apiKey ?? process.env.SEOUL_API_KEY` (comma-separated, `parseKeys`) and a one-key subway pool; `isSample` is true only when the general pool is the sample key alone |
| `KeyPool` | `src/client/keyPool.ts` | Picks the first key under its daily limit that is not cooling down; raw keys stay in memory and the ledger sees only `keyIdOf()` hashes |
| `maskKey` / `maskedKey` / `maskedSubwayKey` | `src/client/keyPool.ts`, `src/client/seoulApi.ts` | Expose only the first 4 characters of a real key (or the literal `sample`); `maskedKey()` appends `외 N개` when the pool holds more keys |
| `request` error paths | `src/client/seoulApi.ts` | Embed only the masked key that was actually used in `HTTP-<status>`, `TIMEOUT` and `NETWORK` `SeoulApiError` messages |
| Cache key | `src/client/seoulApi.ts` (`fetchUnwrapped`) | The request URL with the key segment replaced by `{key}` (`sample` in sample mode), so neither L1, L2 nor the single-flight map holds a raw key |
```

한국어 표에서 대응하는 세 행을 바꾸고 같은 위치에 두 행을 추가한다.

바꿀 행(기존):
```md
| `SeoulApiClient` 생성자 | `src/client/seoulApi.ts:53-63` | 활성 키(`opts.apiKey ?? process.env.SEOUL_API_KEY ?? 'sample'`)를 선택하고 `isSample`을 도출합니다 |
| `maskedKey` / `maskedSubwayKey` | `src/client/seoulApi.ts:92-98` | 실제 키의 앞 4글자만(또는 리터럴 `sample`) 노출하며, 전체 값은 절대 노출하지 않습니다 |
| `request` 에러 경로 | `src/client/seoulApi.ts:110-129` | `HTTP-<status>`, `TIMEOUT`, `NETWORK` `SeoulApiError` 메시지에 마스킹된 키만 포함시킵니다 |
```
새 행:
```md
| `SeoulApiClient` 생성자 | `src/client/seoulApi.ts` | `opts.apiKey ?? process.env.SEOUL_API_KEY`(쉼표 목록, `parseKeys`)로 일반 키 풀을, 키 하나로 지하철 풀을 만듭니다. 일반 풀이 샘플 키 하나일 때만 `isSample`이 참입니다 |
| `KeyPool` | `src/client/keyPool.ts` | 하루 한도 미만이고 쿨다운 중이 아닌 첫 키를 고릅니다. 원문 키는 메모리에만 두고 장부에는 `keyIdOf()` 해시만 넘깁니다 |
| `maskKey` / `maskedKey` / `maskedSubwayKey` | `src/client/keyPool.ts`, `src/client/seoulApi.ts` | 실제 키의 앞 4글자만(또는 리터럴 `sample`) 보여 줍니다. 풀에 키가 더 있으면 `maskedKey()`가 `외 N개`를 붙입니다 |
| `request` 에러 경로 | `src/client/seoulApi.ts` | `HTTP-<status>`, `TIMEOUT`, `NETWORK` `SeoulApiError` 메시지에 실제로 호출에 쓴 키의 마스킹만 넣습니다 |
| 캐시 키 | `src/client/seoulApi.ts`(`fetchUnwrapped`) | 요청 URL의 키 자리를 `{key}`(샘플 모드는 `sample`)로 바꾼 값입니다. L1, L2, single-flight 맵 어디에도 원문 키가 남지 않습니다 |
```

`docs/reference/api.md`의 English "3. Key Decisions"에서 "The daily quota is a soft limit" 항목 바로 다음에 추가:

```md
- Key pool: `SEOUL_API_KEY` may list several keys separated by commas. Each upstream call uses the first key that is under its daily limit and not cooling down; when no key is left the client answers from the cache only. The 80% note and the exhausted note use the pool totals. With two or more keys, `ERROR-337` cools that key down for 10 minutes (process memory only) and retries once with the next key; a single key, sample included, throws as before. The cache key replaces the key segment of the URL with `{key}` (`sample` in sample mode), so switching keys keeps cache hits. Because 0.7.0 changes this format, existing L2 entries miss once and expire within 24 h.
```

한국어 "3. 주요 결정"에서 "일일 쿼터는 soft 한도입니다" 항목 바로 다음에 추가:

```md
- 키 풀: `SEOUL_API_KEY`에 쉼표로 여러 키를 넣을 수 있습니다. 업스트림 호출마다 하루 한도 미만이고 쿨다운 중이 아닌 첫 키를 쓰고, 남은 키가 없으면 캐시로만 응답합니다. 80% 안내와 소진 안내는 풀 합계를 기준으로 합니다. 키가 둘 이상일 때 `ERROR-337`이 나면 그 키를 10분 동안 빼고(프로세스 메모리에만 기록) 다음 키로 한 번 다시 호출합니다. 키가 하나면(샘플 포함) 지금처럼 오류를 던집니다. 캐시 키는 URL의 키 자리를 `{key}`(샘플 모드는 `sample`)로 바꾼 값이라 키를 바꿔도 캐시가 적중합니다. 0.7.0에서 이 형식이 바뀌므로 기존 L2 항목은 한 번 빗나가고 24시간 안에 만료됩니다.
```

`README.md`에서 네 줄을 바꾼다.

- 95행 `- \`SEOUL_API_KEY\` — issued free at data.seoul.go.kr. Leave empty for sample mode (single 광화문·덕수궁 hotspot only)` 끝에 `. Several keys may be given separated by commas; the server moves to the next key when one reaches its daily limit`를 붙인다.
- 176행 표 `| \`SEOUL_API_KEY\` | General API key (same as stdio mode). | \`sample\` |`를 `| \`SEOUL_API_KEY\` | General API key (same as stdio mode). Comma-separated keys rotate when one reaches its daily limit. | \`sample\` |`로 바꾼다.
- 417행 `- \`SEOUL_API_KEY\` — data.seoul.go.kr에서 무료 발급. 비우면 샘플 모드(광화문·덕수궁 단일 핫스팟 한정)로 동작` 끝에 `. 쉼표로 여러 키를 넣으면 한 키가 하루 한도에 닿을 때 다음 키로 넘어갑니다`를 붙인다.
- 498행 표 `| \`SEOUL_API_KEY\` | 일반 API 키(stdio 모드와 동일). | \`sample\` |`를 `| \`SEOUL_API_KEY\` | 일반 API 키(stdio 모드와 동일). 쉼표로 여러 키를 넣으면 하루 한도에 닿은 키 다음 키를 씁니다. | \`sample\` |`로 바꾼다.

행 번호가 맞지 않으면 `grep -n "SEOUL_API_KEY" README.md`로 찾는다.

- [ ] **Step 7: 전체 테스트와 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add src/client/seoulApi.ts src/http.ts tests/seoulApi.test.ts src/client/CLAUDE.md docs/reference/security.md docs/reference/api.md README.md
git commit -m "feat: rotate comma-separated API keys with key-independent cache keys" -m "SEOUL_API_KEY accepts several keys. The client picks the first key under its daily limit, cools a key down for 10 minutes on ERROR-337 when another key exists, and caches under a URL whose key segment is {key}. Existing L2 entries miss once after this change." -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---
### Task 3: 코드 검사 인터셉터 Lambda

**Files:**
- Create: `infra/lambda/code-check.mjs`
- Test: `tests/infra/codeCheck.test.ts`
- Modify: `docs/reference/security.md` (표에 한 행씩)

**Interfaces:**
- Consumes: 없음(Node 내장 `node:crypto`, Lambda 런타임 내장 `@aws-sdk/client-dynamodb`)
- Produces:
  - `export function minuteKey(ms: number): string` → `rate#YYYYMMDDHHmm`(UTC)
  - `export function createHandler(opts: { codeSha256?: string; validUntil?: string; ratePerMinute: number; incr: (pk: string, expireAt: number) => Promise<number>; now?: () => number; log?: (line: string) => void }): (event) => Promise<object>`
  - `export const handler` (Lambda 진입점, 환경 변수 `CODE_SHA256`, `VALID_UNTIL`, `RATE_PER_MINUTE`, `TABLE_NAME`)
  - 응답 계약(스펙 3.1~3.2):
    - 통과: `{ interceptorOutputVersion: '1.0', mcp: { transformedGatewayRequest: { body } } }`
    - 코드 오류와 만료: `transformedGatewayResponse: { statusCode: 403, body: { jsonrpc: '2.0', id, error: { code: -32001, message } } }`
    - 분당 한도 초과: `transformedGatewayResponse: { statusCode: 200, body: { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text }] } } }`
  - 로그 한 줄: `JSON.stringify({ method, tool, decision })`, `decision`은 `pass` | `bad_code` | `expired` | `rate_limited` | `rate_check_failed`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/infra/codeCheck.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createHandler, minuteKey } from '../../infra/lambda/code-check.mjs'

const CODE = 'seoul-ABCD-2345'
const HASH = createHash('sha256').update(CODE).digest('hex')
const NOW = Date.parse('2026-11-19T10:00:00+09:00')
const auth = { Authorization: `Bearer ${CODE}` }

const event = (headers: Record<string, string> | undefined, body: any) => ({
  interceptorInputVersion: '1.0',
  mcp: { gatewayRequest: { path: '/mcp', httpMethod: 'POST', ...(headers ? { headers } : {}), body } },
})
const callBody = (id: number) => ({
  jsonrpc: '2.0', id, method: 'tools/call',
  params: { name: 'seoul___get_city_snapshot', arguments: { place: '강남역' } },
})
const listBody = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/list' })
const response = (out: any) => out.mcp.transformedGatewayResponse

function setup(over: Record<string, unknown> = {}) {
  const logs: string[] = []
  let count = 0
  const handler = createHandler({
    codeSha256: HASH,
    validUntil: '2026-11-20T18:00:00+09:00',
    ratePerMinute: 2,
    incr: async () => ++count,
    now: () => NOW,
    log: (line: string) => { logs.push(line) },
    ...over,
  })
  return { handler, logs }
}

describe('code-check 인터셉터', () => {
  it('올바른 코드면 요청 본문을 바꾸지 않고 넘긴다', async () => {
    const { handler, logs } = setup()
    const body = listBody(1)
    const out = await handler(event(auth, body))
    expect(out).toEqual({ interceptorOutputVersion: '1.0', mcp: { transformedGatewayRequest: { body } } })
    expect(JSON.parse(logs[0])).toEqual({ method: 'tools/list', tool: null, decision: 'pass' })
  })

  it('헤더 이름과 Bearer의 대소문자를 가리지 않는다', async () => {
    const { handler } = setup()
    const out = await handler(event({ authorization: `bearer ${CODE}` }, listBody(1)))
    expect(out.mcp.transformedGatewayRequest).toBeDefined()
  })

  it.each([
    ['헤더 없음', undefined],
    ['Bearer 없음', { Authorization: CODE }],
    ['틀린 코드', { Authorization: 'Bearer seoul-WRNG-CODE' }],
  ])('%s이면 403과 -32001', async (_name, headers) => {
    const { handler, logs } = setup()
    const out = await handler(event(headers as Record<string, string> | undefined, listBody(7)))
    expect(response(out)).toEqual({
      statusCode: 403,
      body: { jsonrpc: '2.0', id: 7, error: { code: -32001, message: expect.stringContaining('워크숍 코드가 올바르지 않습니다') } },
    })
    expect(JSON.parse(logs[0]).decision).toBe('bad_code')
  })

  it('CODE_SHA256이 비어 있으면 모두 거부한다', async () => {
    const { handler } = setup({ codeSha256: '' })
    expect(response(await handler(event(auth, listBody(1)))).statusCode).toBe(403)
  })

  it.each([
    ['만료 시각이 지남', '2026-11-19T09:59:59+09:00'],
    ['만료 시각이 비어 있음', ''],
    ['만료 시각을 해석할 수 없음', 'tomorrow'],
  ])('%s이면 403 만료 안내', async (_name, validUntil) => {
    const { handler, logs } = setup({ validUntil })
    const out = await handler(event(auth, listBody(2)))
    expect(response(out).statusCode).toBe(403)
    expect(response(out).body.error.message).toContain('만료')
    expect(JSON.parse(logs[0]).decision).toBe('expired')
  })

  it('분당 한도를 넘은 tools/call은 200과 isError 결과로 돌려준다', async () => {
    const { handler, logs } = setup()
    await handler(event(auth, callBody(1)))
    await handler(event(auth, callBody(2)))
    const out = await handler(event(auth, callBody(3)))
    expect(response(out)).toEqual({
      statusCode: 200,
      body: { jsonrpc: '2.0', id: 3, result: { isError: true, content: [{ type: 'text', text: expect.stringContaining('1분 뒤') }] } },
    })
    expect(JSON.parse(logs[2])).toEqual({ method: 'tools/call', tool: 'seoul___get_city_snapshot', decision: 'rate_limited' })
  })

  it('tools/list는 카운터를 올리지 않고 통과한다', async () => {
    let calls = 0
    const { handler } = setup({ incr: async () => { calls++; return 99 } })
    const out = await handler(event(auth, listBody(1)))
    expect(out.mcp.transformedGatewayRequest).toBeDefined()
    expect(calls).toBe(0)
  })

  it('카운터가 실패하면 통과시키고 rate_check_failed를 남긴다', async () => {
    const { handler, logs } = setup({ incr: async () => { throw new Error('ddb down') } })
    const out = await handler(event(auth, callBody(1)))
    expect(out.mcp.transformedGatewayRequest).toBeDefined()
    expect(JSON.parse(logs[0]).decision).toBe('rate_check_failed')
  })

  it('카운터 키는 UTC 분 단위이고 만료는 120초 뒤다', async () => {
    const seen: Array<[string, number]> = []
    const { handler } = setup({ incr: async (pk: string, expireAt: number) => { seen.push([pk, expireAt]); return 1 } })
    await handler(event(auth, callBody(1)))
    expect(seen).toEqual([['rate#202611190100', Math.floor(NOW / 1000) + 120]])
    expect(minuteKey(NOW)).toBe('rate#202611190100')
  })

  it('id가 없는 요청(알림)은 id null로 거부한다', async () => {
    const { handler } = setup()
    const out = await handler(event(undefined, { jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(response(out).body.id).toBeNull()
  })

  it('로그에 코드와 헤더 값이 남지 않는다', async () => {
    const { handler, logs } = setup()
    await handler(event({ ...auth, 'X-Secret': 'header-value' }, callBody(1)))
    await handler(event({ Authorization: 'Bearer seoul-WRNG-CODE' }, callBody(2)))
    const text = logs.join('\n')
    for (const s of [CODE, 'seoul-WRNG-CODE', 'header-value', 'Bearer', HASH]) expect(text).not.toContain(s)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/infra/codeCheck.test.ts`
Expected: FAIL, `Failed to resolve import "../../infra/lambda/code-check.mjs"`

- [ ] **Step 3: 구현**

`infra/lambda/code-check.mjs`:

```js
// AgentCore Gateway REQUEST interceptor for the Seoul workshop gateway.
// Design: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md section 3.
// Never log headers, the code or its hash: the gateway passes Authorization to this function.
import { createHash, timingSafeEqual } from 'node:crypto'

const MESSAGES = {
  bad_code: '워크숍 코드가 올바르지 않습니다. Authorization: Bearer <코드> 헤더를 확인하세요. / Invalid workshop code.',
  expired: '워크숍 코드가 만료되었습니다. 진행자에게 새 코드를 받으세요. / Workshop code expired.',
  rate_limited: '요청이 많습니다. 1분 뒤 다시 시도하세요. / Too many requests, retry in a minute.',
}
const DEFAULT_RATE_PER_MINUTE = 120

/** UTC minute bucket of the per-minute counter, e.g. rate#202611190100 */
export function minuteKey(ms) {
  return `rate#${new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
}

function bearerToken(headers) {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== 'authorization' || typeof value !== 'string') continue
    const match = /^Bearer\s+(.+)$/i.exec(value.trim())
    return match ? match[1].trim() : undefined
  }
  return undefined
}

function codeMatches(code, codeSha256) {
  if (!code || !/^[0-9a-f]{64}$/i.test(codeSha256 ?? '')) return false
  const actual = createHash('sha256').update(code).digest()
  return timingSafeEqual(actual, Buffer.from(codeSha256, 'hex'))
}

const pass = body => ({ interceptorOutputVersion: '1.0', mcp: { transformedGatewayRequest: { body } } })

const deny = (id, message) => ({
  interceptorOutputVersion: '1.0',
  mcp: { transformedGatewayResponse: { statusCode: 403, body: { jsonrpc: '2.0', id, error: { code: -32001, message } } } },
})

const limited = id => ({
  interceptorOutputVersion: '1.0',
  mcp: {
    transformedGatewayResponse: {
      statusCode: 200,
      body: { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: MESSAGES.rate_limited }] } },
    },
  },
})

export function createHandler({ codeSha256, validUntil, ratePerMinute, incr, now = Date.now, log = console.log }) {
  const until = Date.parse(validUntil ?? '')
  return async event => {
    const request = event?.mcp?.gatewayRequest ?? {}
    const body = request.body ?? {}
    const id = body.id ?? null
    const method = typeof body.method === 'string' ? body.method : null
    const tool = method === 'tools/call' && typeof body.params?.name === 'string' ? body.params.name : null
    const finish = (decision, output) => {
      log(JSON.stringify({ method, tool, decision }))
      return output
    }

    if (!codeMatches(bearerToken(request.headers), codeSha256)) return finish('bad_code', deny(id, MESSAGES.bad_code))
    if (!Number.isFinite(until) || now() >= until) return finish('expired', deny(id, MESSAGES.expired))
    if (method === 'tools/call') {
      try {
        const t = now()
        const count = await incr(minuteKey(t), Math.floor(t / 1000) + 120)
        if (count > ratePerMinute) return finish('rate_limited', limited(id))
      } catch {
        // The counter guards against runaway loops, not against strangers: let the call through.
        return finish('rate_check_failed', pass(body))
      }
    }
    return finish('pass', pass(body))
  }
}

function parseRate(raw) {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RATE_PER_MINUTE
}

let dynamo
/** Atomic add on the minute bucket in the workshop table; returns the new count */
async function incrementMinute(pk, expireAt) {
  if (!dynamo) {
    const { DynamoDBClient, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb')
    dynamo = { client: new DynamoDBClient({}), UpdateItemCommand }
  }
  const out = await dynamo.client.send(new dynamo.UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: { pk: { S: pk } },
    UpdateExpression: 'ADD n :one SET expireAt = if_not_exists(expireAt, :exp)',
    ExpressionAttributeValues: { ':one': { N: '1' }, ':exp': { N: String(expireAt) } },
    ReturnValues: 'UPDATED_NEW',
  }))
  return Number(out.Attributes.n.N)
}

export const handler = createHandler({
  codeSha256: process.env.CODE_SHA256,
  validUntil: process.env.VALID_UNTIL,
  ratePerMinute: parseRate(process.env.RATE_PER_MINUTE),
  incr: incrementMinute,
})
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/infra/codeCheck.test.ts`
Expected: PASS (15 tests)

Run: `node --check infra/lambda/code-check.mjs`
Expected: 출력 없음(문법 오류 없음)

- [ ] **Step 5: 보안 문서에 한 행 추가**

`docs/reference/security.md` English 표 끝(`install-hooks.sh` 행 다음)에 추가:

```md
| `code-check.mjs` | `infra/lambda/code-check.mjs` | Workshop gateway REQUEST interceptor: compares the sha256 of the `Bearer` code with `CODE_SHA256` in constant time, checks `VALID_UNTIL`, limits `tools/call` per minute, and logs only `{method, tool, decision}` |
```

한국어 표 끝에 추가:

```md
| `code-check.mjs` | `infra/lambda/code-check.mjs` | 워크숍 Gateway REQUEST 인터셉터. `Bearer` 코드의 sha256을 `CODE_SHA256`과 상수 시간으로 비교하고, `VALID_UNTIL`과 분당 `tools/call` 한도를 확인합니다. 로그에는 `{method, tool, decision}`만 남깁니다 |
```

- [ ] **Step 6: 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add infra/lambda/code-check.mjs tests/infra/codeCheck.test.ts docs/reference/security.md
git commit -m "feat: add workshop gateway code-check interceptor" -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---
### Task 4: 스택 템플릿과 구조 테스트

**Files:**
- Create: `infra/seoul-workshop.yaml`, `infra/CLAUDE.md`
- Test: `tests/infra/workshopTemplate.test.ts`
- Modify: `package.json`, `package-lock.json` (devDependency `js-yaml`, `@types/js-yaml`), `.mcpbignore`, `.dockerignore`

**Interfaces:**
- Consumes: Task 3의 Lambda 핸들러 이름 `code-check.handler`와 환경 변수 이름
- Produces (Task 5~8이 쓰는 이름):
  - 파라미터: `McpImageUri`, `McpRepositoryName`, `CodeKey`, `SeoulApiKey`, `SeoulSubwayApiKey`, `CodeSha256`, `CodeValidUntil`, `RatePerMinute`, `QuotaDailyLimit`
  - 출력: `BucketName`, `TableName`(항상), `RuntimeId`, `RuntimeArn`(`HasImage`), `GatewayId`, `GatewayUrl`, `TargetId`(`HasAll`)
  - Lambda 함수 이름 `<스택 이름>-code-check`

- [ ] **Step 1: 테스트 도구 설치**

Run: `npm install --save-dev js-yaml@4 @types/js-yaml@4`
Expected: `package.json` devDependencies에 두 항목 추가

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/infra/workshopTemplate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

const TEXT = readFileSync(new URL('../../infra/seoul-workshop.yaml', import.meta.url), 'utf8')
// CloudFormation 짧은 태그를 { Ref: ... } 같은 객체로 읽는다
const FNS = ['Ref', 'Sub', 'GetAtt', 'Not', 'Equals', 'And', 'Or', 'If', 'Condition', 'Join', 'Select', 'Split']
const KINDS = ['scalar', 'sequence', 'mapping'] as const
const SCHEMA = yaml.DEFAULT_SCHEMA.extend(
  FNS.flatMap(fn => KINDS.map(kind => new yaml.Type(`!${fn}`, { kind, construct: (d: unknown) => ({ [fn]: d }) }))),
)
const T = yaml.load(TEXT, { schema: SCHEMA }) as any
const R = T.Resources

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v])
const statements = (role: string): any[] =>
  R[role].Properties.Policies.flatMap((p: any) => p.PolicyDocument.Statement)

describe('infra/seoul-workshop.yaml', () => {
  it('런타임은 V2, MCP, PUBLIC이고 인바운드 인증을 따로 두지 않는다', () => {
    const rt = R.WorkshopRuntime
    expect(rt.Type).toBe('AWS::BedrockAgentCore::Runtime')
    expect(rt.Condition).toBe('HasImage')
    const p = rt.Properties
    expect(p.AgentRuntimeName).toBe('seoul_workshop_mcp')
    expect(p.PlatformVersion).toBe('V2')
    expect(p.ProtocolConfiguration).toBe('MCP')
    expect(p.NetworkConfiguration).toEqual({ NetworkMode: 'PUBLIC' })
    expect(p.AuthorizerConfiguration).toBeUndefined()
    expect(p.LifecycleConfiguration).toEqual({ IdleRuntimeSessionTimeout: 900, MaxLifetime: 28800 })
    expect(p.EnvironmentVariables).toEqual({
      SEOUL_API_KEY: { Ref: 'SeoulApiKey' },
      SEOUL_SUBWAY_API_KEY: { Ref: 'SeoulSubwayApiKey' },
      CACHE_TABLE_NAME: { Ref: 'WorkshopTable' },
      QUOTA_DAILY_LIMIT: { Ref: 'QuotaDailyLimit' },
    })
  })

  it('Gateway는 인증 없음과 헤더를 받는 REQUEST 인터셉터 하나로 막는다', () => {
    const gw = R.WorkshopGateway
    expect(gw.Type).toBe('AWS::BedrockAgentCore::Gateway')
    expect(gw.Condition).toBe('HasAll')
    const p = gw.Properties
    expect(p.AuthorizerType).toBe('NONE')
    expect(p.AuthorizerConfiguration).toBeUndefined()
    expect(p.InterceptorConfigurations).toEqual([{
      Interceptor: { Lambda: { Arn: { GetAtt: 'CodeCheckFunction.Arn' } } },
      InterceptionPoints: ['REQUEST'],
      InputConfiguration: { PassRequestHeaders: true },
    }])
    expect(p.ProtocolConfiguration.Mcp.SearchType).toBeUndefined()
    expect(p.ProtocolConfiguration.Mcp.SupportedVersions).toEqual(['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'])
  })

  it('대상 seoul은 Gateway 역할의 SigV4로 런타임을 부른다', () => {
    const tg = R.SeoulTarget
    expect(tg.Type).toBe('AWS::BedrockAgentCore::GatewayTarget')
    expect(tg.Condition).toBe('HasAll')
    expect(tg.Properties.Name).toBe('seoul')
    expect(tg.Properties.GatewayIdentifier).toEqual({ Ref: 'WorkshopGateway' })
    expect(tg.Properties.CredentialProviderConfigurations).toEqual([{
      CredentialProviderType: 'GATEWAY_IAM_ROLE',
      CredentialProvider: { IamCredentialProvider: { Service: 'bedrock-agentcore', Region: { Ref: 'AWS::Region' } } },
    }])
    const server = tg.Properties.TargetConfiguration.Mcp.McpServer
    expect(server.ListingMode).toBe('DEFAULT')
    expect(server.Endpoint.Sub).toBe(
      'https://bedrock-agentcore.${AWS::Region}.amazonaws.com/runtimes/arn%3A${AWS::Partition}%3Abedrock-agentcore%3A${AWS::Region}%3A${AWS::AccountId}%3Aruntime%2F${WorkshopRuntime.AgentRuntimeId}/invocations?qualifier=DEFAULT',
    )
  })

  it('Gateway 역할은 이 스택의 인터셉터와 런타임만 호출한다', () => {
    const st = statements('GatewayRole')
    expect(st.flatMap(s => asList(s.Action)).sort()).toEqual(['bedrock-agentcore:InvokeAgentRuntime', 'lambda:InvokeFunction'])
    const text = JSON.stringify(st)
    expect(text).toContain(':function:${AWS::StackName}-code-check')
    expect(text).toContain(':runtime/seoul_workshop_mcp-*')
  })

  it('Resource "*"는 ecr:GetAuthorizationToken에만 쓴다', () => {
    const roles = Object.keys(R).filter(k => R[k].Type === 'AWS::IAM::Role')
    const wildcard = roles
      .flatMap(statements)
      .filter(s => asList(s.Resource).includes('*'))
      .flatMap(s => asList(s.Action))
    expect(wildcard).toEqual(['ecr:GetAuthorizationToken'])
  })

  it('계정 ID, ARN 리터럴, 기존 리소스 이름이 없다', () => {
    expect(TEXT).not.toMatch(/\b\d{12}\b/)
    expect(TEXT).not.toContain('arn:aws:')
    for (const name of ['seoul_opendata_mcp', 'myseoul_mcp', 'seoul-mcp-cache']) expect(TEXT).not.toContain(name)
  })

  it('테이블 TTL은 expireAt이고 키와 코드 해시 파라미터는 NoEcho다', () => {
    expect(R.WorkshopTable.Properties.TimeToLiveSpecification).toEqual({ AttributeName: 'expireAt', Enabled: true })
    for (const name of ['SeoulApiKey', 'SeoulSubwayApiKey', 'CodeSha256']) expect(T.Parameters[name].NoEcho).toBe(true)
    expect(T.Parameters.CodeValidUntil.NoEcho).toBeUndefined()
  })

  it('인터셉터 Lambda는 코드 키가 있을 때만 만들고 판정 값을 환경 변수로 받는다', () => {
    const fn = R.CodeCheckFunction
    expect(fn.Condition).toBe('HasCode')
    expect(fn.Properties.Handler).toBe('code-check.handler')
    expect(fn.Properties.Runtime).toBe('nodejs22.x')
    expect(fn.Properties.FunctionName).toEqual({ Sub: '${AWS::StackName}-code-check' })
    expect(fn.Properties.Environment.Variables).toEqual({
      CODE_SHA256: { Ref: 'CodeSha256' },
      VALID_UNTIL: { Ref: 'CodeValidUntil' },
      RATE_PER_MINUTE: { Ref: 'RatePerMinute' },
      TABLE_NAME: { Ref: 'WorkshopTable' },
    })
  })

  it('배포 스크립트가 읽는 출력이 모두 있다', () => {
    expect(Object.keys(T.Outputs).sort()).toEqual(
      ['BucketName', 'GatewayId', 'GatewayUrl', 'RuntimeArn', 'RuntimeId', 'TableName', 'TargetId'],
    )
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/infra/workshopTemplate.test.ts`
Expected: FAIL, `ENOENT: no such file or directory, open '.../infra/seoul-workshop.yaml'`

- [ ] **Step 4: 템플릿 작성**

`infra/seoul-workshop.yaml` (버전 문자열은 따옴표로 감싼다. 감싸지 않으면 YAML이 날짜로 읽는다):

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: >-
  seoul-opendata-mcp workshop: a workshop-only AgentCore Runtime V2 for the Seoul
  open data MCP server, behind an AgentCore Gateway whose REQUEST interceptor
  checks a shared workshop code.

# Deployed by scripts/workshop-deploy.ts in two passes. The first pass leaves
# McpImageUri and CodeKey empty and creates the table, the bucket and the roles.
# The second pass passes both and creates the runtime, the interceptor, the
# gateway and its target.
# Design: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md

Parameters:
  McpImageUri:
    Type: String
    Default: ""
    Description: seoul-opendata-mcp image as <repository uri>@sha256:<digest>. Empty on the first pass.
  McpRepositoryName:
    Type: String
    Default: seoul-opendata-mcp
    Description: Existing ECR repository that holds the MCP server image.
  CodeKey:
    Type: String
    Default: ""
    Description: S3 key of the interceptor zip in WorkshopBucket. Empty on the first pass.
  SeoulApiKey:
    Type: String
    NoEcho: true
    Default: ""
    Description: Seoul Open Data Plaza API keys, comma-separated.
  SeoulSubwayApiKey:
    Type: String
    NoEcho: true
    Default: ""
    Description: Seoul real-time subway API key.
  CodeSha256:
    Type: String
    NoEcho: true
    Default: ""
    AllowedPattern: "^([0-9a-f]{64})?$"
    Description: sha256 (hex) of the workshop code. Empty rejects every request.
  CodeValidUntil:
    Type: String
    Default: ""
    AllowedPattern: "^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\+09:00)?$"
    Description: Expiry of the workshop code in KST, for example 2026-12-03T18:00:00+09:00. Empty rejects every request.
  RatePerMinute:
    Type: Number
    Default: 120
    MinValue: 1
    Description: tools/call requests the whole gateway accepts per minute.
  QuotaDailyLimit:
    Type: Number
    Default: 1000
    MinValue: 1
    Description: Daily upstream calls per Seoul API key (QUOTA_DAILY_LIMIT of the server).

Conditions:
  HasImage: !Not [!Equals [!Ref McpImageUri, ""]]
  HasCode: !Not [!Equals [!Ref CodeKey, ""]]
  HasAll: !And [!Condition HasImage, !Condition HasCode]

Resources:
  WorkshopTable:
    # Response cache, daily quota ledger and the per-minute counters of the interceptor.
    Type: AWS::DynamoDB::Table
    DeletionPolicy: Delete
    UpdateReplacePolicy: Delete
    Properties:
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - {AttributeName: pk, AttributeType: S}
      KeySchema:
        - {AttributeName: pk, KeyType: HASH}
      TimeToLiveSpecification:
        AttributeName: expireAt
        Enabled: true

  WorkshopBucket:
    # Holds the interceptor zip under code/.
    Type: AWS::S3::Bucket
    DeletionPolicy: Delete
    UpdateReplacePolicy: Delete
    Properties:
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault: {SSEAlgorithm: AES256}
      OwnershipControls:
        Rules:
          - ObjectOwnership: BucketOwnerEnforced

  RuntimeRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: {Service: bedrock-agentcore.amazonaws.com}
            Action: sts:AssumeRole
            Condition:
              StringEquals: {"aws:SourceAccount": !Ref "AWS::AccountId"}
              ArnLike:
                "aws:SourceArn": !Sub "arn:${AWS::Partition}:bedrock-agentcore:${AWS::Region}:${AWS::AccountId}:*"
      Policies:
        - PolicyName: workshop-runtime
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: ImageAuthorization
                # ecr:GetAuthorizationToken has no resource-level form.
                Effect: Allow
                Action: ecr:GetAuthorizationToken
                Resource: "*"
              - Sid: ImagePull
                Effect: Allow
                Action: [ecr:BatchGetImage, ecr:GetDownloadUrlForLayer, ecr:BatchCheckLayerAvailability]
                Resource: !Sub "arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/${McpRepositoryName}"
              - Sid: RuntimeLogs
                Effect: Allow
                Action: [logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents, logs:DescribeLogStreams]
                Resource: !Sub "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/bedrock-agentcore/runtimes/seoul_workshop_mcp-*"
              - Sid: WorkshopTable
                Effect: Allow
                Action: [dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem]
                Resource: !GetAtt WorkshopTable.Arn

  WorkshopRuntime:
    Type: AWS::BedrockAgentCore::Runtime
    Condition: HasImage
    Properties:
      AgentRuntimeName: seoul_workshop_mcp
      Description: Seoul open data MCP server for workshops, reached through the workshop gateway.
      PlatformVersion: V2
      RoleArn: !GetAtt RuntimeRole.Arn
      AgentRuntimeArtifact:
        ContainerConfiguration: {ContainerUri: !Ref McpImageUri}
      NetworkConfiguration: {NetworkMode: PUBLIC}
      ProtocolConfiguration: MCP
      LifecycleConfiguration:
        IdleRuntimeSessionTimeout: 900
        MaxLifetime: 28800
      EnvironmentVariables:
        SEOUL_API_KEY: !Ref SeoulApiKey
        SEOUL_SUBWAY_API_KEY: !Ref SeoulSubwayApiKey
        CACHE_TABLE_NAME: !Ref WorkshopTable
        QUOTA_DAILY_LIMIT: !Ref QuotaDailyLimit

  CodeCheckLogGroup:
    Type: AWS::Logs::LogGroup
    Condition: HasCode
    DeletionPolicy: Delete
    UpdateReplacePolicy: Delete
    Properties:
      LogGroupName: !Sub "/aws/lambda/${AWS::StackName}-code-check"
      RetentionInDays: 14

  CodeCheckRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: {Service: lambda.amazonaws.com}
            Action: sts:AssumeRole
      Policies:
        - PolicyName: code-check
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: Logs
                Effect: Allow
                Action: [logs:CreateLogStream, logs:PutLogEvents]
                Resource: !Sub "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-code-check:*"
              - Sid: RateCounter
                Effect: Allow
                Action: dynamodb:UpdateItem
                Resource: !GetAtt WorkshopTable.Arn

  CodeCheckFunction:
    Type: AWS::Lambda::Function
    Condition: HasCode
    DependsOn: CodeCheckLogGroup
    Properties:
      FunctionName: !Sub "${AWS::StackName}-code-check"
      Description: REQUEST interceptor of the workshop gateway (shared code, expiry, per-minute limit).
      Runtime: nodejs22.x
      Architectures: [arm64]
      Handler: code-check.handler
      MemorySize: 128
      Timeout: 5
      Role: !GetAtt CodeCheckRole.Arn
      Code:
        S3Bucket: !Ref WorkshopBucket
        S3Key: !Ref CodeKey
      Environment:
        Variables:
          CODE_SHA256: !Ref CodeSha256
          VALID_UNTIL: !Ref CodeValidUntil
          RATE_PER_MINUTE: !Ref RatePerMinute
          TABLE_NAME: !Ref WorkshopTable

  GatewayRole:
    # Name patterns instead of GetAtt: the role exists before the conditional resources do.
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: {Service: bedrock-agentcore.amazonaws.com}
            Action: sts:AssumeRole
            Condition:
              StringEquals: {"aws:SourceAccount": !Ref "AWS::AccountId"}
              ArnLike:
                "aws:SourceArn": !Sub "arn:${AWS::Partition}:bedrock-agentcore:${AWS::Region}:${AWS::AccountId}:*"
      Policies:
        - PolicyName: workshop-gateway
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: Interceptor
                Effect: Allow
                Action: lambda:InvokeFunction
                Resource: !Sub "arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${AWS::StackName}-code-check"
              - Sid: Runtime
                # Runtime ids are <name>-<10 characters>; the pattern also covers the endpoint ARN.
                Effect: Allow
                Action: bedrock-agentcore:InvokeAgentRuntime
                Resource: !Sub "arn:${AWS::Partition}:bedrock-agentcore:${AWS::Region}:${AWS::AccountId}:runtime/seoul_workshop_mcp-*"

  WorkshopGateway:
    Type: AWS::BedrockAgentCore::Gateway
    Condition: HasAll
    Properties:
      Name: !Sub "${AWS::StackName}-gateway"
      Description: Workshop gateway for the Seoul open data MCP server. Callers send Authorization Bearer <workshop code>.
      RoleArn: !GetAtt GatewayRole.Arn
      ProtocolType: MCP
      ProtocolConfiguration:
        Mcp:
          SupportedVersions: ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"]
      AuthorizerType: NONE
      InterceptorConfigurations:
        - Interceptor:
            Lambda:
              Arn: !GetAtt CodeCheckFunction.Arn
          InterceptionPoints: [REQUEST]
          InputConfiguration:
            PassRequestHeaders: true

  SeoulTarget:
    Type: AWS::BedrockAgentCore::GatewayTarget
    Condition: HasAll
    Properties:
      GatewayIdentifier: !Ref WorkshopGateway
      Name: seoul
      Description: seoul_workshop_mcp runtime, signed with the gateway role.
      TargetConfiguration:
        Mcp:
          McpServer:
            # The gateway calls this URL as given, so the runtime ARN is URL-encoded here.
            Endpoint: !Sub "https://bedrock-agentcore.${AWS::Region}.amazonaws.com/runtimes/arn%3A${AWS::Partition}%3Abedrock-agentcore%3A${AWS::Region}%3A${AWS::AccountId}%3Aruntime%2F${WorkshopRuntime.AgentRuntimeId}/invocations?qualifier=DEFAULT"
            ListingMode: DEFAULT
      CredentialProviderConfigurations:
        - CredentialProviderType: GATEWAY_IAM_ROLE
          CredentialProvider:
            IamCredentialProvider:
              Service: bedrock-agentcore
              Region: !Ref "AWS::Region"

Outputs:
  BucketName:
    Value: !Ref WorkshopBucket
  TableName:
    Value: !Ref WorkshopTable
  RuntimeId:
    Condition: HasImage
    Value: !GetAtt WorkshopRuntime.AgentRuntimeId
  RuntimeArn:
    Condition: HasImage
    Value: !GetAtt WorkshopRuntime.AgentRuntimeArn
  GatewayId:
    Condition: HasAll
    Value: !GetAtt WorkshopGateway.GatewayIdentifier
  GatewayUrl:
    Condition: HasAll
    Value: !GetAtt WorkshopGateway.GatewayUrl
  TargetId:
    Condition: HasAll
    Value: !GetAtt SeoulTarget.TargetId
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/infra/workshopTemplate.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: 정적 검증 (리소스를 만들지 않는 읽기 전용 호출)**

Run: `aws cloudformation validate-template --region ap-northeast-2 --template-body file://infra/seoul-workshop.yaml --query 'Parameters[].ParameterKey' --output text`
Expected: 파라미터 9개 이름 출력, 오류 없음

cfn-lint가 있으면(MCP 도구 `validate_cloudformation_template` 포함) 함께 돌려 경고를 확인한다. `AWS::BedrockAgentCore::*` 속성 이름 경고가 나오면 스펙 2.1과 위 Step 4를 대조해 오타만 고치고, 속성 구조는 바꾸지 않는다.

- [ ] **Step 7: `infra/CLAUDE.md` 작성**

```md
# Infra Module

## Role
워크숍 Gateway 스택(`seoul-workshop`)의 CloudFormation 템플릿과 인터셉터 Lambda입니다. 설계는 `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md`, 배포는 `scripts/workshop-deploy.ts`, 코드 교체는 `scripts/workshop-code.ts`가 맡습니다.

## Key Files
- `seoul-workshop.yaml` - 워크숍 전용 런타임 `seoul_workshop_mcp`, 테이블, 버킷, 인터셉터 Lambda, Gateway, 대상 `seoul`. 2단계 생성(`HasImage`, `HasCode`, `HasAll`).
- `lambda/code-check.mjs` - Gateway REQUEST 인터셉터. 공용 코드의 sha256 비교, 만료, 분당 `tools/call` 한도.

## Rules
- 스택을 만들거나 바꾸거나 지우는 일과 ECR 푸시는 사용자 승인 뒤에만 합니다.
- 템플릿에 계정 ID, ARN 리터럴, 버킷 이름, 도메인을 적지 않습니다. `!Sub "arn:${AWS::Partition}:..."`와 `!Ref`를 씁니다.
- 기존 런타임 `seoul_opendata_mcp`, `myseoul_mcp`와 테이블 `seoul-mcp-cache`는 이 스택의 리소스가 아닙니다. 참조하지 않고 바꾸지 않습니다.
- 인터셉터는 헤더, 코드, 코드 해시를 로그에 남기지 않습니다. 로그는 `{method, tool, decision}` 한 줄입니다.
- 템플릿을 바꾸면 `tests/infra/workshopTemplate.test.ts`를, 인터셉터를 바꾸면 `tests/infra/codeCheck.test.ts`를 먼저 고칩니다.
- Lambda 환경 변수를 콘솔이나 CLI로 직접 고치지 않습니다. 다음 스택 배포 때 되돌아갑니다. 코드와 만료는 `npm run workshop:code`로 바꿉니다.
```

- [ ] **Step 8: 번들과 이미지에서 제외**

`.mcpbignore` 끝에 `/infra/` 한 줄을 추가한다. `.dockerignore` 끝에 `infra` 한 줄을 추가한다.

- [ ] **Step 9: 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add infra/seoul-workshop.yaml infra/CLAUDE.md tests/infra/workshopTemplate.test.ts package.json package-lock.json .mcpbignore .dockerignore
git commit -m "feat: add seoul-workshop CloudFormation template" -m "A workshop-only AgentCore Runtime V2, a gateway with a REQUEST interceptor, and an MCP server target signed with the gateway role." -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---
### Task 5: 스크립트 순수 함수와 `.env` 파서 공유

**Files:**
- Modify: `src/client/env.ts` (`parseDotEnv` 분리)
- Create: `scripts/workshop-lib.ts`
- Test: `tests/env.test.ts` (추가), `tests/workshopLib.test.ts` (생성)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export function parseDotEnv(text: string): Record<string, string>` (`src/client/env.ts`). `loadDotEnv`가 이 함수를 쓴다
  - `scripts/workshop-lib.ts`:
    - `REGION = 'ap-northeast-2'`, `STACK = 'seoul-workshop'`, `REPOSITORY = 'seoul-opendata-mcp'`, `MAX_DAYS = 14`
    - `CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'`
    - `PARAMETERS` (Task 4의 파라미터 9개, 순서 고정), `type ParameterName`
    - `newCode(pick?: (max: number) => number): string`
    - `sha256Hex(data: string | Buffer): string`
    - `parseDays(raw: string | undefined): number`
    - `kstIso(ms: number): string`
    - `interface StackParameter { ParameterKey: string; ParameterValue?: string; UsePreviousValue?: boolean }`
    - `stackParameters(given: Partial<Record<ParameterName, string>>, mode: 'create' | 'update'): StackParameter[]`
    - `imageTag(version: string, commit: string): string`
    - `codeKeyOf(source: string | Buffer): string`
    - `registrationCommand(gatewayUrl: string): string`
    - `withSecretFile<T>(value: unknown, fn: (path: string) => T): T`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/env.test.ts`의 import를 `import { loadDotEnv, parseDotEnv } from '../src/client/env.js'`로 바꾸고 파일 끝에 추가:

```ts
describe('parseDotEnv', () => {
  it('주석과 빈 줄을 건너뛰고 따옴표를 벗긴다', () => {
    expect(parseDotEnv('# c\nA=one\n\nB="two two"\nC=\'three\'\nbad line\n=novalue\n')).toEqual({
      A: 'one', B: 'two two', C: 'three',
    })
  })

  it('쉼표 목록 값을 그대로 둔다', () => {
    expect(parseDotEnv('SEOUL_API_KEY=k1,k2\n')).toEqual({ SEOUL_API_KEY: 'k1,k2' })
  })
})
```

`tests/workshopLib.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  CODE_ALPHABET, PARAMETERS, newCode, sha256Hex, parseDays, kstIso, stackParameters,
  imageTag, codeKeyOf, registrationCommand, withSecretFile,
} from '../scripts/workshop-lib.js'

describe('workshop-lib', () => {
  it('코드는 seoul-XXXX-XXXX 형식이고 헷갈리는 문자를 쓰지 않는다', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^seoul-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
    expect(CODE_ALPHABET).toHaveLength(32)
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/)
  })

  it('코드 문자는 주입한 난수로 고른다', () => {
    expect(newCode(() => 0)).toBe('seoul-2222-2222')
    expect(newCode(max => max - 1)).toBe('seoul-ZZZZ-ZZZZ')
  })

  it('sha256Hex는 Node crypto와 같은 값을 낸다', () => {
    expect(sha256Hex('seoul-ABCD-2345')).toBe(createHash('sha256').update('seoul-ABCD-2345').digest('hex'))
  })

  it('--days는 기본 1이고 1~14 정수만 받는다', () => {
    expect(parseDays(undefined)).toBe(1)
    expect(parseDays('14')).toBe(14)
    for (const bad of ['0', '15', '1.5', 'two', '']) expect(() => parseDays(bad)).toThrow()
  })

  it('kstIso는 +09:00 오프셋의 초 단위 시각이다', () => {
    expect(kstIso(Date.UTC(2026, 10, 19, 1, 2, 3, 456))).toBe('2026-11-19T10:02:03+09:00')
    expect(Date.parse(kstIso(Date.UTC(2026, 10, 19, 15, 0, 0)))).toBe(Date.UTC(2026, 10, 19, 15, 0, 0))
  })

  it('update에서는 주지 않은 파라미터를 이전 값으로 유지한다', () => {
    const params = stackParameters({ CodeKey: 'code/x.zip' }, 'update')
    expect(params).toHaveLength(PARAMETERS.length)
    expect(params.find(p => p.ParameterKey === 'CodeKey')).toEqual({ ParameterKey: 'CodeKey', ParameterValue: 'code/x.zip' })
    expect(params.find(p => p.ParameterKey === 'SeoulApiKey')).toEqual({ ParameterKey: 'SeoulApiKey', UsePreviousValue: true })
  })

  it('create에서는 주지 않은 파라미터를 빼서 템플릿 기본값을 쓴다', () => {
    expect(stackParameters({ SeoulApiKey: 'k1,k2' }, 'create')).toEqual([{ ParameterKey: 'SeoulApiKey', ParameterValue: 'k1,k2' }])
  })

  it('이미지 태그와 코드 키 형식', () => {
    expect(imageTag('0.7.0', '1234567890abcdef')).toBe('0.7.0-workshop-1234567')
    expect(codeKeyOf('export const x = 1\n')).toMatch(/^code\/code-check-[0-9a-f]{16}\.zip$/)
    expect(codeKeyOf('a')).toBe(codeKeyOf('a'))
    expect(codeKeyOf('a')).not.toBe(codeKeyOf('b'))
  })

  it('등록 명령에는 코드 대신 자리 표시가 들어간다', () => {
    expect(registrationCommand('https://gw.example/mcp')).toBe(
      'claude mcp add --transport http seoul https://gw.example/mcp --header "Authorization: Bearer <코드>"',
    )
  })

  it('withSecretFile은 0600 파일을 쓰고 끝나면 지운다', () => {
    let seen = ''
    const result = withSecretFile({ secret: 's' }, path => {
      seen = path
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ secret: 's' })
      return 42
    })
    expect(result).toBe(42)
    expect(existsSync(seen)).toBe(false)
  })

  it('withSecretFile은 fn이 던져도 파일을 지운다', () => {
    let seen = ''
    expect(() => withSecretFile({}, path => { seen = path; throw new Error('boom') })).toThrow('boom')
    expect(existsSync(seen)).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/env.test.ts tests/workshopLib.test.ts`
Expected: FAIL. `parseDotEnv is not a function`, `Failed to resolve import "../scripts/workshop-lib.js"`

- [ ] **Step 3: `src/client/env.ts` 구현**

파일 전체를 아래로 바꾼다. `loadDotEnv`의 동작은 같다.

```ts
import { readFileSync, existsSync } from 'node:fs'

/** .env 형식 문자열을 KEY=VALUE 맵으로 읽는다. 주석과 빈 줄은 건너뛰고, 값을 감싼 따옴표 한 쌍을 벗긴다 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

/** CWD(또는 지정 경로)의 .env를 읽어, 아직 설정되지 않은 환경변수만 채운다. 명시적 env > .env */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return
  for (const [key, val] of Object.entries(parseDotEnv(readFileSync(path, 'utf8')))) {
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val
  }
}
```

- [ ] **Step 4: `scripts/workshop-lib.ts` 구현**

```ts
/** 워크숍 스크립트의 순수 함수. 설계: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md §5 */
import { createHash, randomInt } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REGION = 'ap-northeast-2'
export const STACK = 'seoul-workshop'
export const REPOSITORY = 'seoul-opendata-mcp'
export const MAX_DAYS = 14
/** 0, 1, O, I를 뺀 32자. 슬라이드를 보고 손으로 칠 때 헷갈리지 않게 한다 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** infra/seoul-workshop.yaml의 파라미터. 순서는 출력용으로만 의미가 있다 */
export const PARAMETERS = [
  'McpImageUri', 'McpRepositoryName', 'CodeKey', 'SeoulApiKey', 'SeoulSubwayApiKey',
  'CodeSha256', 'CodeValidUntil', 'RatePerMinute', 'QuotaDailyLimit',
] as const
export type ParameterName = typeof PARAMETERS[number]

export interface StackParameter { ParameterKey: string; ParameterValue?: string; UsePreviousValue?: boolean }

/** seoul-XXXX-XXXX. 8자 x 5비트 = 40비트 */
export function newCode(pick: (max: number) => number = randomInt): string {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join('')
  return `seoul-${part()}-${part()}`
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function parseDays(raw: string | undefined): number {
  if (raw === undefined) return 1
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
    throw new Error(`--days는 1~${MAX_DAYS} 사이 정수여야 합니다: ${raw}`)
  }
  return n
}

/** KST ISO 8601 시각(초 단위, +09:00). 템플릿 CodeValidUntil의 AllowedPattern과 같은 형식 */
export function kstIso(ms: number): string {
  return `${new Date(ms + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`
}

/** create: 주지 않은 파라미터는 빼서 템플릿 기본값을 쓴다. update: 주지 않은 파라미터는 이전 값을 유지한다 */
export function stackParameters(given: Partial<Record<ParameterName, string>>, mode: 'create' | 'update'): StackParameter[] {
  return PARAMETERS.flatMap((key): StackParameter[] => {
    const value = given[key]
    if (value !== undefined) return [{ ParameterKey: key, ParameterValue: value }]
    return mode === 'update' ? [{ ParameterKey: key, UsePreviousValue: true }] : []
  })
}

export function imageTag(version: string, commit: string): string {
  return `${version}-workshop-${commit.slice(0, 7)}`
}

/** zip은 만들 때마다 안의 시각이 달라지므로 원본 파일의 해시로 키를 정한다 */
export function codeKeyOf(source: string | Buffer): string {
  return `code/code-check-${sha256Hex(source).slice(0, 16)}.zip`
}

export function registrationCommand(gatewayUrl: string): string {
  return `claude mcp add --transport http seoul ${gatewayUrl} --header "Authorization: Bearer <코드>"`
}

/** 비밀이 든 JSON을 0600 파일로 쓰고 fn에 경로를 넘긴 뒤 반드시 지운다. 명령 인자(ps에 보임)에 비밀을 싣지 않기 위함 */
export function withSecretFile<T>(value: unknown, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'seoul-workshop-'))
  const path = join(dir, 'parameters.json')
  try {
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
    return fn(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/env.test.ts tests/workshopLib.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add src/client/env.ts scripts/workshop-lib.ts tests/env.test.ts tests/workshopLib.test.ts
git commit -m "feat: add workshop script helpers and share the dotenv parser" -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---
### Task 6: aws 래퍼, 배포 스크립트, 코드 스크립트

**Files:**
- Create: `scripts/workshop-aws.ts`, `scripts/workshop-deploy.ts`, `scripts/workshop-code.ts`
- Test: `tests/workshopAws.test.ts`
- Modify: `package.json` (`scripts`에 두 항목)

**Interfaces:**
- Consumes: Task 5의 `REGION`, `STACK`, `REPOSITORY`, `stackParameters`, `withSecretFile`, `newCode`, `sha256Hex`, `parseDays`, `kstIso`, `imageTag`, `codeKeyOf`, `registrationCommand`, `StackParameter`, `ParameterName`; `parseDotEnv`(`src/client/env.ts`); Task 4의 파라미터와 출력 이름
- Produces (`scripts/workshop-aws.ts`):
  - `run(cmd: string, args: string[], opts?: { input?: string; cwd?: string; inherit?: boolean }): string`
  - `aws(args: string[], opts?): string`, `awsJson<T = any>(args: string[]): T`
  - `describeStack(): any | undefined`, `stackOutputs(stack: any): Record<string, string>`, `stackParameterValue(stack: any, key: string): string | undefined`
  - `createStack(parameters: StackParameter[], templatePath: string): void`
  - `updateStack(parameters: StackParameter[], templatePath?: string): boolean` (바뀐 것이 없으면 false)
  - `deleteStack(): void`, `sleep(ms: number): Promise<void>`
- Produces (`package.json`): `workshop:deploy`, `workshop:code`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/workshopAws.test.ts` (AWS를 부르지 않는 함수만 검사한다):

```ts
import { describe, it, expect } from 'vitest'
import { run, stackOutputs, stackParameterValue } from '../scripts/workshop-aws.js'

describe('workshop-aws', () => {
  it('run은 표준 출력을 돌려준다', () => {
    expect(run('node', ['-e', 'process.stdout.write("ok")'])).toBe('ok')
  })

  it('run이 실패하면 앞 두 인자와 stderr만 오류에 넣고 뒤 인자는 넣지 않는다', () => {
    let message = ''
    try {
      run('node', ['-e', 'console.error("boom"); process.exit(3)', 'SECRETARG'])
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('boom')
    expect(message).toContain('node -e')
    expect(message).not.toContain('SECRETARG')
  })

  it('run은 input을 표준 입력으로 넘긴다', () => {
    expect(run('node', ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'piped' })).toBe('piped')
  })

  it('스택 출력과 파라미터를 이름으로 읽는다', () => {
    const stack = {
      Outputs: [{ OutputKey: 'GatewayUrl', OutputValue: 'https://gw/mcp' }],
      Parameters: [{ ParameterKey: 'CodeValidUntil', ParameterValue: '2026-11-20T18:00:00+09:00' }],
    }
    expect(stackOutputs(stack)).toEqual({ GatewayUrl: 'https://gw/mcp' })
    expect(stackOutputs(undefined)).toEqual({})
    expect(stackParameterValue(stack, 'CodeValidUntil')).toBe('2026-11-20T18:00:00+09:00')
    expect(stackParameterValue(stack, 'Missing')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/workshopAws.test.ts`
Expected: FAIL, `Failed to resolve import "../scripts/workshop-aws.js"`

- [ ] **Step 3: `scripts/workshop-aws.ts` 구현**

```ts
/** aws CLI와 docker 호출 래퍼. 인자는 배열로만 넘기고 셸 문자열을 만들지 않는다 */
import { execFileSync } from 'node:child_process'
import { REGION, STACK, withSecretFile, type StackParameter } from './workshop-lib.js'

export interface RunOptions { input?: string; cwd?: string; inherit?: boolean }

/** 실패하면 명령 이름, 앞 두 인자, stderr만 담아 던진다. 뒤 인자(경로, 값)는 오류 메시지에 넣지 않는다 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): string {
  try {
    const out = execFileSync(cmd, args, {
      cwd: opts.cwd,
      input: opts.input,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: opts.inherit ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
    })
    return out ?? ''
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? '').trim()
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} 실패${stderr ? `: ${stderr}` : ''}`)
  }
}

export function aws(args: string[], opts: RunOptions = {}): string {
  return run('aws', [...args, '--region', REGION], opts)
}

export function awsJson<T = any>(args: string[]): T {
  const out = aws([...args, '--output', 'json']).trim()
  return (out ? JSON.parse(out) : {}) as T
}

export function describeStack(): any | undefined {
  try {
    return awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks[0]
  } catch (e) {
    if ((e as Error).message.includes('does not exist')) return undefined
    throw e
  }
}

export function stackOutputs(stack: any): Record<string, string> {
  return Object.fromEntries((stack?.Outputs ?? []).map((o: any) => [o.OutputKey, o.OutputValue]))
}

export function stackParameterValue(stack: any, key: string): string | undefined {
  return (stack?.Parameters ?? []).find((p: any) => p.ParameterKey === key)?.ParameterValue
}

/** 실패한 리소스와 이유. 배포가 실패했을 때 원인을 바로 보여 준다 */
function failureReasons(): string {
  try {
    const events = awsJson(['cloudformation', 'describe-stack-events', '--stack-name', STACK, '--max-items', '30']).StackEvents ?? []
    return events
      .filter((e: any) => /FAILED/.test(e.ResourceStatus) && e.ResourceStatusReason)
      .map((e: any) => `${e.LogicalResourceId}: ${e.ResourceStatusReason}`)
      .join('\n')
  } catch {
    return ''
  }
}

function waitFor(state: 'stack-create-complete' | 'stack-update-complete' | 'stack-delete-complete'): void {
  try {
    aws(['cloudformation', 'wait', state, '--stack-name', STACK])
  } catch (e) {
    const reasons = failureReasons()
    throw new Error(`${(e as Error).message}${reasons ? `\n${reasons}` : ''}`)
  }
}

export function createStack(parameters: StackParameter[], templatePath: string): void {
  withSecretFile(parameters, path => aws([
    'cloudformation', 'create-stack', '--stack-name', STACK,
    '--template-body', `file://${templatePath}`,
    '--parameters', `file://${path}`,
    '--capabilities', 'CAPABILITY_IAM',
  ]))
  waitFor('stack-create-complete')
}

/** 바뀐 것이 없으면 false. templatePath를 주지 않으면 이전 템플릿을 그대로 쓴다 */
export function updateStack(parameters: StackParameter[], templatePath?: string): boolean {
  try {
    withSecretFile(parameters, path => aws([
      'cloudformation', 'update-stack', '--stack-name', STACK,
      ...(templatePath ? ['--template-body', `file://${templatePath}`] : ['--use-previous-template']),
      '--parameters', `file://${path}`,
      '--capabilities', 'CAPABILITY_IAM',
    ]))
  } catch (e) {
    if ((e as Error).message.includes('No updates are to be performed')) return false
    throw e
  }
  waitFor('stack-update-complete')
  return true
}

export function deleteStack(): void {
  aws(['cloudformation', 'delete-stack', '--stack-name', STACK])
  waitFor('stack-delete-complete')
}

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/workshopAws.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: `scripts/workshop-deploy.ts` 작성**

```ts
#!/usr/bin/env tsx
/**
 * 워크숍 스택 seoul-workshop을 배포한다. 설계: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md §5.2
 * 키와 코드 해시는 화면에 출력하지 않고 0600 임시 파일로만 CloudFormation에 넘긴다.
 */
import { parseArgs } from 'node:util'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { parseDotEnv } from '../src/client/env.js'
import {
  REGION, REPOSITORY, STACK, codeKeyOf, imageTag, registrationCommand, stackParameters, type ParameterName,
} from './workshop-lib.js'
import { aws, awsJson, createStack, deleteStack, describeStack, run, sleep, stackOutputs, updateStack } from './workshop-aws.js'

const USAGE = `사용법:
  npm run workshop:deploy -- --env-file .env        처음 배포(키 필수). 이후에 주면 키를 바꾼다
  npm run workshop:deploy                           키는 그대로 두고 이미지와 인터셉터 코드를 갱신
  npm run workshop:deploy -- --skip-image           이미지는 그대로 두고 템플릿과 파라미터만 반영
  npm run workshop:deploy -- --skip-image --rate-per-minute 3 --quota-daily-limit 2   검증용 값
  npm run workshop:deploy -- --delete [--yes]       버킷을 비우고 스택 삭제(--yes가 없으면 계획만 출력)
스모크 테스트에서 코드 있는 호출까지 하려면 SEOUL_WORKSHOP_CODE 환경 변수에 코드를 넣는다.`

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATE = join(ROOT, 'infra', 'seoul-workshop.yaml')
const LAMBDA_DIR = join(ROOT, 'infra', 'lambda')

const { values } = parseArgs({
  options: {
    'env-file': { type: 'string' },
    'skip-image': { type: 'boolean', default: false },
    'rate-per-minute': { type: 'string' },
    'quota-daily-limit': { type: 'string' },
    delete: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

function keysFrom(file: string): Partial<Record<ParameterName, string>> {
  const env = parseDotEnv(readFileSync(file, 'utf8'))
  if (!env.SEOUL_API_KEY) throw new Error(`${file}에 SEOUL_API_KEY가 없습니다`)
  return { SeoulApiKey: env.SEOUL_API_KEY, SeoulSubwayApiKey: env.SEOUL_SUBWAY_API_KEY ?? '' }
}

function requireCleanTree(): void {
  if (run('git', ['status', '--porcelain'], { cwd: ROOT }).trim()) {
    throw new Error('작업 트리가 깨끗하지 않습니다. 이미지 태그가 커밋을 가리키도록 커밋한 뒤 배포하세요')
  }
}

function pushImage(): string {
  const account = awsJson(['sts', 'get-caller-identity']).Account as string
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string
  const tag = imageTag(version, run('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).trim())
  const registry = `${account}.dkr.ecr.${REGION}.amazonaws.com`
  const uri = `${registry}/${REPOSITORY}`
  const digestOf = (): string | undefined => {
    try {
      return awsJson(['ecr', 'describe-images', '--repository-name', REPOSITORY, '--image-ids', `imageTag=${tag}`])
        .imageDetails?.[0]?.imageDigest
    } catch {
      return undefined
    }
  }
  let digest = digestOf()
  if (digest) {
    console.log(`이미지 ${tag}가 이미 있어 그대로 씁니다`)
  } else {
    console.log(`이미지 ${tag}를 빌드해 올립니다`)
    run('docker', ['login', '--username', 'AWS', '--password-stdin', registry], { input: aws(['ecr', 'get-login-password']).trim() })
    run('docker', ['build', '--platform', 'linux/arm64', '-t', `${uri}:${tag}`, '.'], { cwd: ROOT, inherit: true })
    run('docker', ['push', `${uri}:${tag}`], { inherit: true })
    digest = digestOf()
    if (!digest) throw new Error(`올린 이미지 ${tag}의 digest를 찾지 못했습니다`)
  }
  return `${uri}@${digest}`
}

function uploadCode(bucket: string): string {
  const key = codeKeyOf(readFileSync(join(LAMBDA_DIR, 'code-check.mjs')))
  try {
    aws(['s3api', 'head-object', '--bucket', bucket, '--key', key])
    console.log(`인터셉터 코드 ${key}가 이미 있습니다`)
    return key
  } catch {
    // 없으면 아래에서 올린다
  }
  const dir = mkdtempSync(join(tmpdir(), 'seoul-code-'))
  try {
    const zip = join(dir, 'code-check.zip')
    run('zip', ['-q', '-X', zip, 'code-check.mjs'], { cwd: LAMBDA_DIR })
    aws(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', zip])
    console.log(`인터셉터 코드 ${key}를 올렸습니다`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return key
}

function checkRuntime(runtimeId: string): void {
  const r = awsJson(['bedrock-agentcore-control', 'get-agent-runtime', '--agent-runtime-id', runtimeId])
  console.log(`런타임 ${r.agentRuntimeName}: status=${r.status} platformVersion=${r.platformVersion}`)
  if (r.status !== 'READY' || r.platformVersion !== 'V2') throw new Error(`런타임 ${runtimeId}가 V2에서 READY가 아닙니다`)
}

/** 이미지가 바뀌면 tool 목록이 달라질 수 있어 대상을 명시적으로 동기화한다 */
async function syncTarget(gatewayId: string, targetId: string): Promise<void> {
  const get = () => awsJson(['bedrock-agentcore-control', 'get-gateway-target', '--gateway-identifier', gatewayId, '--target-id', targetId])
  const before = get().lastSynchronizedAt
  awsJson(['bedrock-agentcore-control', 'synchronize-gateway-targets', '--gateway-identifier', gatewayId, '--target-id-list', targetId])
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    const t = get()
    if (/FAILED|UNSUCCESSFUL/.test(String(t.status))) {
      throw new Error(`대상 동기화 실패: ${t.status} ${JSON.stringify(t.statusReasons ?? [])}`)
    }
    const advanced = before === undefined || t.lastSynchronizedAt !== before
    if (t.status === 'READY' && advanced) {
      console.log('대상 동기화를 마쳤습니다')
      return
    }
  }
  throw new Error('대상 동기화가 5분 안에 끝나지 않았습니다')
}

async function connect(url: string, code?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    code ? { requestInit: { headers: { Authorization: `Bearer ${code}` } } } : undefined,
  )
  const client = new Client({ name: 'seoul-workshop-smoke', version: '1.0.0' })
  await client.connect(transport)
  return client
}

async function listAllTools(client: Client): Promise<Array<{ name: string }>> {
  const tools: Array<{ name: string }> = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    tools.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)
  return tools
}

async function smoke(url: string): Promise<void> {
  let stage: string = 'none'
  try {
    const anonymous = await connect(url).catch(e => { stage = 'initialize'; throw e })
    await listAllTools(anonymous).catch(e => { stage = 'tools/list'; throw e })
    await anonymous.close()
  } catch {
    // stage에 어느 단계에서 막혔는지 남아 있다
  }
  if (stage === 'none') throw new Error('코드 없는 요청이 통과했습니다')
  console.log(`코드 없는 요청 거부 확인(${stage} 단계에서 거부)`)

  const code = process.env.SEOUL_WORKSHOP_CODE
  if (!code) {
    console.log('SEOUL_WORKSHOP_CODE가 없어 코드 있는 호출은 건너뜁니다')
    return
  }
  const client = await connect(url, code)
  const tools = await listAllTools(client)
  if (tools.length !== 23) throw new Error(`tool 수가 23이 아닙니다: ${tools.length}`)
  const result = await client.callTool({ name: 'seoul___search_place', arguments: { query: '강남' } })
  await client.close()
  if (result.isError) throw new Error('seoul___search_place 호출이 isError를 돌려줬습니다')
  console.log('코드 있는 호출 확인: tool 23개, seoul___search_place 성공')
}

function remove(stack: any): void {
  if (!stack) {
    console.log(`스택 ${STACK}이 없습니다`)
    return
  }
  const bucket = stackOutputs(stack).BucketName
  console.log(`삭제 대상: 스택 ${STACK}, 버킷 ${bucket}의 모든 객체. ECR 이미지는 지우지 않습니다`)
  if (!values.yes) {
    console.log('실제로 지우려면 --yes를 붙여 다시 실행하세요')
    return
  }
  aws(['s3', 'rm', `s3://${bucket}`, '--recursive'])
  deleteStack()
  console.log('삭제했습니다')
}

async function main(): Promise<void> {
  if (values.help) {
    console.log(USAGE)
    return
  }
  let stack = describeStack()
  if (values.delete) return remove(stack)
  if (!values['skip-image']) requireCleanTree()
  const keys = values['env-file'] ? keysFrom(values['env-file']) : undefined

  if (!stack) {
    if (!keys) throw new Error('스택을 처음 만들 때는 --env-file이 필요합니다')
    console.log(`스택 ${STACK}을 이미지와 코드 없이 만듭니다`)
    createStack(stackParameters(keys, 'create'), TEMPLATE)
    stack = describeStack()
  }
  const created = stackOutputs(stack)
  if (values['skip-image'] && !created.RuntimeId) throw new Error('아직 런타임이 없어 --skip-image를 쓸 수 없습니다')
  const image = values['skip-image'] ? undefined : pushImage()
  const codeKey = uploadCode(created.BucketName)

  const given: Partial<Record<ParameterName, string>> = { CodeKey: codeKey, ...(keys ?? {}) }
  if (image) given.McpImageUri = image
  if (values['rate-per-minute']) given.RatePerMinute = values['rate-per-minute']
  if (values['quota-daily-limit']) given.QuotaDailyLimit = values['quota-daily-limit']
  console.log(updateStack(stackParameters(given, 'update'), TEMPLATE) ? '스택을 갱신했습니다' : '스택에 바뀐 것이 없습니다')

  const out = stackOutputs(describeStack())
  checkRuntime(out.RuntimeId)
  await syncTarget(out.GatewayId, out.TargetId)
  await smoke(out.GatewayUrl)
  console.log(`\nGateway URL: ${out.GatewayUrl}\n참가자 등록: ${registrationCommand(out.GatewayUrl)}`)
}

main().catch(e => {
  console.error((e as Error).message)
  process.exit(1)
})
```

- [ ] **Step 6: `scripts/workshop-code.ts` 작성**

```ts
#!/usr/bin/env tsx
/**
 * 워크숍 코드를 발급, 폐기, 조회한다. 설계: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md §5.3
 * 코드 원문은 new에서 한 번만 출력한다. 스택에는 해시만 남는다.
 */
import { parseArgs } from 'node:util'
import { STACK, kstIso, newCode, parseDays, sha256Hex, stackParameters } from './workshop-lib.js'
import { describeStack, stackParameterValue, updateStack } from './workshop-aws.js'

const USAGE = `사용법:
  npm run workshop:code -- new [--days N]   새 코드 발급(기본 1일, 최대 14일)
  npm run workshop:code -- revoke           지금 바로 만료
  npm run workshop:code -- show             만료 시각과 남은 시간`

const { values, positionals } = parseArgs({ allowPositionals: true, options: { days: { type: 'string' } } })

function main(): void {
  const command = positionals[0]
  if (command !== 'new' && command !== 'revoke' && command !== 'show') {
    console.log(USAGE)
    if (command) process.exitCode = 1
    return
  }
  const days = command === 'new' ? parseDays(values.days) : 0 // AWS를 부르기 전에 인자를 검사한다
  const stack = describeStack()
  if (!stack) throw new Error(`스택 ${STACK}이 없습니다. 먼저 npm run workshop:deploy를 실행하세요`)

  if (command === 'new') {
    const code = newCode()
    const until = kstIso(Date.now() + days * 86_400_000)
    updateStack(stackParameters({ CodeSha256: sha256Hex(code), CodeValidUntil: until }, 'update'))
    console.log(`새 워크숍 코드: ${code}\n만료: ${until}\n이 코드는 다시 출력되지 않습니다.`)
    return
  }
  if (command === 'revoke') {
    const now = kstIso(Date.now())
    updateStack(stackParameters({ CodeValidUntil: now }, 'update'))
    console.log(`코드를 폐기했습니다(만료 시각 ${now})`)
    return
  }
  const until = stackParameterValue(stack, 'CodeValidUntil')
  if (!until) {
    console.log('발급된 코드가 없습니다')
    return
  }
  const hours = (Date.parse(until) - Date.now()) / 3_600_000
  console.log(hours > 0 ? `만료: ${until} (약 ${hours.toFixed(1)}시간 남음)` : `만료: ${until} (이미 만료됨)`)
}

try {
  main()
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
```

- [ ] **Step 7: npm 스크립트 추가**

`package.json`의 `"scripts"`에 두 줄을 추가한다(`"prepublishOnly"` 다음):

```json
    "workshop:deploy": "tsx scripts/workshop-deploy.ts",
    "workshop:code": "tsx scripts/workshop-code.ts"
```

- [ ] **Step 8: AWS 없이 확인**

Run: `npx tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck --types node scripts/workshop-deploy.ts scripts/workshop-code.ts`
Expected: 오류 없음

Run: `npm run workshop:code`
Expected: 사용법 세 줄 출력, 종료 코드 0, AWS 호출 없음

Run: `npm run workshop:code -- new --days 99`
Expected: `--days는 1~14 사이 정수여야 합니다: 99`, 종료 코드 1, AWS 호출 없음

Run: `npm run workshop:deploy -- --help`
Expected: 사용법 출력, AWS 호출 없음

- [ ] **Step 9: 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add scripts/workshop-aws.ts scripts/workshop-deploy.ts scripts/workshop-code.ts tests/workshopAws.test.ts package.json
git commit -m "feat: add workshop deploy and code rotation scripts" -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---
### Task 7: 참가자 문서, 0.7.0 버전 맞춤, CHANGELOG

**Files:**
- Create: `docs/workshop.md`
- Modify: `package.json`, `package-lock.json`, `manifest.json`, `src/index.ts:20`, `README.md`(3행 배지와 링크 두 줄), `CLAUDE.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 6의 `npm run workshop:deploy`, `npm run workshop:code` 사용법, Task 4의 출력 `GatewayUrl`
- Produces: 버전 `0.7.0`. `tests/version.test.ts`가 `package.json`, `manifest.json`, `SERVER_VERSION`, CHANGELOG 두 절을 함께 검사한다

- [ ] **Step 1: 버전을 올려 실패하는 버전 테스트 만들기**

Run: `npm version 0.7.0 --no-git-tag-version`
Expected: `package.json`, `package-lock.json`의 version이 `0.7.0`

Run: `npx vitest run tests/version.test.ts`
Expected: FAIL. `manifest.json`이 `0.6.0`이고 CHANGELOG에 `## [0.7.0]`이 없음

- [ ] **Step 2: 나머지 버전 표기 맞추기**

- `manifest.json`의 `"version": "0.6.0"`을 `"version": "0.7.0"`으로 바꾼다.
- `src/index.ts`의 `export const SERVER_VERSION = '0.6.0'`을 `'0.7.0'`으로 바꾼다.
- `README.md` 3행 배지 `Version-0.6.0-green`을 `Version-0.7.0-green`으로 바꾼다.
- `CLAUDE.md` Overview의 `(v0.6.0, MIT)`를 `(v0.7.0, MIT)`로 바꾼다.

- [ ] **Step 3: CHANGELOG 작성**

`CHANGELOG.md`의 English 절 `## [Unreleased]` 바로 아래에 빈 줄을 두고 추가한다. 날짜는 커밋하는 날의 KST 날짜(`TZ=Asia/Seoul date +%F`)를 쓴다.

```md
## [0.7.0] - YYYY-MM-DD

### Added

- `SEOUL_API_KEY` accepts several keys separated by commas. Each upstream call uses the first key under its daily limit. With two or more keys, a key that returns `ERROR-337` is skipped for 10 minutes and the call is retried once with the next key (`src/client/keyPool.ts`).
- Workshop gateway: `infra/seoul-workshop.yaml` (a workshop-only AgentCore Runtime V2 behind an AgentCore Gateway), `infra/lambda/code-check.mjs` (REQUEST interceptor that checks a shared code, its expiry and a per-minute `tools/call` limit), `npm run workshop:deploy`, `npm run workshop:code`, and `docs/workshop.md`.

### Changed

- The cache key no longer contains the API key: the key segment of the URL is replaced by `{key}` (`sample` in sample mode). Existing L2 (DynamoDB) entries miss once after the upgrade and expire within 24 h, so the first day after upgrading makes more upstream calls.
- Error messages carry the masked key that was actually used. `maskedKey()` appends `외 N개` when several keys are set.
- `src/client/env.ts` exports `parseDotEnv()`, which `loadDotEnv()` now uses.
```

한국어 절 `## [Unreleased]` 바로 아래에 추가한다(날짜는 위와 같게):

```md
## [0.7.0] - YYYY-MM-DD

### Added

- `SEOUL_API_KEY`에 쉼표로 여러 키를 넣을 수 있습니다. 업스트림 호출마다 하루 한도 미만인 첫 키를 씁니다. 키가 둘 이상일 때 `ERROR-337`을 돌려준 키는 10분 동안 빼고 다음 키로 한 번 다시 호출합니다(`src/client/keyPool.ts`).
- 워크숍 Gateway: `infra/seoul-workshop.yaml`(AgentCore Gateway 뒤의 워크숍 전용 AgentCore Runtime V2), `infra/lambda/code-check.mjs`(공용 코드, 만료, 분당 `tools/call` 한도를 확인하는 REQUEST 인터셉터), `npm run workshop:deploy`, `npm run workshop:code`, `docs/workshop.md`.

### Changed

- 캐시 키에 API 키가 들어가지 않습니다. URL의 키 자리를 `{key}`(샘플 모드는 `sample`)로 바꿉니다. 업그레이드 후 기존 L2(DynamoDB) 항목은 한 번 빗나가고 24시간 안에 만료되므로, 업그레이드 첫날에는 업스트림 호출이 늘어납니다.
- 오류 메시지에는 실제로 호출에 쓴 키의 마스킹이 들어갑니다. 키가 여러 개면 `maskedKey()`가 `외 N개`를 붙입니다.
- `src/client/env.ts`가 `parseDotEnv()`를 내보내고, `loadDotEnv()`가 이 함수를 씁니다.
```

Run: `npx vitest run tests/version.test.ts`
Expected: PASS

- [ ] **Step 4: Python 예제 API 확인**

context7(`resolve-library-id`로 MCP Python SDK를 찾고 `query-docs`로 "streamable http client headers" 조회)로 현재 `mcp` 패키지의 Streamable HTTP 클라이언트 함수 이름과 헤더 인자를 확인한다. 아래 Step 5의 Python 예제는 `mcp.client.streamable_http.streamablehttp_client(url, headers=...)`를 쓴다. 이름이나 인자가 바뀌었으면 문서 예제만 현재 API에 맞춘다.

- [ ] **Step 5: `docs/workshop.md` 작성**

````md
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

Python(`pip install mcp`):

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

`.env`의 `SEOUL_API_KEY`에 워크숍용 키를 쉼표로 넣고 배포합니다. 스택 생성은 비용이 드는 작업이므로 실행 전에 범위를 확인합니다.

```bash
npm run workshop:deploy -- --env-file .env
```

### 워크숍 전날

```bash
npm run workshop:code -- new --days 1          # 이틀짜리 해커톤이면 --days 2
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

배포 후 확인한 동작을 날짜와 함께 적습니다.

| 항목 | 결과 | 날짜 |
|---|---|---|
| `initialize`가 인터셉터를 거치는지 | 첫 배포 후 기록 | |
| Claude Code가 거부 안내 문구를 보여 주는지 | 첫 배포 후 기록 | |
| 분당 한도 초과 시 `isError` 응답 | 첫 배포 후 기록 | |
| 첫 키 한도 도달 시 다음 키 사용 | 첫 배포 후 기록 | |
| `revoke` 후 거부 | 첫 배포 후 기록 | |
````

- [ ] **Step 6: README와 CLAUDE.md에 링크 추가**

`README.md` English "Deploy to AgentCore Runtime" 절의 마지막 항목(`4. **Extending via AgentCore Gateway** ...`) 다음 줄에 추가:

```md
5. **Workshop gateway with a shared code** — `npm run workshop:deploy` deploys a workshop-only runtime behind an AgentCore Gateway that accepts `Authorization: Bearer <workshop code>`. See [docs/workshop.md](docs/workshop.md) (Korean).
```

한국어 "AgentCore Runtime에 배포" 절의 같은 위치(4번 항목 다음)에 추가:

```md
5. **공용 코드로 접속하는 워크숍 Gateway** — `npm run workshop:deploy`가 `Authorization: Bearer <워크숍 코드>`를 받는 AgentCore Gateway 뒤에 워크숍 전용 런타임을 배포합니다. [docs/workshop.md](docs/workshop.md)를 참고하세요.
```

`CLAUDE.md`의 Project Structure 코드 블록에서 `scripts/` 줄 다음에 추가:

```
infra/          워크숍 Gateway 스택 템플릿(seoul-workshop.yaml)과 인터셉터 Lambda(lambda/code-check.mjs)
```

같은 파일 Key Commands 끝에 추가:

```md
- `npm run workshop:deploy` - 워크숍 Gateway 스택 배포(승인 후에만 실행, `docs/workshop.md` 참조)
- `npm run workshop:code -- new|revoke|show` - 워크숍 코드 발급, 폐기, 조회
```

- [ ] **Step 7: 전체 검증과 커밋**

Run: `npm run build && npm test && bash tests/harness/run-all.sh`
Expected: 빌드 오류 없음, vitest 전체 PASS, 하네스 전체 PASS

```bash
git add package.json package-lock.json manifest.json src/index.ts README.md CLAUDE.md CHANGELOG.md docs/workshop.md
git commit -m "feat: release 0.7.0 with API key rotation and the workshop gateway" -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

---

### Task 8: 배포와 검증 (사용자 승인 필요)

이 태스크는 과금되는 AWS 리소스를 만든다. Step 1에서 승인을 받기 전에는 아무 명령도 실행하지 않는다.

**Files:**
- Modify: `docs/workshop.md`(검증 기록), 결과에 따라 `infra/lambda/code-check.mjs`, `tests/infra/codeCheck.test.ts`

**Interfaces:**
- Consumes: Task 1~7 전체
- Produces: 스택 `seoul-workshop`, Gateway URL, 채워진 검증 기록

- [ ] **Step 1: 승인 요청**

사용자에게 다음을 보여 주고 명시적인 승인을 받는다. 승인 전에는 멈춘다.

- 만드는 리소스: 스택 `seoul-workshop`(DynamoDB 테이블, S3 버킷, IAM 역할 3개, Lambda와 로그 그룹, AgentCore Runtime `seoul_workshop_mcp`, Gateway, 대상 `seoul`)
- ECR 저장소 `seoul-opendata-mcp`에 태그 `0.7.0-workshop-<커밋 7자>` 이미지 추가(다른 태그는 건드리지 않음)
- 예상 비용: 스펙 8절(워크숍 1회 1달러 미만, 쉬는 동안 S3와 로그 보관료)
- 검증 중 서울 API 실호출: `get_city_snapshot` 4회 안팎

- [ ] **Step 2: 사전 확인**

Run: `git status --porcelain && npm test`
Expected: 출력 없음(깨끗한 작업 트리), 테스트 전체 PASS

키 개수만 확인한다(키 값은 출력하지 않는다):

Run: `npx tsx -e "Promise.all([import('./src/client/env.ts'), import('node:fs')]).then(([{ parseDotEnv }, fs]) => { const v = parseDotEnv(fs.readFileSync('.env', 'utf8')).SEOUL_API_KEY ?? ''; console.log('키 개수', v.split(',').filter(s => s.trim()).length) })"`
Expected: `키 개수 N`. N이 1이면 Step 9(키 순환)는 건너뛰고 기록에 "키 1개라 확인하지 않음"이라고 적는다.

- [ ] **Step 3: 첫 배포**

Run: `npm run workshop:deploy -- --env-file .env`
Expected 출력 순서:
1. `스택 seoul-workshop을 이미지와 코드 없이 만듭니다`
2. `이미지 0.7.0-workshop-xxxxxxx를 빌드해 올립니다`와 docker 출력
3. `인터셉터 코드 code/code-check-....zip를 올렸습니다`
4. `스택을 갱신했습니다`
5. `런타임 seoul_workshop_mcp: status=READY platformVersion=V2`
6. `대상 동기화를 마쳤습니다`
7. `코드 없는 요청 거부 확인(initialize 단계에서 거부)` 또는 `(tools/list 단계에서 거부)`
8. `SEOUL_WORKSHOP_CODE가 없어 코드 있는 호출은 건너뜁니다`
9. Gateway URL과 참가자 등록 명령

7번에 나온 단계를 `docs/workshop.md` 검증 기록 첫 행에 적는다.

실패하면 superpowers:systematic-debugging을 따른다. 오류 메시지 아래에 실패한 리소스와 이유가 출력된다. 템플릿을 고쳐야 하면 `tests/infra/workshopTemplate.test.ts`를 먼저 고쳐 실패를 확인하고, 템플릿을 고친 뒤 커밋하고 다시 배포한다.

- [ ] **Step 4: 코드 발급과 코드 있는 스모크 테스트**

Run: `npm run workshop:code -- new --days 1`
Expected: `새 워크숍 코드: seoul-XXXX-XXXX`와 만료 시각. 코드는 이 세션에서만 쓰고 파일이나 커밋에 남기지 않는다.

Run: `SEOUL_WORKSHOP_CODE=<코드> npm run workshop:deploy -- --skip-image`
Expected: `스택에 바뀐 것이 없습니다`, 거부 확인, `코드 있는 호출 확인: tool 23개, seoul___search_place 성공`

- [ ] **Step 5: Claude Code에서 틀린 코드의 안내 확인**

```bash
claude mcp add --transport http seoul-wrong <Gateway URL> --header "Authorization: Bearer seoul-WRNG-CODE" -s local
claude mcp list
claude mcp remove seoul-wrong -s local
```

Expected: `seoul-wrong`이 연결 실패로 표시된다. 출력에 "워크숍 코드가 올바르지 않습니다" 문구가 보이는지 기록한다.

문구가 보이지 않으면 거부 응답을 HTTP 200으로 바꾼다(스펙 9절 2단계).
1. `tests/infra/codeCheck.test.ts`에서 코드 오류와 만료 테스트의 기대값 `statusCode: 403`과 `toBe(403)`을 모두 `200`으로 바꾼다.
2. Run: `npx vitest run tests/infra/codeCheck.test.ts` → FAIL 확인
3. `infra/lambda/code-check.mjs`의 `deny`에서 `statusCode: 403`을 `statusCode: 200`으로 바꾼다.
4. Run: `npx vitest run tests/infra/codeCheck.test.ts` → PASS 확인
5. 커밋: `git commit -am "fix: return HTTP 200 JSON-RPC errors from the workshop interceptor" -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"`
6. Run: `npm run workshop:deploy -- --skip-image` (새 코드 키로 Lambda만 갱신)
7. 위 `claude mcp add`부터 다시 확인하고, 스펙 3.3과 10.1의 403 관련 문장을 결과에 맞게 고친다.

- [ ] **Step 6: Claude Code에서 올바른 코드로 연결**

```bash
claude mcp add --transport http seoul-ws <Gateway URL> --header "Authorization: Bearer <코드>" -s local
claude mcp list
claude mcp remove seoul-ws -s local
```

Expected: `seoul-ws`가 연결됨으로 표시된다.

- [ ] **Step 7: 실제 서울 API 호출**

아래 명령은 저장소 루트에서 실행한다(패키지를 루트의 `node_modules`에서 찾는다). 이 명령을 Step 8, 10에서도 쓴다.

```bash
URL=<Gateway URL> SEOUL_WORKSHOP_CODE=<코드> TOOL=seoul___get_city_snapshot COUNT=1 ARGS='{"place":"강남역"}' npx tsx -e "
(async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const client = new Client({ name: 'workshop-probe', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.URL), {
    requestInit: { headers: { Authorization: 'Bearer ' + process.env.SEOUL_WORKSHOP_CODE } },
  }))
  for (let i = 1; i <= Number(process.env.COUNT); i++) {
    const r = await client.callTool({ name: process.env.TOOL, arguments: JSON.parse(process.env.ARGS) })
    console.log(i, r.isError ? 'isError' : 'ok', String(r.content?.[0]?.text ?? '').slice(0, 100))
  }
  await client.close()
})().catch(e => { console.error('실패:', e.message); process.exit(1) })
"
```

Expected: `1 ok {"data":...` 형태로 강남역 도시데이터가 나온다.

- [ ] **Step 8: 분당 한도 확인**

Run: `npm run workshop:deploy -- --skip-image --rate-per-minute 3`
Expected: `스택을 갱신했습니다`

Step 7 명령을 `TOOL=seoul___search_place COUNT=4 ARGS='{"query":"강남"}'`로 실행한다.
Expected: 1~3은 `ok`, 4는 `isError`이고 "1분 뒤" 문구. 네 호출이 UTC 분 경계에 걸쳐 결과가 다르면 한 번 더 실행한다. 결과를 검증 기록에 적는다.

- [ ] **Step 9: 키 순환 확인 (키가 둘 이상일 때)**

Run: `npm run workshop:deploy -- --skip-image --quota-daily-limit 2`
Expected: `스택을 갱신했습니다`

Step 7 명령을 장소만 바꿔 세 번 실행한다. 캐시에 없는 요청이어야 하므로 `ARGS='{"place":"광화문·덕수궁"}'`, `ARGS='{"place":"홍대 관광특구"}'`, `ARGS='{"place":"잠실 관광특구"}'`를 쓴다.

장부를 확인한다(`<TableName>`은 `aws cloudformation describe-stacks --region ap-northeast-2 --stack-name seoul-workshop --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text`로 얻는다):

```bash
aws dynamodb scan --region ap-northeast-2 --table-name <TableName> \
  --filter-expression "begins_with(pk, :q)" \
  --expression-attribute-values '{":q":{"S":"quota#"}}' \
  --projection-expression "pk, used" --output table
```

Expected: 오늘 날짜의 `quota#<keyId>#<날짜>` 항목이 두 개 이상 있고, 첫 키의 `used`가 2 이상, 다음 키에도 사용량이 있다. 결과를 검증 기록에 적는다.

- [ ] **Step 10: 코드 폐기 확인**

Run: `npm run workshop:code -- revoke`
Expected: `코드를 폐기했습니다(만료 시각 ...)`

Step 7 명령을 다시 실행한다.
Expected: `실패:`로 시작하는 오류, 종료 코드 1. 결과를 검증 기록에 적는다.

- [ ] **Step 11: 파라미터 되돌리기**

Run: `npm run workshop:deploy -- --skip-image --rate-per-minute 120 --quota-daily-limit 1000`
Expected: `스택을 갱신했습니다`, 거부 확인(코드가 폐기된 상태)

Run: `npm run workshop:code -- show`
Expected: `(이미 만료됨)`

- [ ] **Step 12: 검증 기록 커밋**

`docs/workshop.md` 검증 기록의 다섯 행에 결과와 날짜를 채운다. Gateway URL, 계정 ID, 코드는 적지 않는다.

```bash
git add docs/workshop.md
git commit -m "docs: record workshop gateway verification results" -m "Claude-Session: https://claude.ai/code/session_01RrcrPTJygJzkotUJud7YFs"
```

- [ ] **Step 13: 보고**

사용자에게 다음을 보고한다: Gateway URL, 코드 상태(폐기됨), 검증 기록 다섯 항목, 실패하거나 건너뛴 단계와 이유. 푸시는 사용자가 요청할 때만 한다.
