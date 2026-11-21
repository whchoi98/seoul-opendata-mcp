import { describe, it, expect } from 'vitest'
import { isNoData, noDataNote, unwrap } from '../../src/client/response.js'
import { answerFrom, planRequest } from '../../src/store/engine.js'
import type { StoreRule } from '../../src/store/rules.js'
import type { Snapshot } from '../../src/store/snapshot.js'

const NOW = Date.parse('2026-11-21T03:00:00.000Z')
const DAY = 86_400_000
const B = ' '

const snapshot = (service: string, rows: any[], over: Partial<Snapshot> = {}): Snapshot => ({
  v: 1, service, partition: [], collectedAt: new Date(NOW - 3_600_000).toISOString(), totalCount: rows.length, rows, ...over,
})

const pharmacies = [
  { DUTYNAME: '강남온누리약국', DUTYADDR: '서울특별시 강남구 테헤란로 1' },
  { DUTYNAME: '역삼약국', DUTYADDR: '서울특별시 강남구 역삼로 2' },
  { DUTYNAME: '서초온누리약국', DUTYADDR: '서울특별시 서초구 서초대로 3' },
]

describe('noDataNote', () => {
  it('서울 API의 INFO-200 문구와 같고 isNoData가 참이다', () => {
    const live = unwrap('TbPharmacyOperateInfo', { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } })
    expect(noDataNote('TbPharmacyOperateInfo')).toBe(live.note)
    expect(noDataNote('X')).toBe('해당하는 데이터가 없습니다 (X)')
    expect(isNoData({ rows: [], totalCount: 0, note: noDataNote('X') })).toBe(true)
  })
})

