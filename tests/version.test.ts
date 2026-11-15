import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SERVER_VERSION } from '../src/index.js'

const json = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

describe('버전 단일화', () => {
  it('package.json, manifest.json, SERVER_VERSION이 같은 버전을 가리킨다', () => {
    const pkg = json('package.json').version
    expect(json('manifest.json').version).toBe(pkg)
    expect(SERVER_VERSION).toBe(pkg)
  })

  it('CHANGELOG 영문·한국어 절 모두 현재 버전 항목을 가진다', () => {
    const pkg = json('package.json').version
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
    expect(changelog.match(new RegExp(`^## \\[${pkg.replace(/\./g, '\\.')}\\]`, 'gm'))?.length).toBe(2)
  })
})
