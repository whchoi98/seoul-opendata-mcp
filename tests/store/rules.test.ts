import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CATALOG } from '../../src/data/catalog.js'
import { unwrap } from '../../src/client/response.js'
import { STORE_RULES } from '../../src/store/rules.js'

const entry = (id: string) => CATALOG.find(e => e.id === id)
const services = Object.keys(STORE_RULES)
// 스펙 §1.3: 실시간 12종과 부동산 3종은 저장소를 지나간다
const EXCLUDED = [
  'citydata', 'citydata_ppltn', 'citydata_cmrcl', 'LIVE_DST_MESSAGE', 'bikeList', 'GetParkingInfo', 'RealtimeCityAir',
  'realtimeStationArrival', 'AccInfo', 'TimeAverageAirQuality', 'AiRainfallService', 'ListRiverStageService',
  'tbLnOpendataRtmsV', 'tbLnOpendataRentV', 'IndividuallyPostedLandPriceService',
]
// 카탈로그에 자리가 없고 tool이 직접 /{CODENAME}/{TITLE}/{DATE}를 만드는 서비스
const SLOTS_NOT_IN_CATALOG = ['culturalEventInfo']

describe('STORE_RULES', () => {
  it('대상은 37종이고 제외 15종과 합치면 카탈로그 52종이다', () => {
    expect(services).toHaveLength(37)
    expect(EXCLUDED).toHaveLength(15)
    expect([...services, ...EXCLUDED].sort()).toEqual(CATALOG.map(e => e.id).sort())
  })

  it('규칙이 있는 서비스는 모두 일반 API의 JSON 서비스다', () => {
    for (const id of services) {
      expect(entry(id), id).toBeDefined()
      expect(entry(id)!.endpoint, id).toBe('open')
      expect(entry(id)!.responseType, id).toBe('json')
    }
  })

  it('자리 수와 필드 이름이 카탈로그의 pathParams와 같다(문화행사만 규칙 표가 자리를 정의)', () => {
    for (const id of services) {
      const fields = STORE_RULES[id].slots.map(s => s.field)
      if (SLOTS_NOT_IN_CATALOG.includes(id)) {
        expect(entry(id)!.pathParams, id).toEqual([])
        expect(fields).toEqual(['CODENAME', 'TITLE', 'DATE'])
        expect(STORE_RULES[id].examples).toHaveLength(3)
      } else {
        expect(fields, id).toEqual(entry(id)!.pathParams.map(p => p.name))
      }
    }
  })

  it('파티션 자리는 항상 맨 앞에 모여 있고 파티션 계획과 짝이 맞는다', () => {
    for (const id of services) {
      const r = STORE_RULES[id]
      const kinds = r.slots.map(s => s.kind)
      const n = kinds.filter(k => k === 'partition').length
      expect(kinds.slice(0, n).every(k => k === 'partition'), id).toBe(true)
      expect(r.partitions !== undefined, id).toBe(n > 0)
    }
  })

  it('모든 규칙에 묶음, 범위, 기한, 스냅샷당 호출 수가 있다', () => {
    for (const id of services) {
      const r = STORE_RULES[id]
      expect(['daily', 'static'], id).toContain(r.bundle)
      expect(['full', 'head'], id).toContain(r.scope)
      expect(r.maxAgeMs === null || r.maxAgeMs > 0, id).toBe(true)
      expect(r.callsPerSnapshot, id).toBeGreaterThan(0)
    }
  })

  it('묶음별 개수와 예상 호출 수가 스펙 §2.2와 같다', () => {
    const of = (f: (id: string) => boolean) => services.filter(f)
    const plain = of(id => !STORE_RULES[id].partitions)
    const full = plain.filter(id => STORE_RULES[id].scope === 'full')
    const head = plain.filter(id => STORE_RULES[id].scope === 'head')
    expect(full).toHaveLength(12)
    expect(head).toHaveLength(19)
    expect(full.reduce((n, id) => n + STORE_RULES[id].callsPerSnapshot, 0)).toBe(42)
    expect(head.every(id => STORE_RULES[id].callsPerSnapshot === 1 && STORE_RULES[id].slots.length === 0)).toBe(true)
    expect(of(id => STORE_RULES[id].bundle === 'daily' && !!STORE_RULES[id].partitions).sort())
      .toEqual(['CardBusStatisticsServiceNew', 'CardSubwayStatsNew', 'CardSubwayTime', 'SPOP_LOCAL_RESD_DONG'])
    expect(of(id => STORE_RULES[id].bundle === 'static').sort())
      .toEqual(['SearchFirstAndLastTrainbyLineServiceNew', 'SearchSTNTimeTableByIDService'])
    expect(STORE_RULES.SPOP_LOCAL_RESD_DONG.callsPerSnapshot).toBe(11)
    expect(STORE_RULES.CardBusStatisticsServiceNew.scope).toBe('head')
  })

  it('기한이 스펙 §6.3과 같다', () => {
    const DAY = 86_400_000
    const age = (id: string) => STORE_RULES[id].maxAgeMs
    for (const id of services.filter(s => s.startsWith('ListPublicReservation'))) expect(age(id), id).toBe(DAY)
    expect(age('culturalEventInfo')).toBe(3 * DAY)
    expect(age('SeoulMetroFaciInfo')).toBe(3 * DAY)
    expect(age('TbPharmacyOperateInfo')).toBe(7 * DAY)
    expect(age('goodPrices')).toBe(7 * DAY)
    expect(age('SearchFirstAndLastTrainbyLineServiceNew')).toBe(30 * DAY)
    expect(age('SearchSTNTimeTableByIDService')).toBe(30 * DAY)
    for (const id of ['CardSubwayStatsNew', 'CardSubwayTime', 'SPOP_LOCAL_RESD_DONG', 'CardBusStatisticsServiceNew']) {
      expect(age(id), id).toBeNull()
    }
  })

  it('검증으로 정하지 못한 자리만 미지원으로 남는다', () => {
    const undecided = services.flatMap(id =>
      STORE_RULES[id].slots.filter(s => s.kind === 'unsupported' && s.decide).map(s => `${id}.${s.field}`))
    expect(undecided.sort()).toEqual(['ListPublicReservationEducation.USETGTINFO', 'culturalEventInfo.CODENAME'])
    // 2026-11-22 첫 실제 검사로 정한 자리(스펙 §4.2)
    const slot = (id: string, field: string) => STORE_RULES[id].slots.find(s => s.field === field)
    expect(slot('ListPublicReservationEducation', 'AREANM')).toEqual({ field: 'AREANM', kind: 'contains' })
    expect(slot('OdsnBuildingInfo', 'SISUL_NM')).toEqual({ field: 'SISUL_NM', kind: 'contains' })
    expect(slot('GetParkInfo', 'PRK_NOW_INFO_PVSN_YN')).toEqual({ field: 'PRK_NOW_INFO_PVSN_YN', kind: 'unsupported' })
    expect(slot('culturalEventInfo', 'TITLE')).toEqual({ field: 'TITLE', kind: 'unsupported' })
  })

  it('필터와 파티션 필드가 픽스처의 실제 행에 있다', () => {
    const fixtures: Record<string, string> = {
      TbPharmacyOperateInfo: 'pharmacy.json', GetParkInfo: 'parkinfo.json', culturalEventInfo: 'culture.json',
      SearchInfoBySubwayNameService: 'subway_station.json', ListPublicReservationSport: 'reservation.json',
      CardSubwayStatsNew: 'subway_stats.json', CardBusStatisticsServiceNew: 'bus_stats.json',
      CardSubwayTime: 'subway_hourly.json', SPOP_LOCAL_RESD_DONG: 'living_pop.json',
      SearchFirstAndLastTrainbyLineServiceNew: 'subway_firstlast.json', SearchSTNTimeTableByIDService: 'subway_timetable.json',
    }
    for (const [id, file] of Object.entries(fixtures)) {
      const row = unwrap(id, JSON.parse(readFileSync(`tests/fixtures/${file}`, 'utf8'))).rows[0]
      for (const slot of STORE_RULES[id].slots) expect(row, `${id}.${slot.field}`).toHaveProperty(slot.field)
    }
  })
})
