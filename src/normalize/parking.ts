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

/** 공영주차장 안내(GetParkInfo). 실시간 주차대수는 없고 요금, 운영시간, 야간 개방 정보를 준다 */
export interface ParkingInfo {
  code: string; name: string; address: string; kind: string; operation: string; tel: string
  totalSpaces: number | null; paid: string; nightFreeOpen: boolean
  weekdayHours: string; weekendHours: string; saturdayFee: string; holidayFee: string
  baseFee: number | null; baseMinutes: number | null; addFee: number | null; addMinutes: number | null
  dailyMax: number | null; monthlyPass: number | null; realtimeStatus: string
  lat: number | null; lng: number | null
}

const hours = (begin: unknown, endTm: unknown) => (begin && endTm ? `${begin}-${endTm}` : '')

export function normalizeParkInfo(rows: any[]): ParkingInfo[] {
  return rows.map(r => ({
    code: String(r.PKLT_CD ?? ''),
    name: r.PKLT_NM ?? '',
    address: r.ADDR ?? '',
    kind: r.PKLT_KND_NM ?? '',
    operation: r.OPER_SE_NM ?? '',
    tel: r.TELNO ?? '',
    totalSpaces: num(r.TPKCT),
    paid: r.CHGD_FREE_NM ?? '',
    nightFreeOpen: r.NGHT_FREE_OPN_YN === 'Y',
    weekdayHours: hours(r.WD_OPER_BGNG_TM, r.WD_OPER_END_TM),
    weekendHours: hours(r.WE_OPER_BGNG_TM, r.WE_OPER_END_TM),
    saturdayFee: r.SAT_CHGD_FREE_NM ?? '',
    holidayFee: r.LHLDY_NM ?? '',
    baseFee: num(r.PRK_CRG),
    baseMinutes: num(r.PRK_HM),
    addFee: num(r.ADD_CRG),
    addMinutes: num(r.ADD_UNIT_TM_MNT),
    dailyMax: num(r.DLY_MAX_CRG),
    monthlyPass: num(r.MNTL_CMUT_CRG),
    realtimeStatus: r.PRK_NOW_INFO_PVSN_YN_NM ?? '',
    lat: num(r.LAT),
    lng: num(r.LOT),
  }))
}

/** GetParkInfo는 같은 주차장이 여러 행으로 온다(1,000행에 고유 코드 약 200개). 코드별 첫 행만 남긴다 */
export function uniqueByCode<T extends { code: string }>(lots: T[]): T[] {
  const seen = new Set<string>()
  return lots.filter(p => (seen.has(p.code) ? false : (seen.add(p.code), true)))
}
