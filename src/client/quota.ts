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

/** 유효하지 않은(비수치·0 이하) 값은 기본 1000으로 폴백 — 예: QUOTA_DAILY_LIMIT=abc */
export function parseQuotaLimit(raw: string | undefined): number {
  const n = Number(raw ?? 1000)
  return Number.isFinite(n) && n > 0 ? n : 1000
}

export class InMemoryLedger implements QuotaLedger {
  private counts = new Map<string, number>()
  constructor(
    private limit: number = parseQuotaLimit(process.env.QUOTA_DAILY_LIMIT),
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
