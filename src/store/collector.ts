/** 수집기 (스펙 §5). 서버의 읽기 경로와 같은 규칙 표, 같은 키 규칙, 같은 SnapshotStore를 쓴다 */
import { maskKey } from '../client/keyPool.js'
import { keyIdOf, type QuotaLedger } from '../client/quota.js'
import { isNoData, SeoulApiError, type Unwrapped } from '../client/response.js'
import { requestPath } from './engine.js'
import { DISTRICTS, STORE_RULES, type Bundle, type StoreRule } from './rules.js'
import { ALL, decodeSnapshot, encodeSnapshot, snapshotKey, type Snapshot } from './snapshot.js'
import type { ListedObject, SnapshotStore } from './snapshotStore.js'

export const PAGE = 1000
/** 서울 API 호출 사이의 간격 */
export const CALL_DELAY_MS = 200
/** 매일 묶음: 이 시간 안에 받은 스냅샷은 건너뛴다. 도중에 끊긴 실행을 이어 받기 위한 값 */
export const DAILY_SKIP_MS = 3_600_000
/** 정적 묶음과 부동산 묶음: 이 시간 안에 받은 스냅샷은 건너뛴다. 규칙에 skipMs가 있으면 그 값을 쓴다 */
export const STATIC_SKIP_MS = 7 * 86_400_000
/** 날짜 탐색 범위는 개수 + 10일, 월 탐색 범위는 개수 + 2개월 */
export const DATE_EXTRA = 10
export const MONTH_EXTRA = 2
/** 역 코드 스냅샷이 아직 없을 때 시간표 예상에 쓰는 역 수 */
export const STATION_ESTIMATE = 300
/** 실제 호출이 예상 합계의 2배에 이 값을 더한 수에 닿으면 실행을 끝낸다. 원천의 전체 건수가 크게 늘었을 때 쿼터를 다 쓰지 않게 한다 */
export const CALL_CAP_EXTRA = 10

const STATION_SERVICE = 'SearchInfoBySubwayNameService'
const NUMBERED_LINE = /^0?[1-9]호선$/
const LINES = ['1호선', '2호선', '3호선', '4호선', '5호선', '6호선', '7호선', '8호선', '9호선']
const DIRECTIONS = ['1', '2']
const DAY_TYPES = ['1', '2', '3']

/** SeoulApiClient에서 수집기가 쓰는 부분 */
export interface CollectClient {
  isSample: boolean
  getJson(service: string, start: number, end: number, path?: string[]): Promise<Unwrapped>
}

const KST = 9 * 3_600_000
const cross = (...lists: string[][]): string[][] =>
  lists.reduce<string[][]>((acc, list) => acc.flatMap(a => list.map(v => [...a, v])), [[]])
const partitionKey = (partition: string[]): string => (partition.length > 0 ? partition.join('_') : ALL)

/** 어제(KST)부터 거꾸로 n일, YYYYMMDD */
export function recentDates(now: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now + KST - (i + 1) * 86_400_000).toISOString().slice(0, 10).replace(/-/g, ''))
}

/** 지난달(KST)부터 거꾸로 n개월, YYYYMM */
export function recentMonths(now: number, n: number): string[] {
  const d = new Date(now + KST)
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1 - i, 1))
    return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

/** 올해(KST)부터 거꾸로 n개 연도, YYYY */
export function recentYears(now: number, n: number): string[] {
  const year = new Date(now + KST).getUTCFullYear()
  return Array.from({ length: n }, (_, i) => String(year - i))
}

/** 저장소 목록을 서비스 → (파티션 키 → 수정 시각)으로 묶는다 */
export function indexExisting(objects: ListedObject[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const o of objects) {
    const m = /^([^/]+)\/([^/]+)\.json\.gz$/.exec(o.key)
    if (!m) continue
    if (!out.has(m[1])) out.set(m[1], new Map())
    out.get(m[1])!.set(m[2], o.lastModified)
  }
  return out
}

const fieldText = (row: any, field: string): string => String(row?.[field] ?? '').trim()

/**
 * 두 페이지에 걸친 정렬 값. 내림차순 목록에서 순위마다의 값은 정해져 있으므로, 앞 페이지의 마지막 값과 뒤 페이지의 첫 값이 같으면
 * 그 값의 행이 두 페이지에 나뉜 것이다. 한 페이지 안에 다 들어간 값의 행은 순서가 달라도 빠지지 않는다
 */
