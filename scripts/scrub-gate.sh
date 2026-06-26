#!/usr/bin/env bash
#
# Sanitization gate. Must return zero hits before anything ships.
# Designed to FAIL CLOSED: if a scanner cannot run, the gate errors out rather
# than silently reporting "clean". Run pre- and post-first-commit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Intentional public maintainer metadata, such as gke.dimouzunov.com, is allowed.
# This gate focuses on client/private-workspace leakage and release-blocking terms.
PATTERN='vorwerk|mews|art ?nation|1\.5m|€1|confidential|client name|private-source-repo'

# 1) Content scan over SHIPPABLE files only. Drive the file list from git
#    (`git grep` searches tracked files), so gitignored, machine-local artifacts
#    — `.mcp.json`, `.claude/`, `dist/`, `content/`, the private KB — are never
#    scanned: they don't ship, and scanning them produced false failures (e.g. the
#    absolute `/Users/<name>/...` path inside a locally generated `.mcp.json`).
#    git grep keeps grep's exit codes: 0 = matches (FAIL), 1 = clean, >1 = error.
set +e
HITS="$(git grep --no-color -EinI "$PATTERN" -- . ':!package-lock.json' ':!scripts/scrub-gate.sh')"
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

# 3) Secret scan (blocking). gitleaks is required, not optional: a missing
#    scanner must fail the gate, never be skipped.
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "SCRUB FAIL: gitleaks not installed (required secret scanner)."
  echo "Install it: brew install gitleaks"
  exit 1
fi
gitleaks detect --no-banner --redact
echo "secret scan clean"

# 4) Confirm no derived/ignored content is staged or present unexpectedly.
git status --ignored --short
