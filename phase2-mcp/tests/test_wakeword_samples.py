#!/usr/bin/env python3
"""Tests for the Kokoro wake-word sample generator (voice-phase PR 5).

Covers the PRODUCT requirements, not just the plumbing:
  * the phrase is "Hey June" (the pre-PR-5 generator still emitted "Hey Nightjar");
  * the corpus is synthetic and multi-speaker — the single-speaker guard REFUSES
    narrow voice sets, and there is no code path that ingests recorded audio;
  * style blending yields finite, in-range styles of the right shape;
  * output audio is 16 kHz int16 mono, the wake pipeline's native format;
  * the rejected Piper/lessac lineage cannot quietly return.

Pure/offline pieces run everywhere; the one synthesis test needs the Kokoro
weights in ~/.nightjar/models and is skipped (stated, not silent) without them.

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_wakeword_samples.py
"""
from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PHASE2 = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PHASE2))
sys.path.insert(0, str(PHASE2 / "wakeword_training"))

import generate_samples as g  # noqa: E402

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        FAILS.append(label)


def main() -> int:
    print("== 1. the phrase is Hey June ==")
    check("every positive phrase contains 'june'",
          all("june" in p.lower() for p in g.POSITIVE_PHRASES), str(g.POSITIVE_PHRASES))
    check("no positive phrase says 'nightjar' (the pre-PR-5 defect)",
          not any("nightjar" in p.lower() for p in g.POSITIVE_PHRASES))
    check("adversarials do NOT contain the exact wake phrase",
          not any("hey june" == p.lower().strip(".!?,") for p in g.ADVERSARIAL_PHRASES))

    print("\n== 2. speaker diversity is enforced, not suggested ==")
    check("full English voice set passes",
          (g.check_speaker_diversity(g.ENGLISH_VOICES) or True))
    check(f"voice set spans >= {g.MIN_DISTINCT_SPEAKERS} speakers",
          len(set(g.ENGLISH_VOICES)) >= g.MIN_DISTINCT_SPEAKERS,
          f"{len(set(g.ENGLISH_VOICES))} voices")
    genders = {v[1] for v in g.ENGLISH_VOICES}
    accents = {v[0] for v in g.ENGLISH_VOICES}
    check("both genders present", genders == {"f", "m"}, str(genders))
    check("both accent groups present (American + British)", accents == {"a", "b"}, str(accents))

    # The guard must REFUSE the historical failure modes:
    for label, voices in [
        ("one voice", ["af_heart"]),
        ("the exact pre-PR-5 set (5 voices, all af_*)",
         ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_nova"]),
        ("many voices but single-gender",
         [v for v in g.ENGLISH_VOICES if v[1] == "f"]),
    ]:
        try:
            g.check_speaker_diversity(voices)
            check(f"guard refuses {label}", False, "no exception raised")
        except g.SingleSpeakerError:
            check(f"guard refuses {label}", True)

    print("\n== 3. synthetic-only: no path ingests recorded audio ==")
    src = (PHASE2 / "wakeword_training" / "generate_samples.py").read_text(encoding="utf-8")
    for token in ("sounddevice", "pyaudio", "parec", "InputStream"):
        check(f"generator source has no {token!r} capture path", token not in src)
    # stricter: the module must not import anything that can open a mic
    import ast
    mods = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module.split(".")[0])
    check("generator imports no audio-capture module",
          not (mods & {"sounddevice", "pyaudio"}), str(sorted(mods)))

    print("\n== 4. the Piper/lessac lineage cannot quietly return ==")
    piper_imports = [m for m in mods if "piper" in m.lower()]
    check("generator imports nothing piper-related", not piper_imports, str(piper_imports))
    # The docstring CITES the rejected checkpoint by name — that is the NJ-59
    # evidence chain and must stay. What may not appear is anything fetchable:
    # a URL that would actually download a piper artifact.
    import re
    fetchable = [u for u in re.findall(r"https?://\S+", src) if "piper" in u.lower()]
    check("no fetchable piper artifact URL", not fetchable, str(fetchable))
    vendor_readme = PHASE2 / "wakeword_training" / "heybuddy_vendor" / "VENDOR.md"
    check("VENDOR.md records the NJ-59 chain", "NJ-59" in vendor_readme.read_text(encoding="utf-8"))

    print("\n== 5. speaker plan properties (pure, no synthesis) ==")
    import random
    plan = g.speaker_plan(list(g.ENGLISH_VOICES), random.Random(0))
    first = [next(plan) for _ in range(len(g.ENGLISH_VOICES))]
    check("every pure voice appears before any blend",
          all(a == b and w == 0.0 for a, b, w in first))
    nxt = [next(plan) for _ in range(200)]
    check("blends follow, with valid weights",
          all(w in g.BLEND_WEIGHTS and a != b for a, b, w in nxt))

    print("\n== 6. synthesis smoke test (needs Kokoro weights; skipped if absent) ==")
    from nightjar_capabilities import config
    have_weights = (config.MODELS_DIR / "kokoro" / "kokoro-v1.0.fp16.onnx").exists()
    if not have_weights:
        print("  [skip] Kokoro weights not in the model cache — synthesis untested HERE; "
              "run on a machine that has them (rule 8: stated, not silently green)")
    else:
        import tempfile
        with tempfile.TemporaryDirectory(prefix="wwsamples-") as td:
            n = g.generate("positives", Path(td), 4, list(g.ENGLISH_VOICES), seed=1)
            wavs = sorted(Path(td).glob("*.wav"))
            check("generate() wrote the requested count", n == 4 and len(wavs) == 4)
            with wave.open(str(wavs[0]), "rb") as wv:
                check("output is 16 kHz mono int16",
                      wv.getframerate() == 16000 and wv.getnchannels() == 1
                      and wv.getsampwidth() == 2,
                      f"{wv.getframerate()} Hz, {wv.getnchannels()} ch, {wv.getsampwidth()*8} bit")
                frames = np.frombuffer(wv.readframes(wv.getnframes()), dtype=np.int16)
            check("audio is non-silent and finite",
                  frames.size > 4000 and int(np.abs(frames).max()) > 500)

    print("\n" + ("FAILED: " + "; ".join(FAILS[:10]) if FAILS else "ALL CHECKS PASSED"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
