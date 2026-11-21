/** 규칙 엔진. 입출력만 있는 순수 함수다 (스펙 §4.3). "답하지 않는다"는 undefined이고, 부르는 쪽이 지금 경로로 넘긴다 */
import { noDataNote, type Unwrapped } from '../client/response.js'
import { STORE_RULES, type StoreRule } from './rules.js'
import { isHead, snapshotKey, type Snapshot } from './snapshot.js'

export interface Filter { field: string; kind: 'eq' | 'contains'; value: string }

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
  // tool은 건너뛰는 자리를 공백 한 칸으로 채워 보낸다. 공백뿐인 값은 없는 값이다
  const values = path.map(v => String(v).trim())
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
      filters.push({ field: slot.field, kind: slot.kind, value })
    }
  }
  return { service, key: snapshotKey(service, partition), partition, filters, rule }
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
