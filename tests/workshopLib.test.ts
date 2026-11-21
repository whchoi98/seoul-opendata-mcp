import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  CODE_ALPHABET, PARAMETERS, newCode, sha256Hex, parseDays, kstIso, stackParameters,
  imageTag, codeKeyOf, registrationCommand, withSecretFile, stackBlocker,
} from '../scripts/workshop-lib.js'

describe('workshop-lib', () => {
  it('코드는 seoul-XXXX-XXXX 형식이고 헷갈리는 문자를 쓰지 않는다', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^seoul-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
    expect(CODE_ALPHABET).toHaveLength(32)
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/)
  })

  it('코드 문자는 주입한 난수로 고른다', () => {
    expect(newCode(() => 0)).toBe('seoul-2222-2222')
    expect(newCode(max => max - 1)).toBe('seoul-ZZZZ-ZZZZ')
  })

  it('sha256Hex는 Node crypto와 같은 값을 낸다', () => {
    expect(sha256Hex('seoul-ABCD-2345')).toBe(createHash('sha256').update('seoul-ABCD-2345').digest('hex'))
  })

  it('--days는 기본 1이고 1~14 정수만 받는다', () => {
    expect(parseDays(undefined)).toBe(1)
    expect(parseDays('14')).toBe(14)
    for (const bad of ['0', '15', '1.5', 'two', '']) expect(() => parseDays(bad)).toThrow()
  })

  it('kstIso는 +09:00 오프셋의 초 단위 시각이다', () => {
    expect(kstIso(Date.UTC(2026, 10, 19, 1, 2, 3, 456))).toBe('2026-11-19T10:02:03+09:00')
    expect(Date.parse(kstIso(Date.UTC(2026, 10, 19, 15, 0, 0)))).toBe(Date.UTC(2026, 10, 19, 15, 0, 0))
  })

  it('update에서는 주지 않은 파라미터를 이전 값으로 유지한다', () => {
    const params = stackParameters({ CodeKey: 'code/x.zip' }, 'update')
    expect(params).toHaveLength(PARAMETERS.length)
    expect(params.find(p => p.ParameterKey === 'CodeKey')).toEqual({ ParameterKey: 'CodeKey', ParameterValue: 'code/x.zip' })
    expect(params.find(p => p.ParameterKey === 'SeoulApiKey')).toEqual({ ParameterKey: 'SeoulApiKey', UsePreviousValue: true })
  })

  it('create에서는 주지 않은 파라미터를 빼서 템플릿 기본값을 쓴다', () => {
    expect(stackParameters({ SeoulApiKey: 'k1,k2' }, 'create')).toEqual([{ ParameterKey: 'SeoulApiKey', ParameterValue: 'k1,k2' }])
  })

  it('이미지 태그와 코드 키 형식', () => {
    expect(imageTag('0.7.0', '1234567890abcdef')).toBe('0.7.0-workshop-1234567')
    expect(codeKeyOf('export const x = 1\n')).toMatch(/^code\/code-check-[0-9a-f]{16}\.zip$/)
    expect(codeKeyOf('a')).toBe(codeKeyOf('a'))
    expect(codeKeyOf('a')).not.toBe(codeKeyOf('b'))
  })

  it('등록 명령에는 코드 대신 자리 표시가 들어간다', () => {
    expect(registrationCommand('https://gw.example/mcp')).toBe(
      'claude mcp add --transport http seoul https://gw.example/mcp --header "Authorization: Bearer <코드>"',
    )
  })

  it('withSecretFile은 0600 파일을 쓰고 끝나면 지운다', () => {
    let seen = ''
    const result = withSecretFile({ secret: 's' }, path => {
      seen = path
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ secret: 's' })
      return 42
    })
    expect(result).toBe(42)
    expect(existsSync(seen)).toBe(false)
  })

  it('withSecretFile은 fn이 던져도 파일을 지운다', () => {
    let seen = ''
    expect(() => withSecretFile({}, path => { seen = path; throw new Error('boom') })).toThrow('boom')
    expect(existsSync(seen)).toBe(false)
  })

  it('stackBlocker는 복구가 필요하거나 진행 중인 스택만 막는다', () => {
    expect(stackBlocker('ROLLBACK_COMPLETE')).toContain('--delete --yes')
    expect(stackBlocker('UPDATE_IN_PROGRESS')).toContain('UPDATE_IN_PROGRESS')
    expect(stackBlocker('CREATE_IN_PROGRESS')).toContain('CREATE_IN_PROGRESS')
    expect(stackBlocker('CREATE_COMPLETE')).toBeUndefined()
    expect(stackBlocker('UPDATE_COMPLETE')).toBeUndefined()
    expect(stackBlocker('UPDATE_ROLLBACK_COMPLETE')).toBeUndefined()
    expect(stackBlocker(undefined)).toBeUndefined()
  })
})

describe('parseCollectDays', () => {
  it('없으면 undefined, 1~60 정수만 받는다', async () => {
    const { parseCollectDays } = await import('../scripts/workshop-lib.js')
    expect(parseCollectDays(undefined)).toBeUndefined()
    expect(parseCollectDays('1')).toBe(1)
    expect(parseCollectDays('60')).toBe(60)
    for (const bad of ['0', '61', '1.5', 'two', '']) expect(() => parseCollectDays(bad)).toThrow('--days')
  })
})

describe('새 파라미터와 수집 코드 키', () => {
  it('PARAMETERS에 수집 스케줄 파라미터가 있다', () => {
    expect(PARAMETERS).toContain('CollectSchedule')
    expect(PARAMETERS).toContain('CollectCodeKey')
  })

  it('update에서 스택에 아직 없는 파라미터는 빼서 템플릿 기본값을 쓴다', () => {
    const existing = ['McpImageUri', 'McpRepositoryName', 'CodeKey', 'SeoulApiKey', 'SeoulSubwayApiKey', 'CodeSha256', 'CodeValidUntil', 'RatePerMinute', 'QuotaDailyLimit']
    const params = stackParameters({ CodeKey: 'code/x.zip', CollectCodeKey: 'code/collect-1.zip' }, 'update', existing)
    expect(params.map(p => p.ParameterKey)).not.toContain('CollectSchedule')
    expect(params.find(p => p.ParameterKey === 'CollectCodeKey')).toEqual({ ParameterKey: 'CollectCodeKey', ParameterValue: 'code/collect-1.zip' })
    expect(params.find(p => p.ParameterKey === 'SeoulApiKey')).toEqual({ ParameterKey: 'SeoulApiKey', UsePreviousValue: true })
    expect(params).toHaveLength(10)
  })

  it('스택에 이미 있는 파라미터는 이전 값을 유지한다', () => {
    const params = stackParameters({}, 'update', [...PARAMETERS])
    expect(params).toHaveLength(PARAMETERS.length)
    expect(params.every(p => p.UsePreviousValue === true)).toBe(true)
  })

  it('코드 키는 이름을 바꿔 쓸 수 있다', () => {
    expect(codeKeyOf('a', 'collect')).toMatch(/^code\/collect-[0-9a-f]{16}\.zip$/)
    expect(codeKeyOf('a')).toMatch(/^code\/code-check-[0-9a-f]{16}\.zip$/)
  })
})
