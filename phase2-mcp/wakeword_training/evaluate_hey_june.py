#!/usr/bin/env python
"""Acceptance bar for a trained hey_june.onnx — prints PASS/FAIL per criterion and
exits nonzero on any failure. RUN THIS ON THE POD BEFORE TEARING IT DOWN.

The five criteria (threshold 0.5 throughout), agreed 2026-08-03:

  0. HOLDOUT INTEGRITY (gate for everything else): no held-out voice appears in
     the training/adversarial WAV directories — parsed from the canonical
     filenames, pure or inside a blend. A leak here makes test 1 meaningless
     (the model would score brilliantly on voices it secretly trained on and
     generalise badly, undetectably), so a leak FAILS the whole run.
  1. Clean held-out-voice positives ("hey june", 4 voices never trained on):
     detection >= 95%.
  2. Noise-augmented held-out positives (white + colored noise, SNR 5-15 dB,
     numpy-only so this script needs no torch): detection >= 85%.
  3. Adversarials (hey Jane/Dune/Jude/... incl. "hey buddy", which must now be
     a NEGATIVE): accept rate <= 5%, and "hey buddy" clips mean score < 0.3.
  4. False accepts on the precalculated validation negatives (~35 h of real
     speech, precomputed embeddings scored directly): < 0.5 FA/hour.
  5. Clean positives sanity: mean score >= 0.9 (reference: the old stand-in
     scored its own phrase at 0.991).

Scoring tests 1/2/3/5 goes through nightjar_capabilities.wakeword — the REAL
runtime shim, not a reimplementation — so a pass here also proves train/runtime
geometry parity (`--runtime-shim` is therefore always on; the flag is accepted
for compatibility but is a no-op). Test 4 scores the wake classifier directly
over precomputed embeddings (the backbone stage is already baked into them).

Usage (pod, from phase2-mcp/):
  python wakeword_training/evaluate_hey_june.py MODEL.onnx \
      --holdout-dir /data/holdout --adversarial-dir /data/adv \
      --training-dirs /data/pos,/data/adv \
      --validation-negatives /data/heybuddy/validation.npy \
      --validation-hours 35
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))   # phase2-mcp/ -> nightjar_capabilities
sys.path.insert(0, str(HERE))

from generate_samples import (  # noqa: E402
    ADVERSARIAL_PHRASES, ADVERSARIAL_SUFFIXES, HOLDOUT_VOICES, voices_in_filename,
)
from nightjar_capabilities import wakeword  # noqa: E402 — the real runtime shim


def adversarial_text_of(filename: str) -> str:
    """Reconstruct the phrase a generated adversarial clip contains. The canonical
    filename carries the GLOBAL index, and generate_samples picks
    texts[g % len(texts)] deterministically — so the text is derivable without
    storing it in the name."""
    texts = [p + s for p in ADVERSARIAL_PHRASES for s in ADVERSARIAL_SUFFIXES]
    try:
        g = int(filename.split("_")[1])
    except (IndexError, ValueError):
        return ""
    return texts[g % len(texts)]

THRESHOLD = 0.5
FAILS: List[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        FAILS.append(label)


def parse_args(argv: List[str]) -> Dict[str, object]:
    if not argv or argv[0].startswith("--"):
        print(__doc__)
        raise SystemExit(2)
    opts: Dict[str, object] = {"model": argv[0], "validation_hours": 35.0}
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--runtime-shim":            # always on; kept for compatibility
            i += 1
            continue
        if a == "--allow-standin":
            # Calibration mode: lets the harness run against the interim stand-in
            # so its failure detection can be demonstrated (the stand-in must FAIL
            # tests 1/3/5 — it answers to the wrong phrase). NEVER a shipping path:
            # the verdict still says FAIL unless the model is custom.
            opts["allow_standin"] = True
            i += 1
            continue
        key = a.lstrip("-").replace("-", "_")
        opts[key] = argv[i + 1]
        i += 2
    return opts


def wavs(directory: Path) -> List[Path]:
    files = sorted(directory.glob("*.wav"))
    if not files:
        raise FileNotFoundError(f"no .wav files in {directory}")
    return files


def add_noise(pcm: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    """White + colored noise at the given SNR — numpy only, deliberately simple.
    (The heavy augmentation lives in training; this only needs to be *harder than
    clean*, not a reproduction of the training distribution.)"""
    x = pcm.astype(np.float32)
    sig_pow = float(np.mean(x ** 2)) or 1.0
    noise = rng.standard_normal(len(x)).astype(np.float32)
    # brown-ish tilt for half the energy: cumulative sum then de-trend
    colored = np.cumsum(rng.standard_normal(len(x))).astype(np.float32)
    colored -= colored.mean()
    colored /= (np.abs(colored).max() or 1.0)
    noise = 0.5 * noise + 0.5 * colored * (np.abs(noise).max() or 1.0)
    noise_pow = float(np.mean(noise ** 2)) or 1.0
    scale = np.sqrt(sig_pow / (noise_pow * 10 ** (snr_db / 10.0)))
    out = x + noise * scale
    return np.clip(out, -32768, 32767).astype(np.int16)


def detection_rate(detector_factory, files: List[Path],
                   mutate=None, seed: int = 0) -> Tuple[float, List[float]]:
    rng = np.random.default_rng(seed)
    scores, hits = [], 0
    for f in files:
        pcm = wakeword._read_wav_16k_mono_int16(str(f))  # noqa: SLF001 — the runtime loader
        if mutate is not None:
            pcm = mutate(pcm, rng)
        det = detector_factory()
        r = det.scan(pcm)
        scores.append(r["max_score"])
        hits += bool(r["detected"])
    return hits / max(len(files), 1), scores


def main() -> int:
    opts = parse_args(sys.argv[1:])
    model = str(opts["model"])
    holdout_dir = Path(str(opts["holdout_dir"]))
    adv_dir = Path(str(opts["adversarial_dir"]))
    training_dirs = [Path(p) for p in str(opts["training_dirs"]).split(",")]
    val_npy: Optional[str] = opts.get("validation_negatives")  # type: ignore[assignment]
    val_hours = float(opts.get("validation_hours", 35.0))      # type: ignore[arg-type]

    def make_detector() -> wakeword.WakeWordDetector:
        return wakeword.WakeWordDetector(model_path=model, threshold=THRESHOLD)

    d = make_detector()
    print(f"== evaluating {model} (model_key={d.model_key}, is_custom={d.is_custom}, "
          f"threshold={THRESHOLD}) ==")
    if not d.is_custom:
        if opts.get("allow_standin"):
            print("  [note] --allow-standin: evaluating the interim stand-in for harness "
                  "calibration; the verdict will still be FAIL")
            FAILS.append("model is the interim stand-in (calibration run)")
        else:
            check("model under evaluation is not the interim stand-in", False,
                  "this IS the stand-in (content check) — you are evaluating the wrong file")
            print("\nVERDICT: FAIL — wrong model file; nothing further measured")
            return 1

    # ── 0. holdout integrity: gate for everything else ────────────────────────
    print("\n== 0. holdout integrity — held-out voices are ABSENT from training dirs ==")
    leaks: List[str] = []
    unparsed = 0
    for td in training_dirs:
        for f in wavs(td):
            vs = voices_in_filename(f.name)
            if not vs:
                unparsed += 1
                continue
            if set(vs) & set(HOLDOUT_VOICES):
                leaks.append(f"{td.name}/{f.name}")
    check("no held-out voice in any training/adversarial clip (pure or blended)",
          not leaks, "; ".join(leaks[:5]) + (f" (+{len(leaks)-5} more)" if len(leaks) > 5 else ""))
    check("every training filename is parseable (unparsed files can hide a leak)",
          unparsed == 0, f"{unparsed} unparseable filenames")
    ho_files = wavs(holdout_dir)
    ho_bad = [f.name for f in ho_files
              if not set(voices_in_filename(f.name)) <= set(HOLDOUT_VOICES)
              or not voices_in_filename(f.name)]
    check("holdout dir contains ONLY held-out voices", not ho_bad, "; ".join(ho_bad[:5]))
    if leaks or unparsed or ho_bad:
        print("\nHOLDOUT INTEGRITY FAILED — the remaining numbers would be meaningless. "
              "Regenerate the corpora before evaluating.")
        print("VERDICT: FAIL")
        return 1

    # ── 1. clean held-out positives ───────────────────────────────────────────
    print("\n== 1. clean held-out-voice positives ==")
    rate, scores = detection_rate(make_detector, ho_files)
    check(f"detection >= 95% (got {rate:.1%} over {len(ho_files)} clips)", rate >= 0.95,
          f"weakest: {sorted(scores)[:3]}")

    # ── 2. noise-augmented held-out positives ─────────────────────────────────
    print("\n== 2. noise-augmented held-out positives (SNR 5-15 dB) ==")
    rng_snr = np.random.default_rng(1)
    rate_n, scores_n = detection_rate(
        make_detector, ho_files,
        mutate=lambda pcm, rng: add_noise(pcm, float(rng_snr.uniform(5, 15)), rng), seed=1)
    check(f"detection >= 85% (got {rate_n:.1%})", rate_n >= 0.85,
          f"weakest: {sorted(scores_n)[:3]}")

    # ── 3. adversarials ───────────────────────────────────────────────────────
    print("\n== 3. adversarial rejection ==")
    adv_files = wavs(adv_dir)
    rate_a, scores_a = detection_rate(make_detector, adv_files)
    check(f"adversarial accept rate <= 5% (got {rate_a:.1%} over {len(adv_files)} clips)",
          rate_a <= 0.05, f"worst: {sorted(scores_a)[-3:]}")
    buddy = [f for f in adv_files
             if "hey buddy" in adversarial_text_of(f.name).lower()]
    if buddy:
        _, scores_b = detection_rate(make_detector, buddy)
        check(f"'hey buddy' mean score < 0.3 over {len(buddy)} clips "
              f"(got {np.mean(scores_b):.3f}) — the old stand-in phrase must be a "
              f"negative now", float(np.mean(scores_b)) < 0.3)
    else:
        check("adversarial corpus contains 'hey buddy' clips (index-derived)", False,
              f"none among {len(adv_files)} clips — corpus too small or phrase list "
              f"changed; the old stand-in phrase MUST be tested as a negative")

    # ── 4. false accepts per hour on real-speech negatives ────────────────────
    print("\n== 4. false accepts on the precalculated validation negatives ==")
    if not val_npy:
        print("  [skip] --validation-negatives not provided — FA/hour NOT measured. "
              "Do not ship on this run (rule 8: stated, not silently green).")
        FAILS.append("FA/hour unmeasured")
    else:
        import onnxruntime as rt
        arr = np.load(val_npy, mmap_mode="r")
        emb = np.asarray(arr[:, :16, :], dtype=np.float32)   # drop the transcript column
        sess = rt.InferenceSession(model, providers=["CPUExecutionProvider"])
        iname = sess.get_inputs()[0].name
        accepts = 0
        for i in range(0, len(emb), 2048):
            out = sess.run(None, {iname: emb[i:i + 2048]})[0].ravel()
            accepts += int(np.sum(out >= THRESHOLD))
        fa_per_hour = accepts / val_hours
        check(f"FA/hour < 0.5 (got {fa_per_hour:.3f}: {accepts} accepts over "
              f"~{val_hours:.0f} h / {len(emb)} windows)", fa_per_hour < 0.5)
        if fa_per_hour < 0.2:
            print(f"  [note] stretch bar (<0.2 FA/h) also met")

    # ── 5. sanity vs the stand-in's reference number ──────────────────────────
    print("\n== 5. clean-positive mean score ==")
    check(f"mean score >= 0.9 (got {np.mean(scores):.3f}; stand-in reference was 0.991 "
          f"on its own phrase)", float(np.mean(scores)) >= 0.9)

    print("\nVERDICT: " + ("FAIL — " + "; ".join(FAILS[:6]) if FAILS else
                           "PASS — safe to tear the pod down (copy the .pt checkpoint too)"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
