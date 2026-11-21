import { describe, it, expect } from 'vitest'
import type { Unwrapped } from '../../src/client/response.js'
import type { CollectClient } from '../../src/store/collector.js'
import { STORE_RULES } from '../../src/store/rules.js'
import { encodeSnapshot, snapshotKey, type Snapshot } from '../../src/store/snapshot.js'
import type { SnapshotStore } from '../../src/store/snapshotStore.js'
import { casesFor, formatVerify, runVerify } from '../../src/store/verify.js'

const NOW = Date.parse('2026-11-21T03:00:00.000Z')
const PHARMACY = 'TbPharmacyOperateInfo'
const SENIOR = 'OdsnBuildingInfo'
const B = ' '

function memoryStore() {
  const objects = new Map<string, Buffer>()
  const store: SnapshotStore = {
    async get(key) { const body = objects.get(key); return body ? { body } : undefined },
    async put(key, body) { objects.set(key, body) },
    async list(prefix) { return [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key, lastModified: NOW, size: 1 })) },
  }
  const seed = (service: string, partition: string[], rows: any[], totalCount = rows.length) => {
    const s: Snapshot = { v: 1, service, partition, collectedAt: new Date(NOW).toISOString(), totalCount, rows }
    objects.set(snapshotKey(service, partition), encodeSnapshot(s))
  }
  return { store, seed }
}

type Req = { service: string; path: string[] }
function fakeClient(handler: (r: Req) => Unwrapped) {
  const calls: Req[] = []
  const client: CollectClient = {
    isSample: false,
    async getJson(service, _start, _end, path = []) { calls.push({ service, path }); return handler({ service, path }) },
  }
  return { client, calls }
}
const noData = (service: string): Unwrapped => ({ rows: [], totalCount: 0, note: `해당하는 데이터가 없습니다 (${service})` })
const answer = (service: string, rows: any[]): Unwrapped => (rows.length > 0 ? { rows, totalCount: rows.length } : noData(service))

const pharmacies = [
  { DUTYNAME: '강남온누리약국', DUTYADDR: '서울특별시 강남구 테헤란로 1' },
  { DUTYNAME: '역삼약국', DUTYADDR: '서울특별시 강남구 역삼로 2' },
  { DUTYNAME: '서초온누리약국', DUTYADDR: '서울특별시 서초구 서초대로 3' },
]
/** 약국 서비스의 실제 동작(두 자리 모두 부분일치)을 흉내 낸다 */
const livePharmacy = (r: Req): Unwrapped => {
  const [addr = '', name = ''] = r.path.map(v => v.trim())
  return answer(r.service, pharmacies.filter(p => p.DUTYADDR.includes(addr) && p.DUTYNAME.includes(name)))
}

describe('casesFor', () => {
  it('인자 없음, 자리 하나씩, 지원 자리 전부를 카탈로그 예시 값으로 만든다', () => {
    expect(casesFor(PHARMACY, STORE_RULES[PHARMACY], []).map(c => [c.label, c.path])).toEqual([
      ['인자 없음', []],
      ['DUTYADDR만', ['강남구']],
      ['DUTYNAME만', [B, '온누리']],
      ['지원 자리 전부', ['강남구', '온누리']],
    ])
  })

  it('검증으로 결정할 자리는 두 가정으로 만들고, 그냥 미지원인 자리는 만들지 않는다', () => {
    const cases = casesFor('culturalEventInfo', STORE_RULES.culturalEventInfo, [])
    expect(cases.map(c => [c.label, c.path, c.assume?.kind])).toEqual([
      ['인자 없음', [], undefined],
      ['TITLE만', [B, '서울'], undefined],
      ['CODENAME 가정: 일치(전체 값)', ['콘서트'], 'eq'],
      ['CODENAME 가정: 부분일치(전체 값)', ['콘서트'], 'contains'],
      ['CODENAME 가정: 일치(앞부분)', ['콘서'], 'eq'],
      ['CODENAME 가정: 부분일치(앞부분)', ['콘서'], 'contains'],
    ])
    expect(cases[2].assume).toEqual({ slot: 0, field: 'CODENAME', kind: 'eq' })
  })

  it('파티션 자리에는 저장된 파티션 값을 넣는다', () => {
    expect(casesFor('CardSubwayTime', STORE_RULES.CardSubwayTime, ['202609']).map(c => c.path)).toEqual([
      ['202609'], ['202609', '2호선'], ['202609', B, '강남'], ['202609', '2호선', '강남'],
    ])
    expect(casesFor('CardBusStatisticsServiceNew', STORE_RULES.CardBusStatisticsServiceNew, ['20261116']).map(c => c.path)).toEqual([['20261116']])
  })
})

