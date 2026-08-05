#!/usr/bin/env python3
"""NJ-79: the wake daemon's log path must survive PIPED stdio on Windows.

Why this test exists, and why it is shaped this way:

The daemon crash-looped on its first native-Windows run — five restarts, then `failed` —
because `print()` raised UnicodeEncodeError on a non-cp1252 character. Python chooses stdout's
encoding from whether stdout is a CONSOLE: a real terminal on Windows gives
`_WindowsConsoleIO` at utf-8 and everything works, while a PIPE falls back to the locale ANSI
codepage (cp1252 on a typical box). The supervisor spawns with pipes; a human testing by hand
gets a console.

So a console-attached test PASSES ON THE BROKEN CODE. That is precisely how this shipped and
reached hardware. Every check below therefore runs a real subprocess with
`stdout=PIPE, stderr=PIPE` and asserts on what actually comes back.

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_log_encoding.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PHASE2 = Path(__file__).resolve().parents[1]
FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' - ' + detail) if detail else ''}")
    if not ok:
        FAILS.append(label)


def run_piped(code: str, env_extra: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    """Run `code` in a child with stdout AND stderr as PIPES — never a console."""
    env = dict(os.environ)
    # Force the failure mode we are defending against, so this test is meaningful on a box
    # whose locale is already UTF-8 (i.e. every POSIX CI machine). Without this the test
    # would be vacuous off Windows.
    env["PYTHONIOENCODING"] = env_extra.pop("PYTHONIOENCODING", "cp1252") if env_extra else "cp1252"
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(PHASE2),
        env=env,
        stdout=subprocess.PIPE,   # <- a PIPE, not a console. The whole point.
        stderr=subprocess.PIPE,
        timeout=120,
    )


print("== 1. the daemon module imports and logs under a hostile (cp1252) piped stdout ==")
# Importing wake_daemon runs its module-level reconfigure. Then drive log() with the exact
# strings that crashed, plus a hostile sample of every character class involved.
CODE_IMPORT_AND_LOG = r"""
import sys
import wake_daemon as wd
wd.log("plain ascii line")
wd.log("em-dash — ellipsis … box ─")          # cp1252-encodable + not
wd.log("warning sign ⚠️ arrow → ge ≥")   # the class that CRASHED
wd.log(wd.SILENCE_HINT_MSG)                                  # the real mic-denied warning
print("DONE-OK")
"""
r = run_piped(CODE_IMPORT_AND_LOG)
out = r.stdout.decode("utf-8", errors="replace")
err = r.stderr.decode("utf-8", errors="replace")
check("child exited 0 (no UnicodeEncodeError)", r.returncode == 0, f"rc={r.returncode} stderr={err[-300:]}")
check("reached the end of the log sequence", "DONE-OK" in out, out[-200:])
check("no UnicodeEncodeError anywhere in stderr", "UnicodeEncodeError" not in err, err[-300:])

print("\n== 2. the emitted bytes are valid UTF-8 (so the supervisor can decode them) ==")
# The producer half of the bug: cp1252 bytes (e.g. 0x97 for an em-dash) are not valid UTF-8,
# so the supervisor's decode turns them into replacement characters even when nothing crashes.
try:
    r.stdout.decode("utf-8", errors="strict")
    ok_utf8 = True
    detail = ""
except UnicodeDecodeError as e:
    ok_utf8 = False
    detail = str(e)
check("stdout decodes as strict UTF-8", ok_utf8, detail)
check("the em-dash survived as U+2014, not as a lone 0x97", "—" in out, repr(out[:120]))

print("\n== 3. the three reachable WARNING sites are ASCII-safe ==")
# Belt-and-braces to the encoding fix: even if stdio reconfiguration is somehow bypassed,
# these three must not be able to raise. They are the only non-ASCII-carrying log sites the
# daemon can actually reach at runtime.
src = (PHASE2 / "wake_daemon.py").read_text(encoding="utf-8")
bad_lines = []
for i, line in enumerate(src.splitlines(), 1):
    if "log(" not in line and "SILENCE_HINT_MSG" not in line:
        continue
    for ch in line:
        if ord(ch) < 128:
            continue
        try:
            ch.encode("cp1252")
        except UnicodeEncodeError:
            bad_lines.append(f"{i}:U+{ord(ch):04X}")
check("no cp1252-unencodable characters in reachable log lines", not bad_lines, "; ".join(bad_lines))

print("\n== 4. a console-attached run would NOT have caught this (guard the guard) ==")
# Prove the test's own premise: with stdout forced to utf-8 the hostile line never raises,
# which is exactly the false green a hand-run terminal test produces.
r2 = run_piped("print('⚠️ ok')", {"PYTHONIOENCODING": "utf-8"})
r3 = run_piped("import sys; sys.stdout.reconfigure(encoding='cp1252', errors='strict'); print('⚠️ no')")
check("utf-8 stdio: the hostile character prints fine", r2.returncode == 0, f"rc={r2.returncode}")
check("cp1252 STRICT stdio: it still raises (the original bug is real)",
      r3.returncode != 0 and b"UnicodeEncodeError" in r3.stderr,
      f"rc={r3.returncode}")

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
