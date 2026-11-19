import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadDotEnv, parseDotEnv } from '../src/client/env.js'

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

describe('parseDotEnv', () => {
  it('주석과 빈 줄을 건너뛰고 따옴표를 벗긴다', () => {
    expect(parseDotEnv('# c\nA=one\n\nB="two two"\nC=\'three\'\nbad line\n=novalue\n')).toEqual({
      A: 'one', B: 'two two', C: 'three',
    })
  })

  it('쉼표 목록 값을 그대로 둔다', () => {
    expect(parseDotEnv('SEOUL_API_KEY=k1,k2\n')).toEqual({ SEOUL_API_KEY: 'k1,k2' })
  })

  it('같은 키가 여러 번 나오면 처음 비어 있지 않은 값을 쓴다(loadDotEnv 기존 동작)', () => {
    expect(parseDotEnv('D=first\nD=second\nE=\nE=later\n')).toEqual({ D: 'first', E: 'later' })
  })
})
