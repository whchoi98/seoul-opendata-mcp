---
description: 신뢰도 기반 필터링으로 현재 변경사항에 대한 코드 리뷰 실행
allowed-tools: Read, Glob, Bash(git diff:*), Bash(git log:*), Bash(find:*)
---

# Code Review

신뢰도 기반 스코어링을 사용하여 현재 코드 변경사항을 검토합니다.

## Step 1: 변경사항 확인

검토 범위 결정:

- $ARGUMENTS가 파일을 지정한 경우 해당 파일 검토
- 그 외의 경우 미스테이징 변경사항 검토: `git diff`
- 미스테이징 변경사항이 없으면 스테이징된 변경사항 검토: `git diff --cached`

## Step 2: 검토 수행

변경된 각 파일에 대해 code-review 스킬 기준 적용:
- 프로젝트 가이드라인 준수 (CLAUDE.md에서)
- 버그 감지 (로직 오류, 보안, 성능)
- 코드 품질 (중복, 복잡성, 테스트 커버리지)
- **프로젝트 특화 검토**:
  - tests/fixtures/*.json 파일 수정 여부 (절대 금지)
  - 매핑 동등성 테스트 누락 확인
  - ok() 봉투 응답 형식 준수 여부
  - 키 유출 여부 (SEOUL_API_KEY, SEOUL_SUBWAY_API_KEY)

## Step 3: 스코어링 및 필터링

각 이슈를 0-100으로 평가합니다. 신뢰도 >= 75인 이슈만 보고합니다.

## Step 4: 출력

구조화된 형식으로 검색 결과 제시 (파일 경로, 줄번호, 수정 제안 포함).
이슈가 없으면 코드가 표준을 충족함을 확인합니다.

## Error Recovery

### Step 1에서 변경사항이 없는 경우
diff 출력이 없다는 것은 검토할 내용이 없다는 의미입니다. 사용자에게 알립니다:
- 변경사항이 커밋되었는지 확인: `git log -1 --oneline`
- 올바른 브랜치에 있는지 확인: `git branch --show-current`
- 파일을 직접 지정하도록 제안: `/review path/to/file`

### Step 2에서 CLAUDE.md가 없거나 비어있는 경우
CLAUDE.md 없이는 프로젝트 가이드라인을 평가할 수 없습니다. 다음을 제안합니다:
- `/init-project` 실행하여 CLAUDE.md 생성
- 또는 관례 섹션이 있는 최소 CLAUDE.md 생성

### diff가 너무 큰 경우 (>500줄)
높은 위험 파일부터 우선 순위 지정:
1. 보안 민감 변경사항이 있는 파일 (hooks, scripts)
2. 로직 변경이 있는 파일
3. 문서 변경 (낮은 우선순위)
