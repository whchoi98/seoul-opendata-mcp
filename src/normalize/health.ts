export interface Pharmacy { name: string; address: string; tel: string; hours: Record<string, string> }

const DAYS = ['월', '화', '수', '목', '금', '토', '일', '공휴일'] as const

/** DUTYTIME{n}S/{n}C (n=1~8: 월~일, 공휴일) → { 월: '0900-1900', ... } (미운영 요일은 '') */
export function normalizePharmacies(rows: any[]): Pharmacy[] {
  return rows.map(r => {
    const hours: Record<string, string> = {}
    DAYS.forEach((day, idx) => {
      const s = r[`DUTYTIME${idx + 1}S`]
      const c = r[`DUTYTIME${idx + 1}C`]
      hours[day] = s != null && c != null && String(s).length >= 3 ? `${String(s).padStart(4, '0')}-${String(c).padStart(4, '0')}` : ''
    })
    return { name: r.DUTYNAME ?? '', address: r.DUTYADDR ?? '', tel: r.DUTYTEL1 ?? '', hours }
  })
}
