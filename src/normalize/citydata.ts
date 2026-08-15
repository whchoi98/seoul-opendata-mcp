import { num, toArray } from './util.js'
import { normalizePopulation, type Population } from './population.js'

// citydata XML은 같은 이름의 노드가 한 단계 더 감싸여 파싱된다 (예: LIVE_PPLTN_STTS.LIVE_PPLTN_STTS).
// 내부 노드가 없으면(단일 중첩) 바깥 노드를 그대로 사용한다.
const inner = (node: any, key: string) => node?.[key]?.[key] ?? node?.[key] ?? null

export function extractRoadTraffic(citydata: any) {
  const road = citydata?.ROAD_TRAFFIC_STTS ?? {}
  const avg = road.AVG_ROAD_DATA ?? {}
  const incidents = toArray(inner(citydata, 'ACDNT_CNTRL_STTS')).map((a: any) => ({
    type: a.ACDNT_TYPE ?? '',
    detail: a.ACDNT_DTYPE ?? '',
    occurredAt: a.ACDNT_OCCR_DT ?? '',
    message: a.ACDNT_INFO ?? '',
  }))
  return {
    message: avg.ROAD_MSG ?? '',
    index: avg.ROAD_TRAFFIC_IDX ?? '',
    averageSpeedKmh: num(avg.ROAD_TRAFFIC_SPD),
    measuredAt: avg.ROAD_TRAFFIC_TIME ?? '',
    incidents,
  }
}

export function extractWeather(citydata: any) {
  const w = inner(citydata, 'WEATHER_STTS') ?? {}
  return {
    temperatureC: num(w.TEMP),
    sensibleTemperatureC: num(w.SENSIBLE_TEMP),
    maxTempC: num(w.MAX_TEMP),
    minTempC: num(w.MIN_TEMP),
    humidityPct: num(w.HUMIDITY),
    precipitation: String(w.PRECIPITATION ?? ''),
    precipitationType: w.PRECPT_TYPE ?? '',
    precipitationMessage: w.PCP_MSG ?? '',
    sunrise: String(w.SUNRISE ?? ''),
    sunset: String(w.SUNSET ?? ''),
    uvLevel: w.UV_INDEX_LVL != null ? String(w.UV_INDEX_LVL) : '',
    pm10: num(w.PM10),
    pm10Level: w.PM10_INDEX ?? '',
    pm25: num(w.PM25),
    pm25Level: w.PM25_INDEX ?? '',
    airQualityIndex: w.AIR_IDX ?? '',
    airMessage: w.AIR_MSG ?? '',
    warnings: toArray(w.NEWS_LIST?.WARN_VAL).map(String),
    measuredAt: w.WEATHER_TIME ?? '',
  }
}

export function extractSnapshot(citydata: any): {
  place: string; population: Population; weatherSummary: string; roadMessage: string
  events: Array<{ name: string; period: string; place: string }>
} {
  const ppltn = inner(citydata, 'LIVE_PPLTN_STTS')
  const population = normalizePopulation(ppltn ?? {}, false)
  const w = extractWeather(citydata)
  const events = toArray(inner(citydata, 'EVENT_STTS')).slice(0, 5).map((e: any) => ({
    name: e.EVENT_NM ?? '',
    period: e.EVENT_PERIOD ?? '',
    place: e.EVENT_PLACE ?? '',
  }))
  return {
    place: citydata?.AREA_NM ?? '',
    population,
    weatherSummary: `기온 ${w.temperatureC ?? '?'}°C, ${w.precipitationMessage || '강수 정보 없음'}, PM2.5 ${w.pm25Level || '?'}`,
    roadMessage: extractRoadTraffic(citydata).message,
    events,
  }
}
