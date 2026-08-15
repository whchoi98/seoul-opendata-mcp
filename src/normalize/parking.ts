import { num } from './util.js'

export interface ParkingLot {
  code: string
  name: string
  address: string
  totalSpaces: number | null
  occupied: number | null
  available: number | null
  realtimeYn: string
  baseFee: number | null
  baseMinutes: number | null
  updatedAt: string
}

export function normalizeParkingLots(rows: any[]): ParkingLot[] {
  return rows.map(r => {
    const total = num(r.TPKCT)
    const occupied = num(r.NOW_PRK_VHCL_CNT)
    return {
      code: String(r.PKLT_CD ?? ''),
      name: r.PKLT_NM ?? '',
      address: r.ADDR ?? '',
      totalSpaces: total,
      occupied,
      available: total != null && occupied != null ? total - occupied : null,
      realtimeYn: String(r.PRK_STTS_YN ?? ''),
      baseFee: num(r.BSC_PRK_CRG),
      baseMinutes: num(r.BSC_PRK_HR),
      updatedAt: r.NOW_PRK_VHCL_UPDT_TM ?? '',
    }
  })
}
