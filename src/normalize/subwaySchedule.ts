// 지하철 시간표 계열(역 검색, 첫차·막차, 역별 시간표) 정규화
export const DIRECTION: Record<string, string> = { '1': '상행·내선', '2': '하행·외선' }
export const DAY: Record<string, string> = { '1': '평일', '2': '토요일', '3': '휴일' }

/** '02호선' → '2호선'. 숫자 노선이 아니면 그대로 */
export const lineLabel = (raw: string): string => raw.replace(/^0(\d호선)$/, '$1')

export interface TrainTime { time: string; nextDay: boolean }

/** 'HHMMSS' 또는 'HH:MM:SS'를 HH:MM으로. 24시 이후(자정 넘은 운행)는 시를 24 빼고 nextDay로 표시한다 */
export function formatHms(raw: unknown): TrainTime | null {
  const m = /^(\d{2}):?(\d{2})/.exec(String(raw ?? ''))
  if (!m) return null
  const h = Number(m[1])
  return { time: `${String(h % 24).padStart(2, '0')}:${m[2]}`, nextDay: h >= 24 }
}

export interface SubwayStation { code: string; name: string; line: string; externalCode: string }

export function normalizeSubwayStations(rows: any[]): SubwayStation[] {
  return rows.map(r => ({
    code: String(r.STATION_CD ?? ''),
    name: r.STATION_NM ?? '',
    line: lineLabel(String(r.LINE_NUM ?? '')),
    externalCode: String(r.FR_CODE ?? ''),
  }))
}

export interface TrainEnd extends TrainTime { from: string; to: string }
export interface FirstLastTrain {
  line: string; direction: string; day: string; stationCode: string; station: string
  first: TrainEnd | null; last: TrainEnd | null
}

const end = (time: unknown, from: unknown, to: unknown): TrainEnd | null => {
  const t = formatHms(time)
  return t && { ...t, from: String(from ?? ''), to: String(to ?? '') }
}

export function normalizeFirstLast(rows: any[]): FirstLastTrain[] {
  return rows.map(r => ({
    line: lineLabel(String(r.SBWY_ROUT_LN ?? '')),
    direction: DIRECTION[String(r.UPLN_DNLN)] ?? '',
    day: DAY[String(r.DOW)] ?? '',
    stationCode: String(r.SUBW_CD ?? ''),
    station: r.STTN ?? '',
    first: end(r.FSTT_HRM, r.FSTT_DPTRE_STTN, r.FSTT_ARVL_STTN),
    last: end(r.LSTTM_HRM, r.LSTTM_DPTRE_STTN, r.LSTTM_ARVL_STTN),
  }))
}

export interface TimetableEntry { trainNo: string; departs: string; nextDay: boolean; origin: string; destination: string; direction: string }

export function normalizeTimetable(rows: any[]): TimetableEntry[] {
  return rows.map(r => {
    const t = formatHms(r.LEFTTIME)
    return {
      trainNo: String(r.TRAIN_NO ?? ''),
      departs: t?.time ?? '',
      nextDay: t?.nextDay ?? false,
      origin: r.SUBWAYSNAME ?? '',
      destination: r.SUBWAYENAME ?? '',
      direction: DIRECTION[String(r.INOUT_TAG)] ?? '',
    }
  })
}

/** 역명 후보: 입력 그대로, 끝의 "역"을 뗀 이름, "역"을 붙인 이름 순. 데이터셋마다 "서울역"과 "강남"처럼 표기가 다르다 */
export function stationNameCandidates(input: string): string[] {
  const name = input.trim()
  const alt = name.endsWith('역') ? name.slice(0, -1) : `${name}역`
  return [...new Set([name, alt].filter(Boolean))]
}

/** 사용자 입력 호선을 '2호선' 꼴로 맞춘다: '2', '02호선', '2호선' → '2호선'. 그 밖의 노선명은 그대로 */
export function lineInput(input: string): string {
  const v = input.trim()
  const m = /^0?([1-9])(호선)?$/.exec(v)
  return m ? `${m[1]}호선` : v
}
