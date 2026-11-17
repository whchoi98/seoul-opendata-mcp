// 공공서비스예약(ListPublicReservation* 분야별 서비스) 정규화. 상세 HTML(DTLCONT)은 크기가 커서 버린다
import { num, decodeEntities } from './util.js'

export interface Reservation {
  id: string; name: string; category: string; subcategory: string; status: string; payment: string
  place: string; district: string; target: string; url: string
  serviceStart: string; serviceEnd: string; receiptStart: string; receiptEnd: string
  useHours: string; tel: string; lat: number | null; lng: number | null
}

const dateTime = (v: unknown) => String(v ?? '').replace(/\.0$/, '')

export function normalizeReservations(rows: any[]): Reservation[] {
  return rows.map(r => ({
    id: String(r.SVCID ?? ''),
    name: decodeEntities(r.SVCNM),
    category: r.MAXCLASSNM ?? '',
    subcategory: r.MINCLASSNM ?? '',
    status: r.SVCSTATNM ?? '',
    payment: r.PAYATNM ?? '',
    place: decodeEntities(r.PLACENM),
    district: r.AREANM ?? '',
    target: String(r.USETGTINFO ?? '').trim(),
    url: r.SVCURL ?? '',
    serviceStart: dateTime(r.SVCOPNBGNDT),
    serviceEnd: dateTime(r.SVCOPNENDDT),
    receiptStart: dateTime(r.RCPTBGNDT),
    receiptEnd: dateTime(r.RCPTENDDT),
    useHours: r.V_MIN && r.V_MAX ? `${r.V_MIN}~${r.V_MAX}` : '',
    tel: r.TELNO ?? '',
    lat: num(r.Y),
    lng: num(r.X),
  }))
}
