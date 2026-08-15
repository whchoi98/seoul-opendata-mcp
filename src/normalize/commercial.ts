import { num, toArray } from './util.js'

export interface CommercialCategory {
  large: string; mid: string; level: string
  paymentCount: number | null; amountMin: number | null; amountMax: number | null
  merchantCount: number | null
}
export interface Commercial {
  level: string
  paymentCount: number | null
  paymentAmountMin: number | null; paymentAmountMax: number | null
  measuredAt: string | null
  categories: CommercialCategory[]
}

export function normalizeCommercial(raw: any): Commercial {
  return {
    level: raw.AREA_CMRCL_LVL,
    paymentCount: num(raw.AREA_SH_PAYMENT_CNT),
    paymentAmountMin: num(raw.AREA_SH_PAYMENT_AMT_MIN),
    paymentAmountMax: num(raw.AREA_SH_PAYMENT_AMT_MAX),
    measuredAt: raw.CMRCL_TIME ?? null,
    categories: toArray(raw.CMRCL_RSB).map((r: any) => ({
      large: r.RSB_LRG_CTGR,
      mid: r.RSB_MID_CTGR,
      level: r.RSB_PAYMENT_LVL,
      paymentCount: num(r.RSB_SH_PAYMENT_CNT),
      amountMin: num(r.RSB_SH_PAYMENT_AMT_MIN),
      amountMax: num(r.RSB_SH_PAYMENT_AMT_MAX),
      merchantCount: num(r.RSB_MCT_CNT),
    })),
  }
}
