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
