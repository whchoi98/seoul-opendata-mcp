import { describe, it, expect, vi } from 'vitest'
import { SeoulApiClient } from '../src/client/seoulApi.js'

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const standardPage = (rows: any[], total: number) =>
  jsonResponse({ bikeList: { list_total_count: total, RESULT: { CODE: 'INFO-000', MESSAGE: 'ok' }, row: rows } })

describe('SeoulApiClient', () => {
  it('키 미설정 시 sample 폴백 + isSample=true', () => {
    delete process.env.SEOUL_API_KEY
    const c = new SeoulApiClient({ fetchFn: vi.fn() as any })
    expect(c.isSample).toBe(true)
  })

  it('빈 문자열 apiKey는 sample 폴백 + isSample=true', () => {
    const c = new SeoulApiClient({ apiKey: '', fetchFn: vi.fn() as any })
    expect(c.isSample).toBe(true)
  })

  it('공백뿐인 apiKey도 sample 폴백 + isSample=true', () => {
    const c = new SeoulApiClient({ apiKey: '  ', fetchFn: vi.fn() as any })
    expect(c.isSample).toBe(true)
  })

  it('URL을 {base}/{key}/{type}/{service}/{start}/{end}/{path...}로 조립하고 경로를 인코딩한다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ 'SeoulRtd.citydata_ppltn': [{ AREA_NM: '강남역' }] }))
    const c = new SeoulApiClient({ apiKey: 'MYKEY', fetchFn: fetchFn as any })
    await c.getJson('citydata_ppltn', 1, 5, ['강남역'])
    const url: string = fetchFn.mock.calls[0][0]
    expect(url).toBe(`http://openapi.seoul.go.kr:8088/MYKEY/json/citydata_ppltn/1/5/${encodeURIComponent('강남역')}`)
  })

  it('동일 URL 재호출은 TTL 내 캐시를 사용한다', async () => {
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    await c.getJson('bikeList', 1, 5)
    await c.getJson('bikeList', 1, 5)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('fetchAll은 pageSize 단위로 totalCount까지 순회해 병합한다', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(standardPage([{ i: 1 }, { i: 2 }], 5))
      .mockResolvedValueOnce(standardPage([{ i: 3 }, { i: 4 }], 5))
      .mockResolvedValueOnce(standardPage([{ i: 5 }], 5))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    const rows = await c.fetchAll('bikeList', { max: 10, pageSize: 2 })
    expect(rows.map(r => r.i)).toEqual([1, 2, 3, 4, 5])
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('HTTP 5xx는 1회 재시도 후 성공하면 정상 반환', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    const u = await c.getJson('bikeList', 1, 5)
    expect(u.rows).toHaveLength(1)
  })

  it('에러 메시지에서 키가 마스킹된다', () => {
    const c = new SeoulApiClient({ apiKey: 'SECRETKEY123', fetchFn: vi.fn() as any })
    expect(c.maskedKey()).toBe('SECR…(masked)')
  })

  it('JSON 요청에 XML 에러가 오면 폴백 파싱해 SeoulApiError로 변환', async () => {
    // 호출 제한 시 실제 응답: JSON 엔드포인트인데 XML 에러 반환
    const xmlError = '<RESULT><CODE>ERROR-337</CODE><MESSAGE>샘플키는 초당 요청 제한이 있습니다.</MESSAGE></RESULT>'
    const fetchFn = vi.fn().mockResolvedValue(new Response(xmlError, { status: 200 }))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    await expect(c.getJson('bikeList', 1, 5)).rejects.toMatchObject({ name: 'SeoulApiError', code: 'ERROR-337' })
  })

  it('JSON도 XML도 아닌 응답은 PARSE 코드의 SeoulApiError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not json at all', { status: 200 }))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    await expect(c.getJson('bikeList', 1, 5)).rejects.toMatchObject({ name: 'SeoulApiError', code: 'PARSE' })
  })

  it('샘플 키는 요청 범위를 5건으로 클램프한다 (ERROR-335 회피)', async () => {
    delete process.env.SEOUL_API_KEY
    const page = { culturalEventInfo: { list_total_count: 1, RESULT: { CODE: 'INFO-000', MESSAGE: 'ok' }, row: [{ a: 1 }] } }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(page))
    const c = new SeoulApiClient({ fetchFn: fetchFn as any })
    expect(c.isSample).toBe(true)
    await c.getJson('culturalEventInfo', 1, 500)
    expect(fetchFn.mock.calls[0][0]).toMatch(/\/culturalEventInfo\/1\/5$/)
  })

  it('샘플 키의 fetchAll은 최대 5건 단일 페이지로 동작', async () => {
    delete process.env.SEOUL_API_KEY
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }, { i: 5 }], 122))
    const c = new SeoulApiClient({ fetchFn: fetchFn as any })
    const rows = await c.fetchAll('bikeList', { max: 3000, pageSize: 1000 })
    expect(rows).toHaveLength(5)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][0]).toContain('/bikeList/1/5')
  })

  it('지하철 키 폴백 체인: 전용 → 일반 → sample', () => {
    delete process.env.SEOUL_API_KEY
    delete process.env.SEOUL_SUBWAY_API_KEY
    const dedicated = new SeoulApiClient({ apiKey: 'GEN', subwayApiKey: 'SUB', fetchFn: vi.fn() as any })
    expect(dedicated.maskedSubwayKey()).toBe('SUB…(masked)')
    const inherited = new SeoulApiClient({ apiKey: 'GEN', fetchFn: vi.fn() as any })
    expect(inherited.maskedSubwayKey()).toBe('GEN…(masked)')
    const sample = new SeoulApiClient({ fetchFn: vi.fn() as any })
    expect(sample.maskedSubwayKey()).toBe('sample')
  })

  it('getSubway는 subwayKey로 URL을 만든다', async () => {
    const payload = { errorMessage: { status: 200, code: 'INFO-000', message: 'ok', total: 0 }, realtimeArrivalList: [] }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload))
    const c = new SeoulApiClient({ apiKey: 'GEN', subwayApiKey: 'SUBKEY', fetchFn: fetchFn as any })
    await c.getSubway('realtimeStationArrival', 0, 5, ['강남'])
    expect(fetchFn.mock.calls[0][0]).toContain('/SUBKEY/json/')
    expect(fetchFn.mock.calls[0][0]).not.toContain('/GEN/')
  })

  it('SOFT_TTL 정렬: citydata 계열 300s, 배치 통계 24h, 기본 1h', async () => {
    const { SOFT_TTL, DEFAULT_SOFT_TTL } = await import('../src/client/seoulApi.js')
    expect(SOFT_TTL['citydata']).toBe(300_000)
    expect(SOFT_TTL['citydata_ppltn']).toBe(300_000)
    expect(SOFT_TTL['realtimeStationArrival']).toBe(15_000)
    expect(SOFT_TTL['CardSubwayStatsNew']).toBe(86_400_000)
    expect(SOFT_TTL['SPOP_LOCAL_RESD_DONG']).toBe(86_400_000)
    expect(SOFT_TTL['tbLnOpendataRtmsV']).toBe(21_600_000)
    expect(SOFT_TTL['culturalEventInfo']).toBe(21_600_000)
    expect(SOFT_TTL['TbPharmacyOperateInfo']).toBe(86_400_000)
    expect(SOFT_TTL['AccInfo']).toBe(300_000)
    expect(SOFT_TTL['TimeAverageAirQuality']).toBe(3_600_000)
    expect(DEFAULT_SOFT_TTL).toBe(3_600_000)
  })

  it('stale-while-revalidate: soft 만료 시 stale 즉시 반환 + note + 백그라운드 1회 갱신', async () => {
    let t = 0
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(standardPage([{ v: 1 }], 1))
      .mockResolvedValueOnce(standardPage([{ v: 2 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, now: () => t })
    await c.getJson('bikeList', 1, 5)                     // 미스 → fetch #1
    t = 300_001                                            // bikeList soft 300s 초과
    const stale = await c.getJson('bikeList', 1, 5)        // stale 즉시 반환
    expect(stale.rows[0].v).toBe(1)
    expect(stale.note).toContain('캐시된 데이터')
    await new Promise(r => setTimeout(r, 20))              // 백그라운드 갱신 완료 대기
    expect(fetchFn).toHaveBeenCalledTimes(2)               // fetch #2 (갱신)
    const fresh = await c.getJson('bikeList', 1, 5)        // 갱신본이 fresh로 서빙
    expect(fresh.rows[0].v).toBe(2)
    expect(fresh.note).toBeUndefined()
  })

  it('single-flight: 동일 URL 동시 5회 요청은 업스트림 1회', async () => {
    let resolveFetch!: (r: Response) => void
    const fetchFn = vi.fn().mockReturnValue(new Promise<Response>(res => { resolveFetch = res }))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    const calls = Promise.all(Array.from({ length: 5 }, () => c.getJson('bikeList', 1, 5)))
    await new Promise(r => setTimeout(r, 10))
    resolveFetch(standardPage([{ a: 1 }], 1))
    const results = await calls
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(results.every(u => u.rows.length === 1)).toBe(true)
  })

  it('쿼터 80% 이상이면 fresh 응답에도 경고 note', async () => {
    const { InMemoryLedger } = await import('../src/client/quota.js')
    const ledger = new InMemoryLedger(5)
    for (let i = 0; i < 4; i++) await ledger.increment((await import('../src/client/quota.js')).keyIdOf('K'))
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger })
    const u = await c.getJson('bikeList', 1, 5) // 5번째 호출 = 100%... 아님: 호출 전 4/5=80%
    expect(u.note).toContain('쿼터')
  })

  it('쿼터 소진 시: 캐시 있으면 stale 서빙, 없으면 빈 결과 + 안내(에러 아님)', async () => {
    const { InMemoryLedger, keyIdOf } = await import('../src/client/quota.js')
    let t = 0
    const ledger = new InMemoryLedger(1)
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger, now: () => t })
    await c.getJson('bikeList', 1, 5)            // 1/1 소진
    t = 300_001                                   // soft 만료 → stale
    const stale = await c.getJson('bikeList', 1, 5)
    expect(stale.rows).toHaveLength(1)
    expect(stale.note).toContain('쿼터')          // 소진 상태에서 stale 서빙 안내
    expect(fetchFn).toHaveBeenCalledTimes(1)      // 백그라운드 갱신도 억제
    const miss = await c.getJson('GetParkingInfo', 1, 5) // 캐시 없음 → 빈 결과
    expect(miss.rows).toHaveLength(0)
    expect(miss.note).toContain('쿼터')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
