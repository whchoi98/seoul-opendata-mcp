import type { Unwrapped } from './response.js'

export const HARD_TTL_MS = 86_400_000 // stale 서빙 한도(전 서비스 공통 24h)
// L1 항목 수 상한 — 핫스팟 3종(121+121+82)과 페이지 단위 데이터셋을 담고도 남는 크기.
// 자유 입력 키(call_dataset 파라미터, 역명)가 장기 실행 HTTP 프로세스에 무한히 쌓이는 것을 막는다.
export const MAX_L1_ENTRIES = 1000

export interface CacheEntry { value: Unwrapped; storedAt: number; softTtlMs: number }

export interface CacheBackend {
  get(key: string): Promise<CacheEntry | undefined>
  set(key: string, entry: CacheEntry): Promise<void>
}

/** Map의 삽입 순서를 사용 순서로 쓰는 LRU — 조회·저장 시 항목을 맨 뒤로 옮기고, 넘치면 맨 앞을 버린다 */
export class InMemoryCache implements CacheBackend {
  private store = new Map<string, CacheEntry>()
  constructor(
    private now: () => number = Date.now,
    private hardTtlMs: number = HARD_TTL_MS,
    private maxEntries: number = MAX_L1_ENTRIES,
  ) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const e = this.store.get(key)
    if (!e) return undefined
    this.store.delete(key)
    if (this.now() - e.storedAt > this.hardTtlMs) return undefined
    this.store.set(key, e)
    return e
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.store.delete(key)
    this.store.set(key, entry)
    while (this.store.size > this.maxEntries) {
      this.store.delete(this.store.keys().next().value as string)
    }
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
