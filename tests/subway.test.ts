import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unwrap } from '../src/client/response.js'
import { normalizeArrivals, LINE_NAMES } from '../src/normalize/subway.js'

const rows = unwrap('realtimeStationArrival', JSON.parse(readFileSync('tests/fixtures/subway.json', 'utf8'))).rows

describe('normalizeArrivals', () => {
  it('subwayId를 호선명으로 변환', () => {
    const a = normalizeArrivals(rows)
    expect(a.length).toBeGreaterThan(0)
    expect(a[0].line).toMatch(/호선|선|GTX/)
  })
  it('도착까지 초를 숫자로', () => {
    const a = normalizeArrivals(rows)
    expect(a.every(x => x.secondsToArrival === null || typeof x.secondsToArrival === 'number')).toBe(true)
  })
  it('알 수 없는 subwayId는 원본 코드 유지', () => {
    expect(normalizeArrivals([{ subwayId: '9999', barvlDt: '0' }])[0].line).toBe('9999')
  })
  it('LINE_NAMES에 1~9호선 존재', () => {
    expect(LINE_NAMES['1002']).toBe('2호선')
    expect(LINE_NAMES['1009']).toBe('9호선')
  })
})
