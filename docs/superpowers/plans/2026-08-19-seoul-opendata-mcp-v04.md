# seoul-opendata-mcp v0.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stdio 전용 서버에 AgentCore Runtime 계약(Streamable HTTP·:8000·/mcp·/ping·ARM64)을 충족하는 HTTP 진입점과, 세션 수와 업스트림 쿼터를 분리하는 2단 캐시(L1 메모리+L2 DynamoDB)·stale 서빙·single-flight·일일 쿼터 예산 회계를 추가한다.

**Architecture:** `cache.ts`를 `CacheBackend` 추상화(+CompositeCache)로 재설계하고 `SeoulApiClient.fetchUnwrapped`에 fresh/stale/쿼터소진 3분기 파이프라인을 넣는다. L2·예산 원장은 env(`CACHE_TABLE_NAME`) 게이트 + lazy import라 stdio 경로는 완전 무변경 동작. `src/http.ts`는 기존 `buildServer()`를 재사용하는 별도 엔트리다.

**Tech Stack:** 기존 스택 + `@aws-sdk/client-dynamodb`/`@aws-sdk/lib-dynamodb`(lazy), node:http, SDK `StreamableHTTPServerTransport`.

**Spec:** `docs/superpowers/specs/2026-08-19-seoul-opendata-mcp-v04-design.md` (v1/v2 스펙의 전역 규칙 승계)

## Global Constraints

- v1/v2 전 규칙 승계: ok() 봉투 / 외부 HTTP는 SeoulApiClient만 / **tests/fixtures 불변** / 매핑 동등성 관례 / TDD RED→GREEN / 커밋 `feat:` `fix:` `test:` `docs:` `chore:` / TypeScript strict·ESM `.js` imports / 키 값 노출 금지(./.env 읽기 금지, 테스트는 가짜 키만)
- **stdio 경로 무영향**: `CACHE_TABLE_NAME` 미설정 시 신규 의존성 로드 0, 동작 차이는 TTL 값 변경뿐. 기존 테스트 109개(105+4 live)는 시그니처 적응 외 의미 변경 금지
- 캐시 계층·예산 원장 장애는 절대 요청을 실패시키지 않음(경고 로그 + 폴백)
- soft TTL 표는 스펙 §5 값 그대로, hard TTL은 전 서비스 24h(`HARD_TTL_MS = 86_400_000`)
- 쿼터 한도 env `QUOTA_DAILY_LIMIT` 기본 1000, 기준일은 KST(UTC+9), 카운터는 키별 분리
- HTTP 계약: `0.0.0.0:${PORT:-8000}`, `POST /mcp`(JSON/SSE), `GET /ping`→200 `{"status":"Healthy"}`, stateless(`sessionIdGenerator: undefined`), 임의 `Mcp-Session-Id` 헤더 거부 금지
- 실제 AWS 리소스 생성 금지(테스트는 주입식 fake, 문서에만 생성 명령 기재)

## File Structure

```
src/client/cache.ts        # 재작성: CacheEntry/CacheBackend/InMemoryCache/CompositeCache (T1)
src/client/quota.ts        # QuotaLedger/InMemoryLedger/kstDayKey (T3)
src/client/seoulApi.ts     # SOFT_TTL 정렬 + fresh/stale/소진 파이프라인 + single-flight (T2, T3 수정)
src/client/dynamo.ts       # DynamoDbCache/DynamoDbLedger/maybeAttachL2 — lazy import (T4)
src/http.ts                # Streamable HTTP 엔트리 (T5)
src/index.ts               # isCli 블록에 maybeAttachL2 호출 추가 (T4 수정)
Dockerfile, .dockerignore  # (T6)
docs/runbooks/agentcore-deploy.md, docs/decisions/ADR-004-*.md, README 양 섹션, CHANGELOG (T7)
tests/cache2.test.ts, tests/quota.test.ts, tests/dynamo.test.ts, tests/http.test.ts (신규)
tests/seoulApi.test.ts     # 캐시 async화·stale·소진 분기 케이스 추가 (T2/T3 수정)
```

---

### Task 1: 캐시 코어 재설계 — CacheBackend / InMemoryCache / CompositeCache

**Files:**
- Modify: `src/client/cache.ts` (전면 재작성 — 기존 TtlCache 제거)
- Create: `tests/cache2.test.ts`

**Interfaces:**
- Produces (이후 전 태스크가 소비하는 정확한 시그니처):
  - `interface CacheEntry { value: Unwrapped; storedAt: number; softTtlMs: number }`
  - `interface CacheBackend { get(key: string): Promise<CacheEntry | undefined>; set(key: string, entry: CacheEntry): Promise<void> }`
  - `const HARD_TTL_MS = 86_400_000`
  - `class InMemoryCache implements CacheBackend` — `constructor(now?: () => number, hardTtlMs?: number)`; hard 초과 항목은 get에서 삭제 후 undefined
  - `type Freshness = 'fresh' | 'stale'`
  - `class CompositeCache` — `constructor(l1: CacheBackend, l2?: CacheBackend, now?: () => number)`; `setL2(l2: CacheBackend): void`; `get(key): Promise<{ entry: CacheEntry; freshness: Freshness } | undefined>`(L1→L2, L2 히트 시 L1 승격, L2 예외는 console.error 후 무시); `set(key, value: Unwrapped, softTtlMs): Promise<void>`(L1·L2 기록, L2 예외 무시)

- [ ] **Step 1: Write the failing test**

