#!/bin/bash
# One-command setup for new developers: install deps, build, test, and guide .env setup.
# Usage: bash scripts/setup.sh

set -e

echo "=== seoul-opendata-mcp 설정 시작 ==="

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js(>=18)가 필요합니다"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm이 필요합니다"; exit 1; }

echo "--- 의존성 설치 (npm install) ---"
npm install

echo "--- 빌드 (npm run build) ---"
npm run build

echo "--- 테스트 (npm test) ---"
npm test

# .env 안내: 이미 있으면 그대로 두고, 없으면 .env.example을 참고하도록 안내만 한다.
# (실키가 담긴 .env는 어떤 경우에도 읽거나 자동 복사하지 않는다)
echo "--- .env 안내 ---"
if [ -f ".env" ]; then
    echo ".env가 이미 존재합니다 (내용은 건드리지 않습니다)."
else
    if [ -f ".env.example" ]; then
        echo ".env가 없습니다. .env.example을 참고해 아래처럼 직접 만들어 주세요:"
        echo "  cp .env.example .env"
        echo "  SEOUL_API_KEY=<data.seoul.go.kr에서 발급받은 키>"
        echo "  SEOUL_SUBWAY_API_KEY=<지하철 실시간 도착 전용 키, 선택>"
    fi
    echo "키 없이도 샘플 모드로 동작합니다 (citydata 계열은 광화문·덕수궁 한정, 일반 API는 5행 제한)."
fi

# Git hooks 설치 (commit-msg: Co-Authored-By 제거)
if [ -d ".git" ] && [ -f "scripts/install-hooks.sh" ]; then
    echo "--- Git hooks 설치 ---"
    bash scripts/install-hooks.sh
fi

echo "=== 설정 완료 ==="
echo "다음 단계:"
echo "  1. npm run dev       # MCP 서버를 stdio로 실행"
echo "  2. npm run inspect   # MCP Inspector로 tool 점검"
