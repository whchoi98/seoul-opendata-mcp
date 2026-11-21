/** 스냅샷을 두는 곳의 인터페이스와 디렉터리 구현 (스펙 §3.2). 서버는 get만, 수집기는 셋 다 쓴다 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

export interface StoredObject { body: Buffer; etag?: string }
export interface ListedObject { key: string; lastModified: number; size: number }

export interface SnapshotStore {
  /** 없는 객체는 undefined. ifNoneMatch가 지금 etag와 같으면 'not-modified' */
  get(key: string, opts?: { ifNoneMatch?: string }): Promise<StoredObject | 'not-modified' | undefined>
  put(key: string, body: Buffer): Promise<void>
  /** prefix로 시작하는 키의 객체. 빈 문자열이면 전부 */
  list(prefix: string): Promise<ListedObject[]>
}

const isMissing = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

/** 테스트와 로컬 개발용. 키를 루트 디렉터리 아래의 상대 경로로 쓴다 */
export class DirectoryStore implements SnapshotStore {
  private root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private pathOf(key: string): string {
    const full = resolve(this.root, key)
    if (!full.startsWith(this.root + sep)) throw new Error('저장소 밖을 가리키는 키입니다')
    return full
  }

  async get(key: string, opts: { ifNoneMatch?: string } = {}): Promise<StoredObject | 'not-modified' | undefined> {
    let body: Buffer
    try {
      body = await readFile(this.pathOf(key))
    } catch (e) {
      if (isMissing(e)) return undefined
      throw e
    }
    const etag = createHash('sha256').update(body).digest('hex')
    return opts.ifNoneMatch === etag ? 'not-modified' : { body, etag }
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathOf(key)
    await mkdir(dirname(path), { recursive: true })
    // 읽는 쪽이 반쯤 쓴 파일을 보지 않도록 임시 파일에 쓴 뒤 이름을 바꾼다
    const tmp = `${path}.tmp-${process.pid}`
    await writeFile(tmp, body)
    await rename(tmp, path)
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (e) {
        if (isMissing(e)) return
        throw e
      }
      for (const entry of entries) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(path)
        } else if (entry.name.endsWith('.json.gz')) {
          const key = relative(this.root, path).split(sep).join('/')
          if (!key.startsWith(prefix)) continue
          const s = await stat(path)
          out.push({ key, lastModified: s.mtimeMs, size: s.size })
        }
      }
    }
    await walk(this.root)
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }
}
