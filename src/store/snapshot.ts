/** 스냅샷 객체의 형식과 키 규칙. 수집기와 서버가 맞춰야 하는 것은 이 파일 하나다 (스펙 §3.1) */
import { gunzipSync, gzipSync } from 'node:zlib'

export const SNAPSHOT_VERSION = 1
/** S3 객체 키의 맨 앞. STORE_URI는 이 접두사까지 포함한다: s3://<버킷>/store/v1 */
export const STORE_PREFIX = 'store/v1'
/** 파티션이 없는 데이터셋의 파티션 키 */
export const ALL = '_all'

export interface Snapshot {
  v: 1
  service: string
  /** 파티션 자리의 값. 파티션이 없으면 빈 배열 */
  partition: string[]
  /** 수집을 마친 시각(ISO 8601) */
  collectedAt: string
  /** 서울 API가 알려 준 전체 건수 */
  totalCount: number
  /** 서울 API가 준 원본 행. 순서를 바꾸지 않고 정규화하지 않는다 */
  rows: any[]
}

/** STORE_URI 아래의 상대 키. 파티션 값은 규칙의 형식 검사를 통과한 것만 넘겨야 한다 */
export function snapshotKey(service: string, partition: string[]): string {
  return `${service}/${partition.length > 0 ? partition.join('_') : ALL}.json.gz`
}

export function encodeSnapshot(s: Snapshot): Buffer {
  return gzipSync(JSON.stringify(s))
}

/** bytes는 압축을 푼 JSON의 바이트 수. 메모리 상한 계산에 쓴다 */
export function decodeSnapshot(body: Buffer): { snapshot: Snapshot; bytes: number } {
  const json = gunzipSync(body)
  const s = JSON.parse(json.toString('utf8'))
  const ok = s?.v === SNAPSHOT_VERSION && typeof s.service === 'string' && Array.isArray(s.partition)
    && Array.isArray(s.rows) && typeof s.totalCount === 'number' && !Number.isNaN(Date.parse(s.collectedAt))
  if (!ok) throw new Error(`스냅샷 형식이 맞지 않습니다 (v=${String(s?.v)})`)
  return { snapshot: s as Snapshot, bytes: json.length }
}

/** 저장된 행이 전체 건수보다 적으면 머리 스냅샷이다. 필터 요청에는 답할 수 없다 (스펙 §2.1) */
export const isHead = (s: Snapshot): boolean => s.rows.length < s.totalCount
