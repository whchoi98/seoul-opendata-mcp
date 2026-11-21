# Infra Module

## Role
워크숍 Gateway 스택(`seoul-workshop`)의 CloudFormation 템플릿과 인터셉터 Lambda입니다. 설계는 `docs/superpowers/specs/2026-11-19-workshop-gateway-design.md`, 배포는 `scripts/workshop-deploy.ts`, 코드 교체는 `scripts/workshop-code.ts`가 맡습니다. 사전 적재 저장소(버킷의 `store/v1/`)와 선택적 수집 스케줄의 설계는 `docs/superpowers/specs/2026-11-21-snapshot-store-design.md`입니다.

## Key Files
- `seoul-workshop.yaml` - 워크숍 전용 런타임 `seoul_workshop_mcp`, 테이블, 버킷, 인터셉터 Lambda, Gateway, 대상 `seoul`. 2단계 생성(`HasImage`, `HasCode`, `HasAll`). 런타임은 `STORE_URI`로 버킷의 `store/v1/`을 읽고, `CollectSchedule`을 넣으면 수집 Lambda와 EventBridge 스케줄이 생깁니다(`HasSchedule`).
- `lambda/code-check.mjs` - Gateway REQUEST 인터셉터. 공용 코드의 sha256 비교, 만료, 분당 `tools/call` 한도.
- `lambda/collect.ts` - 매일 묶음 스냅샷을 수집하는 Lambda 진입점. `scripts/workshop-bundle.ts`가 `collect.mjs`로 묶어 `code/` 아래에 올립니다.

## Rules
- 스택을 만들거나 바꾸거나 지우는 일과 ECR 푸시는 사용자 승인 뒤에만 합니다.
- 템플릿에 계정 ID, ARN 리터럴, 버킷 이름, 도메인을 적지 않습니다. `!Sub "arn:${AWS::Partition}:..."`와 `!Ref`를 씁니다.
- 기존 런타임 `seoul_opendata_mcp`, `myseoul_mcp`와 테이블 `seoul-mcp-cache`는 이 스택의 리소스가 아닙니다. 참조하지 않고 바꾸지 않습니다.
- 워크숍 스택에서 서울 API 키는 런타임과 수집 Lambda의 환경 변수에, 코드 sha256은 Lambda 환경 변수에 있어 `bedrock-agentcore:GetAgentRuntime`과 `lambda:GetFunctionConfiguration` 읽기 권한은 비밀 읽기 권한과 같고, 40비트 무솔트 해시는 오프라인 대입을 막지 못합니다.
- 인터셉터는 헤더, 코드, 코드 해시를 로그에 남기지 않습니다. 로그는 `{method, tool, decision}` 한 줄입니다.
- 템플릿을 바꾸면 `tests/infra/workshopTemplate.test.ts`를, 인터셉터를 바꾸면 `tests/infra/codeCheck.test.ts`를 먼저 고칩니다.
- Lambda 환경 변수를 콘솔이나 CLI로 직접 고치지 않습니다. 다음 스택 배포 때 되돌아갑니다. 코드와 만료는 `npm run workshop:code`로 바꿉니다.
- 버킷의 `store/` 아래 객체는 90일 뒤에 지워집니다. 런타임 역할은 `store/*`를 읽기만 하고, 쓰기는 수집 Lambda 역할과 진행자의 자격 증명만 합니다.