`tests/cache2.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { InMemoryCache, CompositeCache, HARD_TTL_MS, type CacheBackend, type CacheEntry } from '../src/client/cache.js'

const U = (tag: string) => ({ rows: [{ tag }], totalCount: 1, raw: null }) as any

const fakeBackend = (store = new Map<string, CacheEntry>()): CacheBackend & { store: Map<string, CacheEntry> } => ({
  store,
  async get(k) { return store.get(k) },
  async set(k, e) { store.set(k, e) },
})

describe('InMemoryCache', () => {
  it('hard TTL(24h) 초과 항목은 get에서 제거', async () => {
    let t = 1_000_000
    const c = new InMemoryCache(() => t)
    await c.set('k', { value: U('a'), storedAt: t, softTtlMs: 1000 })
    t += HARD_TTL_MS + 1
    expect(await c.get('k')).toBeUndefined()
  })
})

describe('CompositeCache', () => {
  it('soft 이내는 fresh, 초과~hard 이내는 stale', async () => {
    let t = 0
    const cc = new CompositeCache(new InMemoryCache(() => t), undefined, () => t)
    await cc.set('k', U('a'), 300_000)
    expect((await cc.get('k'))!.freshness).toBe('fresh')
    t = 300_001
    expect((await cc.get('k'))!.freshness).toBe('stale')
  })
  it('L1 미스·L2 히트 시 L1으로 승격', async () => {
    let t = 0
    const l1 = fakeBackend(); const l2 = fakeBackend()
    await l2.set('k', { value: U('b'), storedAt: 0, softTtlMs: 1000 })
    const cc = new CompositeCache(l1, l2, () => t)
    expect((await cc.get('k'))!.entry.value.rows[0].tag).toBe('b')
    expect(l1.store.has('k')).toBe(true)
  })
  it('L2 get/set 예외는 무시되고 L1으로 폴백', async () => {
    const broken: CacheBackend = { async get() { throw new Error('ddb down') }, async set() { throw new Error('ddb down') } }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cc = new CompositeCache(new InMemoryCache(() => 0), broken, () => 0)
    await expect(cc.set('k', U('a'), 1000)).resolves.toBeUndefined()
    await expect(cc.get('k')).resolves.toBeTruthy()
    spy.mockRestore()
  })
  it('setL2로 뒤늦게 L2를 붙일 수 있다', async () => {
    const cc = new CompositeCache(new InMemoryCache(() => 0), undefined, () => 0)
    const l2 = fakeBackend()
    cc.setL2(l2)
    await cc.set('k', U('a'), 1000)
    expect(l2.store.has('k')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cache2.test.ts`
Expected: FAIL — 신규 export 없음

- [ ] **Step 3: 구현**

`src/client/cache.ts` 전면 교체:
```ts
import type { Unwrapped } from './response.js'

export const HARD_TTL_MS = 86_400_000 // stale 서빙 한도(전 서비스 공통 24h)

export interface CacheEntry { value: Unwrapped; storedAt: number; softTtlMs: number }

export interface CacheBackend {
  get(key: string): Promise<CacheEntry | undefined>
  set(key: string, entry: CacheEntry): Promise<void>
}

export class InMemoryCache implements CacheBackend {
  private store = new Map<string, CacheEntry>()
  constructor(private now: () => number = Date.now, private hardTtlMs: number = HARD_TTL_MS) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const e = this.store.get(key)
    if (!e) return undefined
    if (this.now() - e.storedAt > this.hardTtlMs) { this.store.delete(key); return undefined }
    return e
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.store.set(key, entry)
  }
}

export type Freshness = 'fresh' | 'stale'

/** L1(프로세스 메모리) 우선, L2(전역, 선택)는 실패해도 요청을 실패시키지 않는다 */
export class CompositeCache {
  constructor(
    private l1: CacheBackend,
    private l2: CacheBackend | undefined = undefined,
    private now: () => number = Date.now,
  ) {}

  setL2(l2: CacheBackend): void { this.l2 = l2 }

  async get(key: string): Promise<{ entry: CacheEntry; freshness: Freshness } | undefined> {
    let entry = await this.l1.get(key)
    if (!entry && this.l2) {
      try {
        entry = await this.l2.get(key)
        if (entry) await this.l1.set(key, entry)
      } catch (e) {
        console.error(`[cache] L2 get 실패 — L1 폴백: ${(e as Error).message}`)
      }
    }
    if (!entry) return undefined
    if (this.now() - entry.storedAt > HARD_TTL_MS) return undefined
    const freshness: Freshness = this.now() - entry.storedAt <= entry.softTtlMs ? 'fresh' : 'stale'
    return { entry, freshness }
  }

  async set(key: string, value: Unwrapped, softTtlMs: number): Promise<void> {
    const entry: CacheEntry = { value, storedAt: this.now(), softTtlMs }
    await this.l1.set(key, entry)
    if (this.l2) {
      try { await this.l2.set(key, entry) } catch (e) {
        console.error(`[cache] L2 set 실패 — 무시: ${(e as Error).message}`)
      }
    }
  }
}
```
주의: 이 시점에 `src/client/seoulApi.ts`가 기존 `TtlCache`를 import하므로 빌드가 깨진다 — **이 태스크에서 seoulApi의 캐시 사용부를 최소 수정으로 함께 적응**한다(동작 동일 유지): `new TtlCache(opts.now)` → `new CompositeCache(new InMemoryCache(opts.now), undefined, opts.now ?? Date.now)`, `const cached = this.cache.get(url)` → `const cached = await this.cache.get(url); if (cached?.freshness === 'fresh') return cached.entry.value`(stale 분기는 T2에서 — 여기서는 stale이면 미스로 취급: `if (cached) { /* T2에서 stale 서빙 */ }` 없이 fresh만 반환), `this.cache.set(url, result, TTL[service] ?? 60_000)` 형태로 교체.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cache2.test.ts && npm test && npm run build`
Expected: 신규 5 PASS + 기존 109개 green(캐시 히트 의미 불변) + 빌드 클린

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: cache backend abstraction — InMemoryCache and CompositeCache with soft/hard TTL"
```

---

### Task 2: SOFT_TTL 정렬 + stale-while-revalidate + single-flight

