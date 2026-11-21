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

/** S3 연결을 맺는 시간 제한. SDK 기본값 0은 제한이 없어 멈춘 연결이 끝나지 않는다 */
const CONNECTION_TIMEOUT_MS = 2_000
/** 객체 읽기(본문 포함)와 목록 한 페이지의 시간 제한. 서버의 읽기가 반드시 끝나게 한다 */
const S3_READ_TIMEOUT_MS = 10_000
/** 객체 쓰기의 시간 제한. 느린 회선에서 몇 MB를 올려도 넉넉하게 둔다 */
const S3_WRITE_TIMEOUT_MS = 120_000

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
  // 요청 시간 제한은 클라이언트에 두지 않고 요청마다 abort signal로 건다. 핸들러의 타이머는 응답 헤더를 받으면 풀리기 때문이다
  const client = new S3Client({ ...(region ? { region } : {}), requestHandler: { connectionTimeout: CONNECTION_TIMEOUT_MS } })
  const s3: S3Like = {
    async getObject(p) {
      // 신호는 본문을 다 읽을 때까지 살아 있어 헤더와 본문을 합쳐 제한한다
      const r = await client.send(new GetObjectCommand(p), { abortSignal: AbortSignal.timeout(S3_READ_TIMEOUT_MS) })
      if (!r.Body) throw new Error('S3 응답에 본문이 없습니다')
      return { body: Buffer.from(await r.Body.transformToByteArray()), etag: r.ETag }
    },
    async putObject(p) {
      await client.send(new PutObjectCommand({ ...p, ContentType: 'application/gzip' }), { abortSignal: AbortSignal.timeout(S3_WRITE_TIMEOUT_MS) })
    },
    async listObjectsV2(p) {
      const r = await client.send(new ListObjectsV2Command(p), { abortSignal: AbortSignal.timeout(S3_READ_TIMEOUT_MS) })
      return {
        contents: (r.Contents ?? []).map(o => ({ key: o.Key ?? '', lastModified: o.LastModified?.getTime() ?? 0, size: o.Size ?? 0 })),
        nextToken: r.IsTruncated ? r.NextContinuationToken : undefined,
      }
    },
  }
  return new S3Store(s3, parsed.bucket, parsed.prefix)
}
