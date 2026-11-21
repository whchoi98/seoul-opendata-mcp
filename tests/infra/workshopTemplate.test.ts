import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

const TEXT = readFileSync(new URL('../../infra/seoul-workshop.yaml', import.meta.url), 'utf8')
// CloudFormation 짧은 태그를 { Ref: ... } 같은 객체로 읽는다
const FNS = ['Ref', 'Sub', 'GetAtt', 'Not', 'Equals', 'And', 'Or', 'If', 'Condition', 'Join', 'Select', 'Split']
const KINDS = ['scalar', 'sequence', 'mapping'] as const
const SCHEMA = yaml.DEFAULT_SCHEMA.extend(
  FNS.flatMap(fn => KINDS.map(kind => new yaml.Type(`!${fn}`, { kind, construct: (d: unknown) => ({ [fn]: d }) }))),
)
const T = yaml.load(TEXT, { schema: SCHEMA }) as any
const R = T.Resources

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v])
const statements = (role: string): any[] =>
  R[role].Properties.Policies.flatMap((p: any) => p.PolicyDocument.Statement)

describe('infra/seoul-workshop.yaml', () => {
  it('런타임은 V2, MCP, PUBLIC이고 인바운드 인증을 따로 두지 않는다', () => {
    const rt = R.WorkshopRuntime
    expect(rt.Type).toBe('AWS::BedrockAgentCore::Runtime')
    expect(rt.Condition).toBe('HasImage')
    const p = rt.Properties
    expect(p.AgentRuntimeName).toBe('seoul_workshop_mcp')
    expect(p.PlatformVersion).toBe('V2')
    expect(p.ProtocolConfiguration).toBe('MCP')
    expect(p.NetworkConfiguration).toEqual({ NetworkMode: 'PUBLIC' })
    expect(p.AuthorizerConfiguration).toBeUndefined()
    expect(p.LifecycleConfiguration).toEqual({ IdleRuntimeSessionTimeout: 900, MaxLifetime: 28800 })
    expect(p.EnvironmentVariables).toEqual({
      SEOUL_API_KEY: { Ref: 'SeoulApiKey' },
      SEOUL_SUBWAY_API_KEY: { Ref: 'SeoulSubwayApiKey' },
      CACHE_TABLE_NAME: { Ref: 'WorkshopTable' },
      QUOTA_DAILY_LIMIT: { Ref: 'QuotaDailyLimit' },
      STORE_URI: { Sub: 's3://${WorkshopBucket}/store/v1' },
    })
  })

  it('런타임 역할은 store/ 아래 객체만 읽고 목록 권한은 store/ 접두사로 제한한다', () => {
    const st = statements('RuntimeRole')
    expect(st.find(s => s.Sid === 'StoreRead')).toEqual({
      Sid: 'StoreRead', Effect: 'Allow', Action: 's3:GetObject', Resource: { Sub: '${WorkshopBucket.Arn}/store/*' },
    })
    expect(st.find(s => s.Sid === 'StoreList')).toEqual({
      Sid: 'StoreList', Effect: 'Allow', Action: 's3:ListBucket', Resource: { GetAtt: 'WorkshopBucket.Arn' },
      Condition: { StringLike: { 's3:prefix': 'store/*' } },
    })
    const s3Actions = st.flatMap(s => asList(s.Action)).filter(a => String(a).startsWith('s3:')).sort()
    expect(s3Actions).toEqual(['s3:GetObject', 's3:ListBucket'])
  })

  it('버킷은 store/ 아래 객체만 90일 뒤에 지운다', () => {
    expect(R.WorkshopBucket.Properties.LifecycleConfiguration).toEqual({
      Rules: [{ Id: 'expire-store-snapshots', Status: 'Enabled', Prefix: 'store/', ExpirationInDays: 90 }],
    })
  })

  it('Gateway는 인증 없음과 헤더를 받는 REQUEST 인터셉터 하나로 막는다', () => {
    const gw = R.WorkshopGateway
    expect(gw.Type).toBe('AWS::BedrockAgentCore::Gateway')
    expect(gw.Condition).toBe('HasAll')
    const p = gw.Properties
    expect(p.AuthorizerType).toBe('NONE')
    expect(p.AuthorizerConfiguration).toBeUndefined()
    expect(p.InterceptorConfigurations).toEqual([{
      Interceptor: { Lambda: { Arn: { GetAtt: 'CodeCheckFunction.Arn' } } },
      InterceptionPoints: ['REQUEST'],
      InputConfiguration: { PassRequestHeaders: true },
    }])
    expect(p.ProtocolConfiguration.Mcp.SearchType).toBeUndefined()
    expect(p.ProtocolConfiguration.Mcp.SupportedVersions).toEqual(['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'])
  })

  it('대상 seoul은 Gateway 역할의 SigV4로 런타임을 부른다', () => {
    const tg = R.SeoulTarget
    expect(tg.Type).toBe('AWS::BedrockAgentCore::GatewayTarget')
    expect(tg.Condition).toBe('HasAll')
    expect(tg.Properties.Name).toBe('seoul')
    expect(tg.Properties.GatewayIdentifier).toEqual({ Ref: 'WorkshopGateway' })
    expect(tg.Properties.CredentialProviderConfigurations).toEqual([{
      CredentialProviderType: 'GATEWAY_IAM_ROLE',
      CredentialProvider: { IamCredentialProvider: { Service: 'bedrock-agentcore', Region: { Ref: 'AWS::Region' } } },
    }])
    const server = tg.Properties.TargetConfiguration.Mcp.McpServer
    expect(server.ListingMode).toBe('DEFAULT')
    expect(server.Endpoint.Sub).toBe(
      'https://bedrock-agentcore.${AWS::Region}.${AWS::URLSuffix}/runtimes/arn%3A${AWS::Partition}%3Abedrock-agentcore%3A${AWS::Region}%3A${AWS::AccountId}%3Aruntime%2F${WorkshopRuntime.AgentRuntimeId}/invocations?qualifier=DEFAULT',
    )
  })

  it('Gateway 역할은 이 스택의 인터셉터와 런타임만 호출한다', () => {
    const st = statements('GatewayRole')
    expect(st.flatMap(s => asList(s.Action)).sort()).toEqual(['bedrock-agentcore:InvokeAgentRuntime', 'lambda:InvokeFunction'])
    const text = JSON.stringify(st)
    expect(text).toContain(':function:${AWS::StackName}-code-check')
    expect(text).toContain(':runtime/seoul_workshop_mcp-*')
  })

  it('Resource "*"는 ecr:GetAuthorizationToken에만 쓴다', () => {
    const roles = Object.keys(R).filter(k => R[k].Type === 'AWS::IAM::Role')
    const wildcard = roles
      .flatMap(statements)
      .filter(s => asList(s.Resource).includes('*'))
      .flatMap(s => asList(s.Action))
    expect(wildcard).toEqual(['ecr:GetAuthorizationToken'])
  })

  it('계정 ID, ARN 리터럴, 기존 리소스 이름이 없다', () => {
    expect(TEXT).not.toMatch(/\b\d{12}\b/)
    expect(TEXT).not.toContain('arn:aws:')
    for (const name of ['seoul_opendata_mcp', 'myseoul_mcp', 'seoul-mcp-cache']) expect(TEXT).not.toContain(name)
  })

  it('테이블 TTL은 expireAt이고 키와 코드 해시 파라미터는 NoEcho다', () => {
    expect(R.WorkshopTable.Properties.TimeToLiveSpecification).toEqual({ AttributeName: 'expireAt', Enabled: true })
    for (const name of ['SeoulApiKey', 'SeoulSubwayApiKey', 'CodeSha256']) expect(T.Parameters[name].NoEcho).toBe(true)
    expect(T.Parameters.CodeValidUntil.NoEcho).toBeUndefined()
  })

  it('인터셉터 Lambda는 코드 키가 있을 때만 만들고 판정 값을 환경 변수로 받는다', () => {
    const fn = R.CodeCheckFunction
    expect(fn.Condition).toBe('HasCode')
    expect(fn.Properties.Handler).toBe('code-check.handler')
    expect(fn.Properties.Runtime).toBe('nodejs22.x')
    expect(fn.Properties.FunctionName).toEqual({ Sub: '${AWS::StackName}-code-check' })
    expect(fn.Properties.Environment.Variables).toEqual({
      CODE_SHA256: { Ref: 'CodeSha256' },
      VALID_UNTIL: { Ref: 'CodeValidUntil' },
      RATE_PER_MINUTE: { Ref: 'RatePerMinute' },
      TABLE_NAME: { Ref: 'WorkshopTable' },
    })
  })

  it('배포 스크립트가 읽는 출력이 모두 있다', () => {
    expect(Object.keys(T.Outputs).sort()).toEqual(
      ['BucketName', 'GatewayId', 'GatewayUrl', 'RuntimeArn', 'RuntimeId', 'TableName', 'TargetId'],
    )
  })

  it('스케줄 리소스는 CollectSchedule과 CollectCodeKey가 모두 있을 때만 만든다', () => {
    expect(T.Parameters.CollectSchedule).toMatchObject({ Type: 'String', Default: '' })
    expect(T.Parameters.CollectCodeKey).toMatchObject({ Type: 'String', Default: '' })
    expect(T.Conditions.HasSchedule).toEqual({
      And: [{ Not: [{ Equals: [{ Ref: 'CollectSchedule' }, ''] }] }, { Not: [{ Equals: [{ Ref: 'CollectCodeKey' }, ''] }] }],
    })
    for (const name of ['CollectLogGroup', 'CollectRole', 'CollectFunction', 'CollectInvokeConfig', 'CollectScheduleRole', 'CollectDailySchedule']) {
      expect(R[name].Condition, name).toBe('HasSchedule')
    }
  })

  it('수집 Lambda는 Node.js 22 arm64, 15분이고 store/와 쿼터 장부만 쓴다', () => {
    const fn = R.CollectFunction.Properties
    expect(fn).toMatchObject({ Runtime: 'nodejs22.x', Architectures: ['arm64'], Handler: 'collect.handler', Timeout: 900 })
    expect(fn.FunctionName).toEqual({ Sub: '${AWS::StackName}-collect' })
    expect(fn.Code).toEqual({ S3Bucket: { Ref: 'WorkshopBucket' }, S3Key: { Ref: 'CollectCodeKey' } })
    expect(fn.Environment.Variables).toEqual({
      SEOUL_API_KEY: { Ref: 'SeoulApiKey' },
      STORE_URI: { Sub: 's3://${WorkshopBucket}/store/v1' },
      TABLE_NAME: { Ref: 'WorkshopTable' },
      QUOTA_DAILY_LIMIT: { Ref: 'QuotaDailyLimit' },
    })
    const st = statements('CollectRole')
    expect(st.flatMap(s => asList(s.Action)).sort()).toEqual([
      'dynamodb:GetItem', 'dynamodb:UpdateItem', 'logs:CreateLogStream', 'logs:PutLogEvents', 's3:GetObject', 's3:ListBucket', 's3:PutObject',
    ])
    expect(st.find(s => s.Sid === 'StoreReadWrite').Resource).toEqual({ Sub: '${WorkshopBucket.Arn}/store/*' })
    expect(st.find(s => s.Sid === 'StoreList').Condition).toEqual({ StringLike: { 's3:prefix': 'store/*' } })
    expect(R.CollectLogGroup.Properties).toEqual({ LogGroupName: { Sub: '/aws/lambda/${AWS::StackName}-collect' }, RetentionInDays: 14 })
    expect(R.CollectInvokeConfig.Properties).toEqual({ FunctionName: { Ref: 'CollectFunction' }, Qualifier: '$LATEST', MaximumRetryAttempts: 0 })
  })

  it('스케줄은 서울 시간으로 수집 Lambda만 부른다', () => {
    const s = R.CollectDailySchedule
    expect(s.Type).toBe('AWS::Scheduler::Schedule')
    expect(s.Properties.ScheduleExpression).toEqual({ Ref: 'CollectSchedule' })
    expect(s.Properties.ScheduleExpressionTimezone).toBe('Asia/Seoul')
    expect(s.Properties.FlexibleTimeWindow).toEqual({ Mode: 'OFF' })
    expect(s.Properties.Target).toEqual({
      Arn: { GetAtt: 'CollectFunction.Arn' }, RoleArn: { GetAtt: 'CollectScheduleRole.Arn' }, Input: '{}', RetryPolicy: { MaximumRetryAttempts: 0 },
    })
    expect(statements('CollectScheduleRole')).toEqual([
      { Sid: 'Invoke', Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: { GetAtt: 'CollectFunction.Arn' } },
    ])
    expect(R.CollectScheduleRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal).toEqual({ Service: 'scheduler.amazonaws.com' })
  })

  it('스크립트의 PARAMETERS 목록이 템플릿의 파라미터와 같다', async () => {
    const { PARAMETERS } = await import('../../scripts/workshop-lib.js')
    expect([...PARAMETERS].sort()).toEqual(Object.keys(T.Parameters).sort())
  })
})