**Files:**
- Modify: `src/client/seoulApi.ts`
- Test: `tests/seoulApi.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: `CompositeCache`/`CacheEntry`(T1)
- Produces:
  - `SOFT_TTL: Record<string, number>` + `DEFAULT_SOFT_TTL = 3_600_000` export (스펙 §5 표 그대로)
  - `Unwrapped` 반환 시 stale이면 `note`에 `캐시된 데이터(약 N분 경과) — 백그라운드 갱신 중` 병합(기존 note와 ` | `로 연결)
  - private `fetchFresh(url, base, type, service, keyUsed)` — single-flight 맵 경유
  - `withNote(u: Unwrapped, note: string): Unwrapped` export (T3 재사용)

- [ ] **Step 1: Write the failing tests**

`tests/seoulApi.test.ts`에 추가:
```ts
  it('SOFT_TTL 정렬: citydata 계열 300s, 배치 통계 24h, 기본 1h', async () => {
    const { SOFT_TTL, DEFAULT_SOFT_TTL } = await import('../src/client/seoulApi.js')
    expect(SOFT_TTL['citydata']).toBe(300_000)
    expect(SOFT_TTL['citydata_ppltn']).toBe(300_000)
    expect(SOFT_TTL['realtimeStationArrival']).toBe(15_000)
    expect(SOFT_TTL['CardSubwayStatsNew']).toBe(86_400_000)
    expect(SOFT_TTL['SPOP_LOCAL_RESD_DONG']).toBe(86_400_000)
    expect(SOFT_TTL['tbLnOpendataRtmsV']).toBe(21_600_000)
    expect(SOFT_TTL['culturalEventInfo']).toBe(21_600_000)
    expect(SOFT_TTL['TbPharmacyOperateInfo']).toBe(86_400_000)
    expect(SOFT_TTL['AccInfo']).toBe(300_000)
    expect(SOFT_TTL['TimeAverageAirQuality']).toBe(3_600_000)
    expect(DEFAULT_SOFT_TTL).toBe(3_600_000)
  })

  it('stale-while-revalidate: soft 만료 시 stale 즉시 반환 + note + 백그라운드 1회 갱신', async () => {
    let t = 0
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(standardPage([{ v: 1 }], 1))
      .mockResolvedValueOnce(standardPage([{ v: 2 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, now: () => t })
    await c.getJson('bikeList', 1, 5)                     // 미스 → fetch #1
    t = 300_001                                            // bikeList soft 300s 초과
    const stale = await c.getJson('bikeList', 1, 5)        // stale 즉시 반환
    expect(stale.rows[0].v).toBe(1)
    expect(stale.note).toContain('캐시된 데이터')
    await new Promise(r => setTimeout(r, 20))              // 백그라운드 갱신 완료 대기
    expect(fetchFn).toHaveBeenCalledTimes(2)               // fetch #2 (갱신)
    const fresh = await c.getJson('bikeList', 1, 5)        // 갱신본이 fresh로 서빙
    expect(fresh.rows[0].v).toBe(2)
    expect(fresh.note).toBeUndefined()
  })

  it('single-flight: 동일 URL 동시 5회 요청은 업스트림 1회', async () => {
    let resolveFetch!: (r: Response) => void
    const fetchFn = vi.fn().mockReturnValue(new Promise<Response>(res => { resolveFetch = res }))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    const calls = Promise.all(Array.from({ length: 5 }, () => c.getJson('bikeList', 1, 5)))
    await new Promise(r => setTimeout(r, 10))
    resolveFetch(standardPage([{ a: 1 }], 1))
    const results = await calls
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(results.every(u => u.rows.length === 1)).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/seoulApi.test.ts`
Expected: 신규 3건 FAIL (SOFT_TTL 미export, stale 미구현, 병합 미구현)

- [ ] **Step 3: 구현**

`src/client/seoulApi.ts` 수정:
```ts
// TTL 상수 교체 (기존 TTL 맵 삭제)
export const DEFAULT_SOFT_TTL = 3_600_000
// 원천 데이터 갱신 주기에 정렬 — 스펙 §5
export const SOFT_TTL: Record<string, number> = {
  citydata: 300_000, citydata_ppltn: 300_000, citydata_cmrcl: 300_000,
  realtimeStationArrival: 15_000,
  bikeList: 300_000, GetParkingInfo: 300_000, RealtimeCityAir: 300_000, AccInfo: 300_000,
  culturalEventInfo: 21_600_000,
  tbLnOpendataRtmsV: 21_600_000, tbLnOpendataRentV: 21_600_000,
  CardSubwayStatsNew: 86_400_000, CardBusStatisticsServiceNew: 86_400_000,
  SPOP_LOCAL_RESD_DONG: 86_400_000, SPOP_DAILYSUM_JACHI: 86_400_000,
  TbPharmacyOperateInfo: 86_400_000, TbHospitalInfo: 86_400_000, ChildCareInfo: 86_400_000,
  TimeAverageAirQuality: 3_600_000,
}

/** 기존 note를 보존하며 안내를 병합한 사본 반환 */
export function withNote(u: Unwrapped, note: string): Unwrapped {
  return { ...u, note: u.note ? `${u.note} | ${note}` : note }
}
```

`fetchUnwrapped`를 3분기 파이프라인으로 교체 + single-flight (`private inflight = new Map<string, Promise<Unwrapped>>()`, `private nowFn: () => number` 필드 저장):
```ts
  private async fetchUnwrapped(base: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): Promise<Unwrapped> {
    const key = base === SUBWAY_BASE ? this.subwayKey : this.key
    if (key === 'sample') end = Math.min(end, start + 4)
    const url = this.buildUrl(base, key, type, service, start, end, path)

    const cached = await this.cache.get(url)
    if (cached?.freshness === 'fresh') return cached.entry.value

    if (cached) {
      // stale: 즉시 반환 + 백그라운드 갱신 (실패는 로그만 — 다음 요청이 재시도)
      void this.fetchFresh(url, type, service).catch(e =>
        console.error(`[cache] 백그라운드 갱신 실패(${service}): ${(e as Error).message}`))
      const ageMin = Math.round((this.nowFn() - cached.entry.storedAt) / 60_000)
      return withNote(cached.entry.value, `캐시된 데이터(약 ${ageMin}분 경과) — 백그라운드 갱신 중`)
    }

    return this.fetchFresh(url, type, service)
  }

  /** 실제 업스트림 호출 — 동일 URL 동시 요청은 1회로 병합(single-flight) */
  private fetchFresh(url: string, type: 'json' | 'xml', service: string): Promise<Unwrapped> {
    const existing = this.inflight.get(url)
    if (existing) return existing
    const p = (async () => {
      const text = await this.request(url)
      const payload = type === 'xml' ? this.xml.parse(text) : this.parseJsonWithXmlFallback(service, text)
      const result = unwrap(service, payload)
      await this.cache.set(url, result, SOFT_TTL[service] ?? DEFAULT_SOFT_TTL)
      return result
    })().finally(() => this.inflight.delete(url))
    this.inflight.set(url, p)
    return p
  }
```
생성자에 `this.nowFn = opts.now ?? Date.now` 저장(캐시 생성에 이미 쓰는 값 재사용).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/seoulApi.test.ts && npm test && npm run build`
Expected: 전체 green (기존 '동일 URL 재호출 캐시' 테스트는 fresh 경로로 그대로 통과)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: source-aligned soft TTLs, stale-while-revalidate, single-flight"
```

---

### Task 3: 쿼터 예산 회계 (QuotaLedger)

**Files:**
- Create: `src/client/quota.ts`, `tests/quota.test.ts`
- Modify: `src/client/seoulApi.ts` (파이프라인에 예산 분기), `tests/seoulApi.test.ts` (통합 케이스)

**Interfaces:**
- Produces:
  - `interface QuotaStatus { used: number; limit: number; ratio: number }`
  - `interface QuotaLedger { increment(keyId: string): Promise<void>; status(keyId: string): Promise<QuotaStatus> }`
  - `class InMemoryLedger implements QuotaLedger` — `constructor(limit?: number, now?: () => number)`; 기본 limit = `Number(process.env.QUOTA_DAILY_LIMIT ?? 1000)`
  - `function kstDayKey(now: () => number): string` — UTC+9 기준 `YYYYMMDD`
  - `function keyIdOf(apiKey: string): string` — `sha256(apiKey).slice(0,8)` (node:crypto, 원문 키 비노출)
  - `ClientOptions`에 `ledger?: QuotaLedger` 추가; `SeoulApiClient.setLedger(l: QuotaLedger): void`

- [ ] **Step 1: Write the failing tests**

`tests/quota.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { InMemoryLedger, kstDayKey, keyIdOf } from '../src/client/quota.js'

describe('kstDayKey', () => {
  it('UTC 15:30 = KST 다음날 00:30', () => {
    const t = Date.UTC(2026, 7, 19, 15, 30) // 2026-08-19 15:30 UTC → KST 08-20
    expect(kstDayKey(() => t)).toBe('20260820')
  })
})

describe('keyIdOf', () => {
  it('원문 키를 포함하지 않는 8자 해시', () => {
    const id = keyIdOf('SECRETKEY123')
    expect(id).toHaveLength(8)
    expect('SECRETKEY123').not.toContain(id)
  })
})

describe('InMemoryLedger', () => {
  it('키별·일별 독립 카운트와 ratio', async () => {
    let t = Date.UTC(2026, 7, 19, 0, 0)
    const l = new InMemoryLedger(10, () => t)
    await l.increment('a'); await l.increment('a'); await l.increment('b')
    expect((await l.status('a'))).toMatchObject({ used: 2, limit: 10, ratio: 0.2 })
    expect((await l.status('b')).used).toBe(1)
    t += 86_400_000 // 다음 날 → 카운터 리셋
    expect((await l.status('a')).used).toBe(0)
  })
})
```

`tests/seoulApi.test.ts`에 통합 케이스 추가:
```ts
  it('쿼터 80% 이상이면 fresh 응답에도 경고 note', async () => {
    const { InMemoryLedger } = await import('../src/client/quota.js')
    const ledger = new InMemoryLedger(5)
    for (let i = 0; i < 4; i++) await ledger.increment((await import('../src/client/quota.js')).keyIdOf('K'))
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger })
    const u = await c.getJson('bikeList', 1, 5) // 5번째 호출 = 100%... 아님: 호출 전 4/5=80%
    expect(u.note).toContain('쿼터')
  })

  it('쿼터 소진 시: 캐시 있으면 stale 서빙, 없으면 빈 결과 + 안내(에러 아님)', async () => {
    const { InMemoryLedger, keyIdOf } = await import('../src/client/quota.js')
    let t = 0
    const ledger = new InMemoryLedger(1)
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger, now: () => t })
    await c.getJson('bikeList', 1, 5)            // 1/1 소진
    t = 300_001                                   // soft 만료 → stale
    const stale = await c.getJson('bikeList', 1, 5)
    expect(stale.rows).toHaveLength(1)
    expect(stale.note).toContain('쿼터')          // 소진 상태에서 stale 서빙 안내
    expect(fetchFn).toHaveBeenCalledTimes(1)      // 백그라운드 갱신도 억제
    const miss = await c.getJson('GetParkingInfo', 1, 5) // 캐시 없음 → 빈 결과
    expect(miss.rows).toHaveLength(0)
    expect(miss.note).toContain('쿼터')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/quota.test.ts tests/seoulApi.test.ts`
Expected: FAIL — 모듈/분기 없음

- [ ] **Step 3: 구현**

`src/client/quota.ts`:
```ts
import { createHash } from 'node:crypto'

export interface QuotaStatus { used: number; limit: number; ratio: number }

export interface QuotaLedger {
  increment(keyId: string): Promise<void>
  status(keyId: string): Promise<QuotaStatus>
}

/** UTC+9(KST) 기준 YYYYMMDD — 서울시 쿼터의 하루 경계 */
export function kstDayKey(now: () => number = Date.now): string {
  return new Date(now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '')
}

/** 원문 키를 어디에도 남기지 않기 위한 8자 식별자 */
export function keyIdOf(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 8)
}

export class InMemoryLedger implements QuotaLedger {
  private counts = new Map<string, number>()
  constructor(
    private limit: number = Number(process.env.QUOTA_DAILY_LIMIT ?? 1000),
    private now: () => number = Date.now,
  ) {}

  private bucket(keyId: string): string { return `${keyId}#${kstDayKey(this.now)}` }

  async increment(keyId: string): Promise<void> {
    const b = this.bucket(keyId)
    this.counts.set(b, (this.counts.get(b) ?? 0) + 1)
  }

  async status(keyId: string): Promise<QuotaStatus> {
    const used = this.counts.get(this.bucket(keyId)) ?? 0
    return { used, limit: this.limit, ratio: this.limit > 0 ? used / this.limit : 1 }
  }
}
```

`src/client/seoulApi.ts` — 생성자에 `this.ledger = opts.ledger ?? new InMemoryLedger(undefined, opts.now)` + `setLedger()`, `fetchUnwrapped` 3분기 완성:
```ts
    const keyId = keyIdOf(key)
    const budget = await this.safeStatus(keyId)   // ledger 예외는 {used:0,limit:∞,ratio:0}으로 폴백

    if (budget.ratio >= 1) {
      if (cached) return withNote(cached.entry.value,
        `일일 API 쿼터 소진 — 캐시된 데이터(약 ${age(cached)}분 경과)로 응답합니다`)
      return { rows: [], totalCount: 0, raw: null,
        note: `일일 API 쿼터(${budget.limit}회)가 소진되어 새 데이터를 가져올 수 없습니다. 내일 자정(KST) 이후 재시도하세요.` }
    }

    if (cached) { /* T2의 stale 분기 그대로 */ }

    const result = await this.fetchFresh(url, type, service, keyId)
    if (budget.ratio >= 0.8) {
      return withNote(result, `일일 API 쿼터 ${Math.round(budget.ratio * 100)}% 사용(${budget.used}/${budget.limit})`)
    }
    return result
```
`fetchFresh`는 `keyId` 인자를 받아 `this.request(url)` 성공 직후 `await this.safeIncrement(keyId)` 호출(ledger 예외는 로그 후 무시). `safeStatus`/`safeIncrement`는 try/catch 래퍼로 원장 장애가 요청을 죽이지 않게 한다. stale 분기의 백그라운드 갱신은 `budget.ratio < 1`일 때만 발화(소진 시 억제 — 위 테스트가 검증).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/quota.test.ts tests/seoulApi.test.ts && npm test && npm run build`
Expected: 전체 green

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: daily quota ledger with warning notes and stale-only exhaustion mode"
```

---

### Task 4: DynamoDB L2 어댑터 + env 게이트 배선

**Files:**
- Create: `src/client/dynamo.ts`, `tests/dynamo.test.ts`
- Modify: `package.json` (deps 추가), `src/index.ts` (isCli 블록에 attach 호출)

**Interfaces:**
- Consumes: `CacheBackend`/`CacheEntry`(T1), `QuotaLedger`/`kstDayKey`(T3), `SeoulApiClient.setLedger`, `CompositeCache.setL2`(클라이언트에 `attachL2(l2: CacheBackend): void` 위임 메서드 추가 — cache 필드가 private이므로)
- Produces:
  - `interface DocClientLike { get(p): Promise<{ Item?: any }>; put(p): Promise<any>; update(p): Promise<{ Attributes?: any }> }` — 테스트 주입 지점
  - `class DynamoDbCache implements CacheBackend` — `constructor(doc: DocClientLike, table: string)`; 380KB 초과 entry는 set 생략; item: `{ pk, entry: JSON문자열, expireAt: 초단위(storedAt+HARD_TTL) }`
  - `class DynamoDbLedger implements QuotaLedger` — `constructor(doc: DocClientLike, table: string, limit?: number, now?: () => number)`; `pk = quota#<keyId>#<kstDayKey>`; increment는 `UpdateExpression: 'ADD used :one'`, status는 get
  - `async function maybeAttachL2(client: SeoulApiClient): Promise<boolean>` — `process.env.CACHE_TABLE_NAME` 없으면 즉시 false(**aws-sdk 미로드**); 있으면 `await import('@aws-sdk/client-dynamodb')`/`'@aws-sdk/lib-dynamodb'`로 DocClient 생성 후 `client.attachL2(...)`+`client.setLedger(...)`, 실패 시 console.error 후 false

- [ ] **Step 1: 의존성 추가**

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

- [ ] **Step 2: Write the failing tests**

`tests/dynamo.test.ts` (실 AWS 미사용 — fake DocClient 주입):
```ts
import { describe, it, expect, vi } from 'vitest'
import { DynamoDbCache, DynamoDbLedger, type DocClientLike } from '../src/client/dynamo.js'
import { HARD_TTL_MS } from '../src/client/cache.js'

const fakeDoc = (): DocClientLike & { items: Map<string, any> } => {
  const items = new Map<string, any>()
  return {
    items,
    async get({ Key }: any) { return { Item: items.get(Key.pk) } },
    async put({ Item }: any) { items.set(Item.pk, Item) },
    async update({ Key, ExpressionAttributeValues }: any) {
      const cur = items.get(Key.pk) ?? { pk: Key.pk, used: 0 }
      cur.used += ExpressionAttributeValues[':one']
      items.set(Key.pk, cur)
      return { Attributes: cur }
    },
  }
}

describe('DynamoDbCache', () => {
  it('set 후 get 왕복 + expireAt은 storedAt+HARD_TTL(초)', async () => {
    const doc = fakeDoc()
    const c = new DynamoDbCache(doc, 'T')
    await c.set('u1', { value: { rows: [1] } as any, storedAt: 1_000_000, softTtlMs: 300_000 })
    const item = doc.items.get('u1')
    expect(item.expireAt).toBe(Math.floor((1_000_000 + HARD_TTL_MS) / 1000))
    const e = await c.get('u1')
    expect(e!.value.rows[0]).toBe(1)
    expect(e!.softTtlMs).toBe(300_000)
  })
  it('380KB 초과 entry는 set을 생략', async () => {
    const doc = fakeDoc()
    const c = new DynamoDbCache(doc, 'T')
    const big = { value: { rows: ['x'.repeat(400_000)] } as any, storedAt: 0, softTtlMs: 1000 }
    await c.set('big', big)
    expect(doc.items.has('big')).toBe(false)
  })
})

describe('DynamoDbLedger', () => {
  it('increment 누적 + status + 키·일별 pk 분리', async () => {
    const doc = fakeDoc()
    let t = Date.UTC(2026, 7, 19, 0, 0)
    const l = new DynamoDbLedger(doc, 'T', 10, () => t)
    await l.increment('abc'); await l.increment('abc')
    expect((await l.status('abc'))).toMatchObject({ used: 2, ratio: 0.2 })
    expect([...doc.items.keys()][0]).toMatch(/^quota#abc#\d{8}$/)
  })
})

describe('maybeAttachL2', () => {
  it('CACHE_TABLE_NAME 미설정이면 false (aws-sdk 미로드 경로)', async () => {
    delete process.env.CACHE_TABLE_NAME
    const { maybeAttachL2 } = await import('../src/client/dynamo.js')
    const { SeoulApiClient } = await import('../src/client/seoulApi.js')
    expect(await maybeAttachL2(new SeoulApiClient({ apiKey: 'K', fetchFn: vi.fn() as any }))).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/dynamo.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`src/client/dynamo.ts`:
```ts
import { HARD_TTL_MS, type CacheBackend, type CacheEntry } from './cache.js'
import { kstDayKey, type QuotaLedger, type QuotaStatus } from './quota.js'
import type { SeoulApiClient } from './seoulApi.js'

const MAX_ITEM_BYTES = 380_000 // DynamoDB 400KB 한도 대비 여유

export interface DocClientLike {
  get(params: any): Promise<{ Item?: any }>
  put(params: any): Promise<any>
  update(params: any): Promise<{ Attributes?: any }>
}

export class DynamoDbCache implements CacheBackend {
  constructor(private doc: DocClientLike, private table: string) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const { Item } = await this.doc.get({ TableName: this.table, Key: { pk: key } })
    if (!Item?.entry) return undefined
    const e = JSON.parse(Item.entry) as CacheEntry
    return e
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const body = JSON.stringify(entry)
    if (Buffer.byteLength(body) > MAX_ITEM_BYTES) return // L1만으로 충분한 대형 응답
    await this.doc.put({
      TableName: this.table,
      Item: { pk: key, entry: body, expireAt: Math.floor((entry.storedAt + HARD_TTL_MS) / 1000) },
    })
  }
}

