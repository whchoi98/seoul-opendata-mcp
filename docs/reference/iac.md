# Infrastructure as Code / IaC 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview

The IaC layer declares the workshop stack `seoul-workshop` in one CloudFormation template and deploys it with two TypeScript scripts. It exists so that the workshop environment can be created, changed and removed with one command each, with secrets kept out of the terminal and out of the repository. What the deployed resources do at run time is in [infrastructure.md](infrastructure.md).

### 2. Components

| Component | Path | Purpose |
|---|---|---|
| Stack template | `infra/seoul-workshop.yaml` | Nine parameters, three conditions, ten resources and seven outputs. Declares the table, bucket, three IAM roles, runtime, interceptor log group and function, gateway and gateway target |
| Conditions | `infra/seoul-workshop.yaml` (`HasImage`, `HasCode`, `HasAll`) | Let the stack exist before the image and the interceptor zip do. The runtime needs `HasImage`, the Lambda and its log group need `HasCode`, the gateway and target need both |
| Deploy script | `scripts/workshop-deploy.ts` | `npm run workshop:deploy`. Creates the stack in two passes or updates it, builds and pushes the image, uploads the interceptor zip, checks the runtime, synchronizes the gateway target and runs a smoke test. `--delete --yes` empties the bucket and deletes the stack |
| Code script | `scripts/workshop-code.ts` | `npm run workshop:code -- new|revoke|show`. Changes only `CodeSha256` and `CodeValidUntil`, keeping every other parameter at its previous value |
| Pure helpers | `scripts/workshop-lib.ts` | Region, stack name, parameter list, `stackParameters` (`UsePreviousValue` on update), `imageTag`, `codeKeyOf`, `stackBlocker`, `withSecretFile` |
| CLI wrappers | `scripts/workshop-aws.ts` | `createStack`, `updateStack` and `deleteStack` call the `aws` CLI with `CAPABILITY_IAM` and wait for completion. `updateStack` returns `false` when CloudFormation reports no changes |
| Template tests | `tests/infra/workshopTemplate.test.ts` | Parses the YAML and checks the runtime, gateway, target, IAM scope, `NoEcho` parameters, outputs, and that no account id, ARN literal or foreign resource name appears |
| Script tests | `tests/workshopLib.test.ts`, `tests/workshopAws.test.ts` | Cover the pure helpers and the `run` wrapper: its output, its standard input, and an error message that leaves out trailing arguments |

### 3. Key Decisions

- The stack is created in two passes. The image needs an ECR push and the interceptor zip needs the stack's bucket, so the first pass creates the table, bucket and roles with `McpImageUri` and `CodeKey` empty, and the second pass creates the rest.
- Secrets never appear on a command line. Keys and the code hash go to CloudFormation in a JSON parameter file with mode 0600 (`--parameters file://`), which is removed right after the call. The three secret parameters are `NoEcho`.
- On update, a parameter that is not given keeps its previous value (`UsePreviousValue`). Changing a rate limit therefore cannot blank the keys, and issuing a code cannot change the image.
- The template holds no account id, ARN literal, bucket name or domain. ARNs are built with `!Sub "arn:${AWS::Partition}:..."`, and the target endpoint uses `${AWS::URLSuffix}` with the runtime ARN URL-encoded, because the gateway calls that URL as given.
- The image is referenced by digest and tagged `<version>-workshop-<commit 7>`, which is why a deploy without `--skip-image` requires a clean working tree. The interceptor zip key is the hash of the source file, so an unchanged interceptor is not uploaded again.
- A first creation that fails leaves the stack in `ROLLBACK_COMPLETE`, which can be neither updated nor reused. `stackBlocker` stops with the recovery command instead of failing later with an unclear CloudFormation error.
- After an image change the script calls `synchronize-gateway-targets` and waits for `lastSynchronizedAt` to advance, because the gateway caches the target's tool list.
- Template and interceptor changes are test-first: `tests/infra/workshopTemplate.test.ts` and `tests/infra/codeCheck.test.ts` change before the files they cover.

### 4. Code Pointers

