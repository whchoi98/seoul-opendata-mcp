/**
 * 실제 API 대비 검사 (스펙 §7.2). 수집 직후 같은 요청을 스냅샷과 서울 API 양쪽에 보내 비교한다.
 * 쿼터를 쓰므로 CI에 넣지 않고, 규칙을 바꾸거나 처음 수집했을 때 손으로 돌린다.
 */
import { isNoData, type Unwrapped } from '../client/response.js'
import { CATALOG } from '../data/catalog.js'
import { CALL_DELAY_MS, PAGE, indexExisting, type CollectClient } from './collector.js'
import { answerFrom, planRequest } from './engine.js'
import { STORE_RULES, type SlotRule, type StoreRule } from './rules.js'
import { ALL, decodeSnapshot, snapshotKey, type Snapshot } from './snapshot.js'
import type { SnapshotStore } from './snapshotStore.js'

const BLANK = ' '

export interface VerifyCase {
  service: string
  /** 서울 API에 보낼 경로 */
  path: string[]
  label: string
  /** 미지원 자리를 이 규칙으로 가정하고 비교한다 */
  assume?: { slot: number; field: string; kind: 'eq' | 'contains' }
}

const examplesOf = (service: string, rule: StoreRule): string[] =>
  rule.examples ?? CATALOG.find(e => e.id === service)?.pathParams.map(p => p.example) ?? []

/**
 * 서비스 하나의 검사 요청: 인자 없음, 자리 하나씩, 지원 자리 전부, 결정할 자리의 두 가정.
 * 결정할 자리는 예시 값 전체와 그 앞부분 두 값으로 시험한다. 전체 값만으로는 일치와 부분일치가 같은 행을 고르기 때문이다
 */
export function casesFor(service: string, rule: StoreRule, partition: string[]): VerifyCase[] {
  const examples = examplesOf(service, rule)
  /** values: 자리 번호 → 넣을 값. 파티션 자리에는 저장된 파티션 값이 들어간다 */
  const pathWith = (values: Record<number, string>): string[] => {
    const path = rule.slots.map((_, i) => (i < partition.length ? partition[i] : values[i] ?? BLANK))
    while (path.length > 0 && path[path.length - 1] === BLANK) path.pop()
    return path
  }
  const example = (indexes: number[]): Record<number, string> => Object.fromEntries(indexes.map(i => [i, examples[i]]))
  const supported = rule.slots.flatMap((s, i) => (s.kind === 'eq' || s.kind === 'contains' ? [i] : []))
  const cases: VerifyCase[] = [{ service, path: pathWith({}), label: '인자 없음' }]
  for (const i of supported) cases.push({ service, path: pathWith(example([i])), label: `${rule.slots[i].field}만` })
  if (supported.length > 1) cases.push({ service, path: pathWith(example(supported)), label: '지원 자리 전부' })
  rule.slots.forEach((s, i) => {
    if (s.kind !== 'unsupported' || !s.decide) return
    const full = examples[i]
    const front = full.slice(0, Math.max(1, Math.ceil(full.length / 2)))
    for (const [value, which] of [[full, '전체 값'], [front, '앞부분']] as const) {
      for (const kind of ['eq', 'contains'] as const) {
        cases.push({
          service, path: pathWith({ [i]: value }), label: `${s.field} 가정: ${kind === 'eq' ? '일치' : '부분일치'}(${which})`,
          assume: { slot: i, field: s.field, kind },
        })
      }
    }
  })
  return cases
}

export interface CaseResult {
  service: string
  label: string
  path: string[]
  status: 'ok' | 'order' | 'fail' | 'skip'
  detail: string
  assume?: VerifyCase['assume']
}

export interface Decision { service: string; field: string; verdict: '일치' | '부분일치' | '둘 다 맞음' | '재현 못 함' }

