import { toArray, KEY_GUIDE } from '../normalize/util.js'

export class SeoulApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'SeoulApiError'
  }
}

export interface Unwrapped {
  rows: any[]
  totalCount: number
  note?: string
}

const pickResult = (o: any) =>
  o?.RESULT ?? o?.errorMessage ?? null

const codeOf = (r: any): string | null =>
  r == null ? null : (r.CODE ?? r['RESULT.CODE'] ?? r.code ?? null)

const msgOf = (r: any): string =>
  r == null ? '' : (r.MESSAGE ?? r['RESULT.MESSAGE'] ?? r.message ?? '')

const NO_DATA = '해당하는 데이터가 없습니다'

/** INFO-200과 같은 뜻의 note. 사전 적재 저장소(src/store)도 0건일 때 이 함수로 같은 문구를 만든다 */
export const noDataNote = (service: string): string => `${NO_DATA} (${service})`

/** 조건에 맞는 행이 없다는 정상 응답(INFO-200)인지. 쿼터 소진처럼 다른 이유로 비어 있으면 false */
export const isNoData = (u: Unwrapped) => u.rows.length === 0 && (!u.note || u.note.startsWith(NO_DATA))

function assertOk(service: string, result: any): string | undefined {
  const code = codeOf(result)
  if (code == null || code === 'INFO-000') return undefined
  if (code === 'INFO-200') return noDataNote(service)
  const hint = /키|KEY/i.test(msgOf(result)) || code === 'INFO-100' ? ` — ${KEY_GUIDE}` : ''
  throw new SeoulApiError(code, `서울 열린데이터광장 API 오류 [${code}] ${msgOf(result)}${hint}`)
}

export function unwrap(service: string, payload: any): Unwrapped {
  // 형태 A: 최상위 RESULT만 있는 에러 응답
  if (payload?.RESULT && Object.keys(payload).length === 1) {
    const note = assertOk(service, payload.RESULT)
    return { rows: [], totalCount: 0, note }
  }
  // 형태 B: 지하철 swopenapi — { errorMessage, realtimeArrivalList }
  if (payload?.errorMessage) {
    const note = assertOk(service, payload.errorMessage)
    const rows = toArray(payload.realtimeArrivalList)
    return { rows, totalCount: payload.errorMessage.total ?? rows.length, note }
  }
  // 형태 B': swopenapi 에러 시 errorMessage 래퍼 없이 top-level { status, code, message }로 응답
  if (payload?.code != null && payload?.status != null) {
    const note = assertOk(service, payload)
    const rows = toArray(payload.realtimeArrivalList)
    return { rows, totalCount: payload.total ?? rows.length, note }
  }
  // 형태 C: citydata_ppltn — { "SeoulRtd.citydata_ppltn": [...], RESULT: {...} }
  if (payload?.['SeoulRtd.citydata_ppltn']) {
    const note = assertOk(service, pickResult(payload))
    const rows = toArray(payload['SeoulRtd.citydata_ppltn'])
    return { rows, totalCount: rows.length, note }
  }
  // 형태 D: citydata_cmrcl — { list_total_count, LIVE_CMRCL_STTS: {...} }
  if (payload?.LIVE_CMRCL_STTS) {
    const note = assertOk(service, pickResult(payload))
    return { rows: [payload.LIVE_CMRCL_STTS], totalCount: 1, note }
  }
  // 형태 E: citydata 통합(XML 파싱 결과) — { "SeoulRtd.citydata": { RESULT, CITYDATA } }
  if (payload?.['SeoulRtd.citydata']) {
    const body = payload['SeoulRtd.citydata']
    const note = assertOk(service, body.RESULT)
    return { rows: toArray(body.CITYDATA), totalCount: 1, note }
  }
  // 형태 G: bikeList — 봉투 키(rentBikeStatus)가 service명과 다른 표준형
  if (payload?.rentBikeStatus) {
    const body = payload.rentBikeStatus
    const note = assertOk(service, body.RESULT)
    return { rows: toArray(body.row), totalCount: body.list_total_count ?? 0, note }
  }
  // 형태 F: 표준 — { [service]: { list_total_count, RESULT, row } }
  const body = payload?.[service]
  if (body) {
    const note = assertOk(service, body.RESULT)
    return { rows: toArray(body.row), totalCount: body.list_total_count ?? 0, note }
  }
  throw new SeoulApiError('PARSE', `알 수 없는 응답 형태 (${service}): ${JSON.stringify(payload).slice(0, 200)}`)
}
