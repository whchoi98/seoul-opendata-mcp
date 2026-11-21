import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'
import {
  ALL, SNAPSHOT_VERSION, STORE_PREFIX, decodeSnapshot, encodeSnapshot, isHead, snapshotKey, type Snapshot,
} from '../../src/store/snapshot.js'

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  v: 1, service: 'CardSubwayStatsNew', partition: ['20261116'],
  collectedAt: '2026-11-21T01:23:45.000Z', totalCount: 2, rows: [{ a: 1 }, { a: '가' }], ...over,
})

describe('snapshot', () => {
  it('키는 <서비스>/<파티션 값을 _로 이은 것>.json.gz이고 파티션이 없으면 _all이다', () => {
    expect(snapshotKey('TbPharmacyOperateInfo', [])).toBe('TbPharmacyOperateInfo/_all.json.gz')
    expect(snapshotKey('CardSubwayStatsNew', ['20261116'])).toBe('CardSubwayStatsNew/20261116.json.gz')
    expect(snapshotKey('SearchFirstAndLastTrainbyLineServiceNew', ['2호선', '1', '1']))
      .toBe('SearchFirstAndLastTrainbyLineServiceNew/2호선_1_1.json.gz')
    expect(ALL).toBe('_all')
    expect(STORE_PREFIX).toBe('store/v1')
    expect(SNAPSHOT_VERSION).toBe(1)
  })

  it('gzip JSON으로 왕복하고 압축을 푼 바이트 수를 돌려준다', () => {
    const s = snap()
    const body = encodeSnapshot(s)
    expect(body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b])) // gzip 머리
    const { snapshot, bytes } = decodeSnapshot(body)
    expect(snapshot).toEqual(s)
    expect(bytes).toBe(Buffer.byteLength(JSON.stringify(s)))
  })

  it('버전이 다르거나 필드가 빠졌거나 gzip이 아니면 던진다', () => {
    const bad = (o: unknown) => () => decodeSnapshot(gzipSync(JSON.stringify(o)))
    expect(bad({ ...snap(), v: 2 })).toThrow('스냅샷 형식')
    expect(bad({ ...snap(), rows: undefined })).toThrow('스냅샷 형식')
    expect(bad({ ...snap(), collectedAt: 'yesterday' })).toThrow('스냅샷 형식')
    expect(bad(null)).toThrow('스냅샷 형식')
    expect(() => decodeSnapshot(Buffer.from('not gzip'))).toThrow()
  })

  it('저장된 행이 전체 건수보다 적으면 머리 스냅샷이다', () => {
    expect(isHead(snap({ totalCount: 2 }))).toBe(false)
    expect(isHead(snap({ totalCount: 814_076 }))).toBe(true)
  })
})
