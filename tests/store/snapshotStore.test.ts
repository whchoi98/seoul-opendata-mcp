import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DirectoryStore } from '../../src/store/snapshotStore.js'
import { S3Store, parseS3Uri, type S3Like } from '../../src/store/s3Store.js'

describe('DirectoryStore', () => {
  let dir: string
  let store: DirectoryStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seoul-store-'))
    store = new DirectoryStore(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('put한 본문을 get으로 돌려주고 etag는 내용의 sha256이다', async () => {
    await store.put('A/_all.json.gz', Buffer.from('one'))
    expect(await store.get('A/_all.json.gz')).toEqual({
      body: Buffer.from('one'), etag: createHash('sha256').update('one').digest('hex'),
    })
    expect(readdirSync(join(dir, 'A'))).toEqual(['_all.json.gz']) // 임시 파일이 남지 않는다
  })

  it('없는 키는 undefined', async () => {
    expect(await store.get('A/_all.json.gz')).toBeUndefined()
  })

  it('ifNoneMatch가 지금 etag와 같으면 not-modified, 내용이 바뀌면 새 본문', async () => {
    await store.put('A/_all.json.gz', Buffer.from('one'))
    const first = await store.get('A/_all.json.gz')
    if (!first || first === 'not-modified') throw new Error('본문이 와야 한다')
    expect(await store.get('A/_all.json.gz', { ifNoneMatch: first.etag })).toBe('not-modified')
    await store.put('A/_all.json.gz', Buffer.from('two'))
    expect(await store.get('A/_all.json.gz', { ifNoneMatch: first.etag })).toMatchObject({ body: Buffer.from('two') })
  })

  it('list는 접두사에 맞는 .json.gz만 키, 수정 시각, 크기와 함께 돌려준다', async () => {
    await store.put('A/_all.json.gz', Buffer.from('1'))
    await store.put('B/20261116.json.gz', Buffer.from('22'))
    await store.put('B/20261117.json.gz', Buffer.from('333'))
    writeFileSync(join(dir, 'B', 'notes.txt'), 'x')
    const all = await store.list('')
    expect(all.map(o => o.key)).toEqual(['A/_all.json.gz', 'B/20261116.json.gz', 'B/20261117.json.gz'])
    expect(all.map(o => o.size)).toEqual([1, 2, 3])
    expect(all.every(o => Math.abs(o.lastModified - Date.now()) < 60_000)).toBe(true)
    expect((await store.list('B/')).map(o => o.key)).toEqual(['B/20261116.json.gz', 'B/20261117.json.gz'])
  })

  it('없는 루트 디렉터리의 list는 빈 배열이고 put은 디렉터리를 만든다', async () => {
    const fresh = new DirectoryStore(join(dir, 'not-yet'))
    expect(await fresh.list('')).toEqual([])
    await fresh.put('A/_all.json.gz', Buffer.from('1'))
    expect(existsSync(join(dir, 'not-yet', 'A', '_all.json.gz'))).toBe(true)
  })

  it('루트 밖을 가리키는 키는 거부한다', async () => {
    await expect(store.get('../outside.json.gz')).rejects.toThrow('저장소 밖')
    await expect(store.put('A/../../outside.json.gz', Buffer.from('x'))).rejects.toThrow('저장소 밖')
  })
})

const s3Error = (name: string, status: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } })

function fakeS3(pageSize = 2) {
  const objects = new Map<string, { body: Buffer; etag: string; lastModified: number }>()
  const calls: Array<{ op: string; params: any }> = []
  const s3: S3Like = {
    async getObject(p) {
      calls.push({ op: 'get', params: p })
      const o = objects.get(p.Key)
      if (!o) throw s3Error('NoSuchKey', 404)
      if (p.IfNoneMatch === o.etag) throw s3Error('NotModified', 304)
      return { body: o.body, etag: o.etag }
    },
    async putObject(p) {
      calls.push({ op: 'put', params: p })
      objects.set(p.Key, { body: p.Body, etag: `"e${objects.size + 1}"`, lastModified: 1000 + objects.size })
    },
    async listObjectsV2(p) {
      calls.push({ op: 'list', params: p })
      const keys = [...objects.keys()].filter(k => k.startsWith(p.Prefix)).sort()
      const from = p.ContinuationToken ? Number(p.ContinuationToken) : 0
      return {
        contents: keys.slice(from, from + pageSize).map(k => ({ key: k, lastModified: objects.get(k)!.lastModified, size: objects.get(k)!.body.length })),
        nextToken: from + pageSize < keys.length ? String(from + pageSize) : undefined,
      }
    },
  }
  return { s3, objects, calls }
}

