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
  /** 있으면 서울 API를 부르지 않고 이 설명으로 건너뛴다 */
  skip?: string
}

const examplesOf = (service: string, rule: StoreRule): string[] =>
  rule.examples ?? CATALOG.find(e => e.id === service)?.pathParams.map(p => p.example) ?? []

const fieldText = (row: any, field: string): string => String(row?.[field] ?? '').trim()

const NO_VALUE = '스냅샷에 이 필드 값이 없어 검사하지 못함'

/**
 * 서비스 하나의 검사 요청: 인자 없음, 자리 하나씩, 지원 자리 전부, 결정할 자리의 두 가정.
 * 지원 자리와 결정할 자리는 값 전체와 그 앞부분 두 값으로 시험한다. 전체 값만으로는 일치와 부분일치가 같은 행을 고르기 때문이다.
 * 값은 예시 값이다. 다만 일치로 비교하는 자리(일치, 결정할 자리)는 예시 값과 똑같은 값을 가진 행이, 부분일치 자리는 예시 값을 포함한 행이
 * 스냅샷(rows)에 있어야 한다. 없으면 스냅샷에서 그 필드의 첫 값을 쓴다. rows를 주지 않으면 예시 값을 그대로 쓴다
 */
export function casesFor(service: string, rule: StoreRule, partition: string[], rows?: any[]): VerifyCase[] {
  const examples = examplesOf(service, rule)
  /** values: 자리 번호 → 넣을 값. 파티션 자리에는 저장된 파티션 값이 들어간다 */
  const pathWith = (values: Record<number, string>): string[] => {
    const path = rule.slots.map((_, i) => (i < partition.length ? partition[i] : values[i] ?? BLANK))
    while (path.length > 0 && path[path.length - 1] === BLANK) path.pop()
    return path
  }
  /** 자리 번호 → 시험할 값. 스냅샷에 그 필드 값이 없으면 undefined */
  const probes = rule.slots.map((s, i): string | undefined => {
    if (!rows) return examples[i]
    const stored = rows.map(r => fieldText(r, s.field)).filter(v => v !== '')
    const example = (examples[i] ?? '').trim()
    // 일치로 비교하는 자리에 행 값의 일부를 넣으면 맞는 규칙에서도 양쪽이 0건이라 아무것도 확인하지 못한다
    const byEquality = s.kind === 'eq' || (s.kind === 'unsupported' && s.decide === true)
    if (example !== '' && stored.some(v => (byEquality ? v === example : v.includes(example)))) return example
    // '/'는 경로에서 %2F가 되고 서울 API가 이를 어떻게 다루는지 모른다. 거부되면 검사 전체가 끝나므로 다른 값이 있으면 피한다
    return stored.find(v => !v.includes('/')) ?? stored[0]
  })
  // 끝의 공백은 저장소가 잘라 내지만 서울 API에는 그대로 간다. 앞부분이 공백으로 끝나지 않게 한다
  const frontOf = (value: string): string => value.slice(0, Math.max(1, Math.ceil(value.length / 2))).trimEnd()
  const supported = rule.slots.flatMap((s, i) => (s.kind === 'eq' || s.kind === 'contains' ? [i] : []))
  const cases: VerifyCase[] = [{ service, path: pathWith({}), label: '인자 없음' }]
  for (const i of supported) {
    const field = rule.slots[i].field
    const value = probes[i]
    if (value === undefined) {
      cases.push({ service, path: [], label: `${field}만`, skip: NO_VALUE })
      continue
    }
    cases.push({ service, path: pathWith({ [i]: value }), label: `${field}만` })
    const front = frontOf(value)
    if (front !== value) cases.push({ service, path: pathWith({ [i]: front }), label: `${field}만(앞부분)` })
  }
  const probed = supported.filter(i => probes[i] !== undefined)
  if (probed.length > 1) {
    const fieldOf = (i: number): string => rule.slots[i].field
    // 따로 고른 값을 모두 가진 행이 없으면 이 요청만은 모든 자리의 필드가 비지 않은 첫 행에서 값을 모은다
    const together = rows?.some(r => probed.every(i => fieldText(r, fieldOf(i)).includes(probes[i]!)))
    const one = rows && !together ? rows.find(r => probed.every(i => fieldText(r, fieldOf(i)) !== '')) : undefined
    const values = Object.fromEntries(probed.map(i => [i, one ? fieldText(one, fieldOf(i)) : probes[i]!]))
    cases.push({ service, path: pathWith(values), label: '지원 자리 전부' })
  }
  rule.slots.forEach((s, i) => {
    if (s.kind !== 'unsupported' || !s.decide) return
    const full = probes[i]
    if (full === undefined) {
      // decide()가 이 자리를 "근거 없음"으로 보고하도록 두 가정 모두 건너뛴 결과를 남긴다
      for (const kind of ['eq', 'contains'] as const) {
        cases.push({
          service, path: [], label: `${s.field} 가정: ${kind === 'eq' ? '일치' : '부분일치'}`,
          assume: { slot: i, field: s.field, kind }, skip: NO_VALUE,
        })
      }
      return
    }
    const front = frontOf(full)
    // 한 글자 값은 앞부분이 같아 전체 값으로만 시험한다
    const values: Array<[string, string]> = front === full ? [[full, '전체 값']] : [[full, '전체 값'], [front, '앞부분']]
    for (const [value, which] of values) {
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

export interface Decision { service: string; field: string; verdict: '일치' | '부분일치' | '둘 다 맞음' | '근거 없음' | '재현 못 함' }

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
  if (mine.totalCount === 0 && live.totalCount === 0 && plan.filters.length > 0) {
    // 양쪽 모두 0건이면 어떤 규칙이든 맞는다. 이 값을 포함한 행이 있는데도 서울 API가 0건이었을 때만 근거가 된다
    const contained = snapshot.rows.some(row => plan.filters.every(f => fieldText(row, f.field).includes(f.value)))
    return contained
      ? { ...base, status: 'ok', detail: '0건 일치(이 값을 포함한 행이 있는데 양쪽 모두 0건)' }
      : { ...base, status: 'skip', detail: '양쪽 모두 0건이고 스냅샷에 이 값을 가진 행이 없어 근거가 되지 않음' }
  }
  if (mine.totalCount !== live.totalCount) {
    return { ...base, status: 'fail', detail: `전체 건수 다름: 저장소 ${mine.totalCount}, 서울 API ${live.totalCount}` }
  }
  const a = mine.rows.map(r => JSON.stringify(r))
  const b = live.rows.map(r => JSON.stringify(r))
  if (sameList(a, b)) return { ...base, status: 'ok', detail: `${live.totalCount}건 일치` }
  if (sameList([...a].sort(), [...b].sort())) return { ...base, status: 'order', detail: `${live.totalCount}건, 행은 같고 순서만 다름` }
  return { ...base, status: 'fail', detail: `행 집합 다름: 저장소 ${a.length}행, 서울 API ${b.length}행(전체 ${live.totalCount}건)` }
}

/**
 * 가정은 그 가정으로 비교한 요청(전체 값과 앞부분)에 실패가 없고 통과가 하나 이상이어야 맞는 것으로 본다.
 * 건너뛴 요청은 어느 쪽의 근거도 아니다
 */
function decide(results: CaseResult[]): Decision[] {
  type Tally = { pass: number; fail: number }
  const groups = new Map<string, { service: string; field: string; eq: Tally; contains: Tally }>()
  for (const r of results) {
    if (!r.assume) continue
    const key = `${r.service}.${r.assume.field}`
    const g = groups.get(key) ?? { service: r.service, field: r.assume.field, eq: { pass: 0, fail: 0 }, contains: { pass: 0, fail: 0 } }
    groups.set(key, g)
    if (r.status === 'ok' || r.status === 'order') g[r.assume.kind].pass++
    else if (r.status === 'fail') g[r.assume.kind].fail++
  }
  const holds = (t: Tally): boolean => t.fail === 0 && t.pass > 0
  const counted = (t: Tally): number => t.pass + t.fail
  return [...groups.values()].map(g => {
    const eq = holds(g.eq)
    const contains = holds(g.contains)
    const verdict: Decision['verdict'] = eq && contains ? '둘 다 맞음' : eq ? '일치' : contains ? '부분일치'
      : counted(g.eq) + counted(g.contains) === 0 ? '근거 없음' : '재현 못 함'
    return { service: g.service, field: g.field, verdict }
  })
}

export async function runVerify(
  client: CollectClient, store: SnapshotStore,
  /** rules: 검사할 규칙 표. 기본은 STORE_RULES이고 테스트가 바꿔 넣는다 */
  opts: { only?: string[]; now?: () => number; delayMs?: number; rules?: Record<string, StoreRule> } = {},
): Promise<VerifyReport> {
  if (client.isSample) throw new Error('샘플 키로는 검사할 수 없습니다. SEOUL_API_KEY를 설정하세요')
  const now = opts.now ?? Date.now
  const delayMs = opts.delayMs ?? CALL_DELAY_MS
  const existing = indexExisting(await store.list(''))
  const results: CaseResult[] = []
  /** 검사 요청을 끝까지 돈 서비스. 도중에 끊긴 서비스의 결과로는 판정하지 않는다 */
  const completed = new Set<string>()
  let calls = 0
  let aborted: string | undefined

  services: for (const [service, rule] of Object.entries(opts.rules ?? STORE_RULES)) {
    if (rule.slots.length === 0) continue // 자리가 없는 머리 스냅샷은 첫 페이지 그대로라 비교할 것이 없다
    if (opts.only && !opts.only.includes(service)) continue
    const keys = [...(existing.get(service)?.keys() ?? [])].sort()
    const partitionKey = rule.partitions ? keys.at(-1) : keys.find(k => k === ALL)
    const partition = rule.partitions && partitionKey ? partitionKey.split('_') : []
    let snapshot: Snapshot | undefined
    try {
      const got = partitionKey ? await store.get(snapshotKey(service, partition)) : undefined
      if (got && got !== 'not-modified') snapshot = decodeSnapshot(got.body).snapshot
    } catch (e) {
      results.push({ service, label: '전체', path: [], status: 'fail', detail: `스냅샷을 읽지 못함: ${(e as Error).message}` })
      continue
    }
    if (!snapshot) {
      results.push({ service, label: '전체', path: [], status: 'skip', detail: '스냅샷 없음' })
      continue
    }
    const live = new Map<string, Unwrapped>()
    for (const c of casesFor(service, rule, partition, snapshot.rows)) {
      if (c.skip !== undefined) {
        results.push({ service, label: c.label, path: c.path, status: 'skip', detail: c.skip, ...(c.assume ? { assume: c.assume } : {}) })
        continue
      }
      const key = c.path.join('\u0000')
      if (!live.has(key)) {
        if (calls > 0 && delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
        calls++
        let u: Unwrapped
        try {
          u = await client.getJson(service, 1, PAGE, c.path)
        } catch (e) {
          aborted = `요청 실패(${service} ${c.label}): ${(e as Error).message}`
          break services
        }
        if (u.rows.length === 0 && !isNoData(u)) {
          aborted = u.note ?? '서울 API가 이유 없이 빈 응답을 돌려줬습니다'
          break services
        }
        live.set(key, u)
      }
      results.push(compare(c, snapshot, rule, live.get(key)!, now()))
    }
    completed.add(service)
  }
  // 가정을 시험한 요청의 실패는 "그 가정이 틀렸다"는 결과이지 검사 실패가 아니다
  const ok = aborted === undefined && results.every(r => r.status !== 'fail' || r.assume !== undefined)
  return { results, decisions: decide(results.filter(r => completed.has(r.service))), calls, aborted, ok }
}

const STATUS_LABEL = { ok: '통과', order: '순서', fail: '실패', skip: '건너뜀' } as const

/** 보낸 경로. 값은 스냅샷에서 올 수 있어 출력에 함께 적는다. 건너뛴 자리는 _, 경로가 없으면 빈 문자열 */
const sentPath = (path: string[]): string => (path.length > 0 ? ` [${path.map(v => (v.trim() === '' ? '_' : v)).join(', ')}]` : '')

export function formatVerify(report: VerifyReport): string {
  return [
    '[verify] 실제 API 대비 검사',
    ...report.results.map(r => `  ${STATUS_LABEL[r.status]} ${r.service} ${r.label}${sentPath(r.path)}: ${r.detail}`),
    ...(report.decisions.length > 0 ? ['검증으로 결정할 자리:', ...report.decisions.map(d => `  ${d.service}.${d.field}: ${d.verdict}`)] : []),
    `호출 합계: ${report.calls}회`,
    ...(report.aborted ? [`중단: ${report.aborted}`] : []),
  ].join('\n')
}
