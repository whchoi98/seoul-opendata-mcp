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
})
