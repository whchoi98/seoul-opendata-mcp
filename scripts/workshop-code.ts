#!/usr/bin/env tsx
/**
 * 워크숍 코드를 발급, 폐기, 조회한다. 설계: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md §5.3
 * 코드 원문은 new에서 한 번만 출력한다. 스택에는 해시만 남는다.
 */
import { parseArgs } from 'node:util'
import { STACK, kstIso, newCode, parseDays, sha256Hex, stackParameters } from './workshop-lib.js'
import { describeStack, stackParameterValue, updateStack } from './workshop-aws.js'

const USAGE = `사용법:
  npm run workshop:code -- new [--days N]   새 코드 발급(기본 1일, 최대 14일)
  npm run workshop:code -- revoke           지금 바로 만료
  npm run workshop:code -- show             만료 시각과 남은 시간`

const { values, positionals } = parseArgs({ allowPositionals: true, options: { days: { type: 'string' } } })

function main(): void {
  const command = positionals[0]
  if (command !== 'new' && command !== 'revoke' && command !== 'show') {
    console.log(USAGE)
    if (command) process.exitCode = 1
    return
  }
  const days = command === 'new' ? parseDays(values.days) : 0 // AWS를 부르기 전에 인자를 검사한다
  const stack = describeStack()
  if (!stack) throw new Error(`스택 ${STACK}이 없습니다. 먼저 npm run workshop:deploy를 실행하세요`)

  if (command === 'new') {
    const code = newCode()
    const until = kstIso(Date.now() + days * 86_400_000)
    updateStack(stackParameters({ CodeSha256: sha256Hex(code), CodeValidUntil: until }, 'update'))
    console.log(`새 워크숍 코드: ${code}\n만료: ${until}\n이 코드는 다시 출력되지 않습니다.`)
    return
  }
  if (command === 'revoke') {
    const now = kstIso(Date.now())
    updateStack(stackParameters({ CodeValidUntil: now }, 'update'))
    console.log(`코드를 폐기했습니다(만료 시각 ${now})`)
    return
  }
  const until = stackParameterValue(stack, 'CodeValidUntil')
  if (!until) {
    console.log('발급된 코드가 없습니다')
    return
  }
  const hours = (Date.parse(until) - Date.now()) / 3_600_000
  console.log(hours > 0 ? `만료: ${until} (약 ${hours.toFixed(1)}시간 남음)` : `만료: ${until} (이미 만료됨)`)
}

try {
  main()
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
