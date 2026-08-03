# Vendored: hey-buddy (training pipeline + JS reference implementation)

| | |
|---|---|
| **Upstream** | https://github.com/painebenjamin/hey-buddy |
| **Our fork** | https://github.com/AxeH666/hey-buddy |
| **Pinned commit** | `6e78d26205da8b4c7c5b05be91dde3304e12b837` (2025-07-25) |
| **Code license** | Apache-2.0 — read from the upstream `LICENSE` file at that commit, verbatim copy in `./LICENSE` (rule 5) |
| **Vendored** | 2026-08-03, voice-phase PR 5 |

## Why this is vendored rather than pip-installed

`heybuddy` is a ~44-star single-maintainer project. Its licence is permissive, so
the cheap insurance against the maintainer (or the repo) disappearing is to keep
our own copy. It is also **not** a runtime dependency and must never become one:
`heybuddy` needs `torch`, `torchaudio` and `piper-phonemize`, and Nightjar's
phase2-mcp runtime is deliberately torch-free (onnxruntime + CTranslate2 only).
This directory is **training-side only** — an offline, GPU-box artifact.

The runtime side is Nightjar-authored: `nightjar_capabilities/wakeword.py` is a
small onnxruntime-only port of the JS inference path (see below), so nothing in
this directory is imported by anything Nightjar ships.

## What was and was not copied

Copied at the pinned commit:

- `src/python/heybuddy/**` — the full training pipeline, including the `piper/`
  subpackage we do **not** use (kept so the vendored tree is a faithful snapshot
  rather than a subset that is hard to diff against upstream).
- `src/js/src/**` — the JavaScript inference implementation. This is **normative**
  for us: it is the reference our onnxruntime shim was ported from, and the
  streaming geometry in `hey-buddy.js` + `models/*.js` is what our
  `wakeword.py` must match frame-for-frame or a trained model's scores will not
  transfer. Keep it; it is the spec.
- `LICENSE`, `README.md`, `setup.py`, `environment.yml`. (The README keeps its
  upstream name — `setup.py` reads it for `long_description`, so renaming it
  breaks `pip install -e`; the one in this directory is upstream's, ours is
  this file.)

Deliberately **not** copied:

- `src/js/models/*.onnx` and `src/js/src/logo.png` — ~7 MB of binaries. The one
  model we actually use as an interim stand-in is vendored once, in
  `phase2-mcp/nightjar_capabilities/models/wakeword/`, not here.
- `tests/`, `scripts/`, `WakeWordTrainer.ipynb` — upstream dev tooling.

## Local modifications

**One patch (voice-phase training PR, 2026-08-03): pregenerated-audio injection.**
The snapshot was unmodified until this patch; it exists because the trainer had
NO seam for feeding it external samples — its positives/adversarials came only
from the built-in `PiperSpeechGenerator`, whose default voice is
lessac/Blizzard-2013-encumbered (NJ-59, next section). Every change is tagged
`# NIGHTJAR PATCH` in-line, and the identical patch is pushed to the fork
(`AxeH666/hey-buddy`, branch `nightjar-wav-injection`) so the trees stay
reconcilable. The four touched files:

1. **`src/python/heybuddy/dataset/wav_directory.py` (NEW)** —
   `WavDirectorySpeechGenerator`: yields samples from a directory of WAVs in the
   exact dict shape `PiperSpeechGenerator` yields, so augmentation/embedding/
   caching downstream are untouched. Files are hash-partitioned into DISJOINT
   train/testing/validation buckets (80/10/10) — Piper gets fresh synthesis per
   call, a finite directory does not, and sharing clips across splits would
   silently inflate the validation metrics the trainer steers by. Undersized
   partitions wrap around with a logged warning, never silently.
