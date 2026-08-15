import { num } from './util.js'

export const LINE_NAMES: Record<string, string> = {
  '1001': '1호선', '1002': '2호선', '1003': '3호선', '1004': '4호선', '1005': '5호선',
  '1006': '6호선', '1007': '7호선', '1008': '8호선', '1009': '9호선',
  '1032': 'GTX-A', '1061': '중앙선', '1063': '경의중앙선', '1065': '공항철도',
  '1067': '경춘선', '1075': '수인분당선', '1077': '신분당선', '1081': '경강선',
  '1092': '우이신설선', '1093': '서해선',
}

export interface SubwayArrival {
  line: string; direction: string; destination: string; trainLine: string
  secondsToArrival: number | null; arrivalMessage: string; currentLocation: string; receivedAt: string
}

export function normalizeArrivals(rows: any[]): SubwayArrival[] {
  return rows.map(r => ({
    line: LINE_NAMES[r.subwayId] ?? String(r.subwayId),
    direction: r.updnLine ?? '',
    destination: r.bstatnNm ?? '',
    trainLine: r.trainLineNm ?? '',
    secondsToArrival: num(r.barvlDt),
    arrivalMessage: r.arvlMsg2 ?? '',
    currentLocation: r.arvlMsg3 ?? '',
    receivedAt: r.recptnDt ?? '',
  }))
}
