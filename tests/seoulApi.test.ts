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
    const { rows, note } = await c.fetchAll('bikeList', { max: 10, pageSize: 2 })
    expect(rows.map(r => r.i)).toEqual([1, 2, 3, 4, 5])
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(note).toBeUndefined()
  })

  it('fetchAll은 두 페이지에서 동일한 note가 반복돼도 중복 없이 1회만 남긴다 (dedupe)', async () => {
    const { InMemoryLedger } = await import('../src/client/quota.js')
    let t = 0
    const ledger = new InMemoryLedger(2)
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(standardPage([{ i: 1 }, { i: 2 }], 4))
      .mockResolvedValueOnce(standardPage([{ i: 3 }, { i: 4 }], 4))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger, now: () => t })
    // 두 페이지를 미리 캐시에 적재 — 이 두 호출로 쿼터 2/2 소진
    await c.getJson('bikeList', 1, 2)
    await c.getJson('bikeList', 3, 4)
    t = 300_001 // soft TTL(300s) 경과, 두 캐시 항목 모두 storedAt=0이라 경과분(ageMin)이 동일해짐
    const { rows, note } = await c.fetchAll('bikeList', { max: 4, pageSize: 2 })
    expect(rows.map(r => r.i)).toEqual([1, 2, 3, 4]) // 소진 상태에서도 stale 캐시로 두 페이지 모두 서빙
    expect(fetchFn).toHaveBeenCalledTimes(2) // fetchAll 단계에서는 업스트림 재호출 없음
    expect(note).toContain('쿼터 소진')
    expect(note?.split(' | ')).toHaveLength(1) // 동일 텍스트가 두 페이지에서 반복돼도 중복 이어붙지 않음
  })

  it('fetchAll은 서로 다른 note가 페이지마다 나오면 | 로 병합한다', async () => {
    const { InMemoryLedger, keyIdOf } = await import('../src/client/quota.js')
    const ledger = new InMemoryLedger(5)
    for (let i = 0; i < 4; i++) await ledger.increment(keyIdOf('K')) // 4/5 = 80%
    const fetchFn = vi.fn().mockResolvedValueOnce(standardPage([{ i: 1 }, { i: 2 }], 4)) // 2페이지째는 소진되어 업스트림 호출 없음
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger })
    const { rows, note } = await c.fetchAll('bikeList', { max: 4, pageSize: 2 })
    expect(rows.map(r => r.i)).toEqual([1, 2]) // 1페이지만 성공, 2페이지는 소진으로 빈 결과
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(note).toContain('80%') // 1페이지: 경고 note
    expect(note).toContain('소진') // 2페이지: 소진 note — 서로 다른 note가 | 로 병합됨
    expect(note?.split(' | ')).toHaveLength(2)
  })

  it('HTTP 5xx는 1회 재시도 후 성공하면 정상 반환', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    const u = await c.getJson('bikeList', 1, 5)
    expect(u.rows).toHaveLength(1)
  })

  it('5xx 응답은 본문을 정리(cancel)한 뒤 retryDelayMs만큼 기다렸다가 재시도한다', async () => {
    const failed = new Response('oops', { status: 503 })
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, retryDelayMs: 60 })
    const t0 = Date.now()
    await c.getJson('bikeList', 1, 5)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50)
    expect(failed.bodyUsed).toBe(true) // 버린 응답 본문이 커넥션을 붙잡지 않도록 정리됨
  })

  it('타임아웃은 재시도하지 않고 TIMEOUT 코드로 즉시 실패한다 (최악 대기 = timeoutMs 1회)', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'SECRETKEY123', fetchFn: fetchFn as any, retryDelayMs: 0 })
    const err = await c.getJson('bikeList', 1, 5).catch(e => e)
    expect(err).toMatchObject({ name: 'SeoulApiError', code: 'TIMEOUT' })
    expect(err.message).not.toContain('SECRETKEY123')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('타임아웃이 아닌 네트워크 오류는 1회 재시도한다', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, retryDelayMs: 0 })
    const u = await c.getJson('bikeList', 1, 5)
    expect(u.rows).toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('결과와 캐시 항목에 원본 payload(raw)를 싣지 않는다 — 메모리·L2 항목 크기 절감', async () => {
    const stored: any[] = []
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })
    c.attachL2({ async get() { return undefined }, async set(_k, e) { stored.push(e) } })
    const u = await c.getJson('bikeList', 1, 5)
    expect(u).not.toHaveProperty('raw')
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored[0])).not.toContain('list_total_count') // 봉투 원문이 L2에 실리지 않음
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
    const { rows } = await c.fetchAll('bikeList', { max: 3000, pageSize: 1000 })
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
    expect(SOFT_TTL['IndividuallyPostedLandPriceService']).toBe(86_400_000) // 연 1회 공시
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

  it('지하철 키와 일반 키는 쿼터 카운터가 독립적이다', async () => {
    const { InMemoryLedger } = await import('../src/client/quota.js')
    const ledger = new InMemoryLedger(1) // 키당 하루 1회
    const fetchFn = vi.fn().mockResolvedValue(standardPage([{ a: 1 }], 1))
    const c = new SeoulApiClient({ apiKey: 'GENKEY', subwayApiKey: 'SUBKEY', fetchFn: fetchFn as any, ledger })

    await c.getJson('bikeList', 1, 5) // 일반 키 1/1 소진
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const generalExhausted = await c.getJson('GetParkingInfo', 1, 5) // 일반 키 소진, 캐시 없음 → 빈 결과
    expect(generalExhausted.rows).toHaveLength(0)
    expect(generalExhausted.note).toContain('쿼터')
    expect(fetchFn).toHaveBeenCalledTimes(1) // 업스트림 호출 없음 — 일반 키 소진 확인

    const subwayPayload = { errorMessage: { status: 200, code: 'INFO-000', message: 'ok', total: 1 }, realtimeArrivalList: [{ x: 1 }] }
    fetchFn.mockResolvedValue(new Response(JSON.stringify(subwayPayload), { status: 200, headers: { 'content-type': 'application/json' } }))
    const subwayFresh = await c.getSubway('realtimeStationArrival', 0, 5, ['강남']) // 지하철 키는 별도 카운터라 소진 영향 없음
    expect(subwayFresh.rows).toHaveLength(1)
    expect(subwayFresh.note).toBeUndefined()
    expect(fetchFn).toHaveBeenCalledTimes(2) // 지하철 키 요청은 업스트림까지 도달
  })
})