describe('planRequest', () => {
  it('규칙이 없는 서비스는 답하지 않는다', () => {
    expect(planRequest('citydata_ppltn', ['강남역'])).toBeUndefined()
    expect(planRequest('constructor', [])).toBeUndefined()
    expect(planRequest('__proto__', [])).toBeUndefined()
  })

  it('인자가 없으면 필터 없이 _all 스냅샷을 고른다', () => {
    const p = planRequest('TbPharmacyOperateInfo', [])!
    expect(p.key).toBe('TbPharmacyOperateInfo/_all.json.gz')
    expect(p.partition).toEqual([])
    expect(p.filters).toEqual([])
    expect(p.service).toBe('TbPharmacyOperateInfo')
  })

  it('자리 순서대로 일치와 부분일치 필터를 만들고 값의 앞뒤 공백을 자른다', () => {
    expect(planRequest('TbPharmacyOperateInfo', ['강남구', ' 온누리 '])!.filters).toEqual([
      { field: 'DUTYADDR', kind: 'contains', value: '강남구' },
      { field: 'DUTYNAME', kind: 'contains', value: '온누리' },
    ])
    expect(planRequest('GetParkInfo', [B, '1033125'])!.filters).toEqual([{ field: 'PKLT_CD', kind: 'eq', value: '1033125' }])
  })

  it('공백뿐이거나 빈 자리는 값이 없는 것으로 본다', () => {
    expect(planRequest('TbPharmacyOperateInfo', [B, '온누리'])!.filters).toEqual([{ field: 'DUTYNAME', kind: 'contains', value: '온누리' }])
    expect(planRequest('TbPharmacyOperateInfo', ['', '  '])!.filters).toEqual([])
    expect(planRequest('culturalEventInfo', [B, B, B])!.filters).toEqual([])
  })

  it('길이 0인 자리 뒤에 값이 있으면 답하지 않는다. 서울 API는 빈 문자열 뒤의 필터를 모두 무시한다', () => {
    expect(planRequest('TbPharmacyOperateInfo', ['', '온누리'])).toBeUndefined()
    expect(planRequest('CardSubwayTime', ['202610', '', '강남'])).toBeUndefined()
    // 공백 한 칸은 지금처럼 값이 없는 자리다
    expect(planRequest('TbPharmacyOperateInfo', [B, '온누리'])!.filters).toEqual([{ field: 'DUTYNAME', kind: 'contains', value: '온누리' }])
    // 끝의 빈 문자열, 뒤에 공백뿐인 빈 문자열은 그대로 답한다
    expect(planRequest('TbPharmacyOperateInfo', ['강남구', ''])!.filters).toEqual([{ field: 'DUTYADDR', kind: 'contains', value: '강남구' }])
    expect(planRequest('TbPharmacyOperateInfo', [''])!.filters).toEqual([])
    expect(planRequest('TbPharmacyOperateInfo', ['', B])!.filters).toEqual([])
  })

  it('미지원 자리에 값이 오면 답하지 않는다', () => {
    expect(planRequest('culturalEventInfo', ['콘서트', B, B])).toBeUndefined()
    expect(planRequest('culturalEventInfo', [B, '재즈', '2026-12-24'])).toBeUndefined()
    expect(planRequest('culturalEventInfo', [B, '재즈', B])!.filters).toEqual([{ field: 'TITLE', kind: 'contains', value: '재즈' }])
    expect(planRequest('OdsnBuildingInfo', ['경로당'])).toBeUndefined()
  })

  it('값이 온 자리가 규칙의 자리 수를 넘으면 답하지 않는다', () => {
    expect(planRequest('TbPharmacyOperateInfo', ['강남구', '온누리', '추가'])).toBeUndefined()
    expect(planRequest('TbPublicWifiInfo', ['강남구'])).toBeUndefined()
    expect(planRequest('TbPublicWifiInfo', [B])!.filters).toEqual([])
    expect(planRequest('TbPharmacyOperateInfo', ['강남구', '온누리', B])!.filters).toHaveLength(2)
  })

  it('파티션 자리의 값으로 스냅샷을 고르고 나머지는 필터가 된다', () => {
    const p = planRequest('CardSubwayTime', ['202610', B, '강남'])!
    expect(p.key).toBe('CardSubwayTime/202610.json.gz')
    expect(p.partition).toEqual(['202610'])
    expect(p.filters).toEqual([{ field: 'STTN', kind: 'eq', value: '강남' }])
    expect(planRequest('SearchFirstAndLastTrainbyLineServiceNew', ['2호선', '1', '1', '0222'])!.key)
      .toBe('SearchFirstAndLastTrainbyLineServiceNew/2호선_1_1.json.gz')
    expect(planRequest('SearchSTNTimeTableByIDService', ['0222', '1', '2'])!.key).toBe('SearchSTNTimeTableByIDService/0222_1_2.json.gz')
  })

  it('파티션 자리가 비었거나 형식에 맞지 않으면 답하지 않는다', () => {
    expect(planRequest('CardSubwayStatsNew', [])).toBeUndefined()
    expect(planRequest('SPOP_LOCAL_RESD_DONG', [B, '14'])).toBeUndefined()
    expect(planRequest('SearchSTNTimeTableByIDService', ['0222', '1'])).toBeUndefined()
    for (const bad of ['2026111', '202611160', '2026-11-16', '..', '../20261116', '20261116/..', 'a/b', '%2e%2e']) {
      expect(planRequest('CardSubwayStatsNew', [bad]), bad).toBeUndefined()
    }
    expect(planRequest('SearchFirstAndLastTrainbyLineServiceNew', ['경의선', '1', '1'])).toBeUndefined()
    expect(planRequest('SearchFirstAndLastTrainbyLineServiceNew', ['2호선/..', '1', '1'])).toBeUndefined()
    expect(planRequest('SearchSTNTimeTableByIDService', ['../0222', '1', '1'])).toBeUndefined()
    expect(planRequest('SearchSTNTimeTableByIDService', ['0222', '4', '1'])).toBeUndefined()
  })

  it('규칙 표를 바꿔 넣을 수 있다(verify가 가정을 시험할 때 쓴다)', () => {
    const rules: Record<string, StoreRule> = {
      X: { slots: [{ field: 'A', kind: 'eq' }], bundle: 'daily', scope: 'full', maxAgeMs: DAY, callsPerSnapshot: 1 },
    }
    expect(planRequest('X', ['v'], rules)!.filters).toEqual([{ field: 'A', kind: 'eq', value: 'v' }])
    expect(planRequest('TbPharmacyOperateInfo', [], rules)).toBeUndefined()
  })
})

