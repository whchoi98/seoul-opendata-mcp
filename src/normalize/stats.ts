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
