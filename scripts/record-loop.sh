#!/usr/bin/env bash
#
# Regenerate the README hero (docs/loop.svg): a static terminal render of the
# real loop — a grounded answer with citations, then the answer -> capture ->
# re-answer proof. Runs the actual engine; no hand-typing, no retakes.
#
# Requires: asciinema (>=3), npx (svg-term-cli is fetched on demand).
#   brew install asciinema
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CAST="$(mktemp -t gke-loop).cast"
CAST_V2="$(mktemp -t gke-loop-v2).cast"
SCRIPT="$(mktemp -t gke-loop-body).sh"
trap 'rm -f "$CAST" "$CAST_V2" "$SCRIPT"' EXIT

# The narrated body: two real commands with colored banners.
cat > "$SCRIPT" <<'BODY'
set -e
printf '\033[1;36m# Grounded Knowledge Engine — the loop\033[0m\n\n'
printf '\033[1;32m$ ground a question in your own Markdown (with citations)\033[0m\n'
npm run search --silent -- \
  --query "are MCP tools model-controlled or application-controlled?" \
  --mode generic --limit 3 --context 1
printf '\n\033[1;32m$ prove the full loop: answer -> capture -> re-answer\033[0m\n'
npm run smoke:mcp --silent
printf '\n\033[1;36m# grounded with citations, captured, and recalled — same capability over MCP\033[0m\n'
BODY

# 1) Record (headless, fixed width so nothing wraps, idle capped to trim startup pauses).
asciinema rec --headless --window-size 120x40 -i 1.2 -c "bash '$SCRIPT'" "$CAST" --overwrite

# 2) asciinema 3.x writes asciicast v3; svg-term-cli reads only v1/v2.
asciinema convert -f asciicast-v2 "$CAST" "$CAST_V2" --overwrite

# 3) Render a STATIC final frame (animated SVGs get their CSS stripped by GitHub's
#    image proxy, which would show an empty terminal — static is reliable).
npx --yes svg-term-cli --in "$CAST_V2" --out docs/loop.svg --window --no-cursor --at 1200

# The smoke test bumps a tracked note's date; keep the tree clean.
git checkout -- kb/topics/mcp-primitive-decision.md 2>/dev/null || true

echo "Wrote docs/loop.svg"
