import { num } from './util.js'

export interface BikeStation {
  id: string; name: string
  available: number | null; racks: number | null; ratePct: number | null
  lat: number | null; lng: number | null
  distanceM?: number
}

export function normalizeBikeStations(rows: any[]): BikeStation[] {
  return rows.map(r => ({
    id: r.stationId ?? '',
    name: r.stationName ?? '',
    available: num(r.parkingBikeTotCnt),
    racks: num(r.rackTotCnt),
    ratePct: num(r.shared),
    lat: num(r.stationLatitude),
    lng: num(r.stationLongitude),
  }))
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
