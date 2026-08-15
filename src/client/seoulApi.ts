import { XMLParser } from 'fast-xml-parser'
import { TtlCache } from './cache.js'
import { unwrap, SeoulApiError, type Unwrapped } from './response.js'

const OPEN_BASE = 'http://openapi.seoul.go.kr:8088'
const SUBWAY_BASE = 'http://swopenapi.seoul.go.kr/api/subway'

// 데이터 갱신 주기에 맞춘 캐시 TTL(ms) — Global Constraints 참조
const TTL: Record<string, number> = {
  citydata: 60_000, citydata_ppltn: 60_000, citydata_cmrcl: 60_000,
  bikeList: 300_000, GetParkingInfo: 300_000, RealtimeCityAir: 300_000,
  culturalEventInfo: 3_600_000, realtimeStationArrival: 15_000,
}

export interface ClientOptions {
  apiKey?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

export class SeoulApiClient {
  readonly isSample: boolean
  private key: string
  private fetchFn: typeof fetch
  private timeoutMs: number
  private cache: TtlCache
  private xml = new XMLParser({ ignoreDeclaration: true })

  constructor(opts: ClientOptions = {}) {
    this.key = opts.apiKey ?? process.env.SEOUL_API_KEY ?? 'sample'
    this.isSample = this.key === 'sample'
    this.fetchFn = opts.fetchFn ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 15_000
    this.cache = new TtlCache(opts.now)
  }

  maskedKey(): string {
    return this.isSample ? 'sample' : `${this.key.slice(0, 4)}…(masked)`
  }

  private buildUrl(base: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): string {
    const segs = [this.key, type, service, String(start), String(end), ...path.map(encodeURIComponent)]
    return `${base}/${segs.join('/')}`
  }

  private async request(url: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) })
        if (res.status >= 500 && attempt === 0) continue
        if (!res.ok) throw new SeoulApiError(`HTTP-${res.status}`, `HTTP ${res.status} (key=${this.maskedKey()})`)
        return await res.text()
      } catch (e) {
        if (e instanceof SeoulApiError) throw e
        if (attempt === 0) continue // 네트워크 오류 1회 재시도
        throw new SeoulApiError('NETWORK', `네트워크 오류: ${(e as Error).message} (key=${this.maskedKey()})`)
      }
    }
  }

  private async fetchUnwrapped(base: string, type: 'json' | 'xml', service: string, start: number, end: number, path: string[]): Promise<Unwrapped> {
    const url = this.buildUrl(base, type, service, start, end, path)
    const cached = this.cache.get(url)
    if (cached) return cached
    const text = await this.request(url)
    const payload = type === 'xml' ? this.xml.parse(text) : JSON.parse(text)
    const result = unwrap(service, payload)
    this.cache.set(url, result, TTL[service] ?? 60_000)
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

  /** 표준 봉투 서비스의 페이지를 totalCount 또는 max까지 자동 순회 병합 */
  async fetchAll(service: string, opts: { max: number; pageSize?: number; path?: string[] }): Promise<any[]> {
    const pageSize = opts.pageSize ?? 1000
    const rows: any[] = []
    for (let start = 1; rows.length < opts.max; start += pageSize) {
      const u = await this.getJson(service, start, Math.min(start + pageSize - 1, opts.max), opts.path ?? [])
      rows.push(...u.rows)
      if (rows.length >= u.totalCount || u.rows.length === 0) break
    }
    return rows.slice(0, opts.max)
  }
}
