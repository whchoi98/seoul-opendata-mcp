/** 워크숍 스크립트의 순수 함수. 설계: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md §5 */
import { createHash, randomInt } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const REGION = 'ap-northeast-2'
export const STACK = 'seoul-workshop'
export const REPOSITORY = 'seoul-opendata-mcp'
export const MAX_DAYS = 14
/** 0, 1, O, I를 뺀 32자. 슬라이드를 보고 손으로 칠 때 헷갈리지 않게 한다 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** infra/seoul-workshop.yaml의 파라미터. 순서는 출력용으로만 의미가 있다 */
export const PARAMETERS = [
  'McpImageUri', 'McpRepositoryName', 'CodeKey', 'SeoulApiKey', 'SeoulSubwayApiKey',
  'CodeSha256', 'CodeValidUntil', 'RatePerMinute', 'QuotaDailyLimit',
] as const
export type ParameterName = typeof PARAMETERS[number]

export interface StackParameter { ParameterKey: string; ParameterValue?: string; UsePreviousValue?: boolean }

/** seoul-XXXX-XXXX. 8자 x 5비트 = 40비트 */
export function newCode(pick: (max: number) => number = randomInt): string {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join('')
  return `seoul-${part()}-${part()}`
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function parseDays(raw: string | undefined): number {
  if (raw === undefined) return 1
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
    throw new Error(`--days는 1~${MAX_DAYS} 사이 정수여야 합니다: ${raw}`)
  }
  return n
}

/** workshop:collect의 --days. 날짜 파티션을 며칠 치 받을지 정한다 */
export function parseCollectDays(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(n) || n < 1 || n > 60) throw new Error(`--days는 1~60 사이 정수여야 합니다: ${raw}`)
  return n
}

/** KST ISO 8601 시각(초 단위, +09:00). 템플릿 CodeValidUntil의 AllowedPattern과 같은 형식 */
export function kstIso(ms: number): string {
  return `${new Date(ms + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`
}

/** create: 주지 않은 파라미터는 빼서 템플릿 기본값을 쓴다. update: 주지 않은 파라미터는 이전 값을 유지한다 */
export function stackParameters(given: Partial<Record<ParameterName, string>>, mode: 'create' | 'update'): StackParameter[] {
  return PARAMETERS.flatMap((key): StackParameter[] => {
    const value = given[key]
    if (value !== undefined) return [{ ParameterKey: key, ParameterValue: value }]
    return mode === 'update' ? [{ ParameterKey: key, UsePreviousValue: true }] : []
  })
}

export function imageTag(version: string, commit: string): string {
  return `${version}-workshop-${commit.slice(0, 7)}`
}

/** zip은 만들 때마다 안의 시각이 달라지므로 원본 파일의 해시로 키를 정한다 */
export function codeKeyOf(source: string | Buffer): string {
  return `code/code-check-${sha256Hex(source).slice(0, 16)}.zip`
}

/** 스택이 지금 갱신하거나 삭제할 수 없는 상태면 그 이유를 돌려준다. 정상 상태나 스택이 없으면 undefined */
export function stackBlocker(status: string | undefined): string | undefined {
  if (status === 'ROLLBACK_COMPLETE') {
    return `스택 ${STACK}의 첫 생성이 실패해 ROLLBACK_COMPLETE 상태입니다. npm run workshop:deploy -- --delete --yes로 지운 뒤 다시 배포하세요`
  }
  if (status?.endsWith('_IN_PROGRESS')) {
    return `스택 ${STACK}이 ${status} 상태입니다. 끝난 뒤 다시 실행하세요`
  }
  return undefined
}

export function registrationCommand(gatewayUrl: string): string {
  return `claude mcp add --transport http seoul ${gatewayUrl} --header "Authorization: Bearer <코드>"`
}

/** 비밀이 든 JSON을 0600 파일로 쓰고 fn에 경로를 넘긴 뒤 반드시 지운다. 명령 인자(ps에 보임)에 비밀을 싣지 않기 위함 */
export function withSecretFile<T>(value: unknown, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'seoul-workshop-'))
  const path = join(dir, 'parameters.json')
  try {
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
    return fn(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