export class DynamoDbLedger implements QuotaLedger {
  constructor(
    private doc: DocClientLike,
    private table: string,
    private limit: number = Number(process.env.QUOTA_DAILY_LIMIT ?? 1000),
    private now: () => number = Date.now,
  ) {}

  private pk(keyId: string): string { return `quota#${keyId}#${kstDayKey(this.now)}` }

  async increment(keyId: string): Promise<void> {
    await this.doc.update({
      TableName: this.table,
      Key: { pk: this.pk(keyId) },
      UpdateExpression: 'ADD used :one',
      ExpressionAttributeValues: { ':one': 1 },
    })
  }

  async status(keyId: string): Promise<QuotaStatus> {
    const { Item } = await this.doc.get({ TableName: this.table, Key: { pk: this.pk(keyId) } })
    const used = Item?.used ?? 0
    return { used, limit: this.limit, ratio: this.limit > 0 ? used / this.limit : 1 }
  }
}

/** CACHE_TABLE_NAME 설정 시에만 aws-sdk를 lazy 로드해 L2 캐시·원장을 연결한다. 실패해도 서버는 L1으로 계속 동작 */
export async function maybeAttachL2(client: SeoulApiClient): Promise<boolean> {
  const table = process.env.CACHE_TABLE_NAME
  if (!table) return false
  try {
    const [{ DynamoDBClient }, { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand }] =
      await Promise.all([import('@aws-sdk/client-dynamodb'), import('@aws-sdk/lib-dynamodb')])
    const raw = DynamoDBDocumentClient.from(new DynamoDBClient({}))
    const doc: DocClientLike = {
      get: p => raw.send(new GetCommand(p)),
      put: p => raw.send(new PutCommand(p)),
      update: p => raw.send(new UpdateCommand(p)),
    }
    client.attachL2(new DynamoDbCache(doc, table))
    client.setLedger(new DynamoDbLedger(doc, table))
    console.error(`[cache] DynamoDB L2 활성화: ${table}`)
    return true
  } catch (e) {
    console.error(`[cache] L2 연결 실패 — L1 전용으로 계속: ${(e as Error).message}`)
    return false
  }
}
```

`src/client/seoulApi.ts`에 위임 메서드 추가:
```ts
  attachL2(l2: CacheBackend): void { this.cache.setL2(l2) }
  setLedger(l: QuotaLedger): void { this.ledger = l }