export function straddling(pages: any[][], field: string): string[] {
  const out = new Set<string>()
  for (let i = 0; i + 1 < pages.length; i++) {
    const last = fieldText(pages[i].at(-1), field)
    if (last !== '' && last === fieldText(pages[i + 1][0], field)) out.add(last)
  }
  return [...out]
}

/** 파티션 값이 규칙의 형식에 맞는지. 맞지 않는 값으로 만든 스냅샷은 서버가 찾지 않는다 */
function isValidPartition(rule: StoreRule, partition: string[]): boolean {
  const slots = rule.slots.filter(s => s.kind === 'partition')
  return slots.length === partition.length && slots.every((s, i) => s.kind === 'partition' && s.pattern.test(partition[i]))
}

/** 역 코드 스냅샷에서 1~9호선 역 코드를 읽는다. 스냅샷이 없으면 undefined */
export async function stationCodes(store: SnapshotStore): Promise<string[] | undefined> {
  const got = await store.get(snapshotKey(STATION_SERVICE, []))
  if (!got || got === 'not-modified') return undefined
  const { snapshot } = decodeSnapshot(got.body)
  const codes = snapshot.rows
    .filter(r => NUMBERED_LINE.test(String(r?.LINE_NUM ?? '').trim()))
    .map(r => String(r?.STATION_CD ?? '').trim())
  return [...new Set(codes)].sort()
}

export interface DatasetPlan {
  service: string
  rule: StoreRule
  /** fixed: 받을 파티션이 정해져 있다. scan: 새것부터 차례로 시도해 공개된 것을 count개 채운다 */
  mode: 'fixed' | 'scan'
  /** fixed면 받을 파티션, scan이면 후보(새것부터) */
  partitions: string[][]
  /** scan 후보 가운데 이미 저장된 것 */
  stored: Set<string>
  /** scan의 목표 개수. fixed면 0 */
  count: number
  /** fixed에서 최근에 받아 건너뛰는 수 */
  skipped: number
  /** 예상 호출 수(상한) */
  estimated: number
  /** 시간표: 역 코드 스냅샷이 없어 실행 때 먼저 받는다 */
  needsStations?: boolean
}

export interface PlanOptions { bundle: Bundle; only?: string[]; days?: number; now: number }

async function planDataset(
  service: string, rule: StoreRule, have: Map<string, number>, store: SnapshotStore, opts: PlanOptions,
): Promise<DatasetPlan> {
  const base = { service, rule, stored: new Set<string>(), count: 0, skipped: 0 }
  const p = rule.partitions
  if (p?.kind === 'date' || p?.kind === 'month') {
    const count = p.kind === 'date' ? (opts.days ?? p.count) : p.count
    const extra = p.kind === 'date' ? DATE_EXTRA : MONTH_EXTRA
    const candidates = p.kind === 'date' ? recentDates(opts.now, count + extra) : recentMonths(opts.now, count + extra)
    const stored = new Set(candidates.filter(c => have.has(c)))
    // 새로 공개된 것 하나는 늘 받는다고 보고, 공개 전 날짜를 확인하는 호출을 extra만큼 더한다
    const estimated = Math.max(1, count - stored.size) * rule.callsPerSnapshot + extra
    return { ...base, mode: 'scan', partitions: candidates.map(c => [c]), stored, count, estimated }
  }
  const skipMs = rule.skipMs ?? (rule.bundle === 'daily' ? DAILY_SKIP_MS : STATIC_SKIP_MS)
  const isFresh = (partition: string[]): boolean => {
    const at = have.get(partitionKey(partition))
    return at !== undefined && opts.now - at < skipMs
  }
  let all: string[][] = [[]]
  let needsStations = false
  if (p?.kind === 'lineDirDay') all = cross(LINES, DIRECTIONS, DAY_TYPES)
  if (p?.kind === 'yearDistrict') all = cross(recentYears(opts.now, p.years), [...DISTRICTS])
  if (p?.kind === 'districtYear') all = cross([...DISTRICTS], recentYears(opts.now, p.years))
  if (p?.kind === 'stationDayDir') {
    const codes = await stationCodes(store)
    needsStations = codes === undefined
    all = cross(codes ?? [], DAY_TYPES, DIRECTIONS)
  }
  all = all.filter(x => isValidPartition(rule, x))
  const partitions = all.filter(x => !isFresh(x))
  if (needsStations) return { ...base, mode: 'fixed', partitions, estimated: 1 + STATION_ESTIMATE * 6, needsStations }
  return { ...base, mode: 'fixed', partitions, skipped: all.length - partitions.length, estimated: partitions.length * rule.callsPerSnapshot }
}

