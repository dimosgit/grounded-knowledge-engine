#!/usr/bin/env bash
set -euo pipefail

if rg --hidden --glob '!node_modules' --glob '!.git' --glob '!package-lock.json' \
  --glob '!scripts/scrub-gate.sh' \
  -i 'vorwerk|mews|art ?nation|uzunov|dimo|1\.5m|€1|confidential|client name' .; then
  echo "SCRUB FAIL: string hit"
  exit 1
else
  echo "string scan clean"
fi

if find . -name '*-private*' -not -path './.git/*' | grep .; then
  echo "SCRUB FAIL: private filename"
  exit 1
else
  echo "filename scan clean"
fi

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-banner --redact
else
  echo "gitleaks not installed; skipping secret scan"
fi

git status --ignored --short
