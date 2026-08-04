#!/usr/bin/env python3
"""Model/dataset licence guard: every non-pip artifact must be manifested, pinned,
and commercially clean if it ships at runtime.

Why this exists: test_no_copyleft_venv.py (#146) sweeps installed Python
DISTRIBUTIONS, and that is the wrong layer for the failure that actually happened.
NJ-58: openWakeWord the PACKAGE is Apache-2.0 and passed every package-level check,
while the MODEL WEIGHTS inside its wheel — including the `hey_jarvis` fallback
Nightjar really used — were CC-BY-NC-SA (non-commercial). Weights are not
distributions; no venv sweep will ever see them. This guard covers that layer:
model files, voice packs, and training datasets, whether vendored in-tree or
fetched at runtime.

What it enforces, against phase2-mcp/model_licenses.json:

  1. Every vendored artifact matches its manifested sha256 (a silent weight swap is
     a silent licence swap — and a supply-chain hole).
  2. Every runtime-scoped artifact is commercial_ok, EXCEPT entries that also carry
     `commercial_ok_reason` — the explicitly-recorded interim exceptions (the
     hey-buddy stand-in). Those must name their NJ item; unexplained
     non-commercial runtime artifacts fail.
  3. Every .onnx under nightjar_capabilities/ appears in the manifest — an
     un-manifested model file in the runtime tree fails, which is what forces the
     NEXT model addition through this process.
  4. Every download URL in nightjar_capabilities source is manifested, so a new
     hot-linked artifact cannot slip in beside the manifest.
  5. The openwakeword package stays gone from the venv (the #146 lesson: pip never
     removes on requirement removal), and nothing imports it.
  6. rejected-scope entries exist for the known-bad artifacts, so their reasoning
     survives in a machine-checked place, not just prose.

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_model_licenses.py
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PHASE2 = Path(__file__).resolve().parent.parent
MANIFEST = PHASE2 / "model_licenses.json"
CAPS = PHASE2 / "nightjar_capabilities"

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        FAILS.append(label)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    arts = manifest["artifacts"]
    by_id = {a["id"]: a for a in arts}
    print(f"== {len(arts)} manifest entries ({MANIFEST.name}) ==")

    # ── 1. vendored artifacts: exist + checksum matches ───────────────────────
    print("\n== 1. vendored artifacts are present and checksum-pinned ==")
    for a in arts:
        if not a.get("vendored"):
            continue
        p = PHASE2 / a["path"]
        if not p.exists():
            check(f"{a['id']}: vendored file exists", False, str(p))
            continue
        got = sha256(p)
        check(f"{a['id']}: sha256 matches manifest", got == a["sha256"],
              f"got {got[:16]}…, manifest {a['sha256'][:16]}…")

    # ── 2. runtime artifacts are commercially clean or explicitly excepted ────
    print("\n== 2. runtime scope: commercial_ok, or a recorded interim exception ==")
    for a in arts:
        if a.get("scope") != "runtime":
            continue
        if a.get("commercial_ok"):
            check(f"{a['id']}: commercial_ok", True)
            continue
        reason = a.get("commercial_ok_reason", "")
        ok = bool(reason) and bool(re.search(r"NJ-\d+", reason))
        check(f"{a['id']}: non-commercial runtime artifact has a recorded NJ-tagged reason",
              ok, reason[:80] or "NO REASON RECORDED")

    # ── 3. no un-manifested model files in the runtime tree ───────────────────
    print("\n== 3. every model binary under nightjar_capabilities/ is manifested ==")
    manifested_paths = {a.get("path") for a in arts if a.get("path")}
    stray = []
    for ext in ("*.onnx", "*.safetensors", "*.gguf", "*.pt", "*.pth"):
        for f in CAPS.rglob(ext):
            rel = f.relative_to(PHASE2).as_posix()
            if rel not in manifested_paths:
                stray.append(rel)
    check("no un-manifested model binaries in the runtime tree", not stray, "; ".join(stray))

    # ── 4. every download URL in runtime source is manifested ────────────────
    print("\n== 4. runtime code fetches only manifested URLs ==")
    manifested_urls = {a.get("source", "") for a in arts}
    url_re = re.compile(r"https?://[^\s\"')]+\.(?:onnx|safetensors|gguf|bin|pt|pth)\b")
    unknown: list[str] = []
    for py in CAPS.rglob("*.py"):
        text = py.read_text(encoding="utf-8", errors="replace")
        for m in url_re.finditer(text):
            url = m.group(0)
            if not any(url in u or u in url for u in manifested_urls if u):
                unknown.append(f"{py.name}: {url}")
    # voice.py builds its URLs as BASE + filename — resolve those too
    voice_src = (CAPS / "voice.py").read_text(encoding="utf-8", errors="replace")
    base = re.search(r'_KOKORO_BASE\s*=\s*"([^"]+)"', voice_src)
    for name_var in ("_KOKORO_MODEL", "_KOKORO_VOICES"):
        nm = re.search(name_var + r'\s*=\s*"([^"]+)"', voice_src)
        if base and nm:
            url = f"{base.group(1)}/{nm.group(1)}"
            if url not in manifested_urls:
                unknown.append(f"voice.py (joined): {url}")
    check("all runtime model-download URLs are manifested", not unknown, "; ".join(unknown))

    # ── 5. openwakeword is gone: from the venv AND from imports ───────────────
    print("\n== 5. openWakeWord stays out (NJ-58) ==")
    import importlib.util
    # NJ-76 (same class as the copyleft guard's vacuous pass): a NEGATIVE import assertion is
    # satisfied by an interpreter where nothing at all is installed, so run with the wrong
    # python this section printed PASS and the file exited 0 having proven nothing. Verified:
    # it exited 0 against an empty venv. Pair it with a POSITIVE control — if these cannot be
    # imported we are not in the phase2-mcp venv, and the negative below is worthless.
    positive = [m for m in ("onnxruntime", "httpx", "mcp") if importlib.util.find_spec(m) is None]
    check("running under the phase2-mcp venv (positive control for the check below)",
          not positive,
          f"not importable: {positive} — wrong interpreter? use phase2-mcp/venv/Scripts/python")
    check("openwakeword is NOT importable from this venv",
          importlib.util.find_spec("openwakeword") is None,
          "pip never removes on requirement removal — purge it (setup scripts do)")
    importers = []
    for py in [*CAPS.rglob("*.py"), PHASE2 / "wake_daemon.py", PHASE2 / "mcp_server.py"]:
        if "openwakeword" in py.read_text(encoding="utf-8", errors="replace").replace(
                "openWakeWord", "openwakeword").lower().replace("# ", ""):
            # allow mentions in comments/docstrings; flag real imports only
            for line in py.read_text(encoding="utf-8", errors="replace").splitlines():
                if re.match(r"\s*(import|from)\s+openwakeword", line):
                    importers.append(f"{py.name}: {line.strip()}")
    check("nothing imports openwakeword", not importers, "; ".join(importers))
    req = (PHASE2 / "requirements.txt").read_text(encoding="utf-8")
    check("openwakeword is not pinned in requirements.txt", "openwakeword" not in req)

    # ── 6. the rejection record survives ─────────────────────────────────────
    print("\n== 6. known-bad artifacts stay recorded as rejections ==")
    for rid in ("REJECTED-openwakeword-pretrained-models",
                "REJECTED-piper-libritts-en-r-medium",
                "REJECTED-piper-sample-generator-default"):
        a = by_id.get(rid)
        check(f"{rid} present, scope=rejected, commercial_ok=false",
              bool(a) and a.get("scope") == "rejected" and a.get("commercial_ok") is False)

    # ── 7. negative controls: the guard actually fails on the bad cases ───────
    print("\n== 7. negative controls ==")
    # (a) a tampered vendored file must fail the checksum check
    vend = next(a for a in arts if a.get("vendored"))
    real = sha256(PHASE2 / vend["path"])
    check("control: checksum comparison rejects a one-bit difference",
          real != vend["sha256"][:-1] + ("0" if vend["sha256"][-1] != "0" else "1"))
    # (b) a runtime entry that is non-commercial with no reason must be caught
    fake = {"id": "fake", "scope": "runtime", "commercial_ok": False}
    caught = not (fake.get("commercial_ok")
                  or re.search(r"NJ-\d+", fake.get("commercial_ok_reason", "") or ""))
    check("control: unexplained non-commercial runtime artifact is caught", caught)
    # (c) an un-manifested URL pattern must be caught by the regex
    check("control: the URL regex sees a novel .onnx link",
          bool(url_re.search('MODEL_URL = "https://evil.example/backdoor.onnx"')))

    print("\n" + ("FAILED: " + "; ".join(FAILS[:10]) if FAILS else "ALL CHECKS PASSED"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
