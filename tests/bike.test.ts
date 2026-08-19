import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { unwrap } from '../src/client/response.js'
import { normalizeBikeStations, haversineM } from '../src/normalize/bike.js'
import { num } from '../src/normalize/util.js'
import { SeoulApiClient } from '../src/client/seoulApi.js'
import { InMemoryLedger, keyIdOf } from '../src/client/quota.js'
import { buildServer } from '../src/index.js'

const rows = unwrap('bikeList', JSON.parse(readFileSync('tests/fixtures/bike.json', 'utf8'))).rows

describe('normalizeBikeStations', () => {
  it('대여소 필드 매핑', () => {
    const s = normalizeBikeStations(rows)[0]
    expect(s.name).toBeTruthy()
    expect(typeof s.available).toBe('number')
    expect(typeof s.lat).toBe('number')
  })
  it('모든 필드가 원본 행과 매핑 일치', () => {
    const stations = normalizeBikeStations(rows)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const s = stations[i]
      expect(s.id).toBe(r.stationId ?? '')
      expect(s.name).toBe(r.stationName ?? '')
      expect(s.available).toBe(num(r.parkingBikeTotCnt))
      expect(s.racks).toBe(num(r.rackTotCnt))
      expect(s.ratePct).toBe(num(r.shared))
      expect(s.lat).toBe(num(r.stationLatitude))
      expect(s.lng).toBe(num(r.stationLongitude))
    }
  })
})

describe('haversineM', () => {
  it('서울시청→강남역 약 8.4km(±1km)', () => {
    const d = haversineM(37.5663, 126.9779, 37.4979, 127.0276)
    expect(d).toBeGreaterThan(7_400)
    expect(d).toBeLessThan(9_400)
  })
})

// F1 회귀: fetchAll 기반 tool(get_bike_stations)이 쿼터 소진 note를 응답 envelope까지 승계하는지
// 실제 McpServer ↔ Client(in-memory transport)를 연결해 tool 호출 전체 경로로 검증한다.
describe('get_bike_stations tool — 쿼터 소진 시 note 승계 (F1 회귀)', () => {
  it('콜드 캐시 + 쿼터 소진 상태에서도 notes에 쿼터 안내가 남는다 (빈 결과로 오판되지 않음)', async () => {
    const ledger = new InMemoryLedger(1)
    await ledger.increment(keyIdOf('K')) // 1/1 소진 — 이후 모든 호출이 콜드 캐시 + 소진 상태
    const fetchFn = vi.fn(() => { throw new Error('쿼터 소진 시에는 업스트림 호출이 없어야 한다') })
    const client = new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any, ledger })
    const server = buildServer(client)

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const mcpClient = new Client({ name: 'f1-regression-test', version: '0' })
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)])

    const res = await mcpClient.callTool({ name: 'get_bike_stations', arguments: { query: '존재하지않는대여소' } })
    const body = JSON.parse((res.content as Array<{ type: string; text: string }>)[0].text)

    expect(fetchFn).not.toHaveBeenCalled() // 소진 상태이므로 캐시 미스가 업스트림을 두드리지 않음
    expect(body.data.stations).toEqual([]) // 대여소는 못 찾았지만
    expect(body.notes.some((n: string) => n.includes('쿼터'))).toBe(true) // "없다"가 아니라 "쿼터 소진"이 고지돼야 함
  })
})