export interface VerifyReport {
  results: CaseResult[]
  decisions: Decision[]
  calls: number
  aborted?: string
  ok: boolean
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

function compare(c: VerifyCase, snapshot: Snapshot, rule: StoreRule, live: Unwrapped, now: number): CaseResult {
  const base = { service: c.service, label: c.label, path: c.path, ...(c.assume ? { assume: c.assume } : {}) }
  const assumed: SlotRule[] = rule.slots.map((s, i) => (c.assume && i === c.assume.slot ? { field: s.field, kind: c.assume.kind } : s))
  const plan = planRequest(c.service, c.path, { [c.service]: { ...rule, slots: assumed } })
  if (!plan) return { ...base, status: 'skip', detail: '규칙으로 답할 수 없는 요청' }
  const mine = answerFrom(snapshot, plan, 1, PAGE, now, { allowExpired: true })?.value
  if (!mine) return { ...base, status: 'skip', detail: '머리 스냅샷이라 이 요청에 답할 수 없음' }
  if (mine.totalCount !== live.totalCount) {
    return { ...base, status: 'fail', detail: `전체 건수 다름: 저장소 ${mine.totalCount}, 서울 API ${live.totalCount}` }
  }
  const a = mine.rows.map(r => JSON.stringify(r))
  const b = live.rows.map(r => JSON.stringify(r))
  if (sameList(a, b)) return { ...base, status: 'ok', detail: `${live.totalCount}건 일치` }
  if (sameList([...a].sort(), [...b].sort())) return { ...base, status: 'order', detail: `${live.totalCount}건, 행은 같고 순서만 다름` }
  return { ...base, status: 'fail', detail: `행 집합 다름: 저장소 ${a.length}행, 서울 API ${b.length}행(전체 ${live.totalCount}건)` }
}

/** 가정은 그 가정으로 비교한 요청(전체 값과 앞부분)이 모두 맞아야 맞는 것으로 본다 */
function decide(results: CaseResult[]): Decision[] {
  const groups = new Map<string, { service: string; field: string; eq: boolean; contains: boolean }>()
  for (const r of results) {
    if (!r.assume) continue
    const key = `${r.service}.${r.assume.field}`
    const g = groups.get(key) ?? { service: r.service, field: r.assume.field, eq: true, contains: true }
    if (r.status !== 'ok' && r.status !== 'order') g[r.assume.kind] = false
    groups.set(key, g)
  }
  return [...groups.values()].map(g => ({
    service: g.service, field: g.field,
    verdict: g.eq && g.contains ? '둘 다 맞음' : g.eq ? '일치' : g.contains ? '부분일치' : '재현 못 함',
  }))
}

export async function runVerify(
  client: CollectClient, store: SnapshotStore, opts: { only?: string[]; now?: () => number; delayMs?: number } = {},
): Promise<VerifyReport> {
  if (client.isSample) throw new Error('샘플 키로는 검사할 수 없습니다. SEOUL_API_KEY를 설정하세요')
  const now = opts.now ?? Date.now
  const delayMs = opts.delayMs ?? CALL_DELAY_MS
  const existing = indexExisting(await store.list(''))
  const results: CaseResult[] = []
  let calls = 0
  let aborted: string | undefined

  services: for (const [service, rule] of Object.entries(STORE_RULES)) {
    if (rule.slots.length === 0) continue // 자리가 없는 머리 스냅샷은 첫 페이지 그대로라 비교할 것이 없다
    if (opts.only && !opts.only.includes(service)) continue
    const keys = [...(existing.get(service)?.keys() ?? [])].sort()
    const partitionKey = rule.partitions ? keys.at(-1) : keys.find(k => k === ALL)
    const partition = rule.partitions && partitionKey ? partitionKey.split('_') : []
    const got = partitionKey ? await store.get(snapshotKey(service, partition)) : undefined
    if (!got || got === 'not-modified') {
      results.push({ service, label: '전체', path: [], status: 'skip', detail: '스냅샷 없음' })
      continue
    }
    const { snapshot } = decodeSnapshot(got.body)
    const live = new Map<string, Unwrapped>()
    for (const c of casesFor(service, rule, partition)) {
      const key = c.path.join('\u0000')
      if (!live.has(key)) {
        if (calls > 0 && delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
        calls++
        const u = await client.getJson(service, 1, PAGE, c.path)
        if (u.rows.length === 0 && !isNoData(u)) {
          aborted = u.note ?? '서울 API가 이유 없이 빈 응답을 돌려줬습니다'
          break services
        }
        live.set(key, u)
      }
      results.push(compare(c, snapshot, rule, live.get(key)!, now()))
    }
  }
  // 가정을 시험한 요청의 실패는 "그 가정이 틀렸다"는 결과이지 검사 실패가 아니다
  const ok = aborted === undefined && results.every(r => r.status !== 'fail' || r.assume !== undefined)
  return { results, decisions: decide(results), calls, aborted, ok }
}

const STATUS_LABEL = { ok: '통과', order: '순서', fail: '실패', skip: '건너뜀' } as const

export function formatVerify(report: VerifyReport): string {
  return [
    '[verify] 실제 API 대비 검사',
    ...report.results.map(r => `  ${STATUS_LABEL[r.status]} ${r.service} ${r.label}: ${r.detail}`),
    ...(report.decisions.length > 0 ? ['검증으로 결정할 자리:', ...report.decisions.map(d => `  ${d.service}.${d.field}: ${d.verdict}`)] : []),
    `호출 합계: ${report.calls}회`,
    ...(report.aborted ? [`중단: ${report.aborted}`] : []),
  ].join('\n')
}