- `infra/seoul-workshop.yaml` - parameters, conditions, resources, outputs
- `scripts/workshop-deploy.ts` - `main()` (order of steps), `pushImage`, `uploadCode`, `checkRuntime`, `syncTarget`, `smoke`, `remove`
- `scripts/workshop-code.ts` - `new`, `revoke`, `show`
- `scripts/workshop-lib.ts` - `stackParameters`, `imageTag`, `codeKeyOf`, `stackBlocker`, `withSecretFile`
- `scripts/workshop-aws.ts` - `createStack`, `updateStack`, `deleteStack`, `run`
- `tests/infra/workshopTemplate.test.ts` - the template's invariants

### 5. Cross-references

- Related modules: `infra/CLAUDE.md`, `scripts/CLAUDE.md`
- Related ADRs: [ADR-005](../decisions/ADR-005-workshop-shared-code-at-the-gateway.md) (workshop access by one shared code). The full design is in `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md`
- Related runbooks: [workshop.md](../workshop.md) (first deploy, code issue and revoke, recovery from `ROLLBACK_COMPLETE`)
- Related references: [infrastructure.md](infrastructure.md), [security.md](security.md)

<a id="korean"></a>
## 한국어

### 1. 개요

IaC 계층은 워크숍 스택 `seoul-workshop`을 CloudFormation 템플릿 하나로 선언하고 TypeScript 스크립트 두 개로 배포합니다. 워크숍 환경을 만들고 바꾸고 지우는 일을 각각 명령 하나로 하고, 비밀 값이 터미널과 저장소에 남지 않게 하려고 둡니다. 배포된 리소스가 실행 중에 하는 일은 [infrastructure.md](infrastructure.md)에 있습니다.

### 2. 구성요소

| 구성요소 | 경로 | 목적 |
|---|---|---|
| 스택 템플릿 | `infra/seoul-workshop.yaml` | 파라미터 9개, 조건 3개, 리소스 10개, 출력 7개입니다. 테이블, 버킷, IAM 역할 3개, 런타임, 인터셉터 로그 그룹과 함수, Gateway, Gateway 대상을 선언합니다 |
| 조건 | `infra/seoul-workshop.yaml`(`HasImage`, `HasCode`, `HasAll`) | 이미지와 인터셉터 zip이 생기기 전에도 스택이 존재할 수 있게 합니다. 런타임은 `HasImage`, Lambda와 로그 그룹은 `HasCode`, Gateway와 대상은 둘 다 필요합니다 |
| 배포 스크립트 | `scripts/workshop-deploy.ts` | `npm run workshop:deploy`입니다. 스택을 두 단계로 만들거나 갱신하고, 이미지를 빌드해 올리고, 인터셉터 zip을 올리고, 런타임을 확인하고, Gateway 대상을 동기화한 뒤 스모크 테스트를 합니다. `--delete --yes`는 버킷을 비우고 스택을 지웁니다 |
| 코드 스크립트 | `scripts/workshop-code.ts` | `npm run workshop:code -- new|revoke|show`입니다. `CodeSha256`과 `CodeValidUntil`만 바꾸고 나머지 파라미터는 이전 값을 유지합니다 |
| 순수 함수 | `scripts/workshop-lib.ts` | 리전, 스택 이름, 파라미터 목록, `stackParameters`(갱신 때 `UsePreviousValue`), `imageTag`, `codeKeyOf`, `stackBlocker`, `withSecretFile`입니다 |
| CLI 래퍼 | `scripts/workshop-aws.ts` | `createStack`, `updateStack`, `deleteStack`이 `CAPABILITY_IAM`으로 `aws` CLI를 부르고 완료를 기다립니다. CloudFormation이 바뀐 것이 없다고 하면 `updateStack`은 `false`를 돌려줍니다 |
| 템플릿 테스트 | `tests/infra/workshopTemplate.test.ts` | YAML을 읽어 런타임, Gateway, 대상, IAM 범위, `NoEcho` 파라미터, 출력을 검사합니다. 계정 ID, ARN 리터럴, 다른 리소스 이름이 없는지도 봅니다 |
| 스크립트 테스트 | `tests/workshopLib.test.ts`, `tests/workshopAws.test.ts` | 순수 함수와 `run` 래퍼를 검사합니다. 래퍼는 출력, 표준 입력, 뒤쪽 인자를 뺀 오류 문구를 봅니다 |

