import { num } from './util.js'

export type PmGrade = '좋음' | '보통' | '나쁨' | '매우나쁨' | ''

export interface AirQuality {
  region: string; district: string
  pm10: number | null; pm25: number | null
  /** 환경부 예보 등급 구간으로 계산한 미세먼지 등급. 통합지수 등급(grade)과 다를 수 있다 */
  pm10Grade: PmGrade; pm25Grade: PmGrade
  ozone: number | null; no2: number | null; co: number | null; so2: number | null
  /** 통합대기환경지수 등급과 지수. mainPollutant가 그 값을 정한 물질이다 */
  grade: string; index: number | null; mainPollutant: string
  measuredAt: string
}

/** 환경부 미세먼지 예보 등급 구간(㎍/㎥). 이 값 이하가 차례로 좋음, 보통, 나쁨이고 그 위는 매우나쁨 */
export const PM10_LIMITS = [30, 80, 150] as const
export const PM25_LIMITS = [15, 35, 75] as const
const GRADES = ['좋음', '보통', '나쁨'] as const

function pmGrade(value: number | null, limits: readonly number[]): PmGrade {
  if (value === null) return ''
  const i = limits.findIndex(limit => value <= limit)
  return i === -1 ? '매우나쁨' : GRADES[i]
}

export function normalizeAir(rows: any[]): AirQuality[] {
  return rows.map(r => {
    const grade: string = r.CAI_GRD ?? ''
    // 측정소가 값을 내지 못하면 원본은 미세먼지와 통합지수를 0으로, 등급을 빈 값으로 준다. 그 0은 측정값이 아니다
    const measured = (v: unknown): number | null => {
      const n = num(v)
      return n === 0 && grade === '' ? null : n
    }
    const pm10 = measured(r.PM)
    const pm25 = measured(r.FPM)
    return {
      region: r.SAREA_NM ?? '',
      district: r.MSRSTN_NM ?? '',
      pm10,
      pm25,
      pm10Grade: pmGrade(pm10, PM10_LIMITS),
      pm25Grade: pmGrade(pm25, PM25_LIMITS),
      ozone: num(r.OZON),
      no2: num(r.NTDX),
      co: num(r.CBMX),
      so2: num(r.SPDX),
      grade,
      index: measured(r.CAI_IDX),
      mainPollutant: r.CRST_SBSTN ?? '',
      measuredAt: String(r.MSRMT_DT ?? ''),
    }
  })
}