```

`src/index.ts` isCli 블록의 클라이언트 생성 직후에:
```ts
  const { maybeAttachL2 } = await import('./client/dynamo.js')
  await maybeAttachL2(client)
```
(dynamo.ts 자체를 lazy import해 stdio 기동 경로에서 모듈 로드 비용 0 유지)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/dynamo.test.ts && npm test && npm run build`
Expected: 전체 green. 추가 검증: `npm pack --dry-run 2>&1 | tail -3`으로 패키지 크기 기록(리뷰용 — aws-sdk는 deps라 tarball엔 미포함, node_modules만 증가)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: DynamoDB L2 cache and quota ledger behind CACHE_TABLE_NAME gate"
```

---

### Task 5: Streamable HTTP 진입점 (AgentCore Runtime 계약)

**Files:**
- Create: `src/http.ts`, `tests/http.test.ts`

**Interfaces:**
- Consumes: `buildServer(client)`/`SeoulApiClient`/`loadDotEnv`/`maybeAttachL2`
- Produces: `node dist/http.js`로 기동하는 HTTP 서버 — 계약: `0.0.0.0:${PORT:-8000}`, `GET /ping`→200 `{"status":"Healthy"}`, `POST /mcp`(stateless Streamable HTTP), 미지정 경로 404

- [ ] **Step 1: Write the failing test**

`tests/http.test.ts` (빌드 산출물을 실제 spawn — cli.test.ts 관례):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, execSync, type ChildProcess } from 'node:child_process'

const PORT = 18077
let proc: ChildProcess

const rpc = (body: object, extraHeaders: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extraHeaders },
    body: JSON.stringify(body),
  })

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }

/** SSE 또는 JSON 응답에서 JSON-RPC 메시지를 추출 */
const parseRpc = async (res: Response) => {
  const text = await res.text()
  const line = text.split('\n').find(l => l.startsWith('data:'))
  return JSON.parse(line ? line.slice(5).trim() : text)
}

beforeAll(async () => {
  execSync('npm run build', { stdio: 'ignore' })
  proc = spawn('node', ['dist/http.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/ping`)).ok) return } catch { /* 기동 대기 */ }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('http 서버 기동 실패')
}, 30_000)

