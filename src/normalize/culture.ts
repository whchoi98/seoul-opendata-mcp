export interface CulturalEvent {
  category: string
  district: string
  title: string
  period: string
  startDate: string
  endDate: string
  place: string
  fee: string
  isFree: boolean
  link: string
}

const day = (v: any): string => String(v ?? '').slice(0, 10)

export function normalizeEvents(rows: any[]): CulturalEvent[] {
  return rows.map(r => {
    const fee = String(r.USE_FEE ?? '').trim()
    return {
      category: r.CODENAME ?? '',
      district: r.GUNAME ?? '',
      title: r.TITLE ?? '',
      period: r.DATE ?? '',
      startDate: day(r.STRTDATE),
      endDate: day(r.END_DATE),
      place: r.PLACE ?? '',
      fee,
      isFree: fee === '' || fee.includes('무료'),
      link: r.ORG_LINK ?? r.HMPG_ADDR ?? '',
    }
  })
}

export function filterEvents(
  events: CulturalEvent[],
  f: { district?: string; from?: string; to?: string; freeOnly?: boolean },
): CulturalEvent[] {
  return events.filter(e => {
    if (f.district && !e.district.includes(f.district)) return false
    if (f.freeOnly && !e.isFree) return false
    if (f.from && e.endDate && e.endDate < f.from) return false
    if (f.to && e.startDate && e.startDate > f.to) return false
    return true
  })
}