/** 저장소만 읽어 수집 계획을 만든다. 서울 API를 부르지 않는다 */
export async function planCollection(store: SnapshotStore, opts: PlanOptions): Promise<DatasetPlan[]> {
  const unknown = (opts.only ?? []).filter(s => !Object.hasOwn(STORE_RULES, s))
  if (unknown.length > 0) throw new Error(`규칙 표에 없는 서비스: ${unknown.join(', ')}`)
  const existing = indexExisting(await store.list(''))
  const plans: DatasetPlan[] = []
  for (const [service, rule] of Object.entries(STORE_RULES)) {
    if (rule.bundle !== opts.bundle) continue
    if (opts.only && !opts.only.includes(service)) continue
    plans.push(await planDataset(service, rule, existing.get(service) ?? new Map(), store, opts))
  }
  return plans
}

export interface DatasetResult {
  service: string
  saved: number
  skipped: number
  /** 서울 API가 "데이터 없음"으로 답해 저장하지 않은 수(공개 전 날짜 등) */
  empty: number
  calls: number
  warnings: string[]
  error?: string
}

export interface CollectReport {
  bundle: Bundle
  estimated: number
  remaining?: number
  /** 실제 수집을 시작했는지. dry-run이거나 예산을 넘으면 false */
  started: boolean
  reason?: string
  plans: DatasetPlan[]
  results: DatasetResult[]
  calls: number
  /** 키 풀이나 저장소를 쓸 수 없어 실행을 끝낸 이유 */
  aborted?: string
  ok: boolean
}

export interface CollectOptions {
  bundle: Bundle
  only?: string[]
  days?: number
  force?: boolean
  dryRun?: boolean
  /** 키 풀의 남은 한도 합계. 주지 않으면 예산 검사를 하지 않는다 */
  remaining?: number
  now?: () => number
  delayMs?: number
  log?: (line: string) => void
}

/** 쿼터 소진이나 호출 제한으로 키 풀 전체를 쓸 수 없는 상태 */
class PoolUnavailable extends Error {}

const resultLine = (r: DatasetResult): string =>
  `${r.service}: 저장 ${r.saved}, 건너뜀 ${r.skipped}, 데이터 없음 ${r.empty}, 호출 ${r.calls}${r.error ? `, 실패: ${r.error}` : ''}`

