#!/bin/bash
# Scan staged files for secrets before a commit.
#
# Two entry points:
#   1. Claude Code PreToolUse (matcher: Bash) — reads the hook JSON on stdin and only scans when the
#      command runs `git commit`. Exit 2 blocks the tool call; stderr is shown to Claude as the reason.
#   2. git pre-commit hook (`secret-scan.sh --pre-commit`, installed by scripts/install-hooks.sh) —
#      runs after `git add`, so it also catches `git add -A && git commit` in a single Bash call,
#      which the PreToolUse path cannot see (the index is inspected before the command runs).
#      Exit 1 aborts the commit.
#
# Scans the STAGED blob (`git show :path`), not the working tree, because that is what gets committed.
# Never prints a matched value — only the file, the pattern label, or the .env variable name.

MODE="claude"
[ "${1:-}" = "--pre-commit" ] && MODE="pre-commit"

if [ "$MODE" = "claude" ]; then
    # 터미널에서 직접 실행하면 stdin이 없으므로 읽지 않는다(cat이 멈추지 않게)
    INPUT=""
    [ -t 0 ] || INPUT=$(cat)
    CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || CMD="$INPUT"
    printf '%s' "$CMD" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)' || exit 0
fi

# label|regex (PCRE). Seoul keys are 32-char hex, so a bare hex run is only flagged in key context
# (assignment or API URL path) — fixture image ids such as atchFileId=<32 hex> are not secrets.
PATTERNS=(
    'AWS Access Key ID|AKIA[0-9A-Z]{16}'
    'AWS Secret Key|aws_secret_access_key\s*[=:]\s*["\x27]?[A-Za-z0-9/+=]{40}'
    'OpenAI API Key|sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}'
    'Anthropic API Key|sk-ant-[A-Za-z0-9-]{90,}'
    'GitHub PAT|ghp_[A-Za-z0-9]{36}'
    'GitHub OAuth Token|gho_[A-Za-z0-9]{36}'
    'GitHub Fine-grained PAT|github_pat_[A-Za-z0-9_]{82}'
    'Slack Bot Token|xoxb-[0-9]+-[A-Za-z0-9]+'
    'Slack User Token|xoxp-[0-9]+-[A-Za-z0-9]+'
    'Stripe Secret Key|sk_live_[A-Za-z0-9]{24,}'
    'Stripe Restricted Key|rk_live_[A-Za-z0-9]{24,}'
    'Google API Key|AIza[A-Za-z0-9_-]{35}'
    'Google OAuth Token|ya29\.[A-Za-z0-9_-]{50,}'
    'Azure Connection String|DefaultEndpointsProtocol=https;Account'
    'Seoul API Key (assignment)|(?i:(seoul_)?(subway_)?api_?key)["\x27]?\s*[:=]\s*["\x27]?[a-f0-9]{32}(?![A-Za-z0-9])'
    'Seoul API Key (URL path)|seoul\.go\.kr(:\d+)?(/api/subway)?/[a-f0-9]{32}/'
    'Password assignment|password\s*[:=]\s*["\x27][^"\x27]{8,}'
    'Secret assignment|secret\s*[:=]\s*["\x27][^"\x27]{8,}'
    'API key assignment|api[_-]?key\s*[:=]\s*["\x27][^"\x27]{8,}'
)

# 의도적으로 가짜 비밀을 담은 하네스 샘플과 문서·잠금 파일은 건너뛴다
SKIP_PATTERNS=('.env.example' '*secret-scan.sh' '*.md' 'package-lock.json' 'yarn.lock' 'tests/harness/*')

# Literal values of secret-like variables from the local .env (if any) — catches a real key pasted
# anywhere, with no context needed. Values stay in this process; only variable names are reported.
ENV_NAMES=()
ENV_VALUES=()
if [ -f .env ]; then
    while IFS='=' read -r name value; do
        [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)$ ]] || continue
        value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
        [ "${#value}" -ge 16 ] || continue
        ENV_NAMES+=("$name"); ENV_VALUES+=("$value")
    done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
fi

SECRETS_FOUND=0
report() { echo "[secret-scan] Potential secret in $1 ($2)" >&2; SECRETS_FOUND=1; }

while IFS= read -r file; do
    [ -n "$file" ] || continue
    skip=false
    for pattern in "${SKIP_PATTERNS[@]}"; do
        [[ "$file" == $pattern ]] && skip=true && break
    done
    $skip && continue

    BLOB=$(git show ":$file" 2>/dev/null) || continue
    for entry in "${PATTERNS[@]}"; do
        printf '%s' "$BLOB" | grep -qP "${entry#*|}" 2>/dev/null && report "$file" "pattern: ${entry%%|*}"
    done
    for i in "${!ENV_VALUES[@]}"; do
        printf '%s' "$BLOB" | grep -qF -- "${ENV_VALUES[$i]}" && report "$file" "value of ${ENV_NAMES[$i]} from .env"
    done
done < <(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)

if [ "$SECRETS_FOUND" -eq 1 ]; then
    {
        echo ""
        echo "[secret-scan] BLOCKED: Potential secrets detected in staged files."
        echo "[secret-scan] Unstage or clean the files above (git restore --staged <file>), then commit again."
        echo "[secret-scan] Keep real keys in .env (git-ignored) and placeholders in .env.example."
    } >&2
    [ "$MODE" = "claude" ] && exit 2
    exit 1
fi
exit 0
