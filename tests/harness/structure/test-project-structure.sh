#!/bin/bash
# Validates this repo's actual state: package.json/manifest.json version sync,
# TOOL_NAMES has exactly 23 entries, CLAUDE.md exists, and scripts/ are sane.

# --- Version sync: package.json <-> manifest.json ---
if [ -f "package.json" ] && [ -f "manifest.json" ]; then
    PKG_VER=$(python3 -c "import json; print(json.load(open('package.json'))['version'])" 2>/dev/null)
    MANIFEST_VER=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])" 2>/dev/null)
    assert_eq "package.json version == manifest.json version" "$MANIFEST_VER" "$PKG_VER"
else
    fail "package.json version == manifest.json version" "package.json or manifest.json not found"
fi

# --- TOOL_NAMES has exactly 23 entries (src/index.ts) ---
if [ -f "src/index.ts" ]; then
    TOOL_COUNT=$(awk '/export const TOOL_NAMES = \[/,/\] as const/' src/index.ts 2>/dev/null \
        | grep -o "'[^']*'" | wc -l | tr -d ' ')
    assert_eq "TOOL_NAMES has 23 entries" "23" "$TOOL_COUNT"
else
    fail "TOOL_NAMES has 23 entries" "src/index.ts not found"
fi

# --- CLAUDE.md existence ---
# May be produced by a separate, concurrently-running task; skip (not fail) until it lands.
if [ -f "CLAUDE.md" ]; then
    assert_file_exists "CLAUDE.md exists" "CLAUDE.md"
else
    skip "CLAUDE.md exists" "not created yet"
fi

# --- scripts/ validation ---
assert_file_exists "scripts/setup.sh exists" "scripts/setup.sh"
assert_file_executable "scripts/setup.sh is executable" "scripts/setup.sh"
assert_bash_syntax "scripts/setup.sh valid bash" "scripts/setup.sh"

assert_file_exists "scripts/install-hooks.sh exists" "scripts/install-hooks.sh"
assert_file_executable "scripts/install-hooks.sh is executable" "scripts/install-hooks.sh"
assert_bash_syntax "scripts/install-hooks.sh valid bash" "scripts/install-hooks.sh"

# --- Module CLAUDE.md coverage: every code directory documents itself ---
for dir in src/*/ scripts/ infra/ tests/; do
    assert_file_exists "${dir}CLAUDE.md exists" "${dir}CLAUDE.md"
done

# --- docs/reference: a detected layer has its doc ---
# Signals follow the layer detection used by /init-project and /add-reference-doc.
if [ -f "Dockerfile" ]; then
    assert_file_exists "docs/reference/infrastructure.md exists (Dockerfile present)" "docs/reference/infrastructure.md"
fi
if compgen -G "infra/*.yaml" > /dev/null; then
    assert_file_exists "docs/reference/iac.md exists (infra/*.yaml present)" "docs/reference/iac.md"
fi

# --- docs/reference: the index and the root CLAUDE.md link every layer doc ---
INDEX_TEXT=$(cat docs/reference/INDEX.md 2>/dev/null || true)
ROOT_CLAUDE_TEXT=$(cat CLAUDE.md 2>/dev/null || true)
for doc in docs/reference/*.md; do
    name=$(basename "$doc")
    if [ "$name" != "INDEX.md" ]; then
        assert_contains "docs/reference/INDEX.md links $name" "$INDEX_TEXT" "]($name)"
        assert_contains "CLAUDE.md links docs/reference/$name" "$ROOT_CLAUDE_TEXT" "(docs/reference/$name)"
    fi
done
