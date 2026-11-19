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
/** coolingUntil은 한도 미만이지만 쿨다운 중인 키가 있을 때 그중 가장 이른 쿨다운 종료 시각. 모든 키가 한도에 닿았으면 없다 */
export type Pick = PickedKey | { exhausted: true; pool: PoolStatus; coolingUntil?: number }

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
    let coolingUntil: number | undefined
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[i]
      if (statuses[i].ratio >= 1) continue
      if (!this.isCooling(key)) return { exhausted: false, key, keyId: keyIdOf(key), pool }
      const until = this.cooling.get(key)!
      if (coolingUntil === undefined || until < coolingUntil) coolingUntil = until
    }
    return { exhausted: true, pool, coolingUntil }
  }
}
