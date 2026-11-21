import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SeoulApiClient } from '../../src/client/seoulApi.js'
import { maybeAttachStore, openStore } from '../../src/store/attach.js'
import { S3Store } from '../../src/store/s3Store.js'
import { encodeSnapshot, snapshotKey } from '../../src/store/snapshot.js'
import { DirectoryStore } from '../../src/store/snapshotStore.js'

describe('maybeAttachStore', () => {
  const dirs: string[] = []
  afterEach(() => {
    delete process.env.STORE_URI
    vi.restoreAllMocks()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const newClient = (fetchFn = vi.fn()) => new SeoulApiClient({ apiKey: 'K', fetchFn: fetchFn as any })

  it('STORE_URI가 없으면 아무것도 붙이지 않는다', async () => {
    delete process.env.STORE_URI
    const client = newClient()
    const attach = vi.spyOn(client, 'attachStore')
    expect(await maybeAttachStore(client)).toBe(false)
    expect(attach).not.toHaveBeenCalled()
  })

  it('디렉터리 경로면 그 디렉터리의 스냅샷으로 답한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = mkdtempSync(join(tmpdir(), 'seoul-attach-'))
    dirs.push(dir)
    await new DirectoryStore(dir).put(snapshotKey('TbPharmacyOperateInfo', []), encodeSnapshot({
      v: 1, service: 'TbPharmacyOperateInfo', partition: [], collectedAt: new Date().toISOString(), totalCount: 1, rows: [{ DUTYNAME: '약국' }],
    }))
    process.env.STORE_URI = dir
    const fetchFn = vi.fn()
    const client = newClient(fetchFn)
    expect(await maybeAttachStore(client)).toBe(true)
    const u = await client.getJson('TbPharmacyOperateInfo', 1, 10)
    expect(u.rows).toEqual([{ DUTYNAME: '약국' }])
    expect(u.note).toMatch(/^사전 적재 데이터\(\d+월 \d+일 수집\)$/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('잘못된 s3 주소면 로그만 남기고 저장소 없이 계속한다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.STORE_URI = 's3://'
    const client = newClient()
    const attach = vi.spyOn(client, 'attachStore')
    expect(await maybeAttachStore(client)).toBe(false)
    expect(attach).not.toHaveBeenCalled()
    expect(err.mock.calls.flat().join(' ')).toContain('저장소 연결 실패')
  })

  it('openStore는 s3 주소면 S3Store, 아니면 DirectoryStore를 연다', async () => {
    expect(await openStore('/tmp/seoul-store-example')).toBeInstanceOf(DirectoryStore)
    // SDK 클라이언트를 만드는 것만으로는 네트워크를 쓰지 않는다
    expect(await openStore('s3://example-bucket/store/v1', 'ap-northeast-2')).toBeInstanceOf(S3Store)
  })
})
