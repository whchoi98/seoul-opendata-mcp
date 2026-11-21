/** aws CLI와 docker 호출 래퍼. 인자는 배열로만 넘기고 셸 문자열을 만들지 않는다 */
import { execFileSync } from 'node:child_process'
import { REGION, STACK, withSecretFile, type StackParameter } from './workshop-lib.js'

export interface RunOptions { input?: string; cwd?: string; inherit?: boolean }

/** 실패하면 명령 이름, 앞 두 인자, stderr만 담아 던진다. 뒤 인자(경로, 값)는 오류 메시지에 넣지 않는다 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): string {
  try {
    const out = execFileSync(cmd, args, {
      cwd: opts.cwd,
      input: opts.input,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: opts.inherit ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
    })
    return out ?? ''
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? '').trim()
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} 실패${stderr ? `: ${stderr}` : ''}`)
  }
}

export function aws(args: string[], opts: RunOptions = {}): string {
  return run('aws', [...args, '--region', REGION], opts)
}

export function awsJson<T = any>(args: string[]): T {
  const out = aws([...args, '--output', 'json']).trim()
  return (out ? JSON.parse(out) : {}) as T
}

export function describeStack(): any | undefined {
  try {
    return awsJson(['cloudformation', 'describe-stacks', '--stack-name', STACK]).Stacks[0]
  } catch (e) {
    if ((e as Error).message.includes('does not exist')) return undefined
    throw e
  }
}

export function stackOutputs(stack: any): Record<string, string> {
  return Object.fromEntries((stack?.Outputs ?? []).map((o: any) => [o.OutputKey, o.OutputValue]))
}

export function stackParameterValue(stack: any, key: string): string | undefined {
  return (stack?.Parameters ?? []).find((p: any) => p.ParameterKey === key)?.ParameterValue
}

/** 스택이 지금 가진 파라미터 이름. 템플릿에 새로 생긴 파라미터를 가려내는 데 쓴다 */
export function stackParameterKeys(stack: any): string[] {
  return (stack?.Parameters ?? []).map((p: any) => p.ParameterKey)
}

/** 실패한 리소스와 이유. 배포가 실패했을 때 원인을 바로 보여 준다 */
function failureReasons(): string {
  try {
    const events = awsJson(['cloudformation', 'describe-stack-events', '--stack-name', STACK, '--max-items', '30']).StackEvents ?? []
    return events
      .filter((e: any) => /FAILED/.test(e.ResourceStatus) && e.ResourceStatusReason)
      .map((e: any) => `${e.LogicalResourceId}: ${e.ResourceStatusReason}`)
      .join('\n')
  } catch {
    return ''
  }
}

function waitFor(state: 'stack-create-complete' | 'stack-update-complete' | 'stack-delete-complete'): void {
  try {
    aws(['cloudformation', 'wait', state, '--stack-name', STACK])
  } catch (e) {
    const reasons = failureReasons()
    throw new Error(`${(e as Error).message}${reasons ? `\n${reasons}` : ''}`)
  }
}

export function createStack(parameters: StackParameter[], templatePath: string): void {
  withSecretFile(parameters, path => aws([
    'cloudformation', 'create-stack', '--stack-name', STACK,
    '--template-body', `file://${templatePath}`,
    '--parameters', `file://${path}`,
    '--capabilities', 'CAPABILITY_IAM',
  ]))
  waitFor('stack-create-complete')
}

/** 바뀐 것이 없으면 false. templatePath를 주지 않으면 이전 템플릿을 그대로 쓴다 */
export function updateStack(parameters: StackParameter[], templatePath?: string): boolean {
  try {
    withSecretFile(parameters, path => aws([
      'cloudformation', 'update-stack', '--stack-name', STACK,
      ...(templatePath ? ['--template-body', `file://${templatePath}`] : ['--use-previous-template']),
      '--parameters', `file://${path}`,
      '--capabilities', 'CAPABILITY_IAM',
    ]))
  } catch (e) {
    if ((e as Error).message.includes('No updates are to be performed')) return false
    throw e
  }
  waitFor('stack-update-complete')
  return true
}

export function deleteStack(): void {
  aws(['cloudformation', 'delete-stack', '--stack-name', STACK])
  waitFor('stack-delete-complete')
}

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