afterAll(() => { proc?.kill() })

describe('AgentCore Runtime HTTP 계약', () => {
  it('GET /ping → 200 {"status":"Healthy"}', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/ping`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'Healthy' })
  })

  it('POST /mcp: initialize → tools/list 19개 (stateless — 요청 간 세션 불요)', async () => {
    const init = await rpc(INIT)
    expect(init.status).toBe(200)
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const msg = await parseRpc(list)
    expect(msg.result.tools).toHaveLength(19)
  }, 15_000)

  it('플랫폼 주입 Mcp-Session-Id 헤더를 거부하지 않는다', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-session-id': 'platform-generated-abc123' })
    expect(res.status).toBe(200)
  }, 15_000)

  it('미지정 경로는 404', async () => {
    expect((await fetch(`http://127.0.0.1:${PORT}/nope`)).status).toBe(404)
  })
})
```
주의: stateless 모드에서 initialize 없이 오는 요청을 SDK가 어떻게 다루는지는 SDK 버전에 따라 다르다 — tools/list가 400/`server not initialized`를 반환하면 **요청마다 새 server+transport를 만드는 구현이 맞는지** 먼저 확인하고, 그래도 거부되면 각 테스트에서 initialize를 선행하는 형태로 테스트를 조정하라(계약의 본질은 "어떤 순서든 500/거부 없이 처리"다). 조정 시 보고서에 SDK 동작을 기록할 것.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http.test.ts`
Expected: FAIL — dist/http.js 없음(기동 실패)

