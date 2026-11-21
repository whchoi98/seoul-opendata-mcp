import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleCollectLambda } from '../scripts/workshop-bundle.js'

describe('bundleCollectLambda', () => {
  it('수집 Lambda를 handler를 내보내는 ESM 한 파일로 묶고 AWS SDK는 묶지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seoul-bundle-'))
    try {
      const out = join(dir, 'collect.mjs')
      await bundleCollectLambda(out)
      const text = readFileSync(out, 'utf8')
      expect(text).toContain('import("@aws-sdk/client-s3")')
      expect(text).toContain('import("@aws-sdk/client-dynamodb")')
      expect(text.length).toBeLessThan(1_000_000)
      const mod = await import(pathToFileURL(out).href)
      expect(typeof mod.handler).toBe('function')
      // 같은 소스는 같은 바이트를 낸다. 코드 키가 내용 해시라서 필요하다
      const again = join(dir, 'again.mjs')
      await bundleCollectLambda(again)
      expect(readFileSync(again, 'utf8')).toBe(text)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
