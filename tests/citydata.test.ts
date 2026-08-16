import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { unwrap } from '../src/client/response.js'
import { extractRoadTraffic, extractWeather, extractSnapshot, extractDisasterAlerts } from '../src/normalize/citydata.js'

const parsed = new XMLParser({ ignoreDeclaration: true }).parse(readFileSync('tests/fixtures/citydata.xml', 'utf8'))
const citydata = unwrap('citydata', parsed).rows[0]

// 파싱된 픽스처의 실제(이중 중첩) 노드 — mapping-equality 비교 기준
const rawAvgRoad = citydata.ROAD_TRAFFIC_STTS.AVG_ROAD_DATA
const rawAccidents = citydata.ACDNT_CNTRL_STTS.ACDNT_CNTRL_STTS
const rawWeather = citydata.WEATHER_STTS.WEATHER_STTS
const rawEvents = citydata.EVENT_STTS.EVENT_STTS
const rawPpltn = citydata.LIVE_PPLTN_STTS.LIVE_PPLTN_STTS

describe('citydata extractors', () => {
  it('도로소통: 평균속도 숫자 + 메시지', () => {
    const r = extractRoadTraffic(citydata)
    expect(typeof r.message).toBe('string')
    expect(r.averageSpeedKmh === null || typeof r.averageSpeedKmh === 'number').toBe(true)
  })

  it('날씨: 기온/미세먼지 숫자화', () => {
    const w = extractWeather(citydata)
    expect(w.temperatureC === null || typeof w.temperatureC === 'number').toBe(true)
    expect(w.pm10 === null || typeof w.pm10 === 'number').toBe(true)
  })

  it('스냅샷: 인구+날씨요약+행사 목록', () => {
    const s = extractSnapshot(citydata)
    expect(s.place).toBe('광화문·덕수궁')
    expect(s.population.congestionLevel).toBeTruthy()
    expect(Array.isArray(s.events)).toBe(true)
  })

  // 재캡처 안전: 값을 하드코딩하지 않고 파싱된 원본 노드와의 매핑을 검증
  it('도로소통: 모든 필드가 AVG_ROAD_DATA / ACDNT_CNTRL_STTS와 매핑 일치', () => {
    const r = extractRoadTraffic(citydata)
    expect(r.message).toBe(rawAvgRoad.ROAD_MSG ?? '')
    expect(r.index).toBe(rawAvgRoad.ROAD_TRAFFIC_IDX ?? '')
    expect(r.averageSpeedKmh).toBe(rawAvgRoad.ROAD_TRAFFIC_SPD == null ? null : Number(rawAvgRoad.ROAD_TRAFFIC_SPD))
    expect(r.measuredAt).toBe(rawAvgRoad.ROAD_TRAFFIC_TIME ?? '')
    expect(r.incidents.length).toBe(rawAccidents.length)
    rawAccidents.forEach((a: any, i: number) => {
      expect(r.incidents[i].type).toBe(a.ACDNT_TYPE ?? '')
      expect(r.incidents[i].detail).toBe(a.ACDNT_DTYPE ?? '')
      expect(r.incidents[i].occurredAt).toBe(a.ACDNT_OCCR_DT ?? '')
      expect(r.incidents[i].message).toBe(a.ACDNT_INFO ?? '')
    })
  })

  it('날씨: 모든 필드가 WEATHER_STTS와 매핑 일치', () => {
    const w = extractWeather(citydata)
    expect(w.temperatureC).toBe(rawWeather.TEMP == null ? null : Number(rawWeather.TEMP))
    expect(w.maxTempC).toBe(rawWeather.MAX_TEMP == null ? null : Number(rawWeather.MAX_TEMP))
    expect(w.minTempC).toBe(rawWeather.MIN_TEMP == null ? null : Number(rawWeather.MIN_TEMP))
    expect(w.humidityPct).toBe(rawWeather.HUMIDITY == null ? null : Number(rawWeather.HUMIDITY))
    expect(w.precipitation).toBe(String(rawWeather.PRECIPITATION ?? ''))
    expect(w.precipitationType).toBe(rawWeather.PRECPT_TYPE ?? '')
    expect(w.precipitationMessage).toBe(rawWeather.PCP_MSG ?? '')
    expect(w.sunrise).toBe(String(rawWeather.SUNRISE ?? ''))
    expect(w.sunset).toBe(String(rawWeather.SUNSET ?? ''))
    expect(w.uvLevel).toBe(String(rawWeather.UV_INDEX_LVL ?? ''))
    expect(w.pm10).toBe(rawWeather.PM10 == null ? null : Number(rawWeather.PM10))
    expect(w.pm10Level).toBe(rawWeather.PM10_INDEX ?? '')
    expect(w.pm25).toBe(rawWeather.PM25 == null ? null : Number(rawWeather.PM25))
    expect(w.pm25Level).toBe(rawWeather.PM25_INDEX ?? '')
    expect(w.airQualityIndex).toBe(rawWeather.AIR_IDX ?? '')
    expect(w.airMessage).toBe(rawWeather.AIR_MSG ?? '')
    expect(w.measuredAt).toBe(rawWeather.WEATHER_TIME ?? '')
    expect(Array.isArray(w.warnings)).toBe(true)
  })

  it('스냅샷: 이벤트가 EVENT_STTS 상위 5건과 매핑 일치', () => {
    const s = extractSnapshot(citydata)
    expect(s.events.length).toBe(Math.min(5, rawEvents.length))
    s.events.forEach((e, i) => {
      expect(e.name).toBe(rawEvents[i].EVENT_NM ?? '')
      expect(e.period).toBe(rawEvents[i].EVENT_PERIOD ?? '')
      expect(e.place).toBe(rawEvents[i].EVENT_PLACE ?? '')
    })
  })

  it('스냅샷: 인구 데이터가 LIVE_PPLTN_STTS와 매핑 일치', () => {
    const s = extractSnapshot(citydata)
    expect(s.population.congestionLevel).toBe(rawPpltn.AREA_CONGEST_LVL)
    expect(s.population.place).toBe(rawPpltn.AREA_NM)
  })

  it('재난문자: 배열 반환 (없으면 빈 배열 — 픽스처 캡처 시점 기준)', () => {
    const alerts = extractDisasterAlerts(citydata)
    expect(Array.isArray(alerts)).toBe(true)
    for (const a of alerts) {
      expect(typeof a.message).toBe('string')
      expect(typeof a.sentAt).toBe('string')
    }
  })
})
