import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_NAMES } from '../src/index.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const distEntry = resolve(repoRoot, 'dist/index.js')

const INPUT_LINES = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
]
  .map((m) => JSON.stringify(m))
  .join('\n') + '\n'

/** entryPath로 node 프로세스를 띄우고 3줄 JSON-RPC 입력을 stdin으로 흘려보낸 뒤,
 * stdout의 마지막 줄(tools/list 응답)에서 tool 이름 목록을 정렬해 반환한다. */
function listToolsViaEntry(entryPath: string): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entryPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
      const last = lines[lines.length - 1]
      if (!last) {
        reject(new Error(`no stdout produced (exit=${code}, stderr=${stderr})`))
        return
      }
      try {
        const parsed = JSON.parse(last)
        const names: string[] = (parsed.result?.tools ?? []).map((t: { name: string }) => t.name).sort()
        resolvePromise(names)
      } catch (e) {
        reject(new Error(`invalid JSON on last stdout line: ${last}\n${(e as Error).message}`))
      }
    })
    child.stdin.write(INPUT_LINES)
    child.stdin.end()
  })
}

describe('CLI entry point (realpath-based detection)', () => {
  let tmpDir: string

  beforeAll(() => {
    // 빌드는 idempotent — 최신 소스로 dist/를 갱신
    execSync('npm run build', { cwd: repoRoot, stdio: 'pipe' })
    tmpDir = mkdtempSync(join(tmpdir(), 'seoul-mcp-cli-test-'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('직접 실행(node dist/index.js) 시 11개 tool을 서빙한다', async () => {
    const names = await listToolsViaEntry(distEntry)
    expect(names).toEqual([...TOOL_NAMES].sort())
  }, 10_000)

  it('npm bin 심볼릭 링크를 통해 실행해도 동일하게 11개 tool을 서빙한다', async () => {
    const symlinkPath = join(tmpDir, 'seoul-opendata-mcp')
    symlinkSync(distEntry, symlinkPath)
    const names = await listToolsViaEntry(symlinkPath)
    expect(names).toEqual([...TOOL_NAMES].sort())
  }, 10_000)
})
