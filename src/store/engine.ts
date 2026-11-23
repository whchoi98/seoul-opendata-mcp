/** 규칙 엔진. 입출력만 있는 순수 함수다 (스펙 §4.3). "답하지 않는다"는 undefined이고, 부르는 쪽이 지금 경로로 넘긴다 */
import { noDataNote, type Unwrapped } from '../client/response.js'
import { STORE_RULES, type StoreRule } from './rules.js'
import { isHead, snapshotKey, type Snapshot } from './snapshot.js'

export interface Filter { field: string; kind: 'eq' | 'contains'; value: string }

/** 건너뛰는 자리에 넣는 값. src/tools/path.ts의 BLANK와 같다 */
const BLANK = ' '
const PAD4 = /^\d{1,4}$/

export interface RequestPlan {
  service: string
  /** 읽을 스냅샷의 상대 키 */
  key: string
  partition: string[]
  filters: Filter[]
  rule: StoreRule
}

/** 요청을 저장소가 답할 수 있으면 읽을 스냅샷과 적용할 필터를 정한다 (§4.3의 1~3) */
export function planRequest(
  service: string, path: string[], rules: Record<string, StoreRule> = STORE_RULES,
): RequestPlan | undefined {
  const rule = Object.hasOwn(rules, service) ? rules[service] : undefined
  if (!rule) return undefined
  // 서울 API는 길이 0인 자리 뒤의 필터를 모두 무시한다(src/tools/path.ts). 그런 요청은 답을 추측하지 않고 넘긴다
  const raw = path.map(v => String(v))
  const firstEmpty = raw.findIndex(v => v.length === 0)
  if (firstEmpty !== -1 && raw.slice(firstEmpty + 1).some(v => v.trim() !== '')) return undefined
  // tool은 건너뛰는 자리를 공백 한 칸으로 채워 보낸다. 공백뿐인 값은 없는 값이다
  const values = raw.map(v => v.trim())
  if (values.some((v, i) => v !== '' && i >= rule.slots.length)) return undefined
  const partition: string[] = []
  const filters: Filter[] = []
  for (let i = 0; i < rule.slots.length; i++) {
    const slot = rule.slots[i]
    const value = values[i] ?? ''
    if (slot.kind === 'partition') {
      // 빈 값도 형식 검사에서 걸린다. 통과한 값만 객체 키에 들어간다
      if (!slot.pattern.test(value)) return undefined
      partition.push(value)
    } else if (value !== '') {
      if (slot.kind === 'unsupported') return undefined
      if (slot.kind === 'pad4') {
        // 서울 API는 지번을 0을 채운 4자리와 비교한다("737"은 "0737"). 숫자 1~4자리가 아니면 답을 추측하지 않는다
        if (!PAD4.test(value)) return undefined
        filters.push({ field: slot.field, kind: 'eq', value: value.padStart(4, '0') })
      } else {
        filters.push({ field: slot.field, kind: slot.kind, value })
      }
    }
  }
  return { service, key: snapshotKey(service, partition), partition, filters, rule }
}

/**
 * 파티션 값을 제자리에 넣은 서울 API 경로. 수집기와 verify가 스냅샷과 같은 범위를 요청할 때 쓴다.
 * 파티션 자리 사이의 빈 자리는 tool과 똑같이 공백 한 칸으로 채우고, 끝쪽 빈 자리는 보내지 않는다.
 * values는 자리 번호 → 필터 값이다
 */
export function requestPath(rule: StoreRule, partition: string[], values: Record<number, string> = {}): string[] {
  let next = 0
  const path = rule.slots.map((slot, i) => (slot.kind === 'partition' ? partition[next++] ?? BLANK : values[i] ?? BLANK))
  while (path.length > 0 && path[path.length - 1] === BLANK) path.pop()
  return path
}

const text = (v: unknown): string => String(v ?? '').trim()

const matches = (row: any, f: Filter): boolean =>
  f.kind === 'eq' ? text(row?.[f.field]) === f.value : text(row?.[f.field]).includes(f.value)

export interface Answer {
  value: Unwrapped
  /** 스냅샷을 수집한 시각(ms) */
  collectedAt: number
  /** 기한이 지난 스냅샷으로 답했는지. allowExpired일 때만 true가 나온다 */
  expired: boolean
}

/** 스냅샷에 필터와 범위를 적용한다 (§4.3의 4~7) */
export function answerFrom(
  snapshot: Snapshot, plan: RequestPlan, start: number, end: number, now: number, opts: { allowExpired?: boolean } = {},
): Answer | undefined {
  const collectedAt = Date.parse(snapshot.collectedAt)
  const expired = plan.rule.maxAgeMs !== null && now - collectedAt > plan.rule.maxAgeMs
  if (expired && !opts.allowExpired) return undefined
  if (start < 1 || end < start) return undefined
  const filtering = plan.filters.length > 0
  if (isHead(snapshot) && (filtering || end > snapshot.rows.length)) return undefined
  const filtered = filtering ? snapshot.rows.filter(r => plan.filters.every(f => matches(r, f))) : snapshot.rows
  const rows = filtered.slice(start - 1, end)
  // 0건에는 서울 API와 같은 문구만 붙인다. isNoData()와 여러 tool이 이 문구로 "조건에 맞는 행 없음"을 구분한다
  if (rows.length === 0) return { value: { rows: [], totalCount: 0, note: noDataNote(plan.service) }, collectedAt, expired }
  return { value: { rows, totalCount: filtering ? filtered.length : snapshot.totalCount }, collectedAt, expired }
}
