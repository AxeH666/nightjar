#!/usr/bin/env bash
# Nightjar one-shot setup for a fresh clone.
#   - fetches the Odysseus submodule (AGPL source + runtime dependency)
#   - applies Nightjar's Odysseus integration patch (embedded ChromaDB, etc.)
#   - creates the Python venvs + installs deps
#   - installs the UI's node modules
#   - installs Ollama + the gemma3:4b vision model (best-effort — offline image analysis)
#   - prints how to export NIGHTJAR_ROOT for manual CLI runs
#
# Idempotent: safe to re-run. Usage:  ./scripts/setup.sh
set -euo pipefail

# Repo root = this script's parent dir (no hardcoded machine path).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "== Nightjar setup (root: $ROOT) =="

# 1) Odysseus submodule (AGPL source-availability + the runtime sidecar) ---------
echo "-- [1/7] Odysseus submodule --"
git submodule update --init research/odysseus

# 2) Apply Nightjar's Odysseus patch (idempotent) -------------------------------
echo "-- [2/7] Odysseus integration patch --"
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
echo "-- [3/7] phase2-mcp venv --";      make_venv phase2-mcp
echo "-- [4/7] phase2-odysseus venv --"; make_venv phase2-odysseus
# Browser Use (autonomous form-filling) — isolated venv so its heavy deps
# (openai/anthropic/google-genai/…) never destabilize phase2-mcp/venv.
echo "-- [4b/7] browser-use venv --";    make_venv browser-use-mcp
# Browser Use 0.13.x drives Chromium over CDP and manages its own browser; it needs a
# Chrome/Chromium available. Best-effort diagnostic only — never fatal (a missing
# browser disables just the browser-use tool). Run doctor yourself to verify/fix:
#   browser-use-mcp/venv/bin/browser-use --doctor
if [ -x browser-use-mcp/venv/bin/browser-use ]; then
  browser-use-mcp/venv/bin/browser-use --doctor >/dev/null 2>&1 \
    && echo "   browser-use browser ready" \
    || echo "   (browser-use needs a Chrome/Chromium — verify later: browser-use-mcp/venv/bin/browser-use --doctor)"
fi

# 4) UI node modules ------------------------------------------------------------
echo "-- [5/7] phase3-ui npm install --"
( cd phase3-ui && npm install --no-audit --no-fund )

# 5) Local vision model — Ollama + gemma3:4b (best-effort, NEVER fatal) ----------
# Powers offline image analysis (nightjar_analyze_image). Skippable with
# NIGHTJAR_SKIP_OLLAMA=1. Cloud vision (BYOK) works regardless of this step.
echo "-- [6/7] local vision (Ollama + gemma3:4b) --"
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

# 5b) Local IMAGE model — diffusers venv + Z-Image-Turbo (best-effort, NEVER fatal) --
# Powers OFFLINE image generation (NJ-6). Skippable with NIGHTJAR_SKIP_DIFFUSION=1.
# Cloud image gen (OpenAI/OpenRouter BYOK) works regardless of this step. Needs a
# CUDA GPU + ~6 GB VRAM to actually generate; the model is Apache-2.0.
echo "-- [7/7] local image backend (diffusion + Z-Image-Turbo) --"
IMAGE_MODEL_DIR="${NIGHTJAR_IMAGE_MODEL_DIR:-$HOME/models/Z-Image-Turbo}"
if [ "${NIGHTJAR_SKIP_DIFFUSION:-0}" = "1" ]; then
  echo "   skipped (NIGHTJAR_SKIP_DIFFUSION=1)"
else
  echo "   creating diffusion-mcp/venv (heavy CUDA deps — this can take a while)…"
  make_venv diffusion-mcp || echo "   (diffusion venv setup failed — retry later: make_venv diffusion-mcp)"
  if [ -f "$IMAGE_MODEL_DIR/model_index.json" ]; then
    echo "   Z-Image-Turbo already present ($IMAGE_MODEL_DIR)"
  elif [ -x diffusion-mcp/venv/bin/python ]; then
    echo "   downloading Tongyi-MAI/Z-Image-Turbo (~6 GB, one-time) → $IMAGE_MODEL_DIR …"
    diffusion-mcp/venv/bin/python - "$IMAGE_MODEL_DIR" <<'PY' || echo "   (model download failed — retry later; cloud image gen via BYOK still works)"
import sys
from huggingface_hub import snapshot_download
snapshot_download("Tongyi-MAI/Z-Image-Turbo", local_dir=sys.argv[1])
PY
  else
    echo "   skipping model download — diffusion venv unavailable (cloud image gen via BYOK still works)"
  fi
fi

# 6) NIGHTJAR_ROOT --------------------------------------------------------------
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
