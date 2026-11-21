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
const PARK = 'GetParkInfo'
const STATION = 'SearchInfoBySubwayNameService'
const FIRST_LAST = 'SearchFirstAndLastTrainbyLineServiceNew'
const B = ' '
const NO_VALUE = '스냅샷에 이 필드 값이 없어 검사하지 못함'
const NAME = '더샵둔촌포레(둔촌현대1차A)'
const seniors = [{ SISUL_NM: NAME }, { SISUL_NM: `${NAME} 별관` }]

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
const livePharmacyOf = (rows: typeof pharmacies) => (r: Req): Unwrapped => {
  const [addr = '', name = ''] = r.path.map(v => v.trim())
  return answer(r.service, rows.filter(p => p.DUTYADDR.includes(addr) && p.DUTYNAME.includes(name)))
}
const livePharmacy = livePharmacyOf(pharmacies)
const verifyOnly = (client: CollectClient, store: SnapshotStore, only: string[]) => runVerify(client, store, { only, now: () => NOW, delayMs: 0 })

describe('casesFor', () => {
  it('인자 없음, 자리 하나씩(값 전체와 앞부분), 지원 자리 전부를 카탈로그 예시 값으로 만든다', () => {
    expect(casesFor(PHARMACY, STORE_RULES[PHARMACY], []).map(c => [c.label, c.path])).toEqual([
      ['인자 없음', []],
      ['DUTYADDR만', ['강남구']],
      ['DUTYADDR만(앞부분)', ['강남']],
      ['DUTYNAME만', [B, '온누리']],
      ['DUTYNAME만(앞부분)', [B, '온누']],
      ['지원 자리 전부', ['강남구', '온누리']],
    ])
  })

  it('일치 자리도 앞부분으로 시험한다. 한 글자 값은 앞부분이 같아 만들지 않는다', () => {
    expect(casesFor(PARK, STORE_RULES[PARK], []).map(c => [c.label, c.path])).toEqual([
      ['인자 없음', []],
      ['ADDR만', ['강남']],
      ['ADDR만(앞부분)', ['강']],
      ['PKLT_CD만', [B, '1033125']],
      ['PKLT_CD만(앞부분)', [B, '1033']],
      ['PRK_NOW_INFO_PVSN_YN만', [B, B, '1']],
      ['지원 자리 전부', ['강남', '1033125', '1']],
    ])
  })

  it('검증으로 결정할 자리는 두 가정으로 만들고, 그냥 미지원인 자리는 만들지 않는다', () => {
    const cases = casesFor('culturalEventInfo', STORE_RULES.culturalEventInfo, [])
    expect(cases.map(c => [c.label, c.path, c.assume?.kind])).toEqual([
      ['인자 없음', [], undefined],
      ['TITLE만', [B, '서울'], undefined],
      ['TITLE만(앞부분)', [B, '서'], undefined],
      ['CODENAME 가정: 일치(전체 값)', ['콘서트'], 'eq'],
      ['CODENAME 가정: 부분일치(전체 값)', ['콘서트'], 'contains'],
      ['CODENAME 가정: 일치(앞부분)', ['콘서'], 'eq'],
      ['CODENAME 가정: 부분일치(앞부분)', ['콘서'], 'contains'],
    ])
    expect(cases[3].assume).toEqual({ slot: 0, field: 'CODENAME', kind: 'eq' })
  })

  it('파티션 자리에는 저장된 파티션 값을 넣는다', () => {
    expect(casesFor('CardSubwayTime', STORE_RULES.CardSubwayTime, ['202609']).map(c => c.path)).toEqual([
      ['202609'], ['202609', '2호선'], ['202609', '2호'], ['202609', B, '강남'], ['202609', B, '강'], ['202609', '2호선', '강남'],
    ])
    expect(casesFor('CardBusStatisticsServiceNew', STORE_RULES.CardBusStatisticsServiceNew, ['20261116']).map(c => c.path)).toEqual([['20261116']])
  })

  it('예시 값을 포함한 행이 스냅샷에 있으면 예시 값을, 없으면 그 필드의 첫 값을 쓴다', () => {
    const stored = [{ DUTYADDR: '서울특별시 서초구 3', DUTYNAME: '서초약국' }, { DUTYADDR: '서울특별시 강남구 1', DUTYNAME: '강남온누리약국' }]
    expect(casesFor(PHARMACY, STORE_RULES[PHARMACY], [], stored).map(c => c.path)).toEqual([
      [], ['강남구'], ['강남'], [B, '온누리'], [B, '온누'], ['강남구', '온누리'],
    ])
    // 9호선 스냅샷에는 카탈로그의 2호선 예시 값(0222, 222)이 없다. 비어 있는 값은 건너뛴다
    const line9 = [{ SUBW_CD: ' ', OTSD_CD: '' }, { SUBW_CD: '4101', OTSD_CD: '901' }, { SUBW_CD: '4102', OTSD_CD: '902' }]
    const p = ['9호선', '2', '3']
    expect(casesFor(FIRST_LAST, STORE_RULES[FIRST_LAST], p, line9).map(c => [c.label, c.path])).toEqual([
      ['인자 없음', p],
      ['SUBW_CD만', [...p, '4101']],
      ['SUBW_CD만(앞부분)', [...p, '41']],
      ['OTSD_CD만', [...p, B, '901']],
      ['OTSD_CD만(앞부분)', [...p, B, '90']],
      ['지원 자리 전부', [...p, '4101', '901']],
    ])
  })

  it('일치로 비교하는 자리는 예시 값과 똑같은 행이, 부분일치 자리는 예시 값을 포함한 행이 있어야 예시 값을 쓴다', () => {
    const valueOf = (service: string, rows: any[], label: string, partition: string[] = []) =>
      casesFor(service, STORE_RULES[service], partition, rows).find(c => c.label === label)!.path.at(-1)
    // 일치 자리: 예시 값(강남)과 똑같은 행이 있으면 쓴다. 포함하기만 하면 그 필드의 첫 값으로 바꾼다
    expect(valueOf(STATION, [{ STATION_NM: '강남구청' }, { STATION_NM: '강남' }], 'STATION_NM만')).toBe('강남')
    expect(valueOf(STATION, [{ STATION_NM: '강남구청' }, { STATION_NM: '역삼' }], 'STATION_NM만')).toBe('강남구청')
    // 검증으로 결정할 자리도 일치로 비교하므로 같은 규칙이다
    expect(valueOf(SENIOR, [{ SISUL_NM: `${NAME} 별관` }], 'SISUL_NM 가정: 일치(전체 값)')).toBe(`${NAME} 별관`)
    expect(valueOf(SENIOR, [{ SISUL_NM: `${NAME} 별관` }, { SISUL_NM: NAME }], 'SISUL_NM 가정: 일치(전체 값)')).toBe(NAME)
    // 부분일치 자리: 예시 값(솔밭)을 포함한 행이 있으면 쓴다
    expect(valueOf('tnFcltySttusInfo1011', [{ FCLTY_NM: '솔밭공원' }], 'FCLTY_NM만')).toBe('솔밭')
    // 대체 값은 '/'가 든 값을 건너뛴다. 모든 값에 '/'가 있으면 첫 값을 쓴다
    expect(valueOf(STATION, [{ STATION_NM: '서울역/1호선' }, { STATION_NM: '시청' }], 'STATION_NM만')).toBe('시청')
    expect(valueOf(STATION, [{ STATION_NM: '서울역/1호선' }, { STATION_NM: '시청/2호선' }], 'STATION_NM만')).toBe('서울역/1호선')
  })

  it('앞부분은 끝의 공백을 뗀다', () => {
    const cases = casesFor('tnFcltySttusInfo1011', STORE_RULES.tnFcltySttusInfo1011, [], [{ FCLTY_NM: '서울특별시 강남구 1' }])
    // 앞 6글자는 '서울특별시 '이다. 서울 API가 끝 공백을 받지 않도록 '서울특별시'로 보낸다
    expect(cases.map(c => [c.label, c.path])).toEqual([
      ['인자 없음', []], ['FCLTY_NM만', ['서울특별시 강남구 1']], ['FCLTY_NM만(앞부분)', ['서울특별시']],
    ])
    const senior = casesFor(SENIOR, STORE_RULES[SENIOR], [], [{ SISUL_NM: '서울특별시 강남구 1' }])
    expect(senior.filter(c => c.label.includes('앞부분')).map(c => c.path)).toEqual([['서울특별시'], ['서울특별시']])
  })

  it('스냅샷에 그 필드 값이 하나도 없으면 서울 API를 부르지 않고 건너뛸 자리 표시만 만든다', () => {
    const station = casesFor(STATION, STORE_RULES[STATION], [], [{ STATION_NM: '' }, { STATION_NM: ' ' }, {}])
    expect(station).toEqual([
      { service: STATION, path: [], label: '인자 없음' },
      { service: STATION, path: [], label: 'STATION_NM만', skip: NO_VALUE },
    ])
    const senior = casesFor(SENIOR, STORE_RULES[SENIOR], [], [])
    expect(senior.map(c => [c.label, c.assume, c.skip])).toEqual([
      ['인자 없음', undefined, undefined],
      ['SISUL_NM 가정: 일치', { slot: 0, field: 'SISUL_NM', kind: 'eq' }, NO_VALUE],
      ['SISUL_NM 가정: 부분일치', { slot: 0, field: 'SISUL_NM', kind: 'contains' }, NO_VALUE],
    ])
  })
})

