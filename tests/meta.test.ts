import { describe, it, expect } from 'vitest'
import { CATALOG } from '../src/data/catalog.js'
import { routeFor, clampLimit } from '../src/tools/meta.js'

describe('routeFor', () => {
  it('json+open → getJson', () => {
    const e = CATALOG.find(x => x.id === 'TbPublicWifiInfo')!
    expect(routeFor(e)).toBe('getJson')
  })
  it('xml → getXml', () => {
    const e = CATALOG.find(x => x.id === 'AccInfo')!
    expect(routeFor(e)).toBe('getXml')
  })
  it('subway 엔드포인트 → getSubway', () => {
    const e = CATALOG.find(x => x.id === 'realtimeStationArrival')!
    expect(routeFor(e)).toBe('getSubway')
  })
})

describe('clampLimit', () => {
  it('기본 10, 최대 50', () => {
    expect(clampLimit(undefined)).toBe(10)
    expect(clampLimit(3)).toBe(3)
    expect(clampLimit(500)).toBe(50)
  })
})
