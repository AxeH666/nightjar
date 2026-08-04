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
#
# NJ-74: both probes MUST be wrapped in try/catch. This script runs under
# $ErrorActionPreference='Stop', and in Windows PowerShell 5.1 ANY stderr redirection on a
# NATIVE command turns each stderr line into an ErrorRecord, which EAP=Stop promotes to a
# terminating error. So on a box that HAS the `py` launcher but NOT 3.12, `py -3.12 --version`
# threw out of this function — the `python` fallback below and the actionable winget message
# were both unreachable, and the user just got py's bare "No suitable Python runtime found".
# `2>$null` does NOT fix this: the ErrorRecord comes from the redirection itself, not from
# where the output lands (verified by running; line ~140's purge is the standing proof — it
# already uses 2>$null and was still fatal).
function Get-Py312 {
  if (Test-Cmd 'py') {
    try {
      $v = (& py -3.12 --version 2>&1)
      if ($LASTEXITCODE -eq 0 -and "$v" -match '3\.12\.') { return @('py', '-3.12') }
    } catch {
      # py exists but has no 3.12 runtime — fall through to the `python` probe.
    }
  }
  if (Test-Cmd 'python') {
    try {
      $v = (& python --version 2>&1)
      # NOTE: `return @('python')` unrolls to a SCALAR string here. That is benign — every
      # call site binds it to New-Venv's [string[]]$Launcher, which re-coerces it to a
      # 1-element array (verified). Don't "fix" it without re-checking those call sites.
      if ("$v" -match '3\.12\.') { return @('python') }
    } catch {
      # python exists but isn't 3.12 (or isn't runnable) — fall through to the throw.
    }
  }
  throw "Python 3.12 not found. Install it: winget install Python.Python.3.12 (then reopen the terminal)."
}

# Create <dir>\venv from <dir>\requirements.txt if absent, install deps. Idempotent.
#
# NJ-73 — the parameter is $Launcher, NOT $Py, and that is load-bearing. PowerShell variable
# names are CASE-INSENSITIVE, so the old `[string[]]$Py` parameter and the local
# `$py = Join-Path $Dir 'venv\Scripts\python.exe'` below were THE SAME VARIABLE. The local
# assignment clobbered the launcher before it was ever used (the [string[]] constraint just
# re-coerced the path into a 1-element array), so the venv-creation line invoked the
# not-yet-created venv interpreter and died with CommandNotFoundException. New-Venv could
# therefore never create a venv on ANY machine — this was not, as first reported, limited to
# boxes lacking `py -3.12`. Existing installs were unaffected only because the Test-Path
# guard below skips creation when a venv already exists. Do not rename this back, and do not
# introduce another local called $py-with-any-casing.
function New-Venv([string]$Dir, [string[]]$Launcher) {
  $req = Join-Path $Dir 'requirements.txt'
  if (-not (Test-Path $req)) { Write-Host "   ($Dir has no requirements.txt - skipping)"; return }
  $py = Join-Path $Dir 'venv\Scripts\python.exe'
  if (-not (Test-Path $py)) {
    Write-Host "   creating $Dir\venv"
    # NJ-73 (second defect, same line): the tail was `$Launcher[1..($Launcher.Length-1)]`.
    # For a ONE-element launcher that is `1..0`, which PowerShell evaluates as the REVERSED
    # range 1,0 — so the tail became the launcher itself, duplicating the interpreter as its
    # own script argument. Select-Object -Skip 1 yields an empty tail for length 1 and the
    # correct tail for 2+.
    $exe  = $Launcher[0]
    $rest = @($Launcher | Select-Object -Skip 1)
    & $exe @rest -m venv (Join-Path $Dir 'venv')
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
#
# NJ-75: "never fatal" was FALSE, and the try/catch is what finally makes it true. pip writes
# "WARNING: Skipping <pkg> as it is not installed" to stderr for each absent package and still
# exits 0; under EAP=Stop, PowerShell 5.1 turns that stderr into a terminating error. At least
# one of these four is absent in any freshly created venv, so this threw every time. It was
# masked only because NJ-73 killed the script at the New-Venv above first — fixing that alone
# would have relocated the fatal error nine lines down, still inside step [5/7], still leaving
# no browser-use-mcp venv. `2>$null` does not help (the ErrorRecord is from the redirection,
# not the destination). The bash original guards the identical call with `|| true`
# (scripts/setup.sh:76); the PowerShell port dropped it.
$mcpPy = Join-Path $Root 'phase2-mcp\venv\Scripts\python.exe'
if (Test-Path $mcpPy) {
  try {
    & $mcpPy -m pip uninstall -y -q kokoro-onnx phonemizer-fork espeakng-loader openwakeword 2>$null | Out-Null
  } catch {
    Write-Host "   (purge of retired packages reported nothing to remove - continuing)"
  }
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