describe('answerFrom', () => {
  const all = snapshot('TbPharmacyOperateInfo', pharmacies)
  const plan = (path: string[]) => planRequest('TbPharmacyOperateInfo', path)!

  it('필터가 없으면 범위만 자르고 전체 건수는 스냅샷의 값이다', () => {
    const a = answerFrom(all, plan([]), 1, 2, NOW)!
    expect(a.value.rows).toEqual(pharmacies.slice(0, 2))
    expect(a.value.totalCount).toBe(3)
    expect(a.value.note).toBeUndefined()
    expect(a.expired).toBe(false)
    expect(a.collectedAt).toBe(NOW - 3_600_000)
    expect(answerFrom(all, plan([]), 2, 1000, NOW)!.value.rows).toEqual(pharmacies.slice(1))
  })

  it('부분일치는 필드가 값을 포함하는 행만 남기고 전체 건수는 걸러진 행 수다', () => {
    const a = answerFrom(all, plan(['강남구', '온누리']), 1, 1000, NOW)!
    expect(a.value.rows).toEqual([pharmacies[0]])
    expect(a.value.totalCount).toBe(1)
    const b = answerFrom(all, plan([B, '온누리']), 1, 1, NOW)!
    expect(b.value.rows).toEqual([pharmacies[0]])
    expect(b.value.totalCount).toBe(2) // 범위로 잘렸어도 조건에 맞는 전체 건수
  })

  it('부분일치는 대소문자를 구분한다', () => {
    const s = snapshot('TbPharmacyOperateInfo', [{ DUTYNAME: 'ABC약국', DUTYADDR: 'x' }])
    expect(answerFrom(s, plan([B, 'ABC']), 1, 10, NOW)!.value.rows).toHaveLength(1)
    expect(answerFrom(s, plan([B, 'abc']), 1, 10, NOW)!.value.rows).toHaveLength(0)
  })

  it('일치는 문자열로 바꾸고 앞뒤 공백을 자른 뒤 비교한다', () => {
    const rows = [{ ADDR: '강남구 1', PKLT_CD: 1033125, PRK_NOW_INFO_PVSN_YN: ' 1 ' }, { ADDR: '강남구 2', PKLT_CD: '10331250', PRK_NOW_INFO_PVSN_YN: '2' }]
    const s = snapshot('GetParkInfo', rows)
    const a = answerFrom(s, planRequest('GetParkInfo', [B, '1033125', '1'])!, 1, 10, NOW)!
    expect(a.value.rows).toEqual([rows[0]])
    expect(answerFrom(s, planRequest('GetParkInfo', [B, '103312'])!, 1, 10, NOW)!.value.rows).toEqual([])
  })

  it('0건이면 note에 서울 API와 같은 문구만 넣는다', () => {
    const a = answerFrom(all, plan([B, '없는약국']), 1, 1000, NOW)!
    expect(a.value).toEqual({ rows: [], totalCount: 0, note: '해당하는 데이터가 없습니다 (TbPharmacyOperateInfo)' })
    expect(isNoData(a.value)).toBe(true)
    // 범위가 걸러진 행을 벗어나도 0건이다
    expect(answerFrom(all, plan([]), 4, 10, NOW)!.value).toEqual({ rows: [], totalCount: 0, note: noDataNote('TbPharmacyOperateInfo') })
  })

  it('머리 스냅샷은 필터 요청과 저장된 범위를 넘는 요청에 답하지 않는다', () => {
    const headSnap = snapshot('TbPharmacyOperateInfo', pharmacies, { totalCount: 5650 })
    expect(answerFrom(headSnap, plan([]), 1, 3, NOW)!.value).toEqual({ rows: pharmacies, totalCount: 5650 })
    expect(answerFrom(headSnap, plan([]), 1, 4, NOW)).toBeUndefined()
    expect(answerFrom(headSnap, plan(['강남구']), 1, 3, NOW)).toBeUndefined()
  })

  it('기한이 지난 스냅샷은 allowExpired일 때만 expired 표시와 함께 답한다', () => {
    const old = snapshot('TbPharmacyOperateInfo', pharmacies, { collectedAt: new Date(NOW - 8 * DAY).toISOString() })
    expect(answerFrom(old, plan([]), 1, 10, NOW)).toBeUndefined()
    const a = answerFrom(old, plan([]), 1, 10, NOW, { allowExpired: true })!
    expect(a.expired).toBe(true)
    expect(a.value.rows).toHaveLength(3)
    const edge = snapshot('TbPharmacyOperateInfo', pharmacies, { collectedAt: new Date(NOW - 7 * DAY).toISOString() })
    expect(answerFrom(edge, plan([]), 1, 10, NOW)!.expired).toBe(false) // 기한과 같으면 아직 쓴다
  })

  it('기한이 없는 규칙의 스냅샷은 오래돼도 답한다', () => {
    const s = snapshot('CardSubwayStatsNew', [{ USE_YMD: '20260101' }], {
      partition: ['20260101'], collectedAt: new Date(NOW - 300 * DAY).toISOString(),
    })
    expect(answerFrom(s, planRequest('CardSubwayStatsNew', ['20260101'])!, 1, 1000, NOW)!.expired).toBe(false)
  })

  it('잘못된 범위에는 답하지 않는다', () => {
    expect(answerFrom(all, plan([]), 0, 5, NOW)).toBeUndefined()
    expect(answerFrom(all, plan([]), 5, 4, NOW)).toBeUndefined()
  })
})
