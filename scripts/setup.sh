#!/usr/bin/env bash
# Nightjar one-shot setup for a fresh clone.
#   - fetches the submodules (Odysseus + the OpenCode ENGINE) + applies the Odysseus patch
#   - installs the engine's deps (bun install)
#   - creates the Python venvs (phase2-mcp/odysseus/browser-use) + the phase-cad venv + deps
#   - installs the UI's node modules
#   - installs Ollama + the gemma3:4b vision model (best-effort — offline image analysis)
#   - installs the local diffusion image backend (best-effort)
#
# Idempotent: safe to re-run. Usage:  ./scripts/setup.sh
#
# OS-aware: runs on Linux/WSL AND under Git Bash on native Windows (venv Scripts/python.exe
# vs bin/python). On native Windows the PowerShell script scripts/setup.ps1 is the primary
# path; this stays runnable under Git Bash. (audit1.md P1-5 — setup was previously POSIX-only.)
set -euo pipefail

# Repo root = this script's parent dir (no hardcoded machine path).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "== Nightjar setup (root: $ROOT) =="

# OS-aware venv interpreter layout: POSIX venvs put python/pip under bin/, Windows (Git Bash)
# venvs under Scripts/ with .exe. On Linux/WSL this is identical to the prior behavior.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) VBIN="Scripts"; PYEXE="python.exe";;
  *)                    VBIN="bin";     PYEXE="python";;
esac
# Python 3.12 launcher: prefer `py -3.12` (Windows launcher), else python3, else python.
if command -v py >/dev/null 2>&1 && py -3.12 --version >/dev/null 2>&1; then PYLAUNCH="py -3.12"
elif command -v python3 >/dev/null 2>&1; then PYLAUNCH="python3"
else PYLAUNCH="python"; fi

# 1) Submodules: Odysseus (RAG/PIM) + OpenCode (the ENGINE — the only agent loop) --------
echo "-- [1/10] git submodules (odysseus + opencode engine) --"
git submodule update --init research/odysseus research/opencode

# 2) OpenCode engine deps — bun install (audit1.md P0-1: the engine is a submodule now, but
# it still needs its node_modules). Put bun on PATH so dependency postinstalls that call
# `bun` resolve; retry --ignore-scripts if a native postinstall (TUI-only tree-sitter
# grammars → node-gyp) aborts — `serve` (HTTP) does not need them.
echo "-- [2/10] OpenCode engine deps (bun install) --"
BUN_BIN="${NIGHTJAR_BUN:-}"
if [ -z "$BUN_BIN" ]; then
  if command -v bun >/dev/null 2>&1; then BUN_BIN="$(command -v bun)"
  elif [ -x "$HOME/.bun/bin/bun" ]; then BUN_BIN="$HOME/.bun/bin/bun"
  elif [ -x "$HOME/.bun/bin/bun.exe" ]; then BUN_BIN="$HOME/.bun/bin/bun.exe"; fi
fi
if [ -n "$BUN_BIN" ]; then
  export PATH="$(dirname "$BUN_BIN"):$PATH"
  ( cd research/opencode && ( "$BUN_BIN" install || "$BUN_BIN" install --ignore-scripts ) )
else
  echo "   WARNING: bun not found — the engine will not start. Install: curl -fsSL https://bun.sh/install | bash" >&2
fi

# 3) Apply Nightjar's Odysseus patch (idempotent) --------------------------------------
echo "-- [3/10] Odysseus integration patch --"
PATCH="$ROOT/phase2-odysseus/odysseus-patches/nightjar-odysseus.patch"
if git -C research/odysseus apply --reverse --check "$PATCH" 2>/dev/null; then
  echo "   already applied — skipping"
elif git -C research/odysseus apply --check "$PATCH" 2>/dev/null; then
  # HARD-FAIL if the apply itself fails — a missing patch means the Odysseus tier
  # runs WITHOUT embedded ChromaDB (no-docker) + the docs RAG fix, which breaks at
  # runtime. Better to stop setup here than to "succeed" into a broken install.
  if ! git -C research/odysseus apply "$PATCH"; then
    echo "   ERROR: Odysseus patch failed to apply (after passing --check)." >&2
    exit 1
  fi
  echo "   applied ($PATCH)"
else
  echo "   ERROR: Odysseus patch does not apply cleanly and is not already applied." >&2
  echo "          The Odysseus tier would be MISSING embedded ChromaDB (no-docker)." >&2
  echo "          Inspect the submodule commit vs the patch: $PATCH" >&2
  exit 1
fi

# 4) Python venvs + deps ---------------------------------------------------------------
make_venv() {  # $1 = dir holding requirements.txt (venv created as <dir>/venv)
  local d="$1"
  [ -f "$d/requirements.txt" ] || { echo "   ($d has no requirements.txt — skipping)"; return; }
  if [ ! -x "$d/venv/$VBIN/$PYEXE" ]; then
    echo "   creating $d/venv"
    $PYLAUNCH -m venv "$d/venv"
  fi
  echo "   installing $d deps (this can take a while)…"
  "$d/venv/$VBIN/$PYEXE" -m pip install -q --upgrade pip
  "$d/venv/$VBIN/$PYEXE" -m pip install -q -r "$d/requirements.txt"
}
echo "-- [4/10] phase2-mcp venv --";      make_venv phase2-mcp
echo "-- [5/10] phase2-odysseus venv --"; make_venv phase2-odysseus
# Browser Use (autonomous form-filling) — isolated venv so its heavy deps
# (openai/anthropic/google-genai/…) never destabilize phase2-mcp/venv.
echo "-- [6/10] browser-use venv --";     make_venv browser-use-mcp
# Browser Use 0.13.x drives Chromium over CDP and manages its own browser; it needs a
# Chrome/Chromium available. Best-effort diagnostic only — never fatal (a missing
# browser disables just the browser-use tool). Run doctor yourself to verify/fix.
if [ -x "browser-use-mcp/venv/$VBIN/browser-use" ]; then
  "browser-use-mcp/venv/$VBIN/browser-use" --doctor >/dev/null 2>&1 \
    && echo "   browser-use browser ready" \
    || echo "   (browser-use needs a Chrome/Chromium — verify later: browser-use-mcp/venv/$VBIN/browser-use --doctor)"
