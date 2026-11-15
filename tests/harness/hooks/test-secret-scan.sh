#!/bin/bash
# Behavior tests for .claude/hooks/secret-scan.sh — runs the real script against a throwaway git repo
# and checks exit codes, which are what actually block (or allow) a commit:
#   Claude Code PreToolUse: exit 2 blocks the tool call; any other code lets it through.
#   git pre-commit (--pre-commit): any non-zero code aborts the commit.
# Secret-looking strings are assembled at runtime (never literal) so this file never trips the scanner
# or GitHub Push Protection itself.

SCAN="$PROJECT_ROOT/.claude/hooks/secret-scan.sh"
SS_REPO=$(mktemp -d)
git -C "$SS_REPO" init -q
git -C "$SS_REPO" config user.email t@example.invalid
git -C "$SS_REPO" config user.name t

FAKE_AWS="AKIA$(printf 'Q%.0s' $(seq 1 16))"
FAKE_SEOUL="$(printf 'a1%.0s' $(seq 1 16))"            # 32-char hex, Seoul key format
COMMIT_JSON='{"tool_name":"Bash","tool_input":{"command":"git add -A && git commit -m wip"}}'
OTHER_JSON='{"tool_name":"Bash","tool_input":{"command":"ls -la"}}'

# run_scan <stdin-payload> [args...] — runs inside the temp repo, sets SS_CODE and SS_ERR
run_scan() {
    local payload="$1"; shift
    SS_CODE=0
    SS_ERR=$( (cd "$SS_REPO" && printf '%s' "$payload" | bash "$SCAN" "$@") 2>&1 >/dev/null ) || SS_CODE=$?
}

stage() { # stage <file> <content>
    printf '%s\n' "$2" > "$SS_REPO/$1"
    git -C "$SS_REPO" add "$1"
}
reset_index() { git -C "$SS_REPO" rm -rq --cached . 2>/dev/null || true; rm -f "$SS_REPO"/*.txt "$SS_REPO"/.env; }

# 1) git commit + staged AWS key → exit 2 (blocks the Claude tool call), reason on stderr
stage leak.txt "aws = $FAKE_AWS"
run_scan "$COMMIT_JSON"
assert_eq "secret-scan: git commit with staged secret exits 2" "2" "$SS_CODE"
assert_contains "secret-scan: block reason is written to stderr" "$SS_ERR" "BLOCKED"

# 2) unrelated Bash command → exit 0 even if the index holds a secret (scan only guards commits)
run_scan "$OTHER_JSON"
assert_eq "secret-scan: non-commit command is not blocked" "0" "$SS_CODE"

# 3) git pre-commit mode → exit 1 (git aborts the commit on any non-zero code)
run_scan "" --pre-commit
assert_eq "secret-scan: --pre-commit with staged secret exits 1" "1" "$SS_CODE"
reset_index

# 4) clean staged file → exit 0
stage clean.txt "hello world"
run_scan "$COMMIT_JSON"
assert_eq "secret-scan: clean staged file is allowed" "0" "$SS_CODE"
reset_index

# 5) the literal value of a key in .env is caught even with no surrounding context
printf 'SEOUL_API_KEY=%s\n' "$FAKE_SEOUL" > "$SS_REPO/.env"
stage notes.txt "debug dump: $FAKE_SEOUL"
run_scan "$COMMIT_JSON"
assert_eq "secret-scan: literal .env key value in staged file exits 2" "2" "$SS_CODE"
assert_contains "secret-scan: .env hit names the variable, not the value" "$SS_ERR" "SEOUL_API_KEY"
if echo "$SS_ERR" | grep -qF "$FAKE_SEOUL"; then
    fail "secret-scan: key value never printed" "stderr contained the key value"
else
    pass "secret-scan: key value never printed"
fi
reset_index

# 6) a 32-hex Seoul-format key in an API URL path is caught
stage url.txt "GET http://openapi.seoul.go.kr:8088/$FAKE_SEOUL/json/bikeList/1/5"
run_scan "$COMMIT_JSON"
assert_eq "secret-scan: Seoul key inside API URL exits 2" "2" "$SS_CODE"
reset_index

# 7) a bare 32-hex id without key context (e.g. fixture image atchFileId) is NOT a false positive
stage fixture.txt "getImage.do?atchFileId=$FAKE_SEOUL&thumb=Y"
run_scan "$COMMIT_JSON"
assert_eq "secret-scan: bare 32-hex file id is not blocked" "0" "$SS_CODE"
reset_index

# 8) the staged blob is scanned, not the working tree (secret removed from disk but still staged)
stage staged-only.txt "aws = $FAKE_AWS"
printf 'cleaned\n' > "$SS_REPO/staged-only.txt"
run_scan "$COMMIT_JSON"
assert_eq "secret-scan: scans staged content, not working tree" "2" "$SS_CODE"
reset_index

# 9) settings.json must not swallow the exit code (|| true turns exit 2 into 0)
if grep -q 'secret-scan.sh[^"]*|| true' .claude/settings.json; then
    fail "secret-scan: settings.json keeps the exit code" "'|| true' after secret-scan.sh"
else
    pass "secret-scan: settings.json keeps the exit code"
fi

rm -rf "$SS_REPO"