2. **`dataset/features.py`** — the Piper import is now LAZY (its import chain
   hard-requires `piper-phonemize`, a Linux-only wheel wrapping GPL espeak-ng;
   with `tts_audio_dir` set the module is never imported, so a training box need
   not install it at all); `TrainingFeaturesGenerator` gains `tts_audio_dir`;
   `generate()` passes the split role to the sample generator (Piper ignores it
   via `**kwargs`); `default()`/`get_training_features()`/
   `get_validation_features()` thread the directory params. Precalculated-cache
   names gain a content fingerprint of the source directory
   (`_audio_dir_fingerprint`) whenever an audio dir is set — upstream keys caches
   by wake phrase alone, so a prior Piper or stale-corpus run's cache would
   silently satisfy `use_cache` for a Kokoro run (Bugbot, PR #155).
3. **`dataset/__init__.py`** — the `from heybuddy.dataset.piper import *` line is
   wrapped in `try/except ImportError`. Without this, importing the package (which
   `heybuddy train` does before parsing options) defeated the lazy import at the
   package boundary (Bugbot, PR #155). `wav_directory` is exported alongside.
4. **`dataset/training.py`** — `default()`/`testing()`/`validation()`/`all()`
   thread `positive_audio_dir`/`adversarial_audio_dir` to the feature calls.
5. **`__main__.py`** — new `--positive-audio-dir`/`--adversarial-audio-dir`
   options; both-or-neither enforced (mixing a pregenerated corpus with Piper
   samples would reintroduce the encumbered voice), and mutually exclusive with
   `--additional-phrase` (whose loops would re-embed the same directory once per
   phrase).

Deliberately NOT threaded: the `--additional-phrase` code paths (guarded off at
the CLI instead — phrase variants belong in the WAV corpus itself).

If further patches become necessary, add them here with the rationale, and push
the same change to the fork so the two stay reconcilable.

## ⚠ The upstream pipeline's positives are NOT commercially clean (NJ-59)

Upstream advertises "Verified for commercial use — uses open data and libraries
with commercially-viable licenses". That is true of its **negatives and
augmentation data** and false of its **positives**. Verified per rule 5:

- `src/python/heybuddy/piper/pretrained.py` sets
  `pretrained_model_url = ".../pretrained/piper-libritts-en-r-medium.safetensors"`
  with `num_speakers = 904` — i.e. Piper's `en_US-libritts_r-medium`.
- `rhasspy/piper-voices` → `en/en_US/libritts_r/medium/MODEL_CARD`:
  *"Fine-tuned from English lessac medium on train-clean-360."*
- → `en/en_US/lessac/medium/MODEL_CARD`: trained from scratch on the Lessac
  Blizzard 2013 corpus.
- → that corpus's licence
  (https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html),
  verbatim: *"Research Purposes" means only those purposes associated with
  research and exploration … and **for the avoidance of doubt excludes** …
  developing, adapting, amending or otherwise using the Materials for any
  commercial purpose, **including the development, marketing, commercialisation,
  sale or licencing of voice synthesis or speech recognition products or
  services***.

That is Nightjar's exact use case. So `heybuddy train`'s steps 1–2 (100k positive
+ 100k adversarial samples via Piper TTS) **must not be used as-is**. Nightjar
generates both sets with Kokoro-82M (Apache-2.0) instead — see
`../generate_samples.py`. Everything downstream of sample generation (augmentation,
embedding extraction, the three-stage trainer) is used unchanged.

This also means upstream's own pretrained `models/*.onnx` inherit the same
lineage, notwithstanding their Apache-2.0/CC-BY-4.0 label. Nightjar ships one of
them (`hey-buddy.onnx`) **only** as a flagged interim stand-in until our own
Kokoro-trained `hey_june.onnx` exists; see `phase2-mcp/model_licenses.json`.

## Upstream licence statements conflict for the pretrained artifacts

- GitHub `README.md` § License: *"HeyBuddy source code and pretrained models are
  released under the Apache License 2.0."*
- The HuggingFace repo that actually serves those artifacts — hard-coded as
  `pretrained_model_url` in `src/python/heybuddy/embeddings.py` — declares
  `license: cc-by-4.0` in its model-card frontmatter.

Both permit commercial use; CC-BY-4.0 additionally requires attribution, so
Nightjar complies with the stricter reading (attribution in
`NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` and `phase2-mcp/NOTICE`). Recorded as a
known hazard rather than resolved, because only the maintainer can reconcile it.
