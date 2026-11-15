import { XMLParser } from 'fast-xml-parser'
import { CompositeCache, InMemoryCache, type CacheBackend } from './cache.js'
import { unwrap, SeoulApiError, type Unwrapped } from './response.js'
import { InMemoryLedger, keyIdOf, type QuotaLedger, type QuotaStatus } from './quota.js'

const OPEN_BASE = 'http://openapi.seoul.go.kr:8088'
const SUBWAY_BASE = 'http://swopenapi.seoul.go.kr/api/subway'

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
}

/** 기존 note를 보존하며 안내를 병합한 사본 반환 */
export function withNote(u: Unwrapped, note: string): Unwrapped {
  return { ...u, note: u.note ? `${u.note} | ${note}` : note }
}

export interface ClientOptions {
  apiKey?: string
  subwayApiKey?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  /** 5xx·네트워크 오류 재시도 전 대기(ms). 기본 300 */
  retryDelayMs?: number
  now?: () => number
  ledger?: QuotaLedger
}

export class SeoulApiClient {
  readonly isSample: boolean
  private key: string
  private subwayKey: string
  private fetchFn: typeof fetch
  private timeoutMs: number
  private retryDelayMs: number
  private cache: CompositeCache
  private xml = new XMLParser({ ignoreDeclaration: true })
  private inflight = new Map<string, Promise<Unwrapped>>()
  private nowFn: () => number
  private ledger: QuotaLedger

  constructor(opts: ClientOptions = {}) {
    this.key = (opts.apiKey ?? process.env.SEOUL_API_KEY ?? '').trim() || 'sample'
    this.isSample = this.key === 'sample'
    this.subwayKey = (opts.subwayApiKey ?? process.env.SEOUL_SUBWAY_API_KEY ?? '').trim() || this.key
    this.fetchFn = opts.fetchFn ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 15_000
    this.retryDelayMs = opts.retryDelayMs ?? 300
    this.cache = new CompositeCache(new InMemoryCache(opts.now), undefined, opts.now ?? Date.now)
    this.nowFn = opts.now ?? Date.now
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

  maskedKey(): string {
    return this.isSample ? 'sample' : `${this.key.slice(0, 4)}…(masked)`
  }

  maskedSubwayKey(): string {
    return this.subwayKey === 'sample' ? 'sample' : `${this.subwayKey.slice(0, 4)}…(masked)`
  }

  private buildUrl(base: string, key: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): string {
    const segs = [key, type, service, String(start), String(end), ...path.map(encodeURIComponent)]
    return `${base}/${segs.join('/')}`
  }

  private async backoff(): Promise<void> {
    if (this.retryDelayMs > 0) await new Promise(r => setTimeout(r, this.retryDelayMs))
  }

  /** 5xx·네트워크 오류는 retryDelayMs 후 1회 재시도. 타임아웃은 재시도하지 않는다 — 최악 대기를 timeoutMs 1회로 묶기 위함 */
  private async request(url: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) })
        if (!res.ok) {
          await res.body?.cancel().catch(() => {}) // 버리는 본문이 커넥션을 붙잡지 않도록 정리
          if (res.status >= 500 && attempt === 0) { await this.backoff(); continue }
          throw new SeoulApiError(`HTTP-${res.status}`, `HTTP ${res.status} (key=${this.maskedKey()})`)
        }
        return await res.text()
      } catch (e) {
        if (e instanceof SeoulApiError) throw e
        if ((e as Error)?.name === 'TimeoutError') {
          throw new SeoulApiError('TIMEOUT', `응답 시간 초과(${this.timeoutMs / 1000}초) (key=${this.maskedKey()})`)
        }
        if (attempt === 0) { await this.backoff(); continue } // 네트워크 오류 1회 재시도
        throw new SeoulApiError('NETWORK', `네트워크 오류: ${(e as Error).message} (key=${this.maskedKey()})`)
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
    const key = base === SUBWAY_BASE ? this.subwayKey : this.key
    // 샘플 키는 요청당 최대 5건 제한(ERROR-335) — 범위를 클램프해 맛보기 모드로 동작시킨다
    if (key === 'sample') end = Math.min(end, start + 4)
    const url = this.buildUrl(base, key, type, service, start, end, path)

    const cached = await this.cache.get(url)
    const keyId = keyIdOf(key)
    // ledger 예외는 safeStatus 내부에서 무제한으로 폴백.
    // soft 한도: 확인(여기)과 증가(fetchFresh 성공 후)가 분리돼 있어, 한도 직전의 동시 요청은 한도를 조금 넘을 수 있다(의도된 동작)
    const budget = await this.safeStatus(keyId)

    if (budget.ratio >= 1) {
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
      // stale: 즉시 반환 + 백그라운드 갱신 (실패는 로그만 — 다음 요청이 재시도). budget.ratio<1이므로 갱신 발화 허용
      void this.fetchFresh(url, type, service, keyId).catch(e =>
        console.error(`[cache] 백그라운드 갱신 실패(${service}): ${(e as Error).message}`))
      const ageMin = Math.round((this.nowFn() - cached.entry.storedAt) / 60_000)
      return withNote(cached.entry.value, `캐시된 데이터(약 ${ageMin}분 경과) — 백그라운드 갱신 중`)
    }

    const result = await this.fetchFresh(url, type, service, keyId)
    if (budget.ratio >= 0.8) {
      return withNote(result, `일일 API 쿼터 ${Math.round(budget.ratio * 100)}% 사용(${budget.used}/${budget.limit})`)
    }
    return result
  }

  /** 실제 업스트림 호출 — 동일 URL 동시 요청은 1회로 병합(single-flight) */
  private fetchFresh(url: string, type: 'json' | 'xml', service: string, keyId: string): Promise<Unwrapped> {
    const existing = this.inflight.get(url)
    if (existing) return existing
    const p = (async () => {
      const text = await this.request(url)
      await this.safeIncrement(keyId) // 원장 장애는 요청을 죽이지 않는다
      const payload = type === 'xml' ? this.xml.parse(text) : this.parseJsonWithXmlFallback(service, text)
      const result = unwrap(service, payload)
      await this.cache.set(url, result, SOFT_TTL[service] ?? DEFAULT_SOFT_TTL)
      return result
    })().finally(() => this.inflight.delete(url))
    this.inflight.set(url, p)
    return p
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
