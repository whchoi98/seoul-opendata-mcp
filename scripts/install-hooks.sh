#!/bin/bash
# Install Git hooks that are not managed by Claude settings.
# Usage: bash scripts/install-hooks.sh

set -e

HOOKS_DIR=".git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
    echo "ERROR: .git/hooks directory not found. Is this a git repository?"
    exit 1
fi

# Install commit-msg hook (removes Co-Authored-By lines)
cat > "$HOOKS_DIR/commit-msg" << 'HOOK'
#!/bin/bash
# Remove Co-Authored-By lines from commit messages.
# Prevents Claude and other AI assistants from appearing as contributors.
sed -i '/^[Cc]o-[Aa]uthored-[Bb]y:.*/d' "$1"
sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$1"
HOOK
chmod +x "$HOOKS_DIR/commit-msg"
echo "Installed commit-msg hook (AI co-author removal)"

# Install pre-commit hook (secret scan on the staged index).
# The Claude Code PreToolUse hook runs before a Bash command, so it cannot see files staged by
# `git add -A && git commit` in the same command; this hook runs after staging and closes that gap.
cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/bin/bash
exec bash "$(git rev-parse --show-toplevel)/.claude/hooks/secret-scan.sh" --pre-commit
HOOK
chmod +x "$HOOKS_DIR/pre-commit"
echo "Installed pre-commit hook (secret scan)"

echo "=== Git hooks installed ==="
