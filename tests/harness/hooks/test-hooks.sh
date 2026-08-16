#!/bin/bash
# Tests for .claude/hooks/*.sh used by this project (see .claude/settings.json).
#
# Note: hook files can be produced by a separate, concurrently-running task.
# Existence/behavior checks below skip (instead of failing) when a given hook
# file does not exist yet — they start asserting for real the moment the file
# shows up, with no changes needed here.

HOOKS=(check-doc-sync secret-scan session-context notify)

for hook in "${HOOKS[@]}"; do
    HOOK_PATH=".claude/hooks/$hook.sh"
    if [ -f "$HOOK_PATH" ]; then
        assert_file_exists "$hook.sh exists" "$HOOK_PATH"
        assert_file_executable "$hook.sh is executable" "$HOOK_PATH"
        assert_bash_syntax "$hook.sh valid bash" "$HOOK_PATH"
    else
        skip "$hook.sh exists" "not created yet"
        skip "$hook.sh is executable" "not created yet"
        skip "$hook.sh valid bash" "not created yet"
    fi
done

# --- settings.json hook registration ---
if [ -f ".claude/settings.json" ]; then
    assert_file_exists "settings.json exists" ".claude/settings.json"
    assert_json_valid "settings.json is valid JSON" ".claude/settings.json"

    SETTINGS=$(cat .claude/settings.json)
    assert_contains "SessionStart hook registered" "$SETTINGS" "session-context.sh"
    assert_contains "PreToolUse hook registered" "$SETTINGS" "secret-scan.sh"
    assert_contains "PostToolUse hook registered" "$SETTINGS" "check-doc-sync.sh"
    assert_contains "PostToolUse matcher is Write|Edit" "$SETTINGS" "Write|Edit"
    assert_contains "Notification hook registered" "$SETTINGS" "notify.sh"
else
    skip "settings.json exists" ".claude/settings.json not created yet"
    skip "settings.json is valid JSON" ".claude/settings.json not created yet"
    skip "SessionStart hook registered" ".claude/settings.json not created yet"
    skip "PreToolUse hook registered" ".claude/settings.json not created yet"
    skip "PostToolUse hook registered" ".claude/settings.json not created yet"
    skip "PostToolUse matcher is Write|Edit" ".claude/settings.json not created yet"
    skip "Notification hook registered" ".claude/settings.json not created yet"
fi

# --- Behavior tests (run only once the corresponding hook file exists) ---
if [ -f ".claude/hooks/check-doc-sync.sh" ]; then
    OUTPUT=$(bash .claude/hooks/check-doc-sync.sh "" 2>&1)
    assert_eq "check-doc-sync: empty path produces no output" "" "$OUTPUT"
else
    skip "check-doc-sync: empty path produces no output" "check-doc-sync.sh not created yet"
fi

if [ -f ".claude/hooks/session-context.sh" ]; then
    OUTPUT=$(bash .claude/hooks/session-context.sh 2>&1)
    assert_contains "session-context: shows project header" "$OUTPUT" "Project Context"
else
    skip "session-context: shows project header" "session-context.sh not created yet"
fi

if [ -f ".claude/hooks/notify.sh" ]; then
    OUTPUT=$(CLAUDE_NOTIFY_WEBHOOK="" bash .claude/hooks/notify.sh "test" "msg" 2>&1)
    assert_eq "notify.sh: no webhook URL produces no output" "" "$OUTPUT"
else
    skip "notify.sh: no webhook URL produces no output" "notify.sh not created yet"
fi
