import { num, toArray } from './util.js'

export interface PopulationForecast { at: string; congestionLevel: string; min: number | null; max: number | null }
export interface Population {
  place: string; code: string
  congestionLevel: string; congestionMessage: string
  populationMin: number | null; populationMax: number | null
  malePct: number | null; femalePct: number | null
  agePct: Record<string, number | null>
  residentPct: number | null; nonResidentPct: number | null
  measuredAt: string
  forecast: PopulationForecast[]
}

export function normalizePopulation(raw: any, includeForecast: boolean): Population {
  const fcst = includeForecast && raw.FCST_YN === 'Y'
    ? toArray(raw.FCST_PPLTN?.FCST_PPLTN ?? raw.FCST_PPLTN).map((f: any) => ({
        at: f.FCST_TIME,
        congestionLevel: f.FCST_CONGEST_LVL,
        min: num(f.FCST_PPLTN_MIN),
        max: num(f.FCST_PPLTN_MAX),
      }))
    : []
  return {
    place: raw.AREA_NM,
    code: raw.AREA_CD,
    congestionLevel: raw.AREA_CONGEST_LVL,
    congestionMessage: raw.AREA_CONGEST_MSG,
    populationMin: num(raw.AREA_PPLTN_MIN),
    populationMax: num(raw.AREA_PPLTN_MAX),
    malePct: num(raw.MALE_PPLTN_RATE),
    femalePct: num(raw.FEMALE_PPLTN_RATE),
    agePct: {
      '0s': num(raw.PPLTN_RATE_0), '10s': num(raw.PPLTN_RATE_10), '20s': num(raw.PPLTN_RATE_20),
      '30s': num(raw.PPLTN_RATE_30), '40s': num(raw.PPLTN_RATE_40), '50s': num(raw.PPLTN_RATE_50),
      '60s': num(raw.PPLTN_RATE_60), '70s+': num(raw.PPLTN_RATE_70),
    },
    residentPct: num(raw.RESNT_PPLTN_RATE),
    nonResidentPct: num(raw.NON_RESNT_PPLTN_RATE),
    measuredAt: raw.PPLTN_TIME,
    forecast: fcst,
  }
}