describe('runVerify', () => {
  it('저장소와 서울 API의 전체 건수와 행이 같으면 통과한다', async () => {
    const m = memoryStore()
    m.seed(PHARMACY, [], pharmacies)
    const { client, calls } = fakeClient(livePharmacy)
    const report = await runVerify(client, m.store, { only: [PHARMACY], now: () => NOW, delayMs: 0 })
    expect(report.results.map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'], ['DUTYADDR만', 'ok'], ['DUTYADDR만(앞부분)', 'ok'],
      ['DUTYNAME만', 'ok'], ['DUTYNAME만(앞부분)', 'ok'], ['지원 자리 전부', 'ok'],
    ])
    expect(report).toMatchObject({ ok: true, calls: 6 })
    expect(calls.map(c => c.path)).toEqual([[], ['강남구'], ['강남'], [B, '온누리'], [B, '온누'], ['강남구', '온누리']])
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
    expect(report.results.map(r => r.status)).toEqual(['order', 'fail', 'ok', 'fail', 'fail', 'ok'])
    expect(report.results[1].detail).toBe('전체 건수 다름: 저장소 2, 서울 API 1')
    expect(report.results[3].detail).toContain('행 집합 다름')
    expect(report.ok).toBe(false)
  })

  it('일치로 적은 자리를 서울 API가 부분일치로 거르면 앞부분 요청에서 실패한다', async () => {
    const parks = [
      { ADDR: '강남구 역삼동 1', PKLT_CD: '1033125', PRK_NOW_INFO_PVSN_YN: '1' },
      { ADDR: '강남구 삼성동 2', PKLT_CD: '1033126', PRK_NOW_INFO_PVSN_YN: '1' },
      { ADDR: '종로구 세종로 3', PKLT_CD: '1010089', PRK_NOW_INFO_PVSN_YN: '0' },
    ]
    const m = memoryStore()
    m.seed(PARK, [], parks)
    const { client } = fakeClient(r => {
      const [addr = '', code = '', yn = ''] = r.path.map(v => v.trim())
      return answer(r.service, parks.filter(x => x.ADDR.includes(addr) && x.PKLT_CD.includes(code) && (yn === '' || x.PRK_NOW_INFO_PVSN_YN === yn)))
    })
    const report = await verifyOnly(client, m.store, [PARK])
    expect(report.results.map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'], ['ADDR만', 'ok'], ['ADDR만(앞부분)', 'ok'],
      ['PKLT_CD만', 'ok'], ['PKLT_CD만(앞부분)', 'fail'],
      ['PRK_NOW_INFO_PVSN_YN만', 'ok'], ['지원 자리 전부', 'ok'],
    ])
    expect(report.results[4].detail).toBe('전체 건수 다름: 저장소 0, 서울 API 2')
    expect(report.ok).toBe(false)
  })

  it('부분일치로 적은 자리를 서울 API가 일치로 거르면 앞부분 요청에서 실패한다', async () => {
    const facilities = [{ FCLTY_NM: '솔밭' }, { FCLTY_NM: '느티나무' }]
    const m = memoryStore()
    m.seed('tnFcltySttusInfo1011', [], facilities)
    const { client } = fakeClient(r => {
      const v = (r.path[0] ?? '').trim()
      return answer(r.service, facilities.filter(x => v === '' || x.FCLTY_NM === v))
    })
    const report = await verifyOnly(client, m.store, ['tnFcltySttusInfo1011'])
    expect(report.results.map(r => [r.label, r.path, r.status])).toEqual([
      ['인자 없음', [], 'ok'], ['FCLTY_NM만', ['솔밭'], 'ok'], ['FCLTY_NM만(앞부분)', ['솔'], 'fail'],
    ])
    expect(report.results[2].detail).toBe('전체 건수 다름: 저장소 1, 서울 API 0')
    expect(report.ok).toBe(false)
  })

  it('필터가 있는 요청에서 양쪽 모두 0건이면, 이 값을 가진 행이 스냅샷에 없을 때 건너뛴다', async () => {
    // 강남구 행과 온누리 행이 따로 있어 두 값을 모두 가진 행이 없다. 두 필드가 모두 찬 행도 없어 한 행에서 값을 모을 수 없다
    const apart = [
      { DUTYNAME: '', DUTYADDR: '서울특별시 강남구 역삼로 2' },
      { DUTYNAME: '서초온누리약국', DUTYADDR: '' },
    ]
    const m = memoryStore()
    m.seed(PHARMACY, [], apart)
    const report = await verifyOnly(fakeClient(livePharmacyOf(apart)).client, m.store, [PHARMACY])
    expect(report.results.at(-1)).toMatchObject({
      label: '지원 자리 전부', path: ['강남구', '온누리'], status: 'skip',
      detail: '양쪽 모두 0건이고 스냅샷에 이 값을 가진 행이 없어 근거가 되지 않음',
    })
    expect(report.results.slice(0, -1).every(r => r.status === 'ok')).toBe(true)
    expect(report.ok).toBe(true)
  })

  it('따로 고른 값을 함께 가진 행이 없으면 지원 자리 전부는 한 행에서 값을 모아 실제로 비교한다', async () => {
    // 카탈로그 예시 값(강남구, 온누리)이 없고, 필드마다 첫 값이 서로 다른 행에서 나온다
    const scattered = [
      { DUTYADDR: '마포구 망원로 1', DUTYNAME: '' },
      { DUTYADDR: '', DUTYNAME: '망원약국' },
      { DUTYADDR: '종로구 종로 2', DUTYNAME: '종로약국' },
    ]
    const m = memoryStore()
    m.seed(PHARMACY, [], scattered)
    const report = await verifyOnly(fakeClient(livePharmacyOf(scattered)).client, m.store, [PHARMACY])
    const by = (label: string) => report.results.find(r => r.label === label)!
    // 자리 하나씩 요청은 따로 고른 값을 그대로 쓴다
    expect(by('DUTYADDR만').path).toEqual(['마포구 망원로 1'])
    expect(by('DUTYNAME만').path).toEqual([B, '망원약국'])
    expect(by('지원 자리 전부')).toMatchObject({ path: ['종로구 종로 2', '종로약국'], status: 'ok', detail: '1건 일치' })
    expect(report.ok).toBe(true)
  })

  it('필터가 있는 요청에서 양쪽 모두 0건이면, 이 값을 포함한 행이 스냅샷에 있을 때만 통과로 센다', async () => {
    const stations = [{ STATION_NM: '강남' }, { STATION_NM: '강남구청' }]
    const m = memoryStore()
    m.seed(STATION, [], stations)
    const { client } = fakeClient(r => {
      const v = (r.path[0] ?? '').trim()
      return answer(r.service, stations.filter(x => v === '' || x.STATION_NM === v))
    })
    const report = await verifyOnly(client, m.store, [STATION])
    expect(report.results.map(r => [r.label, r.path, r.status, r.detail])).toEqual([
      ['인자 없음', [], 'ok', '2건 일치'],
      ['STATION_NM만', ['강남'], 'ok', '1건 일치'],
      ['STATION_NM만(앞부분)', ['강'], 'ok', '0건 일치(이 값을 포함한 행이 있는데 양쪽 모두 0건)'],
    ])
    expect(report.ok).toBe(true)
  })

  it('일치 자리의 예시 값이 행 값의 일부일 뿐이면 행 값으로 시험해 서울 API의 0건을 실패로 드러낸다', async () => {
    // 예시 값 강남은 강남구청의 일부일 뿐이다. 서울 API는 값을 주면 늘 0건이다
    const stations = [{ STATION_NM: '강남구청' }, { STATION_NM: '역삼' }]
    const m = memoryStore()
    m.seed(STATION, [], stations)
    const { client } = fakeClient(r => (r.path.some(v => v.trim() !== '') ? noData(r.service) : answer(r.service, stations)))
    const report = await verifyOnly(client, m.store, [STATION])
    expect(report.results.find(r => r.label === 'STATION_NM만')).toMatchObject({
      path: ['강남구청'], status: 'fail', detail: '전체 건수 다름: 저장소 1, 서울 API 0',
    })
    expect(report.ok).toBe(false)
  })

  it('결정할 자리의 예시 값이 행 값의 일부일 뿐이면 행 값으로 시험해 0건끼리의 비교로 일치라고 하지 않는다', async () => {
    // 예시 값 초등학교는 '초등학교 3~6학년'의 일부일 뿐이다. 서울 API는 USETGTINFO 자리에 값이 오면 늘 0건이다
    const edu = [
      { MINCLASSNM: '역사', SVCNM: '한양도성 탐방', USETGTINFO: '초등학교 3~6학년', AREANM: '종로구' },
      { MINCLASSNM: '과학', SVCNM: '별자리 교실', USETGTINFO: '제한없음', AREANM: '중구' },
    ]
    const service = 'ListPublicReservationEducation'
    const m = memoryStore()
    m.seed(service, [], edu)
    const { client } = fakeClient(r => {
      const [min = '', svc = '', use = '', area = ''] = r.path.map(v => v.trim())
      if (use !== '') return noData(r.service)
      return answer(r.service, edu.filter(x => x.MINCLASSNM.includes(min) && x.SVCNM.includes(svc) && (area === '' || x.AREANM === area)))
    })
    const report = await verifyOnly(client, m.store, [service])
    expect(report.results.find(r => r.label === 'USETGTINFO 가정: 일치(전체 값)')).toMatchObject({
      path: [B, B, '초등학교 3~6학년'], status: 'fail', detail: '전체 건수 다름: 저장소 1, 서울 API 0',
    })
    expect(report.decisions.find(d => d.field === 'USETGTINFO')).toEqual({ service, field: 'USETGTINFO', verdict: '재현 못 함' })
  })

  it('첫차와 막차: 가장 최근 파티션에 카탈로그 예시 값이 없으면 스냅샷의 값으로 실제로 비교한다', async () => {
    const line2 = [{ SBWY_ROUT_LN: '02호선', SUBW_CD: '0222', OTSD_CD: '222', STTN: '강남' }, { SBWY_ROUT_LN: '02호선', SUBW_CD: '0223', OTSD_CD: '223', STTN: '역삼' }]
    const line9 = [{ SBWY_ROUT_LN: '09호선', SUBW_CD: '4101', OTSD_CD: '901', STTN: '개화' }, { SBWY_ROUT_LN: '09호선', SUBW_CD: '4102', OTSD_CD: '902', STTN: '김포공항' }]
    const m = memoryStore()
    m.seed(FIRST_LAST, ['2호선', '1', '1'], line2)
    m.seed(FIRST_LAST, ['9호선', '2', '3'], line9)
    const { client, calls } = fakeClient(r => {
      const [line, , , code = '', outside = ''] = r.path.map(v => v.trim())
      const rows = line === '9호선' ? line9 : line2
      return answer(r.service, rows.filter(x => (code === '' || x.SUBW_CD === code) && (outside === '' || x.OTSD_CD === outside)))
    })
    const report = await verifyOnly(client, m.store, [FIRST_LAST])
    const p = ['9호선', '2', '3']
    expect(calls.map(c => c.path)).toEqual([p, [...p, '4101'], [...p, '41'], [...p, B, '901'], [...p, B, '90'], [...p, '4101', '901']])
    expect(report.results.map(r => [r.label, r.detail])).toEqual([
      ['인자 없음', '2건 일치'],
      ['SUBW_CD만', '1건 일치'],
      ['SUBW_CD만(앞부분)', '0건 일치(이 값을 포함한 행이 있는데 양쪽 모두 0건)'],
      ['OTSD_CD만', '1건 일치'],
      ['OTSD_CD만(앞부분)', '0건 일치(이 값을 포함한 행이 있는데 양쪽 모두 0건)'],
      ['지원 자리 전부', '1건 일치'],
    ])
    expect(report.ok).toBe(true)
  })

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

  it('전체 값으로는 두 가정이 모두 맞고 앞부분에서만 갈릴 때, 앞부분까지 통과한 가정만 인정한다', async () => {
    const one = [{ SISUL_NM: NAME }]
    const m = memoryStore()
    m.seed(SENIOR, [], one)
    const partial = await runVerify(fakeClient(liveSenior('contains', one)).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(partial.results.map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'],
      ['SISUL_NM 가정: 일치(전체 값)', 'ok'], ['SISUL_NM 가정: 부분일치(전체 값)', 'ok'],
      ['SISUL_NM 가정: 일치(앞부분)', 'fail'], ['SISUL_NM 가정: 부분일치(앞부분)', 'ok'],
    ])
    expect(partial.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '부분일치' }])
    const exact = await runVerify(fakeClient(liveSenior('eq', one)).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 })
    expect(exact.results.map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'],
      ['SISUL_NM 가정: 일치(전체 값)', 'ok'], ['SISUL_NM 가정: 부분일치(전체 값)', 'ok'],
      ['SISUL_NM 가정: 일치(앞부분)', 'ok'], ['SISUL_NM 가정: 부분일치(앞부분)', 'fail'],
    ])
    expect(exact.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '일치' }])
  })

  it('한 글자 값은 앞부분이 같아 두 가정을 가를 수 없으므로 둘 다 맞음이다', async () => {
    const short = [{ SISUL_NM: '가' }, { SISUL_NM: '나' }]
    const m = memoryStore()
    m.seed(SENIOR, [], short)
    const report = await verifyOnly(fakeClient(liveSenior('eq', short)).client, m.store, [SENIOR])
    expect(report.results.map(r => [r.label, r.path, r.status])).toEqual([
      ['인자 없음', [], 'ok'],
      ['SISUL_NM 가정: 일치(전체 값)', ['가'], 'ok'], ['SISUL_NM 가정: 부분일치(전체 값)', ['가'], 'ok'],
    ])
    expect(report.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '둘 다 맞음' }])
  })

  it('결정할 자리의 요청이 모두 건너뛰어지면 근거 없음이다', async () => {
    const m = memoryStore()
    m.seed(SENIOR, [], [{ SISUL_NM: '' }, { SISUL_NM: ' ' }])
    const { client, calls } = fakeClient(r => answer(r.service, [{ SISUL_NM: '' }, { SISUL_NM: ' ' }]))
    const report = await verifyOnly(client, m.store, [SENIOR])
    expect(calls.map(c => c.path)).toEqual([[]])
    expect(report.results.map(r => [r.label, r.status, r.detail])).toEqual([
      ['인자 없음', 'ok', '2건 일치'],
      ['SISUL_NM 가정: 일치', 'skip', NO_VALUE],
      ['SISUL_NM 가정: 부분일치', 'skip', NO_VALUE],
    ])
    expect(report.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '근거 없음' }])
    expect(report.ok).toBe(true)
    const text = formatVerify(report)
    expect(text).toContain(`건너뜀 OdsnBuildingInfo SISUL_NM 가정: 일치: ${NO_VALUE}`)
    expect(text).toContain('OdsnBuildingInfo.SISUL_NM: 근거 없음')
  })

  it('서울 API가 필터를 무시하고 스냅샷에 서로 다른 행이 있으면 어느 가정도 맞지 않아 재현 못 함이다', async () => {
    const two = [{ SISUL_NM: '가나경로당' }, { SISUL_NM: '다라경로당' }]
    const m = memoryStore()
    m.seed(SENIOR, [], two)
    const report = await verifyOnly(fakeClient(r => answer(r.service, two)).client, m.store, [SENIOR])
    expect(report.results.filter(r => r.assume).map(r => r.status)).toEqual(['fail', 'fail', 'fail', 'fail'])
    expect(report.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '재현 못 함' }])
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

  it('요청이 실패하면 거기서 끝내고 그때까지의 결과를 남긴다. 도중에 끊긴 서비스는 판정하지 않는다', async () => {
    const events = [{ CODENAME: '콘서트', TITLE: '서울 재즈 페스티벌' }, { CODENAME: '클래식', TITLE: '부산 실내악' }]
    const m = memoryStore()
    m.seed('culturalEventInfo', [], events)
    m.seed(SENIOR, [], seniors)
    const front = NAME.slice(0, 8)
    const { client, calls } = fakeClient(r => {
      if (r.service === SENIOR && r.path[0] === front) throw new Error('응답 시간 초과(15초) (key=ABCD…(masked))')
      if (r.service === SENIOR) return liveSenior('eq')(r)
      const [code = '', title = ''] = r.path.map(v => v.trim())
      return answer(r.service, events.filter(x => (code === '' || x.CODENAME === code) && x.TITLE.includes(title)))
    })
    const report = await verifyOnly(client, m.store, ['culturalEventInfo', SENIOR])
    expect(report.aborted).toBe('요청 실패(OdsnBuildingInfo SISUL_NM 가정: 일치(앞부분)): 응답 시간 초과(15초) (key=ABCD…(masked))')
    expect(report.ok).toBe(false)
    expect(calls.at(-1)).toEqual({ service: SENIOR, path: [front] })
    expect(report.results.filter(r => r.service === SENIOR).map(r => [r.label, r.status])).toEqual([
      ['인자 없음', 'ok'], ['SISUL_NM 가정: 일치(전체 값)', 'ok'], ['SISUL_NM 가정: 부분일치(전체 값)', 'fail'],
    ])
    expect(report.results.filter(r => r.service === 'culturalEventInfo')).toHaveLength(7)
    // 끝까지 돈 문화행사만 판정한다. 경로당은 전체 값의 결과만으로 일치라고 하지 않는다
    expect(report.decisions).toEqual([{ service: 'culturalEventInfo', field: 'CODENAME', verdict: '일치' }])
  })

  it('스냅샷을 읽지 못한 서비스는 실패 한 줄로 남기고 다음 서비스를 검사한다', async () => {
    const m = memoryStore()
    await m.store.put(snapshotKey(PHARMACY, []), Buffer.from('not gzip'))
    m.seed(SENIOR, [], seniors)
    const { client, calls } = fakeClient(liveSenior('eq'))
    const report = await verifyOnly(client, m.store, [PHARMACY, SENIOR])
    expect(report.results[0]).toMatchObject({ service: PHARMACY, label: '전체', path: [], status: 'fail' })
    expect(report.results[0].detail).toMatch(/^스냅샷을 읽지 못함: \S/)
    expect(report.results.slice(1).map(r => r.service)).toEqual(Array(5).fill(SENIOR))
    expect(calls.every(c => c.service === SENIOR)).toBe(true)
    expect(report.decisions).toEqual([{ service: SENIOR, field: 'SISUL_NM', verdict: '일치' }])
    expect(report.ok).toBe(false)
  })

  it('샘플 키로는 검사하지 않는다', async () => {
    const m = memoryStore()
    await expect(runVerify({ ...fakeClient(livePharmacy).client, isSample: true }, m.store)).rejects.toThrow('샘플 키')
  })

  it('결과를 상태, 서비스, 요청, 설명으로 출력하고 결정할 자리를 따로 모은다', async () => {
    const m = memoryStore()
    m.seed(SENIOR, [], seniors)
    const text = formatVerify(await runVerify(fakeClient(liveSenior('eq')).client, m.store, { only: [SENIOR], now: () => NOW, delayMs: 0 }))
    // 보낸 값은 라벨 뒤 대괄호에 적는다. 인자 없는 요청에는 대괄호가 없다
    expect(text.split('\n')).toContain('  통과 OdsnBuildingInfo 인자 없음: 2건 일치')
    expect(text.split('\n')).toContain(`  실패 OdsnBuildingInfo SISUL_NM 가정: 부분일치(전체 값) [${NAME}]: 전체 건수 다름: 저장소 2, 서울 API 1`)
    expect(text).toContain('OdsnBuildingInfo.SISUL_NM: 일치')
    expect(text).toContain('호출 합계: 3회')
    // 건너뛰는 자리(공백 한 칸)는 _로 적는다
    m.seed(PHARMACY, [], pharmacies)
    const lines = formatVerify(await verifyOnly(fakeClient(livePharmacy).client, m.store, [PHARMACY])).split('\n')
    expect(lines).toContain('  통과 TbPharmacyOperateInfo DUTYNAME만(앞부분) [_, 온누]: 2건 일치')
    expect(lines).toContain('  통과 TbPharmacyOperateInfo 지원 자리 전부 [강남구, 온누리]: 1건 일치')
  })
})
