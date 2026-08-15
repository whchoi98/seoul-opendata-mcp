import { num } from './util.js'

export interface AirQuality {
  region: string; district: string
  pm10: number | null; pm25: number | null
  ozone: number | null; no2: number | null; co: number | null; so2: number | null
  grade: string; index: number | null; mainPollutant: string
  measuredAt: string
}

export function normalizeAir(rows: any[]): AirQuality[] {
  return rows.map(r => ({
    region: r.SAREA_NM ?? '',
    district: r.MSRSTN_NM ?? '',
    pm10: num(r.PM),
    pm25: num(r.FPM),
    ozone: num(r.OZON),
    no2: num(r.NTDX),
    co: num(r.CBMX),
    so2: num(r.SPDX),
    grade: r.CAI_GRD ?? '',
    index: num(r.CAI_IDX),
    mainPollutant: r.CRST_SBSTN ?? '',
    measuredAt: String(r.MSRMT_DT ?? ''),
  }))
}