- [ ] **Step 3: 구현**

`src/http.ts`:
```ts
#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildServer, SERVER_NAME, SERVER_VERSION } from './index.js'
import { SeoulApiClient } from './client/seoulApi.js'
import { loadDotEnv } from './client/env.js'

loadDotEnv()
const client = new SeoulApiClient() // 프로세스 전역 1개 — L1 캐시·원장 공유
const { maybeAttachL2 } = await import('./client/dynamo.js')
await maybeAttachL2(client)

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // stateless: 요청마다 독립 server/transport — 플랫폼의 Mcp-Session-Id를 검증하지 않는다
  const server = buildServer(client)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { void transport.close(); void server.close() })
  await server.connect(transport)
  await transport.handleRequest(req, res, await readBody(req))
}

const port = Number(process.env.PORT ?? 8000)
createServer((req, res) => {
  const url = req.url ?? ''
  if (req.method === 'GET' && (url === '/ping' || url.startsWith('/ping?'))) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"Healthy"}')
    return
  }
  if (url === '/mcp' || url.startsWith('/mcp?')) {
    handleMcp(req, res).catch(e => {
      console.error(`[http] 요청 처리 실패: ${(e as Error).message}`)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }))
    })
    return
  }
  res.writeHead(404).end()
}).listen(port, '0.0.0.0', () => {
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} Streamable HTTP on 0.0.0.0:${port} (stateless)`)
  if (client.isSample) console.error(`[${SERVER_NAME}] SEOUL_API_KEY 미설정 — 샘플 키로 동작합니다.`)
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http.test.ts && npm test && npm run build`
Expected: 전체 green (오프라인 — search_place/tools/list는 네트워크 불요)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: streamable HTTP entrypoint on :8000 for AgentCore Runtime contract"
```

---

### Task 6: 컨테이너 (Dockerfile / .dockerignore) + 번들 회귀

**Files:**
- Create: `Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: `dist/http.js`(T5)
- Produces: ARM64 컨테이너 이미지 — `EXPOSE 8000`, `CMD ["node","dist/http.js"]`

- [ ] **Step 1: 파일 작성**

`Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
# AgentCore Runtime 요구: linux/arm64
FROM --platform=linux/arm64 node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=linux/arm64 node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8000
# 키는 이미지에 포함하지 않는다 — Runtime env(SEOUL_API_KEY 등)로 주입
CMD ["node", "dist/http.js"]
```

`.dockerignore`:
```
node_modules
dist
tests
docs
scripts
.claude
.superpowers
.git
.env
.env.example
*.mcpb
seoul-opendata-mcp.mcpb
vitest.config.ts
README*.md
CHANGELOG.md
LICENSE
manifest.json
.mcp.json
.mcpbignore
```

- [ ] **Step 2: 조건부 컨테이너 스모크**

Run: `command -v docker && docker build -t seoul-opendata-mcp:v04 . && docker run -d --rm -p 18088:8000 --name som-smoke seoul-opendata-mcp:v04 && sleep 2 && curl -s http://127.0.0.1:18088/ping && docker rm -f som-smoke`
Expected: `{"status":"Healthy"}`. **docker 미설치 시 이 단계는 SKIP하고 보고서에 "docker 미가용 — Dockerfile은 문법 검토만" 기록** (hadolint 불요, 빌드 실패 시 수정).

