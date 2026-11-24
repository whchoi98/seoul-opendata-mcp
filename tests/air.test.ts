import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeAir } from '../src/normalize/air.js'
import { num } from '../src/normalize/util.js'
import { callTool, rowsUpstream } from './helpers/mcp.js'

const rows = unwrap('RealtimeCityAir', JSON.parse(readFileSync('tests/fixtures/air.json', 'utf8'))).rows

describe('normalizeAir', () => {
  it('자치구/권역/등급 매핑', () => {
    const a = normalizeAir(rows)[0]
    expect(a.district).toBeTruthy()
    expect(a.region).toBeTruthy()
    expect(['좋음', '보통', '나쁨', '매우나쁨', '']).toContain(a.grade)
  })
  it('PM 수치 숫자화', () => {
    const a = normalizeAir(rows)[0]
    expect(a.pm10 === null || typeof a.pm10 === 'number').toBe(true)
  })
  it('모든 필드가 원본 행과 매핑 일치', () => {
    const airQualities = normalizeAir(rows)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const a = airQualities[i]
      expect(a.region).toBe(r.SAREA_NM ?? '')
      expect(a.district).toBe(r.MSRSTN_NM ?? '')
      // 통합지수 등급이 빈 행의 0은 측정값 없음이다
      const noIndex = (r.CAI_GRD ?? '') === ''
      const measured = (v: unknown) => (noIndex && num(v) === 0 ? null : num(v))
      expect(a.pm10).toBe(measured(r.PM))
      expect(a.pm25).toBe(measured(r.FPM))
      expect(a.ozone).toBe(num(r.OZON))
      expect(a.no2).toBe(num(r.NTDX))
      expect(a.co).toBe(num(r.CBMX))
      expect(a.so2).toBe(num(r.SPDX))
      expect(a.grade).toBe(r.CAI_GRD ?? '')
      expect(a.index).toBe(measured(r.CAI_IDX))
      expect(a.mainPollutant).toBe(r.CRST_SBSTN ?? '')
      expect(a.measuredAt).toBe(String(r.MSRMT_DT ?? ''))
    }
  })
})

const row = (over: Record<string, unknown> = {}) => ({
  MSRMT_DT: '202611242000', SAREA_NM: '동남권', MSRSTN_NM: '강남구', PM: 12, FPM: 5,
  OZON: 0.028, NTDX: 0.009, CBMX: 0.3, SPDX: 0.002, CAI_GRD: '좋음', CAI_IDX: 46, CRST_SBSTN: 'O3', ...over,
})
// 2026-11-24 20시 양천구 실제 응답: 미세먼지와 통합지수가 0이고 등급이 비어 있었다
const missingRow = row({ SAREA_NM: '서남권', MSRSTN_NM: '양천구', PM: 0, FPM: 0, OZON: 0.022, CAI_GRD: '', CAI_IDX: 0, CRST_SBSTN: '' })

describe('미세먼지 등급(환경부 예보 등급 구간)', () => {
  it.each([[30, '좋음'], [31, '보통'], [80, '보통'], [81, '나쁨'], [150, '나쁨'], [151, '매우나쁨']])('PM10 %i는 %s', (pm, grade) => {
    expect(normalizeAir([row({ PM: pm })])[0].pm10Grade).toBe(grade)
  })

  it.each([[15, '좋음'], [16, '보통'], [35, '보통'], [36, '나쁨'], [75, '나쁨'], [76, '매우나쁨']])('PM2.5 %i는 %s', (pm, grade) => {
    expect(normalizeAir([row({ FPM: pm })])[0].pm25Grade).toBe(grade)
  })

  it('통합지수 등급과 따로 계산한다', () => {
    // 오존 때문에 통합지수가 보통이어도 미세먼지는 좋음일 수 있다
    const a = normalizeAir([row({ CAI_GRD: '보통', CAI_IDX: 70, CRST_SBSTN: 'O3' })])[0]
    expect(a.grade).toBe('보통')
    expect(a.pm10Grade).toBe('좋음')
    expect(a.pm25Grade).toBe('좋음')
  })
})

describe('측정값이 빠진 측정소', () => {
  it('통합지수 등급이 빈 행의 0은 값 없음으로 본다', () => {
    const a = normalizeAir([missingRow])[0]
    expect(a.pm10).toBeNull()
    expect(a.pm25).toBeNull()
    expect(a.index).toBeNull()
    expect(a.pm10Grade).toBe('')
    expect(a.pm25Grade).toBe('')
    expect(a.ozone).toBe(0.022)
  })

  it('등급이 있는 행의 0은 측정값이므로 그대로 둔다', () => {
    const a = normalizeAir([row({ PM: 0 })])[0]
    expect(a.pm10).toBe(0)
    expect(a.pm10Grade).toBe('좋음')
  })
})

describe('get_air_quality tool', () => {
  it('미세먼지 등급을 함께 주고 통합지수 등급과 구분해 안내한다', async () => {
    const { fetchFn } = rowsUpstream(() => ({ rows: [row()] }))
    const body = await callTool(fetchFn, 'get_air_quality', { district: '강남구' })
    expect(body.data.airQuality[0]).toMatchObject({ pm10: 12, pm10Grade: '좋음', pm25: 5, pm25Grade: '좋음', grade: '좋음', mainPollutant: 'O3' })
    const notes = body.notes.join(' ')
    expect(notes).toContain('통합대기환경지수')
    expect(notes).toContain('PM10은 30, 80, 150')
    expect(notes).toContain('PM2.5는 15, 35, 75')
  })

  it('측정값이 빠진 자치구를 이름으로 알린다', async () => {
    const { fetchFn } = rowsUpstream(() => ({ rows: [row(), missingRow] }))
    const body = await callTool(fetchFn, 'get_air_quality', {})
    expect(body.data.airQuality[1]).toMatchObject({ district: '양천구', pm10: null, pm25: null })
    expect(body.notes).toContain('미세먼지 측정값이 없는 자치구: 양천구. 원본이 0과 빈 등급이라 null로 표시했습니다.')
  })

  it('빠진 자치구가 없으면 그 안내를 붙이지 않는다', async () => {
    const { fetchFn } = rowsUpstream(() => ({ rows: [row()] }))
    const body = await callTool(fetchFn, 'get_air_quality', {})
    expect(body.notes.join(' ')).not.toContain('측정값이 없는 자치구')
  })

  it('장소 단위는 get_weather를 쓰라고 설명에 적는다', async () => {
    const { buildServer } = await import('../src/index.js')
    const { SeoulApiClient } = await import('../src/client/seoulApi.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const mcp = new Client({ name: 'tool-test', version: '0' })
    await Promise.all([buildServer(new SeoulApiClient({ apiKey: 'K' })).connect(st), mcp.connect(ct)])
    const tool = (await mcp.listTools()).tools.find(t => t.name === 'get_air_quality')
    expect(tool?.description).toContain('get_weather')
  })
})
