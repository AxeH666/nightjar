#!/usr/bin/env bash
# Create the Prompt-to-CAD (Task 5) Python environment.
#
# A DEDICATED Python 3.12 venv via `uv`, separate from the other phase venvs: the OCP /
# VTK wheels this pulls are heavy and version-sensitive, and build123d 0.11 depends on
# `cadquery-ocp-novtk` (not `cadquery-ocp`). Keeping it isolated means a CAD dependency
# bump can never disturb the odysseus or mcp environments.
#
# Usage:  phase-cad/setup.sh          # from the repo root
# Result: phase-cad/.venv with build123d + build123d-mcp, ready for opencode.json (PR 9).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: 'uv' is required (https://docs.astral.sh/uv/). Install it and re-run." >&2
  exit 1
fi

# Python 3.12 exactly — NOT 3.13/3.14. 3.12 is the widest-tested intersection across
# build123d + build123d-mcp + OCP + VTK wheels (see README.md). uv fetches it if absent.
echo "==> creating Python 3.12 venv (.venv) via uv"
uv venv --python 3.12 .venv

echo "==> installing pinned CAD deps (this pulls OCP/VTK — sizeable, be patient)"
VIRTUAL_ENV="$HERE/.venv" uv pip install --python .venv/bin/python \
  'build123d>=0.11,<0.12' \
  'build123d-mcp==0.3.79' \
  'cadquery-ocp-novtk!=7.9.3.1.1'

echo "==> smoke test"
.venv/bin/python smoke_test.py

cat <<'DONE'

✅ phase-cad env ready.

  Interpreter : phase-cad/.venv/bin/python
  Wired into  : opencode.json (PR 9) as the build123d-mcp server command,
                with BUILD123D_IN_PROCESS=1 in its environment (REQUIRED — the default
                worker-subprocess mode fails under stdio/sandboxed MCP hosts, upstream #143).
DONE
