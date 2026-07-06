#!/usr/bin/env bash
# Nightjar one-shot setup for a fresh clone.
#   - fetches the Odysseus submodule (AGPL source + runtime dependency)
#   - applies Nightjar's Odysseus integration patch (embedded ChromaDB, etc.)
#   - creates the Python venvs + installs deps
#   - installs the UI's node modules
#   - prints how to export NIGHTJAR_ROOT for manual CLI runs
#
# Idempotent: safe to re-run. Usage:  ./scripts/setup.sh
set -euo pipefail

# Repo root = this script's parent dir (no hardcoded machine path).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "== Nightjar setup (root: $ROOT) =="

# 1) Odysseus submodule (AGPL source-availability + the runtime sidecar) ---------
echo "-- [1/5] Odysseus submodule --"
git submodule update --init research/odysseus

# 2) Apply Nightjar's Odysseus patch (idempotent) -------------------------------
echo "-- [2/5] Odysseus integration patch --"
PATCH="$ROOT/phase2-odysseus/odysseus-patches/nightjar-odysseus.patch"
if git -C research/odysseus apply --reverse --check "$PATCH" 2>/dev/null; then
  echo "   already applied — skipping"
elif git -C research/odysseus apply --check "$PATCH" 2>/dev/null; then
  git -C research/odysseus apply "$PATCH"
  echo "   applied ($PATCH)"
else
  echo "   WARNING: patch neither applies cleanly nor is already applied — check $PATCH"
fi

# 3) Python venvs + deps --------------------------------------------------------
make_venv() {  # $1 = dir holding requirements.txt (venv created as <dir>/venv)
  local d="$1"
  [ -f "$d/requirements.txt" ] || { echo "   ($d has no requirements.txt — skipping)"; return; }
  if [ ! -x "$d/venv/bin/python" ]; then
    echo "   creating $d/venv"
    python3 -m venv "$d/venv"
  fi
  echo "   installing $d deps (this can take a while)…"
  "$d/venv/bin/pip" install -q --upgrade pip
  "$d/venv/bin/pip" install -q -r "$d/requirements.txt"
}
echo "-- [3/5] phase2-mcp venv --";      make_venv phase2-mcp
echo "-- [4/5] phase2-odysseus venv --"; make_venv phase2-odysseus

# 4) UI node modules ------------------------------------------------------------
echo "-- [5/5] phase3-ui npm install --"
( cd phase3-ui && npm install --no-audit --no-fund )

# 5) NIGHTJAR_ROOT --------------------------------------------------------------
# The Electron app sets NIGHTJAR_ROOT for opencode-serve automatically
# (src/main/services.ts). For manual `opencode serve` / CLI runs, export it so the
# opencode.json {env:NIGHTJAR_ROOT} substitutions resolve:
cat <<EOF

== setup complete ==
For manual CLI runs (the desktop app does this automatically), export:

    export NIGHTJAR_ROOT="$ROOT"

Model weights, llama.cpp, and Ollama are NOT installed by this script — see the
phase reports for the local model setup. The desktop app is: cd phase3-ui && npm run dev
EOF
