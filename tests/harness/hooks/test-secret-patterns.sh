#!/bin/bash
# True/false-positive tests for the detection regexes used by .claude/hooks/secret-scan.sh.
# Sensitive-looking tokens are built at runtime via string concatenation (never as literal
# strings in this file) to avoid triggering GitHub Push Protection. See fixtures/secret-samples.txt
# and fixtures/false-positives.txt for the fixed (safe) samples.

# --- True positives: these MUST match ---

# AWS Access Key ID — literal AWS-documented placeholder key, never a real credential.
assert_grep_match "TP: AWS Access Key ID" 'AKIA[0-9A-Z]{16}' "AKIAIOSFODNN7EXAMPLE"

OPENAI_PREFIX="sk-"
OPENAI_MID="abcdefghijklmnopqrst"
OPENAI_MARKER="T3BlbkFJ"
OPENAI_TAIL="ZYXWVUTSRQPONMLKJIHG"
assert_grep_match "TP: OpenAI API Key" 'sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}' \
    "${OPENAI_PREFIX}${OPENAI_MID}${OPENAI_MARKER}${OPENAI_TAIL}"

ANTHROPIC_PREFIX="sk-ant-"
ANTHROPIC_BODY=$(printf 'a%.0s' $(seq 1 95))
assert_grep_match "TP: Anthropic API Key" 'sk-ant-[A-Za-z0-9-]{90,}' "${ANTHROPIC_PREFIX}${ANTHROPIC_BODY}"

GH_BODY36=$(printf 'Z%.0s' $(seq 1 36))
assert_grep_match "TP: GitHub PAT" 'ghp_[A-Za-z0-9]{36}' "ghp_${GH_BODY36}"
assert_grep_match "TP: GitHub OAuth Token" 'gho_[A-Za-z0-9]{36}' "gho_${GH_BODY36}"

GH_FINE_BODY=$(printf 'A%.0s' $(seq 1 82))
assert_grep_match "TP: GitHub Fine-grained PAT" 'github_pat_[A-Za-z0-9_]{82}' "github_pat_${GH_FINE_BODY}"

SLACK_BODY="123456789012-1234567890123-abcdef"
assert_grep_match "TP: Slack Bot Token" 'xoxb-[0-9]+-[A-Za-z0-9]+' "xoxb-${SLACK_BODY}"
assert_grep_match "TP: Slack User Token" 'xoxp-[0-9]+-[A-Za-z0-9]+' "xoxp-${SLACK_BODY}"

STRIPE_BODY=$(printf '9%.0s' $(seq 1 24))
assert_grep_match "TP: Stripe Secret Key" 'sk_live_[A-Za-z0-9]{24,}' "sk_live_${STRIPE_BODY}"
assert_grep_match "TP: Stripe Restricted Key" 'rk_live_[A-Za-z0-9]{24,}' "rk_live_${STRIPE_BODY}"

GOOGLE_KEY_BODY=$(printf 'B%.0s' $(seq 1 35))
assert_grep_match "TP: Google API Key" 'AIza[A-Za-z0-9_-]{35}' "AIza${GOOGLE_KEY_BODY}"

GOOGLE_OAUTH_BODY=$(printf 'C%.0s' $(seq 1 55))
assert_grep_match "TP: Google OAuth Token" 'ya29\.[A-Za-z0-9_-]{50,}' "ya29.${GOOGLE_OAUTH_BODY}"

assert_grep_match "TP: Azure Connection String" 'DefaultEndpointsProtocol=https;Account' \
    "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=FAKE"

# Seoul API Key format (32-char hex) — fake test-only run of digits/letters, not a real key.
# A bare hex run is only a key in context (assignment or API URL path); see FP below for fixture ids.
SEOUL_FAKE="0123456789abcdef0123456789abcdef"
SEOUL_ASSIGN='(?i:(seoul_)?(subway_)?api_?key)["\x27]?\s*[:=]\s*["\x27]?[a-f0-9]{32}(?![A-Za-z0-9])'
SEOUL_URL='seoul\.go\.kr(:\d+)?(/api/subway)?/[a-f0-9]{32}/'
assert_grep_match "TP: Seoul API Key (env assignment)" "$SEOUL_ASSIGN" "SEOUL_API_KEY=${SEOUL_FAKE}"
assert_grep_match "TP: Seoul API Key (code assignment)" "$SEOUL_ASSIGN" "apiKey: '${SEOUL_FAKE}'"
assert_grep_match "TP: Seoul API Key (open API URL)" "$SEOUL_URL" "http://openapi.seoul.go.kr:8088/${SEOUL_FAKE}/json/bikeList/1/5"
assert_grep_match "TP: Seoul API Key (subway URL)" "$SEOUL_URL" "http://swopenapi.seoul.go.kr/api/subway/${SEOUL_FAKE}/json/x/0/5"

assert_grep_match "TP: password assignment" 'password\s*[:=]\s*["\x27][^"\x27]{8,}' 'password = "changeme123456"'
assert_grep_match "TP: secret assignment" 'secret\s*[:=]\s*["\x27][^"\x27]{8,}' 'secret = "changeme123456"'
assert_grep_match "TP: api_key assignment" 'api[_-]?key\s*[:=]\s*["\x27][^"\x27]{8,}' 'api_key = "changeme123456"'

# AWS Secret Key: context is matched inline instead of with a variable-length lookbehind,
# which GNU grep -P rejects ("lookbehind assertion is not fixed length").
AWS_SECRET_RE='aws_secret_access_key\s*[=:]\s*["\x27]?[A-Za-z0-9/+=]{40}'
AWS_SECRET_FAKE=$(printf 'w%.0s' $(seq 1 40))
assert_grep_match "TP: AWS Secret Key (context-aware)" "$AWS_SECRET_RE" "aws_secret_access_key = ${AWS_SECRET_FAKE}"
assert_grep_no_match "FP: AWS Secret Key context-aware, no context present" "$AWS_SECRET_RE" "${AWS_SECRET_FAKE}"

# --- False positives: these MUST NOT match ---
assert_grep_no_match "FP: Normal base64 (no AKIA prefix)" 'AKIA[0-9A-Z]{16}' "dGhpcyBpcyBhIHRlc3Q="
assert_grep_no_match "FP: Empty password" 'password\s*[:=]\s*["\x27][^"\x27]{8,}' 'password = ""'
assert_grep_no_match "FP: Short api_key value" 'api[_-]?key\s*[:=]\s*["\x27][^"\x27]{8,}' 'api_key: "short"'
assert_grep_no_match "FP: fixture image id (bare 32-hex, no key context)" "$SEOUL_ASSIGN" \
    "getImage.do?atchFileId=${SEOUL_FAKE}&thumb=Y"
assert_grep_no_match "FP: fixture image id vs URL pattern" "$SEOUL_URL" \
    "https://culture.seoul.go.kr/cmmn/file/getImage.do?atchFileId=${SEOUL_FAKE}&thumb=Y"
