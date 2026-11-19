#!/usr/bin/env tsx
/**
 * 워크숍 스택 seoul-workshop을 배포한다. 설계: docs/superpowers/specs/2026-11-19-workshop-gateway-design.md §5.2
 * 키와 코드 해시는 화면에 출력하지 않고 0600 임시 파일로만 CloudFormation에 넘긴다.
 */
import { parseArgs } from 'node:util'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { parseDotEnv } from '../src/client/env.js'
import {
  REGION, REPOSITORY, STACK, codeKeyOf, imageTag, registrationCommand, stackBlocker, stackParameters, type ParameterName,
} from './workshop-lib.js'
import { aws, awsJson, createStack, deleteStack, describeStack, run, sleep, stackOutputs, updateStack } from './workshop-aws.js'

const USAGE = `사용법:
  npm run workshop:deploy -- --env-file .env        처음 배포(키 필수). 이후에 주면 키를 바꾼다
  npm run workshop:deploy                           키는 그대로 두고 이미지와 인터셉터 코드를 갱신
  npm run workshop:deploy -- --skip-image           이미지는 그대로 두고 템플릿과 파라미터만 반영
  npm run workshop:deploy -- --skip-image --rate-per-minute 3 --quota-daily-limit 2   검증용 값
  npm run workshop:deploy -- --delete [--yes]       버킷을 비우고 스택 삭제(--yes가 없으면 계획만 출력)
스모크 테스트에서 코드 있는 호출까지 하려면 SEOUL_WORKSHOP_CODE 환경 변수에 코드를 넣는다.`

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATE = join(ROOT, 'infra', 'seoul-workshop.yaml')
const LAMBDA_DIR = join(ROOT, 'infra', 'lambda')

