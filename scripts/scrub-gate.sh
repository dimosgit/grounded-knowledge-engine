#!/usr/bin/env bash
#
# Sanitization gate. Must return zero hits before anything ships.
# Designed to FAIL CLOSED: if a scanner cannot run, the gate errors out rather
# than silently reporting "clean". Run pre- and post-first-commit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PATTERN='vorwerk|mews|art ?nation|uzunov|dimo|1\.5m|€1|confidential|client name'

# 1) Content scan. Use grep (always present) so the gate works under npm's
#    restricted PATH, where the ripgrep shell-function wrapper is unavailable.
#    grep exit codes: 0 = matches found (FAIL), 1 = no matches (clean), >1 = error.
set +e
HITS="$(grep -rEi --binary-files=without-match \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude=package-lock.json --exclude=scrub-gate.sh \
  "$PATTERN" . )"
STATUS=$?
set -e
if [ "$STATUS" -gt 1 ]; then
  echo "SCRUB ERROR: content scanner failed to run (grep status $STATUS)"
  exit 2
fi
if [ -n "$HITS" ]; then
  echo "SCRUB FAIL: string hit"
  echo "$HITS"
  exit 1
fi
echo "string scan clean"

# 2) Filename scan: no *-private* files.
if find . -name '*-private*' -not -path './.git/*' -not -path './node_modules/*' | grep -q .; then
  echo "SCRUB FAIL: private filename"
  find . -name '*-private*' -not -path './.git/*' -not -path './node_modules/*'
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
