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
  raw: any
  note?: string
}

const pickResult = (o: any) =>
  o?.RESULT ?? o?.errorMessage ?? null

const codeOf = (r: any): string | null =>
  r == null ? null : (r.CODE ?? r['RESULT.CODE'] ?? r.code ?? null)

const msgOf = (r: any): string =>
  r == null ? '' : (r.MESSAGE ?? r['RESULT.MESSAGE'] ?? r.message ?? '')

function assertOk(service: string, result: any): string | undefined {
  const code = codeOf(result)
  if (code == null || code === 'INFO-000') return undefined
  if (code === 'INFO-200') return `해당하는 데이터가 없습니다 (${service})`
  const hint = /키|KEY/i.test(msgOf(result)) || code === 'INFO-100' ? ` — ${KEY_GUIDE}` : ''
  throw new SeoulApiError(code, `서울 열린데이터광장 API 오류 [${code}] ${msgOf(result)}${hint}`)
}

export function unwrap(service: string, payload: any): Unwrapped {
  // 형태 A: 최상위 RESULT만 있는 에러 응답
  if (payload?.RESULT && Object.keys(payload).length === 1) {
    const note = assertOk(service, payload.RESULT)
    return { rows: [], totalCount: 0, raw: payload, note }
  }
  // 형태 B: 지하철 swopenapi — { errorMessage, realtimeArrivalList }
  if (payload?.errorMessage) {
    const note = assertOk(service, payload.errorMessage)
    const rows = toArray(payload.realtimeArrivalList)
    return { rows, totalCount: payload.errorMessage.total ?? rows.length, raw: payload, note }
  }
  // 형태 C: citydata_ppltn — { "SeoulRtd.citydata_ppltn": [...], RESULT: {...} }
  if (payload?.['SeoulRtd.citydata_ppltn']) {
    const note = assertOk(service, pickResult(payload))
    const rows = toArray(payload['SeoulRtd.citydata_ppltn'])
    return { rows, totalCount: rows.length, raw: payload, note }
  }
  // 형태 D: citydata_cmrcl — { list_total_count, LIVE_CMRCL_STTS: {...} }
  if (payload?.LIVE_CMRCL_STTS) {
    const note = assertOk(service, pickResult(payload))
    return { rows: [payload.LIVE_CMRCL_STTS], totalCount: 1, raw: payload, note }
  }
  // 형태 E: citydata 통합(XML 파싱 결과) — { "SeoulRtd.citydata": { RESULT, CITYDATA } }
  if (payload?.['SeoulRtd.citydata']) {
    const body = payload['SeoulRtd.citydata']
    const note = assertOk(service, body.RESULT)
    return { rows: toArray(body.CITYDATA), totalCount: 1, raw: payload, note }
  }
  // 형태 G: bikeList — 봉투 키(rentBikeStatus)가 service명과 다른 표준형
  if (payload?.rentBikeStatus) {
    const body = payload.rentBikeStatus
    const note = assertOk(service, body.RESULT)
    return { rows: toArray(body.row), totalCount: body.list_total_count ?? 0, raw: payload, note }
  }
  // 형태 F: 표준 — { [service]: { list_total_count, RESULT, row } }
  const body = payload?.[service]
  if (body) {
    const note = assertOk(service, body.RESULT)
    return { rows: toArray(body.row), totalCount: body.list_total_count ?? 0, raw: payload, note }
  }
  throw new SeoulApiError('PARSE', `알 수 없는 응답 형태 (${service}): ${JSON.stringify(payload).slice(0, 200)}`)
}