- [ ] **Step 3: 번들 회귀 (aws-sdk 추가 영향 확인)**

Run: `npm run bundle && ls -la seoul-opendata-mcp.mcpb` 후 언팩 실행 스모크(deploy.md의 필수 절차 그대로 — tools/list 19 확인). aws-sdk가 prod deps에 추가되어 mcpb 크기가 커진다 — **크기를 보고서에 기록**(수 MB 증가 예상, 10MB 초과 시 보고서에 플래그만 하고 진행).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore && git commit -m "feat: ARM64 container image for AgentCore Runtime deployment"
```

---

### Task 7: 문서 + ADR-004 + 최종 검증

**Files:**
- Create: `docs/runbooks/agentcore-deploy.md`, `docs/decisions/ADR-004-session-scaling-two-tier-cache.md`
- Modify: `README.md`(양 언어), `CHANGELOG.md`(Unreleased), `docs/architecture.md`(캐시 계층 반영), `.env.example`(신규 env 2종 주석)

**Interfaces:**
- Consumes: 완성된 T1~T6 전부

- [ ] **Step 1: README 갱신 (영/한 미러, 구조 패리티 유지)**

- Installation 뒤에 `## Deploy to AgentCore Runtime` / `## AgentCore Runtime에 배포` 절 신설: ① 컨테이너 빌드→ECR push 개요 ② DynamoDB 캐시 테이블 생성 한 줄(`aws dynamodb create-table --table-name seoul-mcp-cache --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH --billing-mode PAY_PER_REQUEST` + TTL 활성화 `--time-to-live-specification` 안내) ③ env 표(`SEOUL_API_KEY`, `SEOUL_SUBWAY_API_KEY`, `CACHE_TABLE_NAME`(선택 — 전역 캐시·쿼터 원장), `QUOTA_DAILY_LIMIT`(기본 1000), `PORT`(기본 8000)) ④ Gateway 확장 경로 1단락(mcpServer 타깃 등록으로 무변경 통합) ⑤ **주의: 실제 배포는 AWS 과금 리소스 생성** 문구
- Coverage & Limits에 stale 서빙·쿼터 소진 동작 한 줄: "쿼터 소진 시에도 24시간 이내 캐시로 응답하며 note로 고지"

- [ ] **Step 2: 런북·ADR 작성**

- `docs/runbooks/agentcore-deploy.md`: .template.md 구조 — 배포(ECR push→create_agent_runtime/agentcore CLI), 검증(/ping·tools/list), 롤백(이전 버전 엔드포인트 핀), 장애 대응(L2 오류 로그 → L1 폴백 확인, 쿼터 소진 → stale-only 동작 확인). 모든 명령은 복붙 가능하게, "실행 전 과금 확인" 경고 포함
- `ADR-004-session-scaling-two-tier-cache.md`: .template.md 구조(양 언어 앵커) — 결정: 세션 수와 업스트림 쿼터의 분리(L1+L2, stale-while-revalidate, single-flight, 일일 예산 회계). 대안 비교: microVM-로컬 캐시 유지(세션 비례 소진), 수집기 선수집(push — 유입 검증 후 후속). 근거 커밋은 이 플랜의 T1~T4

- [ ] **Step 3: CHANGELOG·architecture·.env.example 갱신**

- CHANGELOG `[Unreleased]` 양 언어에: Added — Streamable HTTP 진입점(AgentCore Runtime 계약)/ARM64 Dockerfile/DynamoDB 2단 캐시·쿼터 예산(옵션)/stale 서빙·single-flight; Changed — TTL 원천 주기 정렬(citydata 60s→300s 등)
- `docs/architecture.md`: 클라이언트 층 설명에 2단 캐시·원장 반영(양 언어), Mermaid의 Client 노드 문구 갱신
- `.env.example`에 주석으로 `# CACHE_TABLE_NAME=` `# QUOTA_DAILY_LIMIT=1000` 추가(빈 값 유지)

- [ ] **Step 4: 최종 검증**

Run: `npm test && npm run build && RUN_LIVE=1 npx vitest run tests/live.test.ts && npx tsx scripts/live-sweep.ts`
Expected: 오프라인 전체 green(신규 포함), 라이브 4/4, 스위프 19/19 (TTL 변경·캐시 재설계가 실경로 무회귀 증명)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: AgentCore Runtime deploy guide, ADR-004, changelog for v0.4 features"
```

---

## Self-Review 결과 (플랜 작성자 체크)

- 스펙 §2(HTTP 계약)→T5, §3(컨테이너)→T6, §4.1~4.4(캐시·single-flight·stale)→T1·T2, §4.5(예산)→T3, §4.2(DynamoDB·lazy·380KB·폴백)→T4, §5(TTL 표)→T2, §6(테스트)→각 태스크+T7 Step4, §7(문서·런북·ADR-004·CHANGELOG)→T7. 비목표(쿼터 신청·수집기·실배포·Gateway)는 어느 태스크에도 없음 ✓
- 타입 일관성: `CacheEntry/CacheBackend/HARD_TTL_MS`(T1)를 T4가, `withNote/SOFT_TTL`(T2)·`QuotaLedger/kstDayKey/keyIdOf`(T3)를 T3/T4가, `attachL2/setLedger`(T3·T4 정의)를 T4 `maybeAttachL2`가, `buildServer/loadDotEnv`(기존)를 T5가 소비 — 시그니처 상호 일치 확인
- 의도적 결정 3건(원장 기록 대상): ① T1이 seoulApi를 최소 수정 포함(빌드 그린 유지 — 태스크 분리 시 중간 커밋이 빌드 불가) ② T5 테스트에 SDK stateless 동작의 불확실성 명시(조정 허용 + 보고 의무) ③ 크로스 VM single-flight 비구현(스펙 §4.3 비목표)
- 플레이스홀더 스캔: TBD/TODO/"적절히" 없음 ✓

