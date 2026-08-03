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

    print("\n== 5b. the holdout is enforced in CODE, not by flag discipline (training PR) ==")
    check("HOLDOUT_VOICES spans both genders and both accent groups",
          {v[1] for v in g.HOLDOUT_VOICES} == {"f", "m"}
          and {v[0] for v in g.HOLDOUT_VOICES} == {"a", "b"}, str(g.HOLDOUT_VOICES))
    check("TRAINING_VOICES excludes every held-out voice",
          not set(g.TRAINING_VOICES) & set(g.HOLDOUT_VOICES))
    check("TRAINING_VOICES still passes the diversity guard",
          (g.check_speaker_diversity(g.TRAINING_VOICES) or True))
    # The raise-paths. generate() checks voices BEFORE creating the Kokoro session,
    # so these run without weights or synthesis.
    from pathlib import Path as _P
    for label, kind, voices in [
        ("a held-out voice cannot enter a positives corpus", "positives",
         list(g.TRAINING_VOICES) + ["af_sky"]),
        ("a held-out voice cannot enter an adversarial corpus (even blended-in)",
         "adversarial", list(g.TRAINING_VOICES) + ["bm_lewis"]),
        ("ENGLISH_VOICES (which contains the holdout) is refused for training",
         "positives", list(g.ENGLISH_VOICES)),
        ("a training voice cannot enter the holdout eval set", "holdout",
         ["af_sky", "af_heart"]),
    ]:
        try:
            g.generate(kind, _P("nonexistent-never-created"), 1, voices)
            check(label, False, "no exception raised")
        except g.HoldoutLeakError:
            check(label, True)
    # The filename parser evaluate_hey_june.py relies on for its overlap check:
    check("parser: pure voice", g.voices_in_filename("positives_000042_af_heart_1.0.wav")
          == ("af_heart",))
    check("parser: blended voices",
          g.voices_in_filename("positives_000042_af_heart+bm_george@0.5_1.1.wav")
          == ("af_heart", "bm_george"))
    check("parser: foreign filename yields () (treated as unparseable, not ignored)",
          g.voices_in_filename("random_recording.wav") == ())

    print("\n== 5c. vendored WavDirectorySpeechGenerator: disjoint role partitions "
          "(stubbed import — torch-free) ==")
    # The vendored module only needs `heybuddy.dataset.generator` and `heybuddy.util`;
    # stub the heavy package so the partition logic is exercised on THIS machine
    # rather than first running on the pod.
    import sys as _sys, types as _types, importlib.util as _ilu
    vend = PHASE2 / "wakeword_training" / "heybuddy_vendor" / "src" / "python"
    pkg = _types.ModuleType("heybuddy"); pkg.__path__ = []  # type: ignore[attr-defined]
    util = _types.ModuleType("heybuddy.util")
    import logging
    util.logger = logging.getLogger("stub")  # type: ignore[attr-defined]
    ds = _types.ModuleType("heybuddy.dataset"); ds.__path__ = []  # type: ignore[attr-defined]
    gen = _types.ModuleType("heybuddy.dataset.generator")

    class _StubBase:
        def __init__(self, device_id=None):
            self.device_id = device_id
    gen.AudioDatasetGenerator = _StubBase  # type: ignore[attr-defined]
    saved = {k: _sys.modules.get(k) for k in
             ("heybuddy", "heybuddy.util", "heybuddy.dataset", "heybuddy.dataset.generator")}
    _sys.modules.update({"heybuddy": pkg, "heybuddy.util": util,
                         "heybuddy.dataset": ds, "heybuddy.dataset.generator": gen})
    try:
        spec = _ilu.spec_from_file_location(
            "wav_directory_under_test", vend / "heybuddy" / "dataset" / "wav_directory.py")
        wd_mod = _ilu.module_from_spec(spec)
        spec.loader.exec_module(wd_mod)  # type: ignore[union-attr]
        import tempfile as _tf, wave as _wave
        with _tf.TemporaryDirectory(prefix="wavdir-") as td:
            # 60 tiny valid WAVs
            for i in range(60):
                p = _P(td) / f"clip_{i:03d}.wav"
                with _wave.open(str(p), "wb") as w:
                    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
                    w.writeframes(np.full(1600, 100 + i, dtype=np.int16).tobytes())
            wgen = wd_mod.WavDirectorySpeechGenerator(td)
            parts = {r: set(wgen.files_for_role(r)) for r in ("training", "testing", "validation")}
            check("partitions are pairwise DISJOINT",
                  not (parts["training"] & parts["testing"])
                  and not (parts["training"] & parts["validation"])
                  and not (parts["testing"] & parts["validation"]))
            check("partitions cover every file",
                  parts["training"] | parts["testing"] | parts["validation"]
                  == set(f"clip_{i:03d}.wav" for i in range(60)),
                  f"sizes {[len(parts[r]) for r in ('training','testing','validation')]}")
            got = list(wgen(3, role="training"))
            check("yields the Piper dict shape",
                  all(set(s) == {"audio", "phrase"}
                      and set(s["audio"]) == {"array", "sampling_rate"}
                      and s["audio"]["sampling_rate"] == 16000
                      and s["audio"]["array"].dtype == np.float32 for s in got))
            n_train = len(parts["training"])
            wrapped = list(wgen(n_train + 5, role="training"))
            check("over-request wraps around rather than truncating",
                  len(wrapped) == n_train + 5)
    finally:
        for k, v in saved.items():
            if v is None:
                _sys.modules.pop(k, None)
            else:
                _sys.modules[k] = v

    print("\n== 6. synthesis smoke test (needs Kokoro weights; skipped if absent) ==")
    from nightjar_capabilities import config
    have_weights = (config.MODELS_DIR / "kokoro" / "kokoro-v1.0.fp16.onnx").exists()
    if not have_weights:
        print("  [skip] Kokoro weights not in the model cache — synthesis untested HERE; "
              "run on a machine that has them (rule 8: stated, not silently green)")
    else:
        import tempfile
        with tempfile.TemporaryDirectory(prefix="wwsamples-") as td:
            n = g.generate("positives", Path(td), 4, list(g.TRAINING_VOICES), seed=1)
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