describe('runVerify', () => {
  it('저장소와 서울 API의 전체 건수와 행이 같으면 통과한다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], pharmacies)
    const { client, calls } = fakeClient(livePharmacy)
    const report = await runVerify(client, m.store, { only: [PHARMACY], now: () => NOW, delayMs: 0 })
    expect(report.results.map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'], ['DUTYADDR만', 'ok'], ['DUTYNAME만', 'ok'], ['지원 자리 전부', 'ok'],
    ])
    expect(report).toMatchObject({ ok: true, calls: 4 })
    expect(calls.map(c => c.path)).toEqual([[], ['강남구'], [B, '온누리'], ['강남구', '온누리']])
  })

  it('행은 같고 순서만 다르면 경고, 전체 건수나 행 집합이 다르면 실패다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], pharmacies)
    const { client } = fakeClient(r => {
      if (r.path.length === 0) return { rows: [...pharmacies].reverse(), totalCount: 3 }
      if (r.path[0] === '강남구' && r.path.length === 1) return { rows: [pharmacies[0]], totalCount: 1 } // 서울 API가 한 건만 준다
      if (r.path.length === 2 && r.path[0] === B) return { rows: [pharmacies[0], pharmacies[1]], totalCount: 2 } // 건수는 같고 행이 다르다
      return livePharmacy(r)
    })
    const report = await runVerify(client, m.store, { only: [PHARMACY], now: () => NOW, delayMs: 0 })
    expect(report.results.map(r => r.status)).toEqual(['order', 'fail', 'fail', 'ok'])
    expect(report.results[1].detail).toBe('전체 건수 다름: 저장소 2, 서울 API 1')
    expect(report.results[2].detail).toContain('행 집합 다름')
    expect(report.ok).toBe(false)
  })

  const NAME = '더샵둔촌포레(둔촌현대1차A)'
  const seniors = [{ SISUL_NM: NAME }, { SISUL_NM: `${NAME} 별관` }]
  /** 경로당 서비스가 이름을 일치로 거른다고 볼 때와 부분일치로 거른다고 볼 때의 서울 API */
  const liveSenior = (kind: 'eq' | 'contains', rows = seniors) => (r: Req): Unwrapped => {
    const v = (r.path[0] ?? '').trim()
    return answer(r.service, rows.filter(x => v === '' || (kind === 'eq' ? x.SISUL_NM === v : x.SISUL_NM.includes(v))))
  }

  it('검증으로 결정할 자리는 전체 값과 앞부분으로 두 가정을 비교하고, 같은 요청은 서울 API를 한 번만 부른다', async () => {
    const m = memoryStore()
    m.seed(SENIOR, [], seniors)
    const { client, calls } = fakeClient(liveSenior('eq'))
    const report = await runVerify(client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(report.results.map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'],
      ['SISUL_NM 가정: 일치(전체 값)', 'ok'], ['SISUL_NM 가정: 부분일치(전체 값)', 'fail'],
      ['SISUL_NM 가정: 일치(앞부분)', 'ok'], ['SISUL_NM 가정: 부분일치(앞부분)', 'fail'],
    ])
    expect(calls.map(c => c.path)).toEqual([[], [NAME], [NAME.slice(0, 8)]])
    expect(report.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '일치' }])
    expect(report.ok).toBe(true) // 가정의 실패는 검사 실패가 아니다
  })

  it('서울 API가 부분일치로 거르면 부분일치로 판정한다', async () => {
    const m = memoryStore()
    m.seed(SENIOR, [], seniors)
    const report = await runVerify(fakeClient(liveSenior('contains')).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(report.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '부분일치' }])
  })

  it('예시 값에 맞는 행이 없으면 구분하지 못하고, 어느 가정도 맞지 않으면 재현 못 함이다', async () => {
    const m = memoryStore()
    const others = [{ SISUL_NM: '다른경로당' }]
    m.seed(SENIOR, [], others)
    const both = await runVerify(fakeClient(liveSenior('eq', others)).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(both.decisions[0].verdict).toBe('둘 다 맞음')
    const neither = await runVerify(fakeClient(r => answer(r.service, others)).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(neither.decisions[0].verdict).toBe('재현 못 함')
  })

  it('파티션이 있는 서비스는 가장 최근에 저장된 파티션으로 검사한다', async () => {
    const m = memoryStore()
    m.seed('CardSubwayStatsNew', ['20261115'], [{ USE_YMD: '20261115' }])
    m.seed('CardSubwayStatsNew', ['20261117'], [{ USE_YMD: '20261117' }])
    const { client, calls } = fakeClient(r => answer(r.service, [{ USE_YMD: r.path[0] }]))
    const report = await runVerify(client, m.store, { only: ['CardSubwayStatsNew'], now: () => NOW, delayMs: 0 })
    expect(calls.map(c => c.path)).toEqual([['20261117']])
    expect(report.results[0].status).toBe('ok')
  })

  it('스냅샷이 없는 서비스는 건너뛰고, 자리가 없는 머리 19종은 검사하지 않는다', async () => {
    const m = memoryStore()
    const { client, calls } = fakeClient(r => noData(r.service))
    const report = await runVerify(client, m.store, { now: () => NOW, delayMs: 0 })
    expect(calls).toHaveLength(0)
    expect(report.results).toHaveLength(18)
    expect(report.results.every(r => r.status === 'skip' && r.detail === '스냅샷 없음')).toBe(true)
    expect(report.ok).toBe(true)
  })

  it('쿼터 소진이나 호출 제한 응답을 받으면 검사를 끝낸다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], pharmacies)
    const { client, calls } = fakeClient(() => ({ rows: [], totalCount: 0, note: '일일 API 쿼터(3000회)가 소진되어 새 데이터를 가져올 수 없습니다.' }))
    const report = await runVerify(client, m.store, { only: [PHARMACY], now: () => NOW, delayMs: 0 })
    expect(calls).toHaveLength(1)
    expect(report.ok).toBe(false)
    expect(report.aborted).toContain('소진되어')
  })

  it('샘플 키로는 검사하지 않는다', async () => {
    const m = memoryStore()
    await expect(runVerify({ ...fakeClient(livePharmacy).client, isSample: true }, m.store)).rejects.toThrow('샘플 키')
  })

  it('결과를 상태, 서비스, 요청, 설명으로 출력하고 결정할 자리를 따로 모은다', async () => {
    const m = memoryStore()
    m.seed(SENIOR, [], seniors)
    const text = formatVerify(await runVerify(fakeClient(liveSenior('eq')).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 }))
    expect(text).toContain('통과 OdsnBuildingInfo 인자 없음: 2건 일치')
    expect(text).toContain('실패 OdsnBuildingInfo SISUL_NM 가정: 부분일치(전체 값)')
    expect(text).toContain('OdsnBuildingInfo.SISUL_NM: 일치')
    expect(text).toContain('호출 합계: 3회')
  })
})
