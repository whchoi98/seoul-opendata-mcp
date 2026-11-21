/** 클라이언트가 아는 사전 적재 저장소의 모양. 구현은 src/store/reader.ts에 있고, 이 디렉터리는 src/store를 import하지 않는다 */
import type { Unwrapped } from './response.js'

export interface SnapshotHit {
  value: Unwrapped
  /** 스냅샷을 수집한 시각(ms) */
  collectedAt: number
  /** 기한이 지난 스냅샷으로 답했는지 */
  expired: boolean
}

export interface SnapshotSource {
  /** 답할 수 없으면 undefined. 던지지 않는다 */
  lookup(
    service: string, start: number, end: number, path: string[], opts?: { allowExpired?: boolean },
  ): Promise<SnapshotHit | undefined>
}

const kstMonthDay = (ms: number): string => {
  const d = new Date(ms + 9 * 3_600_000)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
}

/**
 * 저장소가 답한 응답에 붙이는 안내 (스펙 §6.4). tool 봉투의 asOf는 현재 시각이라, 이 문구가 없으면 며칠 전 데이터가 방금 받은 것처럼 보인다.
 * 0건이면 붙이지 않는다. 0건의 note는 서울 API와 같은 문구 하나여야 한다
 */
export function storeNote(hit: SnapshotHit, now: number, reason?: 'quota' | 'rate'): string | undefined {
  if (hit.value.rows.length === 0) return undefined
  const date = kstMonthDay(hit.collectedAt)
  if (!hit.expired) return `사전 적재 데이터(${date} 수집)`
  const days = Math.max(1, Math.round((now - hit.collectedAt) / 86_400_000))
  const why = reason === 'rate' ? '서울 API 호출 제한' : '일일 API 쿼터 소진'
  return `${why}. 기한이 지난 사전 적재 데이터(${date} 수집, 약 ${days}일 경과)로 응답합니다`
}
