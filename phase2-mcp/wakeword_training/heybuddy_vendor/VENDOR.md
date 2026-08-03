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
- `LICENSE`, `README.upstream.md`, `setup.py`, `environment.yml`.

Deliberately **not** copied:

- `src/js/models/*.onnx` and `src/js/src/logo.png` — ~7 MB of binaries. The one
  model we actually use as an interim stand-in is vendored once, in
  `phase2-mcp/nightjar_capabilities/models/wakeword/`, not here.
- `tests/`, `scripts/`, `WakeWordTrainer.ipynb` — upstream dev tooling.

## Local modifications

**None.** This is an unmodified snapshot. Nightjar's divergence from upstream is
expressed as *replacement*, not patches: the positive/adversarial sample
generation stage is bypassed entirely and replaced by
`../generate_samples.py` (Kokoro-82M). See the next section for why, and
`../README.md` for how the two are wired together.

If a patch ever does become necessary, add it here with the rationale, and push
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
