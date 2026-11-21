/** S3 저장소 구현. @aws-sdk/client-s3는 createS3Store() 안에서만 lazy import한다 */
import type { ListedObject, SnapshotStore, StoredObject } from './snapshotStore.js'

/** 이 모듈이 쓰는 S3 호출만 추린 형태. 테스트는 가짜 구현을 넣는다 */
export interface S3Like {
  getObject(p: { Bucket: string; Key: string; IfNoneMatch?: string }): Promise<StoredObject>
  putObject(p: { Bucket: string; Key: string; Body: Buffer }): Promise<void>
  listObjectsV2(p: { Bucket: string; Prefix: string; ContinuationToken?: string }): Promise<{ contents: ListedObject[]; nextToken?: string }>
}

const statusOf = (e: unknown): number | undefined => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
const nameOf = (e: unknown): string | undefined => (e as { name?: string })?.name
const isMissing = (e: unknown): boolean => nameOf(e) === 'NoSuchKey' || statusOf(e) === 404
const isNotModified = (e: unknown): boolean => nameOf(e) === 'NotModified' || statusOf(e) === 304

export class S3Store implements SnapshotStore {
  constructor(private s3: S3Like, private bucket: string, private prefix: string) {}

  private keyOf(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key
  }

  async get(key: string, opts: { ifNoneMatch?: string } = {}): Promise<StoredObject | 'not-modified' | undefined> {
    try {
      return await this.s3.getObject({
        Bucket: this.bucket, Key: this.keyOf(key), ...(opts.ifNoneMatch ? { IfNoneMatch: opts.ifNoneMatch } : {}),
      })
    } catch (e) {
      if (isNotModified(e)) return 'not-modified'
      if (isMissing(e)) return undefined
      throw e
    }
  }

  async put(key: string, body: Buffer): Promise<void> {
    await this.s3.putObject({ Bucket: this.bucket, Key: this.keyOf(key), Body: body })
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = []
    const strip = this.prefix ? this.prefix.length + 1 : 0
    let token: string | undefined
    do {
      const page = await this.s3.listObjectsV2({ Bucket: this.bucket, Prefix: this.keyOf(prefix), ContinuationToken: token })
      for (const o of page.contents) out.push({ ...o, key: o.key.slice(strip) })
      token = page.nextToken
    } while (token)
    return out
  }
}

/** s3://<버킷>/<접두사>. 접두사 끝의 빗금은 뗀다 */
export function parseS3Uri(uri: string): { bucket: string; prefix: string } | undefined {
  const m = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(uri)
  if (!m) return undefined
  return { bucket: m[1], prefix: (m[2] ?? '').replace(/\/+$/, '') }
}

/** region을 주지 않으면 SDK의 기본 설정(런타임의 AWS_REGION)을 쓴다 */
export async function createS3Store(uri: string, region?: string): Promise<S3Store> {
  const parsed = parseS3Uri(uri)
  if (!parsed) throw new Error('저장소 주소는 s3://<버킷>/<접두사> 형식이어야 합니다')
  const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3')
  const client = new S3Client(region ? { region } : {})
  const s3: S3Like = {
    async getObject(p) {
      const r = await client.send(new GetObjectCommand(p))
      if (!r.Body) throw new Error('S3 응답에 본문이 없습니다')
      return { body: Buffer.from(await r.Body.transformToByteArray()), etag: r.ETag }
    },
    async putObject(p) {
      await client.send(new PutObjectCommand({ ...p, ContentType: 'application/gzip' }))
    },
    async listObjectsV2(p) {
      const r = await client.send(new ListObjectsV2Command(p))
      return {
        contents: (r.Contents ?? []).map(o => ({ key: o.Key ?? '', lastModified: o.LastModified?.getTime() ?? 0, size: o.Size ?? 0 })),
        nextToken: r.IsTruncated ? r.NextContinuationToken : undefined,
      }
    },
  }
  return new S3Store(s3, parsed.bucket, parsed.prefix)
}