### 3. 주요 결정

- 스택은 두 단계로 만듭니다. 이미지는 ECR에 올려야 하고 인터셉터 zip은 스택의 버킷이 있어야 올릴 수 있습니다. 그래서 1단계에서 `McpImageUri`와 `CodeKey`를 비운 채 테이블, 버킷, 역할을 만들고 2단계에서 나머지를 만듭니다.
- 비밀 값을 명령줄에 넣지 않습니다. 키와 코드 해시는 권한 0600인 JSON 파라미터 파일(`--parameters file://`)로 CloudFormation에 넘기고 호출 직후 지웁니다. 비밀 파라미터 세 개는 `NoEcho`입니다.
- 갱신할 때 주지 않은 파라미터는 이전 값을 유지합니다(`UsePreviousValue`). 그래서 분당 한도를 바꿔도 키가 비지 않고, 코드를 발급해도 이미지가 바뀌지 않습니다.
- 템플릿에 계정 ID, ARN 리터럴, 버킷 이름, 도메인을 적지 않습니다. ARN은 `!Sub "arn:${AWS::Partition}:..."`로 만듭니다. 대상 엔드포인트는 `${AWS::URLSuffix}`를 쓰고 런타임 ARN을 URL 인코딩합니다. Gateway가 이 URL을 그대로 호출하기 때문입니다.
- 이미지는 digest로 참조하고 `<버전>-workshop-<커밋 7자>` 태그를 붙입니다. `--skip-image` 없이 배포할 때 작업 트리가 깨끗해야 하는 이유입니다. 인터셉터 zip의 키는 원본 파일의 해시라서, 인터셉터가 그대로면 다시 올리지 않습니다.
- 첫 생성이 실패하면 스택이 `ROLLBACK_COMPLETE`에 남고, 이 상태에서는 갱신도 재사용도 할 수 없습니다. `stackBlocker`가 복구 명령을 안내하며 먼저 멈추므로, 뒤에서 알아보기 어려운 CloudFormation 오류로 실패하지 않습니다.
- 이미지를 바꾼 뒤에는 `synchronize-gateway-targets`를 부르고 `lastSynchronizedAt`이 바뀔 때까지 기다립니다. Gateway가 대상의 tool 목록을 캐시하기 때문입니다.
- 템플릿과 인터셉터는 테스트를 먼저 고칩니다. `tests/infra/workshopTemplate.test.ts`와 `tests/infra/codeCheck.test.ts`를 고친 뒤에 대상 파일을 고칩니다.

### 4. 코드 포인터

- `infra/seoul-workshop.yaml` - 파라미터, 조건, 리소스, 출력
- `scripts/workshop-deploy.ts` - `main()`(단계 순서), `pushImage`, `uploadCode`, `checkRuntime`, `syncTarget`, `smoke`, `remove`
- `scripts/workshop-code.ts` - `new`, `revoke`, `show`
- `scripts/workshop-lib.ts` - `stackParameters`, `imageTag`, `codeKeyOf`, `stackBlocker`, `withSecretFile`
- `scripts/workshop-aws.ts` - `createStack`, `updateStack`, `deleteStack`, `run`
- `tests/infra/workshopTemplate.test.ts` - 템플릿의 불변 조건

### 5. 상호 참조

- 관련 모듈: `infra/CLAUDE.md`, `scripts/CLAUDE.md`
- 관련 ADR: [ADR-005](../decisions/ADR-005-workshop-shared-code-at-the-gateway.md) (워크숍 접근을 공용 코드 하나로 확인). 전체 설계는 `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md`에 있습니다
- 관련 런북: [workshop.md](../workshop.md) (첫 배포, 코드 발급과 폐기, `ROLLBACK_COMPLETE` 복구)
- 관련 참조 문서: [infrastructure.md](infrastructure.md), [security.md](security.md)
