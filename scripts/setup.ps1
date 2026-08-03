<#
Nightjar one-shot setup for NATIVE WINDOWS (the PowerShell equivalent of scripts/setup.sh,
which is bash-only and hardcodes POSIX venv paths - see audit1.md P1-5).

Provisions a fresh clone to a runnable app:
  - fetches the git submodule (research/opencode - the ENGINE)
  - `bun install` for the OpenCode engine (the only agent loop)
  - creates the Python 3.12 venvs (phase2-mcp, browser-use) + installs deps
  - phase-cad venv via `uv` (build123d / OCP) + smoke test
  - installs the UI's node modules
  - (optional, best-effort) Ollama gemma3:4b vision model, diffusion venv + Z-Image-Turbo

Idempotent - safe to re-run. Interpreter layout is Windows-correct (venv\Scripts\python.exe).

Usage (from anywhere):
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
Fastest path to a working LAB/CAD via a BYOK cloud key (skips the heavy optional backends):
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -CoreOnly

Prereqs (install first; reopen the terminal after each so PATH refreshes):
    Node 20+ | Bun (irm bun.sh/install.ps1 | iex) | Python 3.12 (winget install Python.Python.3.12)
    | uv (irm https://astral.sh/uv/install.ps1 | iex) | git
#>
[CmdletBinding()]
param(
  [switch]$SkipOllama,      # skip the local vision model (gemma3:4b)
  [switch]$WithDiffusion,   # OPT-IN: local image-gen venv + Z-Image-Turbo (~6 GB) — currently unused by the app (PR E)
  [switch]$CoreOnly         # engine + phase-cad + UI only - the minimal LAB/CAD-via-BYOK path
)
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root
Write-Host "== Nightjar setup (native Windows) - root: $Root ==" -ForegroundColor Cyan

function Test-Cmd([string]$Name) { return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }

# Resolve bun.exe: PATH first, then the default installer location.
function Resolve-Bun {
  if (Test-Cmd 'bun') { return (Get-Command bun).Source }
  $p = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
  if (Test-Path $p) { return $p }
  throw "bun not found. Install it: powershell -c `"irm bun.sh/install.ps1 | iex`" then reopen the terminal."
}

# The Python 3.12 launcher. Prefer the `py -3.12` launcher; fall back to a `python` that
# reports 3.12. build123d/OCP wheels require 3.12 EXACTLY (not 3.13).
function Get-Py312 {
  if (Test-Cmd 'py') {
    $v = (& py -3.12 --version 2>&1)
    if ($LASTEXITCODE -eq 0 -and "$v" -match '3\.12\.') { return @('py', '-3.12') }
  }
  if (Test-Cmd 'python') {
    $v = (& python --version 2>&1)
    if ("$v" -match '3\.12\.') { return @('python') }
  }
  throw "Python 3.12 not found. Install it: winget install Python.Python.3.12 (then reopen the terminal)."
}

# Create <dir>\venv from <dir>\requirements.txt if absent, install deps. Idempotent.
function New-Venv([string]$Dir, [string[]]$Py) {
  $req = Join-Path $Dir 'requirements.txt'
  if (-not (Test-Path $req)) { Write-Host "   ($Dir has no requirements.txt - skipping)"; return }
  $py = Join-Path $Dir 'venv\Scripts\python.exe'
  if (-not (Test-Path $py)) {
    Write-Host "   creating $Dir\venv"
    & $Py[0] @($Py[1..($Py.Length-1)]) -m venv (Join-Path $Dir 'venv')
    if ($LASTEXITCODE -ne 0) { throw "venv creation failed for $Dir" }
  }
  Write-Host "   installing $Dir deps (this can take a while)..."
  & $py -m pip install -q --upgrade pip
  & $py -m pip install -q -r $req
  if ($LASTEXITCODE -ne 0) { throw "pip install failed for $Dir" }
}

# ---- 1) Submodule: OpenCode (the engine) -------------------------------------------
Write-Host "-- [1/7] git submodule (opencode engine) --"
& git submodule update --init research/opencode
if ($LASTEXITCODE -ne 0) { throw "git submodule update failed (need network + git access to the fork)" }

# ---- 2) Engine deps: bun install in research/opencode ------------------------------
Write-Host "-- [2/7] OpenCode engine deps (bun install) --"
$bun = Resolve-Bun
$bunDir = Split-Path $bun -Parent
if (($env:PATH -split ';') -notcontains $bunDir) { $env:PATH = "$bunDir;$env:PATH" }  # so dep postinstalls that call `bun` resolve
Push-Location (Join-Path $Root 'research\opencode')
try {
  & $bun install
  if ($LASTEXITCODE -ne 0) {
    # A native postinstall (e.g. tree-sitter-powershell -> node-gyp, needs VS build tools) can
    # abort the install and leave the tree incomplete. Those grammars are TUI-only; `serve`
    # (HTTP) does not need them. Retry skipping scripts so every package is still LINKED.
    Write-Host "   bun install reported an error (likely a native postinstall) - retrying with --ignore-scripts"
    & $bun install --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "bun install failed in research/opencode (network?)" }
  }
} finally { Pop-Location }

# ---- 4) UI node modules -----------------------------------------------------------
Write-Host "-- [3/7] phase3-ui npm install --"
if (-not (Test-Cmd 'npm')) { throw "npm not found. Install Node.js 20+ and reopen the terminal." }
Push-Location (Join-Path $Root 'phase3-ui')
try { & npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw "npm install failed" } } finally { Pop-Location }

# ---- 5) phase-cad venv (build123d / OCP via uv) - needed for LAB/CAD ---------------
Write-Host "-- [4/7] phase-cad venv (build123d via uv) --"
if (-not (Test-Cmd 'uv')) { throw "uv not found. Install it: powershell -c `"irm https://astral.sh/uv/install.ps1 | iex`" then reopen the terminal." }
$cadPy = Join-Path $Root 'phase-cad\.venv\Scripts\python.exe'
if (-not (Test-Path $cadPy)) { & uv venv --python 3.12 (Join-Path $Root 'phase-cad\.venv') }
& uv pip install --python $cadPy 'build123d>=0.11,<0.12' 'build123d-mcp==0.3.79' 'cadquery-ocp-novtk!=7.9.3.1.1'
if ($LASTEXITCODE -ne 0) { throw "phase-cad dependency install failed (OCP/VTK wheels - need Python 3.12 exactly)" }
Write-Host "   smoke test..."
& $cadPy (Join-Path $Root 'phase-cad\smoke_test.py')
if ($LASTEXITCODE -ne 0) { throw "phase-cad smoke_test.py failed - CAD lab would be non-functional" }

if ($CoreOnly) {
  Write-Host "`n== -CoreOnly: skipping phase2-mcp/browser-use venvs + optional models ==" -ForegroundColor Yellow
  Write-Host "== setup complete (engine + phase-cad + UI). Add a BYOK key in the app for chat/CAD. =="
  Write-Host "== Run the app:  cd phase3-ui; npm run dev =="
  return
}

# ---- 6) Backend Python venvs (phase2-mcp / browser-use) ----------
Write-Host "-- [5/7] backend venvs (phase2-mcp, browser-use) --"
$py312 = Get-Py312
New-Venv (Join-Path $Root 'phase2-mcp') $py312
# TTS moved from kokoro-onnx's GPL espeak tokenizer to misaki (Apache-2.0), and the
# wake word moved from openWakeWord to hey-buddy (voice-phase PR 5) because
# openWakeWord's bundled MODEL weights are CC-BY-NC-SA — non-commercial (NJ-58).
# Dropping any of them from requirements.txt does NOT remove them from an existing
# venv, so purge explicitly — otherwise upgraded installs keep a GPL espeak-ng
# binary, or a non-commercial model set, on disk. Idempotent; never fatal.
$mcpPy = Join-Path $Root 'phase2-mcp\venv\Scripts\python.exe'
if (Test-Path $mcpPy) {
  & $mcpPy -m pip uninstall -y -q kokoro-onnx phonemizer-fork espeakng-loader openwakeword 2>$null | Out-Null
}
New-Venv (Join-Path $Root 'browser-use-mcp') $py312
# browser-use needs a Chrome/Chromium; verify later:  browser-use-mcp\venv\Scripts\browser-use --doctor

# ---- 7) Local vision model - Ollama + gemma3:4b (best-effort, NEVER fatal) ----------
Write-Host "-- [6/7] local vision (Ollama + gemma3:4b) --"
if ($SkipOllama) {
  Write-Host "   skipped (-SkipOllama)"
} elseif (Test-Cmd 'ollama') {
  try {
    $tags = (& ollama list 2>$null | Out-String)
    if ($tags -match 'gemma3:4b') { Write-Host "   gemma3:4b already present" }
    else { Write-Host "   pulling gemma3:4b (~3.3 GB, one-time)..."; & ollama pull gemma3:4b }
  } catch { Write-Host "   (ollama present but pull failed - retry later: ollama pull gemma3:4b)" }
} else {
  Write-Host "   ollama not found - skipped (install from https://ollama.com/download; cloud vision via BYOK still works)"
}

# ---- 8) Local image backend - diffusion venv + Z-Image-Turbo (best-effort) ----------
Write-Host "-- [7/7] local image backend (diffusion + Z-Image-Turbo) --"
# PR E: the app currently has NO local image path (image gen is a BYOK cloud call;
# the diffusion sidecar was removed with the Odysseus submodule). This step is kept
# ONLY as groundwork for a possible future local backend, and is now OPT-IN.
if (-not $WithDiffusion) {
  Write-Host "   skipped (currently unused by the app - opt in with -WithDiffusion)"
} else {
  try { New-Venv (Join-Path $Root 'diffusion-mcp') $py312 } catch { Write-Host "   (diffusion venv setup failed - retry later; cloud image gen via BYOK still works)" }
  $imgDir = if ($env:NIGHTJAR_IMAGE_MODEL_DIR) { $env:NIGHTJAR_IMAGE_MODEL_DIR } else { Join-Path $env:USERPROFILE 'models\Z-Image-Turbo' }
  if (Test-Path (Join-Path $imgDir 'model_index.json')) {
    Write-Host "   Z-Image-Turbo already present ($imgDir)"
  } else {
    Write-Host "   NOTE: Z-Image-Turbo (~6 GB) not downloaded. To enable offline image gen later, pull"
    Write-Host "         Tongyi-MAI/Z-Image-Turbo into $imgDir (needs a CUDA GPU + ~6 GB VRAM)."
  }
}

Write-Host "`n== setup complete ==" -ForegroundColor Green
Write-Host "Run the app:  cd phase3-ui; npm run dev"
Write-Host "For local chat, also install a CUDA llama-server.exe + the Qwen3-4B GGUF and set"
Write-Host "NIGHTJAR_LLAMA_BIN / NIGHTJAR_MODEL_GGUF - or just add a BYOK cloud key in the app."
