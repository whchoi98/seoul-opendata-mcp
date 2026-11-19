import { describe, it, expect } from 'vitest'
import { run, stackOutputs, stackParameterValue } from '../scripts/workshop-aws.js'

describe('workshop-aws', () => {
  it('run은 표준 출력을 돌려준다', () => {
    expect(run('node', ['-e', 'process.stdout.write("ok")'])).toBe('ok')
  })

  it('run이 실패하면 앞 두 인자와 stderr만 오류에 넣고 뒤 인자는 넣지 않는다', () => {
    let message = ''
    try {
      run('node', ['-e', 'console.error("boom"); process.exit(3)', 'SECRETARG'])
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('boom')
    expect(message).toContain('node -e')
    expect(message).not.toContain('SECRETARG')
  })

  it('run은 input을 표준 입력으로 넘긴다', () => {
    expect(run('node', ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'piped' })).toBe('piped')
  })

  it('스택 출력과 파라미터를 이름으로 읽는다', () => {
    const stack = {
      Outputs: [{ OutputKey: 'GatewayUrl', OutputValue: 'https://gw/mcp' }],
      Parameters: [{ ParameterKey: 'CodeValidUntil', ParameterValue: '2026-11-20T18:00:00+09:00' }],
    }
    expect(stackOutputs(stack)).toEqual({ GatewayUrl: 'https://gw/mcp' })
    expect(stackOutputs(undefined)).toEqual({})
    expect(stackParameterValue(stack, 'CodeValidUntil')).toBe('2026-11-20T18:00:00+09:00')
    expect(stackParameterValue(stack, 'Missing')).toBeUndefined()
  })
})
