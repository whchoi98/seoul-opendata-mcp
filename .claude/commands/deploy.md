---
description: npm publish 및 mcpb bundle을 통해 애플리케이션 빌드 및 배포
allowed-tools: Read, Bash(npm:*), Bash(git:*), Bash(find:*), Glob
---

# Deploy

애플리케이션을 빌드하고 배포합니다.

## Step 1: 배포 전 체크

1. 워킹 트리가 깨끗한지 확인: `git status`
2. 현재 브랜치 확인 (main이 아니면 경고)
3. 모든 테스트 통과 확인: `npm test`
4. 배포 runbook 확인: `ls docs/runbooks/deploy-*.md`

## Step 2: 배포 전 준비 (seoul-opendata-mcp 특화)

### 버전 동기화 확인
배포 전 **3곳 버전이 일치**해야 합니다:
- package.json의 version 필드
- manifest.json의 version 필드
- README.md / README.ko.md의 버전 참조

### Live 테스트 실행 (권장)
```bash
RUN_LIVE=true npm test
```
실제 Seoul Open Data API 응답으로 엔드투엔드 검증합니다.

### API 키 마스킹 확인
배포되는 코드에 다음이 없는지 확인:
- 하드코딩된 SEOUL_API_KEY 또는 SEOUL_SUBWAY_API_KEY
- .env 파일 커밋
- 테스트 출력에서의 실제 키

## Step 3: 빌드 및 번들

```bash
npm run build
npm run bundle
```

빌드 결과 확인:
- `dist/` 디렉토리 생성
- `seoul-opendata-mcp.mcpb` 파일 생성 (MCPB 번들)

**번들 실행 스모크 (필수 — 파일 존재 확인만으로는 부족):** 번들을 임시 디렉토리에 언팩한 뒤 실제로 실행해 tools/list가 19개를 반환하는지 확인한다. v0.2.0에서 `.mcpbignore`의 비앵커 `src/` 패턴이 의존성 내부 `node_modules/*/src/`까지 제거해, 파일 검사는 통과했지만 실행 즉시 죽는 번들이 배포된 사례가 있다(ignore 패턴은 반드시 `/src/`처럼 루트 앵커로 쓸 것).

```bash
npx @anthropic-ai/mcpb unpack seoul-opendata-mcp.mcpb /tmp/bundle-smoke
cd /tmp/bundle-smoke && printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | node dist/index.js | tail -1 | grep -o '"name"' | wc -l   # 19이어야 함
```

## Step 4: npm에 발행

```bash
npm publish
```

발행이 성공하면:
- npm 레지스트리에 패키지 업로드
- git 태그 푸시 (리포지토리 관리자가 수행)

## Step 5: 검증

배포 후:
- npm 페이지 확인: `https://www.npmjs.com/package/seoul-opendata-mcp`
- MCPB 번들 크기 확인 (이상적: <5MB)
- 설치 테스트: `npm install -g seoul-opendata-mcp`

## Step 6: 요약

표시합니다:
- 배포된 것과 장소
- 사용된 배포 방법
- 검증 결과
- 배포 runbook이 없으면 생성을 제안

## Error Recovery

### Step 1 배포 전 체크 실패 시
```bash
git stash -u                  # 커밋되지 않은 변경사항 임시 저장
git checkout main             # main 브랜치로 전환
```

### Step 2 버전 동기화 오류 시
```bash
# 현재 버전 확인
npm pkg get version

# 모든 파일이 같은 버전을 가지도록 수정
# package.json, manifest.json, README.md, README.ko.md
```

### Step 3 빌드 실패 시
```bash
npm run build                 # 에러 메시지 확인
npm install                   # 의존성 재설치 시도
npm run build                 # 다시 시도
```

### Step 4 npm 발행 실패 시
- npm 로그인 확인: `npm whoami`
- npm 자격증명 확인: `npm config get registry`
- 패키지명 충돌 확인 (npm에 이미 존재하는지)

### 배포 후 rollback이 필요한 경우
```bash
# npm에서 버전 폐기
npm unpublish seoul-opendata-mcp@X.Y.Z

# 또는 git에서 태그 제거 (관리자)
git push origin :refs/tags/vX.Y.Z
git tag -d vX.Y.Z
```