export async function collect(client: CollectClient, store: SnapshotStore, opts: CollectOptions): Promise<CollectReport> {
  if (client.isSample) throw new Error('샘플 키로는 수집할 수 없습니다. SEOUL_API_KEY를 설정하세요')
  const now = opts.now ?? Date.now
  const delayMs = opts.delayMs ?? CALL_DELAY_MS
  const log = opts.log ?? (() => {})
  const plans = await planCollection(store, { bundle: opts.bundle, only: opts.only, days: opts.days, now: now() })
  const estimated = plans.reduce((n, p) => n + p.estimated, 0)
  const report: CollectReport = { bundle: opts.bundle, estimated, remaining: opts.remaining, started: false, plans, results: [], calls: 0, ok: true }
  if (opts.dryRun) return { ...report, reason: '계획만 출력했습니다(--dry-run)' }
  if (opts.remaining !== undefined && estimated > opts.remaining && !opts.force) {
    return { ...report, ok: false, reason: `예상 호출 ${estimated}회가 남은 한도 ${opts.remaining}회를 넘어 시작하지 않았습니다. --force를 붙이면 그래도 시작합니다` }
  }
  report.started = true
  log(formatPlan(report))

  /** 실행 전체에서 부른 수. 상한에 닿으면 남은 데이터셋도 같은 가정으로 계산했으므로 실행을 끝낸다 */
  let made = 0
  const cap = 2 * estimated + CALL_CAP_EXTRA
  let first = true
  const pace = async (): Promise<void> => {
    if (!first && delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
    first = false
  }

  /** 서울 API를 한 번 부른다. 빈 응답인데 "데이터 없음"이 아니면 쿼터 소진이나 호출 제한이다. 남은 데이터셋도 같은 결과가 나온다 */
  const call = async (service: string, start: number, path: string[], result: DatasetResult): Promise<Unwrapped> => {
    // SeoulApiError가 아니므로 아래의 처리에서 실행 전체를 끝낸다
    if (made >= cap) throw new Error(`호출 ${made}회가 예상 상한 ${estimated}회의 2배를 넘어 중단했습니다. 규칙 표의 스냅샷당 호출 수를 확인하세요`)
    await pace()
    made++
    result.calls++
    const u = await client.getJson(service, start, start + PAGE - 1, path)
    if (u.rows.length === 0 && !isNoData(u)) throw new PoolUnavailable(u.note ?? '서울 API가 이유 없이 빈 응답을 돌려줬습니다')
    return u
  }

  /** 스냅샷 하나를 받아 저장한다. "데이터 없음"이면 저장하지 않고 false */
  const fetchAndSave = async (service: string, partition: string[], rule: StoreRule, result: DatasetResult): Promise<boolean> => {
    const key = snapshotKey(service, partition)
    const pages: any[][] = []
    let received = 0
    let totalCount = 0
    for (let start = 1; ; start += PAGE) {
      // 파티션 자리가 떨어져 있으면(매매의 연도와 자치구명) 사이를 공백으로 채운 경로를 보낸다
      const u = await call(service, start, requestPath(rule, partition), result)
      if (u.rows.length === 0) break
      pages.push(u.rows)
      received += u.rows.length
      totalCount = u.totalCount
      if (rule.scope === 'head' || received >= totalCount) break
    }
    let rows = pages.flat()
    if (rows.length === 0) {
      result.empty++ // 공개 전 날짜. 저장하지 않아 다음 실행이 다시 시도한다
      return false
    }
    if (rule.order?.unstable && rule.scope === 'full') {
      // 정렬 값이 같은 행의 순서가 요청마다 달라, 두 페이지에 걸친 값의 행은 겹치거나 빠져 있다. 그 값으로 다시 받아 바꿔 넣는다
      const { field } = rule.order
      const slot = rule.slots.findIndex(s => s.field === field)
      for (const value of straddling(pages, field)) {
        const u = await call(service, 1, requestPath(rule, partition, { [slot]: value }), result)
        if (u.rows.length < u.totalCount) {
          result.warnings.push(`${key}: ${field} ${value}의 행이 ${u.totalCount}건이라 한 번에 받지 못했습니다. 저장하지 않았습니다`)
          return false
        }
        // 내림차순이므로 이 값보다 큰 행은 모두 앞에 있고 그대로 남는다
        const at = rows.findIndex(r => fieldText(r, field) <= value)
        rows = rows.filter(r => fieldText(r, field) !== value)
        rows.splice(at === -1 ? rows.length : at, 0, ...u.rows)
      }
      if (rows.length !== totalCount) {
        result.warnings.push(`${key}: 경계의 행을 다시 받은 뒤에도 ${rows.length}행으로 전체 ${totalCount}행과 다릅니다(수집 중에 자료가 바뀜). 저장하지 않았습니다`)
        return false
      }
    }
    if (rule.scope === 'full' && rows.length < totalCount) {
      result.warnings.push(`${key}: 전체 ${totalCount}행 중 ${rows.length}행만 받았습니다. 머리 스냅샷으로 취급되어 필터 요청은 서울 API로 갑니다`)
    }
    const snapshot: Snapshot = { v: 1, service, partition, collectedAt: new Date(now()).toISOString(), totalCount, rows }
    // 모든 페이지를 받은 뒤에만 쓴다. 중간에 실패하면 이전 스냅샷이 그대로 남는다
    await store.put(key, encodeSnapshot(snapshot))
    result.saved++
    return true
  }

  const runPlan = async (plan: DatasetPlan, result: DatasetResult): Promise<void> => {
    let partitions = plan.partitions
    if (plan.needsStations) {
      result.warnings.push('역 코드 스냅샷이 없어 먼저 받았습니다')
      await fetchAndSave(STATION_SERVICE, [], STORE_RULES[STATION_SERVICE], result)
      partitions = cross((await stationCodes(store)) ?? [], DAY_TYPES, DIRECTIONS).filter(x => isValidPartition(plan.rule, x))
    }
    if (plan.mode === 'fixed') {
      for (const partition of partitions) await fetchAndSave(plan.service, partition, plan.rule, result)
      return
    }
    let published = 0
    for (const partition of partitions) {
      if (plan.stored.has(partition[0])) {
        result.skipped++
        published++
      } else if (await fetchAndSave(plan.service, partition, plan.rule, result)) {
        published++
      }
      if (published >= plan.count) break
    }
  }

  for (const plan of plans) {
    const result: DatasetResult = { service: plan.service, saved: 0, skipped: plan.skipped, empty: 0, calls: 0, warnings: [] }
    report.results.push(result)
    try {
      await runPlan(plan, result)
    } catch (e) {
      result.error = (e as Error).message
      report.ok = false
      // 서울 API 오류(시간 초과, 서버 오류)는 그 데이터셋만 실패다. 그 밖의 오류는 남은 호출을 낭비하지 않도록 실행을 끝낸다
      if (!(e instanceof SeoulApiError)) {
        report.aborted = result.error
        log(resultLine(result))
        break
      }
    }
    log(resultLine(result))
  }
  report.calls = report.results.reduce((n, r) => n + r.calls, 0)
  return report
}

export interface KeyQuota { key: string; used: number; limit: number }

/** 키별 사용량과 남은 한도 합계. key는 maskKey() 결과만 담는다 */
export async function remainingQuota(keys: readonly string[], ledger: QuotaLedger): Promise<{ keys: KeyQuota[]; remaining: number }> {
  const statuses = await Promise.all(keys.map(k => ledger.status(keyIdOf(k))))
  const list = keys.map((k, i) => ({ key: maskKey(k), used: statuses[i].used, limit: statuses[i].limit }))
  return { keys: list, remaining: list.reduce((n, k) => n + Math.max(0, k.limit - k.used), 0) }
}

export function formatQuota(q: { keys: KeyQuota[]; remaining: number }): string {
  return [...q.keys.map(k => `키 ${k.key}: ${k.used}/${k.limit}`), `남은 한도 합계: ${q.remaining}회`].join('\n')
}

function planLine(p: DatasetPlan): string {
  if (p.needsStations) return `${p.service}: 역 코드 스냅샷이 없어 먼저 받음, 예상 ${p.estimated}회`
  if (p.mode === 'scan') return `${p.service}: 최근 ${p.count}개 목표, 후보 ${p.partitions.length}개 중 저장됨 ${p.stored.size}개, 예상 ${p.estimated}회`
  return `${p.service}: 받을 스냅샷 ${p.partitions.length}개, 건너뜀 ${p.skipped}개, 예상 ${p.estimated}회`
}

export function formatPlan(report: CollectReport): string {
  return [
    `[${report.bundle}] 수집 계획`,
    ...report.plans.map(p => `  ${planLine(p)}`),
    `예상 호출 합계(상한): ${report.estimated}회`,
    ...(report.remaining !== undefined ? [`남은 한도 합계: ${report.remaining}회`] : []),
    ...(report.reason ? [report.reason] : []),
  ].join('\n')
}

export function formatReport(report: CollectReport): string {
  return [
    `[${report.bundle}] 수집 결과`,
    ...report.results.flatMap(r => [`  ${resultLine(r)}`, ...r.warnings.map(w => `    경고: ${w}`)]),
    `실제 호출 합계: ${report.calls}회 (예상 상한 ${report.estimated}회)`,
    ...(report.aborted ? [`중단: ${report.aborted}`] : []),
  ].join('\n')
}

export interface DatasetStatus {
  service: string
  bundle: Bundle
  count: number
  newest?: number
  oldest?: number
  state: '없음' | '기한 내' | '기한 초과' | '기한 없음'
}

/** 데이터셋별 스냅샷 수와 수정 시각. 기한은 가장 오래된 스냅샷으로 판단한다 */
export async function statusOf(store: SnapshotStore, now: number): Promise<DatasetStatus[]> {
  const existing = indexExisting(await store.list(''))
  return Object.entries(STORE_RULES).map(([service, rule]): DatasetStatus => {
    const times = [...(existing.get(service)?.values() ?? [])]
    if (times.length === 0) return { service, bundle: rule.bundle, count: 0, state: '없음' }
    const newest = Math.max(...times)
    const oldest = Math.min(...times)
    const state = rule.maxAgeMs === null ? '기한 없음' : now - oldest > rule.maxAgeMs ? '기한 초과' : '기한 내'
    return { service, bundle: rule.bundle, count: times.length, newest, oldest, state }
  })
}

const kstStamp = (ms: number): string => new Date(ms + KST).toISOString().slice(5, 16).replace('T', ' ')

export function formatStatus(list: DatasetStatus[]): string {
  return list.map(s => {
    if (s.count === 0 || s.newest === undefined || s.oldest === undefined) return `${s.service}: 없음`
    const oldest = s.count > 1 ? `, 가장 오래된 것 ${kstStamp(s.oldest)}` : ''
    return `${s.service}: ${s.count}개, 최근 ${kstStamp(s.newest)}${oldest}, ${s.state}`
  }).join('\n')
}
