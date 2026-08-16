import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadDotEnv } from '../src/client/env.js'

const CLEAN = ['T_ALPHA', 'T_BETA', 'T_QUOTED', 'T_EXISTING']
let dir: string

afterEach(() => {
  for (const k of CLEAN) delete process.env[k]
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('loadDotEnv', () => {
  it('KEY=VALUE 파싱 + 주석/빈 줄 무시 + 따옴표 제거', () => {
    dir = mkdtempSync(join(tmpdir(), 'env-'))
    writeFileSync(join(dir, '.env'), '# comment\nT_ALPHA=one\n\nT_QUOTED="two two"\n')
    loadDotEnv(join(dir, '.env'))
    expect(process.env.T_ALPHA).toBe('one')
    expect(process.env.T_QUOTED).toBe('two two')
  })
  it('이미 설정된 환경변수는 덮어쓰지 않는다', () => {
    dir = mkdtempSync(join(tmpdir(), 'env-'))
    process.env.T_EXISTING = 'keep'
    writeFileSync(join(dir, '.env'), 'T_EXISTING=overwrite\nT_BETA=new\n')
    loadDotEnv(join(dir, '.env'))
    expect(process.env.T_EXISTING).toBe('keep')
    expect(process.env.T_BETA).toBe('new')
  })
  it('파일이 없으면 조용히 무시', () => {
    expect(() => loadDotEnv('/nonexistent/.env')).not.toThrow()
  })
})
