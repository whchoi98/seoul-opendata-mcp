import { describe, it, expect } from 'vitest'
import { unwrap, SeoulApiError } from '../src/client/response.js'

const standard = { bikeList: { list_total_count: 5, RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' }, row: [{ stationName: '102. 망원역 1번출구 앞' }] } }
const ppltn = { 'SeoulRtd.citydata_ppltn': [{ AREA_NM: '광화문·덕수궁', AREA_CONGEST_LVL: '여유' }] }
const cmrcl = { list_total_count: 3, LIVE_CMRCL_STTS: { AREA_CMRCL_LVL: '한산한', CMRCL_RSB: [] } }
const subway = { errorMessage: { status: 200, code: 'INFO-000', message: '정상 처리되었습니다.', total: 7 }, realtimeArrivalList: [{ subwayId: '1002' }] }
const citydataXml = { 'SeoulRtd.citydata': { RESULT: { 'RESULT.CODE': 'INFO-000' }, CITYDATA: { AREA_NM: '광화문·덕수궁' } } }
const keyError = { RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } }
const noData = { culturalEventInfo: { list_total_count: 0, RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } } }

describe('unwrap', () => {
  it('standard 봉투: row 배열 반환', () => {
    const u = unwrap('bikeList', standard)
    expect(u.rows).toHaveLength(1)
    expect(u.totalCount).toBe(5)
  })
  it('citydata_ppltn: 루트 배열 반환', () => {
    expect(unwrap('citydata_ppltn', ppltn).rows[0].AREA_CONGEST_LVL).toBe('여유')
  })
  it('citydata_cmrcl: LIVE_CMRCL_STTS 단일 객체를 rows[0]으로', () => {
    expect(unwrap('citydata_cmrcl', cmrcl).rows[0].AREA_CMRCL_LVL).toBe('한산한')
  })
  it('subway: realtimeArrivalList 반환', () => {
    expect(unwrap('realtimeStationArrival', subway).rows[0].subwayId).toBe('1002')
  })
  it('citydata XML: CITYDATA 객체를 rows[0]으로', () => {
    expect(unwrap('citydata', citydataXml).rows[0].AREA_NM).toBe('광화문·덕수궁')
  })
  it('INFO-200은 빈 rows + note (에러 아님)', () => {
    const u = unwrap('culturalEventInfo', noData)
    expect(u.rows).toHaveLength(0)
    expect(u.note).toContain('데이터가 없습니다')
  })
  it('키 오류는 SeoulApiError(발급 안내 포함)', () => {
    expect(() => unwrap('bikeList', keyError)).toThrowError(SeoulApiError)
    try { unwrap('bikeList', keyError) } catch (e: any) {
      expect(e.code).toBe('INFO-100')
      expect(e.message).toContain('data.seoul.go.kr')
    }
  })
})