describe('S3Store', () => {
  it('put과 get은 접두사를 붙인 키를 쓴다', async () => {
    const { s3, calls } = fakeS3()
    const store = new S3Store(s3, 'bucket', 'store/v1')
    await store.put('A/_all.json.gz', Buffer.from('one'))
    expect(calls[0]).toEqual({ op: 'put', params: { Bucket: 'bucket', Key: 'store/v1/A/_all.json.gz', Body: Buffer.from('one') } })
    expect(await store.get('A/_all.json.gz')).toEqual({ body: Buffer.from('one'), etag: '"e1"' })
    expect(calls[1]).toEqual({ op: 'get', params: { Bucket: 'bucket', Key: 'store/v1/A/_all.json.gz' } })
  })

  it('없는 객체는 undefined, 조건부 요청이 304면 not-modified', async () => {
    const { s3, calls } = fakeS3()
    const store = new S3Store(s3, 'bucket', 'store/v1')
    expect(await store.get('A/_all.json.gz')).toBeUndefined()
    await store.put('A/_all.json.gz', Buffer.from('one'))
    expect(await store.get('A/_all.json.gz', { ifNoneMatch: '"e1"' })).toBe('not-modified')
    expect(calls.at(-1)!.params.IfNoneMatch).toBe('"e1"')
    expect(await store.get('A/_all.json.gz', { ifNoneMatch: '"old"' })).toMatchObject({ etag: '"e1"' })
  })

  it('이름 없이 상태 코드만 있는 404와 304도 같은 뜻으로 읽는다', async () => {
    const s3 = { ...fakeS3().s3, getObject: async () => { throw s3Error('UnknownError', 404) } } as S3Like
    expect(await new S3Store(s3, 'b', 'p').get('k')).toBeUndefined()
    const s304 = { ...fakeS3().s3, getObject: async () => { throw s3Error('UnknownError', 304) } } as S3Like
    expect(await new S3Store(s304, 'b', 'p').get('k', { ifNoneMatch: 'x' })).toBe('not-modified')
  })

  it('그 밖의 오류(403 등)는 그대로 던진다', async () => {
    const s3 = { ...fakeS3().s3, getObject: async () => { throw s3Error('AccessDenied', 403) } } as S3Like
    await expect(new S3Store(s3, 'b', 'p').get('k')).rejects.toThrow('AccessDenied')
  })

  it('list는 페이지를 끝까지 넘기고 접두사를 뗀 키를 돌려준다', async () => {
    const { s3, calls } = fakeS3(2)
    const store = new S3Store(s3, 'bucket', 'store/v1')
    for (const k of ['A/_all.json.gz', 'B/1.json.gz', 'B/2.json.gz', 'B/3.json.gz', 'C/_all.json.gz']) await store.put(k, Buffer.from(k))
    calls.length = 0
    expect((await store.list('')).map(o => o.key)).toEqual(['A/_all.json.gz', 'B/1.json.gz', 'B/2.json.gz', 'B/3.json.gz', 'C/_all.json.gz'])
    expect(calls.map(c => c.params.ContinuationToken)).toEqual([undefined, '2', '4'])
    expect(calls[0].params.Prefix).toBe('store/v1/')
    const b = await store.list('B/')
    expect(b.map(o => o.key)).toEqual(['B/1.json.gz', 'B/2.json.gz', 'B/3.json.gz'])
    expect(b[0]).toEqual({ key: 'B/1.json.gz', lastModified: 1001, size: 'B/1.json.gz'.length })
  })

  it('접두사가 없으면 키를 그대로 쓴다', async () => {
    const { s3, calls } = fakeS3()
    await new S3Store(s3, 'bucket', '').put('A/_all.json.gz', Buffer.from('x'))
    expect(calls[0].params.Key).toBe('A/_all.json.gz')
  })
})

describe('parseS3Uri', () => {
  it('버킷과 접두사를 나누고 끝의 빗금을 뗀다', () => {
    expect(parseS3Uri('s3://my-bucket/store/v1')).toEqual({ bucket: 'my-bucket', prefix: 'store/v1' })
    expect(parseS3Uri('s3://my-bucket/store/v1/')).toEqual({ bucket: 'my-bucket', prefix: 'store/v1' })
    expect(parseS3Uri('s3://my-bucket')).toEqual({ bucket: 'my-bucket', prefix: '' })
  })
  it('s3 주소가 아니면 undefined', () => {
    expect(parseS3Uri('/var/store')).toBeUndefined()
    expect(parseS3Uri('s3://')).toBeUndefined()
    expect(parseS3Uri('s3://Bad_Bucket/x')).toBeUndefined()
  })
})
