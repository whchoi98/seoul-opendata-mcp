# Release Skill

검증 체크를 통해 릴리스 프로세스를 자동화합니다.

## 절차

### 1. 릴리스 전 체크
- 워킹 트리가 깨끗한지 확인: `git status`
- 모든 테스트 통과 확인
- 커밋되지 않은 변경사항 확인
- RUN_LIVE 환경변수 설정 여부 확인 (live 테스트 필요 시)

### 2. 버전 결정
- 마지막 태그 이후 변경사항 검토: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
- Semver 규칙 적용:
  - MAJOR: 주요 API 변경
  - MINOR: 새 기능, 하위 호환성 유지
  - PATCH: 버그 수정만

### 3. 버전 동기화 (seoul-opendata-mcp 특화)
배포 전 3곳 버전 동기화 필수:
- `package.json`: version 필드
- `manifest.json`: version 필드
- README.md / README.ko.md: 해더 버전 참조

### 4. CHANGELOG 업데이트
- 유형별로 변경사항 그룹화 (Added, Changed, Fixed, Removed)
- 커밋 참조 포함
- 날짜 및 버전 헤더 추가

### 5. 릴리스 생성 (npm + mcpb 흐름)
- package.json에서 버전 업데이트
- git 태그 생성: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- 릴리스 노트 생성
- 빌드 및 번들: `npm run build && npm run bundle`
- npm에 발행: `npm publish`

### 6. 요약
- 버전 업 표시
- 주요 변경사항 나열
- 다음 단계 표시 (태그 푸시, 배포 등)
