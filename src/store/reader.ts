/** 서버의 읽기 경로 (스펙 §6.5, §6.6). 어떤 실패도 요청을 실패시키지 않고 "답하지 않음"으로 끝난다 */
import type { SnapshotHit, SnapshotSource } from '../client/snapshotSource.js'
import { answerFrom, planRequest } from './engine.js'
import { decodeSnapshot, type Snapshot } from './snapshot.js'
import type { SnapshotStore } from './snapshotStore.js'

/** 메모리에 두는 스냅샷의 합계 상한. 압축을 푼 JSON 바이트 수로 센다 */
export const MAX_BYTES = 96 * 1024 * 1024
/** 한 번 읽은 스냅샷을 다시 확인하지 않고 쓰는 시간 */
export const REVALIDATE_MS = 600_000
/** 없는 객체와 읽기 오류를 기억하는 시간 */
export const NEGATIVE_MS = 300_000
/** 읽기가 이 시간을 넘으면 그 요청은 지금 경로로 넘긴다 */
export const READ_TIMEOUT_MS = 3_000

interface Held { snapshot: Snapshot; bytes: number; etag?: string; checkedAt: number }

export interface ReaderOptions {
  now?: () => number
  maxBytes?: number
  timeoutMs?: number
  log?: (line: string) => void
}

const TIMED_OUT = Symbol('timed-out')

export class SnapshotReader implements SnapshotSource {
  /** Map의 삽입 순서를 사용 순서로 쓴다. 맨 앞이 가장 오래 안 쓴 것 */
  private held = new Map<string, Held>()
  /** 키 → 다시 읽어도 되는 시각 */
  private missing = new Map<string, number>()
  private loading = new Map<string, Promise<Held | undefined>>()
  private total = 0
  private now: () => number
  private maxBytes: number
  private timeoutMs: number
  private log: (line: string) => void

  constructor(private store: SnapshotStore, opts: ReaderOptions = {}) {
    this.now = opts.now ?? Date.now
    this.maxBytes = opts.maxBytes ?? MAX_BYTES
    this.timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS
    this.log = opts.log ?? (line => console.error(line))
  }

  async lookup(
    service: string, start: number, end: number, path: string[], opts: { allowExpired?: boolean } = {},
  ): Promise<SnapshotHit | undefined> {
    try {
      const plan = planRequest(service, path)
      if (!plan) return undefined
      const held = await this.withTimeout(this.resolve(plan.key))
      if (held === TIMED_OUT) {
        this.log(`[store] 읽기 ${this.timeoutMs}ms 초과 ${plan.key} — 지금 경로로 넘김`)
        return undefined
      }
      if (!held) return undefined
      return answerFrom(held.snapshot, plan, start, end, this.now(), opts)
    } catch (e) {
      this.log(`[store] 조회 실패 — 지금 경로로 넘김: ${(e as Error).message}`)
      return undefined
    }
  }

  private withTimeout<T>(p: Promise<T>): Promise<T | typeof TIMED_OUT> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<typeof TIMED_OUT>(done => { timer = setTimeout(() => done(TIMED_OUT), this.timeoutMs) })
    // 시간 제한이 먼저 끝나도 p는 계속 진행해 끝나면 메모리에 둔다
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
  }

  private resolve(key: string): Promise<Held | undefined> {
    const now = this.now()
    const cur = this.held.get(key)
    if (cur && now - cur.checkedAt < REVALIDATE_MS) {
      this.touch(key, cur)
      return Promise.resolve(cur)
    }
    if (!cur) {
      const until = this.missing.get(key)
      if (until !== undefined && now < until) return Promise.resolve(undefined)
      this.missing.delete(key)
    }
    // 같은 키를 동시에 찾는 요청은 읽기 한 번을 함께 기다린다
    const running = this.loading.get(key)
    if (running) return running
    const p = this.load(key, cur).finally(() => this.loading.delete(key))
    this.loading.set(key, p)
    return p
  }

  private async load(key: string, cur: Held | undefined): Promise<Held | undefined> {
    const started = Date.now()
    try {
      const got = await this.store.get(key, cur?.etag ? { ifNoneMatch: cur.etag } : undefined)
      if (got === 'not-modified' && cur) {
        cur.checkedAt = this.now()
        this.touch(key, cur)
        return cur
      }
      if (got === undefined || got === 'not-modified') {
        this.drop(key)
        this.missing.set(key, this.now() + NEGATIVE_MS)
        return undefined
      }
      const { snapshot, bytes } = decodeSnapshot(got.body)
      const held: Held = { snapshot, bytes, etag: got.etag, checkedAt: this.now() }
      this.keep(key, held)
      // 요청 인자는 남기지 않는다. 키에 든 파티션 값은 형식 검사를 통과한 날짜, 호선, 역 코드뿐이다
      this.log(`[store] 읽음 ${key}: 압축 ${got.body.length}B, 원본 ${bytes}B, ${snapshot.rows.length}행, ${Date.now() - started}ms, 힙 ${Math.round(process.memoryUsage().heapUsed / 1_048_576)}MB`)
      return held
    } catch (e) {
      this.log(`[store] 읽기 실패 ${key}: ${(e as Error).message}`)
      if (cur) {
        // 가진 스냅샷으로 답하고 5분 뒤 다시 확인한다
        cur.checkedAt = this.now() - REVALIDATE_MS + NEGATIVE_MS
        return cur
      }
      this.missing.set(key, this.now() + NEGATIVE_MS)
      return undefined
    }
  }

  private touch(key: string, held: Held): void {
    this.held.delete(key)
    this.held.set(key, held)
  }

  private drop(key: string): void {
    const h = this.held.get(key)
    if (!h) return
    this.held.delete(key)
    this.total -= h.bytes
  }

  private keep(key: string, held: Held): void {
    this.drop(key)
    this.missing.delete(key)
    if (held.bytes > this.maxBytes) return // 상한보다 큰 스냅샷은 이번 요청에만 쓴다
    this.held.set(key, held)
    this.total += held.bytes
    while (this.total > this.maxBytes) this.drop(this.held.keys().next().value as string)
  }
}
