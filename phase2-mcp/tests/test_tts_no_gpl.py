#!/usr/bin/env python3
"""Regression guard: Nightjar's TTS path must never pull GPL into the runtime graph.

This is the CI half of CLAUDE.md rule 6 — it re-triggers the *real* failure
rather than inspecting config. The original defect: `kokoro_onnx.tokenizer`
imports `phonemizer` (GPL-3.0-or-later) and `espeakng_loader` (a stripped GPL
espeak-ng binary) at module scope, and `Kokoro.__init__` builds that Tokenizer
unconditionally — so merely constructing `Kokoro` called
`ctypes.cdll.LoadLibrary(<espeak dll>)` in-process.

Deliberately strict in a way a clean venv alone is not: it arms a
`ctypes` trap BEFORE importing anything and then drives a real synthesis. If the
GPL packages happen to still be installed in a dev venv (they are not removed
from an existing venv by editing requirements.txt), the trap still proves
nothing *loads* them.

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_tts_no_gpl.py
"""
import ctypes
import importlib.util
import os
import sys
import tempfile
import wave
from pathlib import Path

# This test prints IPA (Kokoro's alphabet is phonetic). A default Windows
# console is cp1252 and would die with UnicodeEncodeError before reporting any
# result — so force UTF-8 rather than depending on PYTHONIOENCODING being set.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # non-reconfigurable stream (pytest capture)
        pass

REPO = os.environ.get("NIGHTJAR_ROOT") or str(Path(__file__).resolve().parents[2])
sys.path.insert(0, os.path.join(REPO, "phase2-mcp"))

GPL_TOKENS = ("espeak", "phonemiz", "mbrola", "festival")
GPL_MODULES = ("phonemizer", "espeakng_loader", "kokoro_onnx", "misaki.espeak")

FAILS = []
LOADS = []


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        FAILS.append(label)


# ---- arm the trap before importing anything Nightjar ------------------------
_real_ll = ctypes.cdll.LoadLibrary
_real_cdll = ctypes.CDLL


def _guard(name):
    LOADS.append(str(name))
    if any(t in str(name or "").lower() for t in GPL_TOKENS):
        raise AssertionError(f"GPL shared library load attempted: {name}")


def _trap_ll(name, *a, **kw):
    _guard(name)
    return _real_ll(name, *a, **kw)


class _TrapCDLL(_real_cdll):
    def __init__(self, name, *a, **kw):
        _guard(name)
        super().__init__(name, *a, **kw)


ctypes.cdll.LoadLibrary = _trap_ll
ctypes.CDLL = _TrapCDLL

# ---------------------------------------------------------------------------
print("== 1. static: the GPL G2P stack is not a declared dependency ==")
req = (Path(REPO) / "phase2-mcp" / "requirements.txt").read_text(encoding="utf-8").lower()
for name in ("phonemizer", "espeakng-loader", "kokoro-onnx"):
    check(f"{name!r} absent from requirements.txt", name not in req)

print("\n== 2. static: voice.py never constructs kokoro_onnx.Kokoro ==")
voice_src = (Path(REPO) / "phase2-mcp" / "nightjar_capabilities" / "voice.py").read_text(
    encoding="utf-8"
)
check("no 'from kokoro_onnx' import", "from kokoro_onnx" not in voice_src)
check("no 'import kokoro_onnx'", "import kokoro_onnx" not in voice_src)
check("no 'Kokoro(' construction", "Kokoro(" not in voice_src)

print("\n== 3. the vendored vocab matches Kokoro's alphabet ==")
from nightjar_capabilities import voice  # noqa: E402

vocab = voice._get_vocab()
check("114 entries (NOT 178 — that is the embedding size)", len(vocab) == 114, str(len(vocab)))
check("all keys single-char", all(len(k) == 1 for k in vocab))
check("ids sparse over 1..177", min(vocab.values()) == 1 and max(vocab.values()) == 177)
check("id 0 free for the pad token", 0 not in set(vocab.values()))
for ch in ("A", "I", "O", "W", "Y", "ʤ", "ʧ", "ᵊ", "ˈ", "ˌ", "ː"):
    check(f"vocab contains {ch!r}", ch in vocab)

print("\n== 4. no GPL module entered sys.modules ==")
for m in GPL_MODULES:
    check(f"{m} not imported", m not in sys.modules)

print("\n== 5. live synthesis with the trap armed ==")
have_misaki = importlib.util.find_spec("misaki") is not None
have_spacy = importlib.util.find_spec("spacy") is not None
model = Path(voice._kokoro_dir()) / voice._KOKORO_MODEL
if not (have_misaki and have_spacy):
    print("  SKIP: misaki/spacy not installed (run pip install -r requirements.txt)")
elif not model.exists():
    print(f"  SKIP: Kokoro weights not downloaded yet ({model})")
else:
    out = Path(tempfile.gettempdir()) / "nightjar_tts_no_gpl.wav"
    # Includes a word misaki's lexicon lacks ('Wikipedia') and the CAD homograph
    # ('fillet') — both must survive into the audio.
    voice.speak(
        "Nightjar searched Wikipedia and applied a two millimetre fillet.",
        out_path=str(out),
    )
    with wave.open(str(out)) as w:
        dur = w.getnframes() / w.getframerate()
        sr = w.getframerate()
    check("audio produced", dur > 1.0, f"{dur:.2f}s @ {sr} Hz")
    check("sample rate is 24 kHz", sr == 24000)

    g2p = voice._get_kokoro().g2p
    ph, _ = g2p("Nightjar searched Wikipedia and applied a two millimetre fillet.")
    check("no unk ornament left in phonemes", "\N{BLACK QUESTION MARK ORNAMENT}" not in ph, repr(ph))
    check("'fillet' is the CAD sense, not 'fi-LAY'", "fˈɪlət" in ph)
    check("every phoneme char is in Kokoro's vocab",
          all(c in vocab for c in ph), repr([c for c in ph if c not in vocab]))

    for m in GPL_MODULES:
        check(f"{m} still not imported after synthesis", m not in sys.modules)

print(f"\n== 6. ctypes loads observed: {len(LOADS)} ==")
gpl_loads = [n for n in LOADS if any(t in n.lower() for t in GPL_TOKENS)]
check("no GPL shared library loaded", not gpl_loads, str(gpl_loads))

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
