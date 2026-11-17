import { num } from './util.js'

export interface SubwayRidership { date: string; line: string; station: string; boardings: number | null; alightings: number | null }
export function normalizeSubwayRidership(rows: any[]): SubwayRidership[] {
  return rows.map(r => ({
    date: r.USE_YMD ?? '',
    line: r.SBWY_ROUT_LN_NM ?? '',
    station: r.SBWY_STNS_NM ?? '',
    boardings: num(r.GTON_TNOPE),
    alightings: num(r.GTOFF_TNOPE),
  }))
}

export interface LivingPopulation { date: string; timeSlot: string; dongCode: string; total: number | null }
export function normalizeLivingPopulation(rows: any[]): LivingPopulation[] {
  return rows.map(r => ({
    date: String(r.STDR_DE_ID ?? ''),
    timeSlot: String(r.TMZON_PD_SE ?? ''),
    dongCode: String(r.ADSTRD_CODE_SE ?? ''),
    total: num(r.TOT_LVPOP_CO),
  }))
}

/** 운행일 순서: 04시부터 다음 날 03시까지 */
export const HOUR_ORDER = [...Array.from({ length: 20 }, (_, i) => i + 4), 0, 1, 2, 3]

export interface HourCount { hour: number; boardings: number | null; alightings: number | null }
export interface SubwayHourly { month: string; line: string; station: string; hours: HourCount[]; updatedAt: string }

/** 역별 시간대별 승하차(CardSubwayTime). HR_{시}_GET_ON_NOPE / HR_{시}_GET_OFF_NOPE는 그 달 전체 합계다 */
export function normalizeSubwayHourly(rows: any[]): SubwayHourly[] {
  return rows.map(r => ({
    month: String(r.USE_MM ?? ''),
    line: r.SBWY_ROUT_LN_NM ?? '',
    station: r.STTN ?? '',
    hours: HOUR_ORDER.map(hour => ({ hour, boardings: num(r[`HR_${hour}_GET_ON_NOPE`]), alightings: num(r[`HR_${hour}_GET_OFF_NOPE`]) })),
    updatedAt: String(r.JOB_YMD ?? ''),
  }))
}
