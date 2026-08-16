---
description: 전체 테스트 스위트 실행 및 결과 보고
allowed-tools: Read, Bash(npm test:*), Bash(npm run:*), Bash(find:*), Glob
---

# Test All

이 프로젝트의 전체 테스트 스위트를 실행합니다.

## Step 1: 테스트 프레임워크 감지

프로젝트 파일을 읽어 테스트 프레임워크 결정:
- `package.json` -> test 스크립트 찾기 (vitest, jest, mocha 등)
- `vitest.config.ts` 또는 `vite.config.ts` 확인

## Step 2: 테스트 실행

적절한 테스트 커맨드 실행:

```bash
npm test
```

### Live 테스트 (선택사항)
실제 Seoul Open Data API에 대한 live 테스트를 실행하려면:

```bash
RUN_LIVE=true npm test
```

또는 live-sweep 스크립트 사용:
```bash
npm run bundle
# MCPB 번들에 포함된 live-sweep 실행
```

## Step 3: 결과 보고

다음을 제시합니다:
- 실행된 총 테스트 수, 통과, 실패, 건너뜀
- 실패한 테스트의 상세 내용 (파일 경로 및 오류 메시지)
- 명백한 원인이 있으면 실패한 테스트에 대한 수정 제안

## Error Recovery

### 테스트 러너 자체 실패 시
```bash
npm run build    # 빌드 확인
npm test         # 다시 시도
```

### 일반적인 실패 패턴 및 수정

| 실패 패턴 | 가능성 있는 원인 | 수정 방법 |
|---|---|---|
| "file not found" | 재구조화 후 누락된 파일 | 파일 생성 또는 테스트 업데이트 |
| "invalid JSON" | 잘못된 fixture 포맷 | `python3 -m json.tool <file>` |
| "Version mismatch" | package.json과 manifest.json 버전 불일치 | 둘 다 같은 버전으로 업데이트 |
| "타입 에러" | TypeScript 타입 불일치 | `npm run build` 에러 메시지 확인 |

### 많은 테스트가 동시에 실패하는 경우
구조적 변경으로 여러 가정이 깨진 것일 가능성:
1. `git log -1` — 마지막 변경사항은?
2. `git diff HEAD~1` — 구체적으로 무엇이 변경되었나?
3. 개별 테스트가 아닌 근본 원인 수정