const { values } = parseArgs({
  options: {
    'env-file': { type: 'string' },
    'skip-image': { type: 'boolean', default: false },
    'rate-per-minute': { type: 'string' },
    'quota-daily-limit': { type: 'string' },
    delete: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

function keysFrom(file: string): Partial<Record<ParameterName, string>> {
  const env = parseDotEnv(readFileSync(file, 'utf8'))
  if (!env.SEOUL_API_KEY) throw new Error(`${file}에 SEOUL_API_KEY가 없습니다`)
  return { SeoulApiKey: env.SEOUL_API_KEY, SeoulSubwayApiKey: env.SEOUL_SUBWAY_API_KEY ?? '' }
}

function requireCleanTree(): void {
  if (run('git', ['status', '--porcelain'], { cwd: ROOT }).trim()) {
    throw new Error('작업 트리가 깨끗하지 않습니다. 이미지 태그가 커밋을 가리키도록 커밋한 뒤 배포하세요')
  }
}

function pushImage(): string {
  const account = awsJson(['sts', 'get-caller-identity']).Account as string
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string
  const tag = imageTag(version, run('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).trim())
  const registry = `${account}.dkr.ecr.${REGION}.amazonaws.com`
  const uri = `${registry}/${REPOSITORY}`
  const digestOf = (): string | undefined => {
    try {
      return awsJson(['ecr', 'describe-images', '--repository-name', REPOSITORY, '--image-ids', `imageTag=${tag}`])
        .imageDetails?.[0]?.imageDigest
    } catch {
      return undefined
    }
  }
  let digest = digestOf()
  if (digest) {
    console.log(`이미지 ${tag}가 이미 있어 그대로 씁니다`)
  } else {
    console.log(`이미지 ${tag}를 빌드해 올립니다`)
    run('docker', ['login', '--username', 'AWS', '--password-stdin', registry], { input: aws(['ecr', 'get-login-password']).trim() })
    run('docker', ['build', '--platform', 'linux/arm64', '-t', `${uri}:${tag}`, '.'], { cwd: ROOT, inherit: true })
    run('docker', ['push', `${uri}:${tag}`], { inherit: true })
    digest = digestOf()
    if (!digest) throw new Error(`올린 이미지 ${tag}의 digest를 찾지 못했습니다`)
  }
  return `${uri}@${digest}`
}

function uploadCode(bucket: string): string {
  const key = codeKeyOf(readFileSync(join(LAMBDA_DIR, 'code-check.mjs')))
  try {
    aws(['s3api', 'head-object', '--bucket', bucket, '--key', key])
    console.log(`인터셉터 코드 ${key}가 이미 있습니다`)
    return key
  } catch {
    // 없으면 아래에서 올린다
  }
  const dir = mkdtempSync(join(tmpdir(), 'seoul-code-'))
  try {
    const zip = join(dir, 'code-check.zip')
    run('zip', ['-q', '-X', zip, 'code-check.mjs'], { cwd: LAMBDA_DIR })
    aws(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', zip])
    console.log(`인터셉터 코드 ${key}를 올렸습니다`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return key
}

function checkRuntime(runtimeId: string): void {
  const r = awsJson(['bedrock-agentcore-control', 'get-agent-runtime', '--agent-runtime-id', runtimeId])
  console.log(`런타임 ${r.agentRuntimeName}: status=${r.status} platformVersion=${r.platformVersion}`)
  if (r.status !== 'READY' || r.platformVersion !== 'V2') throw new Error(`런타임 ${runtimeId}가 V2에서 READY가 아닙니다`)
}

/** 이미지가 바뀌면 tool 목록이 달라질 수 있어 대상을 명시적으로 동기화한다 */
async function syncTarget(gatewayId: string, targetId: string): Promise<void> {
  const get = () => awsJson(['bedrock-agentcore-control', 'get-gateway-target', '--gateway-identifier', gatewayId, '--target-id', targetId])
  const before = get().lastSynchronizedAt
  awsJson(['bedrock-agentcore-control', 'synchronize-gateway-targets', '--gateway-identifier', gatewayId, '--target-id-list', targetId])
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    const t = get()
    if (/FAILED|UNSUCCESSFUL/.test(String(t.status))) {
      throw new Error(`대상 동기화 실패: ${t.status} ${JSON.stringify(t.statusReasons ?? [])}`)
    }
    const advanced = before === undefined || t.lastSynchronizedAt !== before
    if (t.status === 'READY' && advanced) {
      console.log('대상 동기화를 마쳤습니다')
      return
    }
  }
  throw new Error('대상 동기화가 5분 안에 끝나지 않았습니다')
}

async function connect(url: string, code?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    code ? { requestInit: { headers: { Authorization: `Bearer ${code}` } } } : undefined,
  )
  const client = new Client({ name: 'seoul-workshop-smoke', version: '1.0.0' })
  await client.connect(transport)
  return client
}

async function listAllTools(client: Client): Promise<Array<{ name: string }>> {
  const tools: Array<{ name: string }> = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    tools.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)
  return tools
}

async function smoke(url: string): Promise<void> {
  let stage: string = 'none'
  try {
    const anonymous = await connect(url).catch(e => { stage = 'initialize'; throw e })
    await listAllTools(anonymous).catch(e => { stage = 'tools/list'; throw e })
    await anonymous.close()
  } catch {
    // stage에 어느 단계에서 막혔는지 남아 있다
  }
  if (stage === 'none') throw new Error('코드 없는 요청이 통과했습니다')
  console.log(`코드 없는 요청 거부 확인(${stage} 단계에서 거부)`)

  const code = process.env.SEOUL_WORKSHOP_CODE
  if (!code) {
    console.log('SEOUL_WORKSHOP_CODE가 없어 코드 있는 호출은 건너뜁니다')
    return
  }
  const client = await connect(url, code)
  const tools = await listAllTools(client)
  if (tools.length !== 23) throw new Error(`tool 수가 23이 아닙니다: ${tools.length}`)
  const result = await client.callTool({ name: 'seoul___search_place', arguments: { query: '강남' } })
  await client.close()
  if (result.isError) throw new Error('seoul___search_place 호출이 isError를 돌려줬습니다')
  console.log('코드 있는 호출 확인: tool 23개, seoul___search_place 성공')
}

function remove(stack: any): void {
  if (!stack) {
    console.log(`스택 ${STACK}이 없습니다`)
    return
  }
  if (stack.StackStatus?.endsWith('_IN_PROGRESS')) {
    console.log(stackBlocker(stack.StackStatus))
    return
  }
  // 첫 생성이 롤백되면 버킷이 이미 없고 Outputs도 비어 있다
  const bucket = stackOutputs(stack).BucketName
  console.log(bucket
    ? `삭제 대상: 스택 ${STACK}, 버킷 ${bucket}의 모든 객체. ECR 이미지는 지우지 않습니다`
    : `삭제 대상: 스택 ${STACK}. 버킷이 없어 비울 객체도 없습니다. ECR 이미지는 지우지 않습니다`)
  if (!values.yes) {
    console.log('실제로 지우려면 --yes를 붙여 다시 실행하세요')
    return
  }
  if (bucket) aws(['s3', 'rm', `s3://${bucket}`, '--recursive'])
  else console.log('버킷이 없어 비우기를 건너뜁니다')
  deleteStack()
  console.log('삭제했습니다')
}

async function main(): Promise<void> {
  if (values.help) {
    console.log(USAGE)
    return
  }
  let stack = describeStack()
  if (values.delete) return remove(stack)
  const blocker = stackBlocker(stack?.StackStatus)
  if (blocker) throw new Error(blocker)
  if (!values['skip-image']) requireCleanTree()
  const keys = values['env-file'] ? keysFrom(values['env-file']) : undefined

  if (!stack) {
    if (!keys) throw new Error('스택을 처음 만들 때는 --env-file이 필요합니다')
    console.log(`스택 ${STACK}을 이미지와 코드 없이 만듭니다`)
    createStack(stackParameters(keys, 'create'), TEMPLATE)
    stack = describeStack()
  }
  const created = stackOutputs(stack)
  if (values['skip-image'] && !created.RuntimeId) throw new Error('아직 런타임이 없어 --skip-image를 쓸 수 없습니다')
  const image = values['skip-image'] ? undefined : pushImage()
  const codeKey = uploadCode(created.BucketName)

  const given: Partial<Record<ParameterName, string>> = { CodeKey: codeKey, ...(keys ?? {}) }
  if (image) given.McpImageUri = image
  if (values['rate-per-minute']) given.RatePerMinute = values['rate-per-minute']
  if (values['quota-daily-limit']) given.QuotaDailyLimit = values['quota-daily-limit']
  console.log(updateStack(stackParameters(given, 'update'), TEMPLATE) ? '스택을 갱신했습니다' : '스택에 바뀐 것이 없습니다')

  const out = stackOutputs(describeStack())
  checkRuntime(out.RuntimeId)
  await syncTarget(out.GatewayId, out.TargetId)
  await smoke(out.GatewayUrl)
  console.log(`\nGateway URL: ${out.GatewayUrl}\n참가자 등록: ${registrationCommand(out.GatewayUrl)}`)
}

main().catch(e => {
  console.error((e as Error).message)
  process.exit(1)
})