fi

# 7) phase-cad venv (build123d / OCP via uv) — REQUIRED for the LAB / CAD lab -----------
# Delegated to the dedicated uv-based script (a separate Python 3.12 venv, isolated because
# OCP/VTK wheels are heavy + version-sensitive). Previously omitted from this one-shot.
echo "-- [7/10] phase-cad venv (build123d via uv) --"
bash "$ROOT/phase-cad/setup.sh"

# 8) UI node modules -------------------------------------------------------------------
echo "-- [8/10] phase3-ui npm install --"
( cd phase3-ui && npm install --no-audit --no-fund )

# 9) Local vision model — Ollama + gemma3:4b (best-effort, NEVER fatal) ----------------
# Powers offline image analysis (nightjar_analyze_image). Skippable with
# NIGHTJAR_SKIP_OLLAMA=1. Cloud vision (BYOK) works regardless of this step.
echo "-- [9/10] local vision (Ollama + gemma3:4b) --"
OLLAMA_HOST_URL="${OLLAMA_HOST:-http://127.0.0.1:11434}"
if command -v ollama >/dev/null 2>&1; then
  echo "   ollama present"
elif [ "${NIGHTJAR_SKIP_OLLAMA:-0}" = "1" ]; then
  echo "   ollama not found — skipped (NIGHTJAR_SKIP_OLLAMA=1)"
else
  echo "   ollama not found — attempting the official install (may prompt for sudo)…"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://ollama.com/install.sh | sh || echo "   (auto-install failed — install manually: https://ollama.com/download)"
  else
    echo "   (curl missing — install ollama manually: https://ollama.com/download)"
  fi
fi
if command -v ollama >/dev/null 2>&1; then
  if ! curl -sf --max-time 2 "$OLLAMA_HOST_URL/api/tags" >/dev/null 2>&1; then
    echo "   starting ollama daemon…"; ( ollama serve >/dev/null 2>&1 & ) ; sleep 2
  fi
  if ollama list 2>/dev/null | grep -q "gemma3:4b"; then
    echo "   gemma3:4b already present"
  else
    echo "   pulling gemma3:4b (~3.3 GB, one-time)…"
    ollama pull gemma3:4b || echo "   (pull failed — retry later: ollama pull gemma3:4b)"
  fi
else
  echo "   skipping vision model — ollama unavailable (cloud vision via BYOK still works)"
fi

# 10) Local IMAGE model — diffusers venv + Z-Image-Turbo (best-effort, NEVER fatal) -----
# Powers OFFLINE image generation (NJ-6). Skippable with NIGHTJAR_SKIP_DIFFUSION=1.
# Cloud image gen (OpenAI/OpenRouter BYOK) works regardless of this step. Needs a
# CUDA GPU + ~6 GB VRAM to actually generate; the model is Apache-2.0.
echo "-- [10/10] local image backend (diffusion + Z-Image-Turbo) --"
IMAGE_MODEL_DIR="${NIGHTJAR_IMAGE_MODEL_DIR:-$HOME/models/Z-Image-Turbo}"
if [ "${NIGHTJAR_SKIP_DIFFUSION:-0}" = "1" ]; then
  echo "   skipped (NIGHTJAR_SKIP_DIFFUSION=1)"
else
  echo "   creating diffusion-mcp/venv (heavy CUDA deps — this can take a while)…"
  make_venv diffusion-mcp || echo "   (diffusion venv setup failed — retry later: make_venv diffusion-mcp)"
  if [ -f "$IMAGE_MODEL_DIR/model_index.json" ]; then
    echo "   Z-Image-Turbo already present ($IMAGE_MODEL_DIR)"
  elif [ -x "diffusion-mcp/venv/$VBIN/$PYEXE" ]; then
    echo "   downloading Tongyi-MAI/Z-Image-Turbo (~6 GB, one-time) → $IMAGE_MODEL_DIR …"
    "diffusion-mcp/venv/$VBIN/$PYEXE" - "$IMAGE_MODEL_DIR" <<'PY' || echo "   (model download failed — retry later; cloud image gen via BYOK still works)"
import sys
from huggingface_hub import snapshot_download
snapshot_download("Tongyi-MAI/Z-Image-Turbo", local_dir=sys.argv[1])
PY
  else
    echo "   skipping model download — diffusion venv unavailable (cloud image gen via BYOK still works)"
  fi
fi

# 11) NIGHTJAR_ROOT --------------------------------------------------------------------
# The Electron app sets NIGHTJAR_ROOT for opencode-serve automatically
# (src/main/services.ts). For manual `opencode serve` / CLI runs, export it so the
# opencode.json {env:NIGHTJAR_ROOT} substitutions resolve:
cat <<EOF

== setup complete ==
For manual CLI runs (the desktop app does this automatically), export:

    export NIGHTJAR_ROOT="$ROOT"

Local LLM weights + llama.cpp are a separate install (see the phase reports); Ollama +
the gemma3:4b vision model are set up above (best-effort — skippable with
NIGHTJAR_SKIP_OLLAMA=1). The desktop app is: cd phase3-ui && npm run dev
EOF
