#!/usr/bin/env bash
#
# Sanitization gate. Must return zero hits before anything ships.
# Designed to FAIL CLOSED: if a scanner cannot run, the gate errors out rather
# than silently reporting "clean". Run pre- and post-first-commit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Blocked terms live in two tiers, so this tracked file never has to name the
# things it exists to keep out of the repository:
#
#   1. scripts/scrub-patterns.public.txt — generic, non-identifying terms that
#      ship with the repo and run everywhere, including CI.
#   2. A machine-local overlay ($GKE_SCRUB_PATTERNS, default
#      .gke/scrub-patterns.txt) — untracked and gitignored. Workspace-specific
#      identifiers belong there: private client and project names, machine-local
#      home-directory paths, and any other term whose appearance in a public
#      diff would itself be the disclosure.
#
# The overlay is required by default. GKE_SCRUB_PUBLIC_ONLY=1 runs the published
# tier alone, for CI and outside contributors who cannot hold a maintainer's
# private list. That is a visible, announced downgrade rather than a silent
# skip, and it still runs the filename, KB-allowlist, and secret scans below.
#
# Intentional public maintainer metadata, such as the published demo domain, is
# allowed and belongs in neither list.
PUBLIC_PATTERNS="scripts/scrub-patterns.public.txt"
LOCAL_PATTERNS="${GKE_SCRUB_PATTERNS:-.gke/scrub-patterns.txt}"

# One term per line; comment and blank lines dropped, the rest joined into a
# single alternation. Never echo the result — printing it would defeat tier 2.
read_patterns() {
  sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' -e 's/[[:space:]]*$//' "$1" | paste -sd '|' -
}

if [ ! -f "$PUBLIC_PATTERNS" ]; then
  echo "SCRUB ERROR: missing published pattern list ($PUBLIC_PATTERNS)"
  exit 2
fi
PATTERN="$(read_patterns "$PUBLIC_PATTERNS")"

if [ "${GKE_SCRUB_PUBLIC_ONLY:-0}" = "1" ]; then
  echo "SCRUB NOTICE: published patterns only (GKE_SCRUB_PUBLIC_ONLY=1); the"
  echo "  machine-local overlay was NOT applied. A maintainer must run the full"
  echo "  gate locally before publishing a release."
elif [ -f "$LOCAL_PATTERNS" ]; then
  LOCAL_PATTERN="$(read_patterns "$LOCAL_PATTERNS")"
  if [ -n "$LOCAL_PATTERN" ]; then
    PATTERN="$PATTERN|$LOCAL_PATTERN"
  fi
  echo "local pattern overlay loaded ($(grep -cvE '^[[:space:]]*(#|$)' "$LOCAL_PATTERNS") terms)"
else
  echo "SCRUB FAIL: machine-local pattern overlay not found at $LOCAL_PATTERNS"
  echo "  cp scripts/scrub-patterns.local.example.txt $LOCAL_PATTERNS"
  echo "  then fill in the identifiers this workspace must never publish."
  echo "  Set GKE_SCRUB_PUBLIC_ONLY=1 to accept the reduced published-only scan."
  exit 1
fi

if [ -z "$PATTERN" ]; then
  echo "SCRUB ERROR: no blocked terms resolved; an empty pattern matches everything."
  exit 2
fi

# 1) Content scan over SHIPPABLE files only. Drive the file list from git
#    (`git grep` searches tracked files), so gitignored, machine-local artifacts
#    — `.mcp.json`, `.claude/`, `dist/`, `content/`, the private KB, and the
#    pattern overlay itself — are never scanned: they don't ship, and scanning
#    them produced false failures (e.g. the absolute `/Users/<name>/...` path
#    inside a locally generated `.mcp.json`). The pattern files that do ship are
#    excluded too, since a term list necessarily contains its own terms.
#    git grep keeps grep's exit codes: 0 = matches (FAIL), 1 = clean, >1 = error.
set +e
HITS="$(git grep --no-color -EinI "$PATTERN" -- . \
  ':!package-lock.json' \
  ':!scripts/scrub-gate.sh' \
  ':!scripts/scrub-patterns.public.txt' \
  ':!scripts/scrub-patterns.local.example.txt')"
STATUS=$?
set -e
if [ "$STATUS" -gt 1 ]; then
  echo "SCRUB ERROR: content scanner failed to run (git grep status $STATUS)"
  exit 2
fi
if [ -n "$HITS" ]; then
  echo "SCRUB FAIL: string hit"
  echo "$HITS"
  exit 1
fi
echo "string scan clean"

# 2) Filename scan: no *-private* files.
if find . -name '*-private*' -not -path './.git/*' -not -path '*/node_modules/*' | grep -q .; then
  echo "SCRUB FAIL: private filename"
  find . -name '*-private*' -not -path './.git/*' -not -path '*/node_modules/*'
  exit 1
fi
echo "filename scan clean"

# 3) The private `kb/` tree is ignored. Only this small, reviewed public
#    allowlist may be tracked; any addition fails until the gate is consciously
#    updated in the same review.
UNEXPECTED_KB="$(git ls-files kb | grep -Ev '^(kb/topics/mcp-primitive-decision\.md|kb/topics/ms365-copilot-mcp-integration\.md)$' || true)"
if [ -n "$UNEXPECTED_KB" ]; then
  echo "SCRUB FAIL: unexpected tracked private-KB path"
  echo "$UNEXPECTED_KB"
  exit 1
fi
echo "tracked KB allowlist clean"

# 4) Secret scan (blocking). gitleaks is required, not optional: a missing
#    scanner must fail the gate, never be skipped.
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "SCRUB FAIL: gitleaks not installed (required secret scanner)."
  echo "Install it: brew install gitleaks"
  exit 1
fi
gitleaks detect --no-banner --redact
echo "secret scan clean"

# 5) Confirm no derived/ignored content is staged or present unexpectedly.
git status --ignored --short
