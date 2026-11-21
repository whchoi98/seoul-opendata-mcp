/** STORE_URI로 사전 적재 저장소를 켠다 (스펙 §6.1) */
import type { SeoulApiClient } from '../client/seoulApi.js'
import { SnapshotReader } from './reader.js'
import { createS3Store } from './s3Store.js'
import { DirectoryStore, type SnapshotStore } from './snapshotStore.js'

/** s3://로 시작하면 S3(SDK는 이때만 불러온다), 아니면 디렉터리 */
export async function openStore(uri: string, region?: string): Promise<SnapshotStore> {
  return uri.startsWith('s3://') ? createS3Store(uri, region) : new DirectoryStore(uri)
}

/** STORE_URI가 설정된 경우에만 저장소를 붙인다. 실패해도 서버는 저장소 없이 계속 동작한다 */
export async function maybeAttachStore(client: SeoulApiClient): Promise<boolean> {
  const uri = process.env.STORE_URI
  if (!uri) return false
  try {
    client.attachStore(new SnapshotReader(await openStore(uri)))
    console.error(`[store] 사전 적재 저장소 활성화: ${uri}`)
    return true
  } catch (e) {
    console.error(`[store] 저장소 연결 실패 — 저장소 없이 계속: ${(e as Error).message}`)
    return false
  }
}
