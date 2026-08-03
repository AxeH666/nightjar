# Custom "Hey June" wake word — training recipe (hey-buddy + Kokoro)

**Status: pipeline built + runtime verified end-to-end against a real model
(voice-phase PR 5); the custom `hey_june.onnx` is NOT yet trained — that is an
offline GPU-box task. Nightjar runs today on the flagged `hey-buddy.onnx`
stand-in (wake phrase: "hey buddy"); drop a trained `hey_june.onnx` into
`nightjar_capabilities/models/wakeword/` (or point `NIGHTJAR_WAKEWORD_MODEL` at
one) to activate the real phrase — no code changes.**

## What changed in PR 5 (and why the old recipe is void)

The previous recipe here said: train with openWakeWord's GitHub pipeline and
generate positives with piper-sample-generator. **Both halves are dead**:

1. **openWakeWord is gone (NJ-58).** Its pretrained models — including the
   `hey_jarvis` fallback Nightjar used to ship — are CC-BY-NC-SA 4.0
   (non-commercial) per its own README, and upstream never answered the
   backbone-licence question (issues #313/#338, 0 comments, 6+ months). Nightjar
   now uses [hey-buddy](https://github.com/painebenjamin/hey-buddy) (Apache-2.0,
   fork: [AxeH666/hey-buddy](https://github.com/AxeH666/hey-buddy), vendored at
   `heybuddy_vendor/` at pinned commit `6e78d26`).
2. **Piper positives are poison (NJ-59).** Both piper-sample-generator's and
   hey-buddy's default TTS checkpoint is `en_US-libritts_r-medium`, fine-tuned
   from the lessac voice, whose Blizzard-2013 licence forbids "the development…
   commercialisation, sale or licencing of voice synthesis or speech recognition
   products or services" — Nightjar's exact use case. Positives (and
   adversarials) come from **Kokoro-82M (Apache-2.0)** instead, via
   `generate_samples.py`.

The backbone is settled (it was NJ-58's last open question): Google's
`speech_embedding` is **Apache-2.0 at the primary source**
(kaggle.com/models/google/speech-embedding, maintainer-verified 2026-08-03), and
PR 5 additionally proved by running both files that hey-buddy's
`speech-embedding.onnx` and openWakeWord's `embedding_model.onnx` carry
numerically identical weights — two tf2onnx conversions of the same Google
network. Full licence ledger: `../model_licenses.json`.

## PRODUCT REQUIREMENTS (unchanged, now enforced by tests)

1. **Synthetic, multi-speaker, always.** Thousands of generated voices, never
   recordings of one person — a model trained on the maintainer recognises the
   maintainer and fails for customers. `generate_samples.py` refuses narrow voice
   sets (`SingleSpeakerError`), has no audio-capture code path, and
   `tests/test_wakeword_samples.py` asserts both.
2. **Licensing is why this model exists.** Every training input must be an entry
   in `../model_licenses.json` with a rule-5-verified licence.
   `tests/test_model_licenses.py` enforces the manifest;
   `mirror_datasets.py` refuses to even mirror an unverified dataset.

## The pipeline

```
generate_samples.py (Kokoro, THIS repo, any OS)        heybuddy_vendor (Linux+GPU)
┌──────────────────────────────────┐                  ┌──────────────────────────┐
│ positives:  "Hey June" x 28 EN   │   16 kHz WAVs    │ augment (noise/music/IR) │
│   voices x style blends x speeds │ ───────────────► │ extract embeddings       │
│ adversarial: "Hey Jane/Dune/..." │                  │ 3-stage trainer          │
└──────────────────────────────────┘                  │ convert -> hey_june.onnx │
                                                      └──────────────────────────┘
                 negatives: precalculated dataset (CC-BY-4.0, up to 72 GB)
```

### Step 1 — positives + adversarials (local, any OS, done in-repo)

```sh
# from phase2-mcp/
venv/Scripts/python wakeword_training/generate_samples.py positives  /data/hey_june/positives  100000
venv/Scripts/python wakeword_training/generate_samples.py adversarial /data/hey_june/adversarial 100000
```

Kokoro has 28 English voices — far short of Piper's 904 speakers — so the
generator multiplies identities by **style-vector blending** (378 voice pairs x 3
weights, mirroring hey-buddy's Piper SLERP trick) and speed variation: ~4,500
distinct (timbre, rate) combinations. PR 5 measured that blended styles score the
same as pure voices through the wake pipeline (mean 0.69 vs 0.59 on the stand-in
model), i.e. blends are real speech, not noise. `--accents` adds 9 non-native
English voices if broader coverage is wanted.

### Step 2 — datasets (self-hosted, licence-gated)

```sh
venv/Scripts/python wakeword_training/mirror_datasets.py plan    # writes mirror_manifest.json
venv/Scripts/python wakeword_training/mirror_datasets.py fetch /data/mirror
```

`plan` enumerates every shard (repo, path, size, sha256) of the negatives
(~72 GB) + augmentation sets and is the durable bill of materials;
`fetch`/`verify` populate and check a staging directory. Copying to real object
storage is a maintainer action once a target exists (deliberately not hardcoded).
⚠ The MIT impulse-response set is currently **licence-blocked** in the manifest
(no licence tag on HF; hey-buddy's CC-BY claim unverified — see the
`mit-impulse-response-survey-16khz` entry in `../model_licenses.json`). Read its
actual terms before training with default augmentation, or swap in a verified IR
set via `--augmentation-impulse-dataset`.

### Step 3 — train (Linux + GPU; torch/TF acceptable there)

```sh
conda env create -f heybuddy_vendor/environment.yml && conda activate heybuddy
pip install -e heybuddy_vendor
# then: patch the sample source (see below), and
heybuddy train "hey june" --augmentation-no-default-impulse-dataset  # until the IR licence is resolved
heybuddy convert checkpoints/hey_june_final.pt
```

⚠ **One small vendored patch is required at this step, by design.** Verified by
reading the vendored code (`dataset/features.py`, `dataset/training.py`): the
trainer's positives come ONLY from its internal `PiperSpeechGenerator` — there is
no CLI flag to feed pregenerated WAVs. The training-PR task is to swap that class
for a directory-reading generator pointed at Step 1's output (the class's
interface is "yield 16 kHz sample batches", so the patch is small and contained in
`TrainingFeaturesGenerator`). Everything downstream — augmentation, embedding
extraction, the 3-stage trainer, ONNX export — is untouched. Record the patch in
`heybuddy_vendor/VENDOR.md` and push it to the fork, per the vendor policy there.
Do NOT "just let it use Piper for a first run": that first run's model would carry
the NJ-59 lineage and someone WILL ship it.

### Step 4 — deploy (zero code change)

```sh
cp hey_june.onnx <repo>/phase2-mcp/nightjar_capabilities/models/wakeword/
# then record its sha256 in ../model_licenses.json (the guard requires it)
```

`wakeword.resolve_model_path()` picks it up; `is_custom=True`; the stand-in
warning disappears; "Hey June" wakes the daemon.

## Validation already done (PR 5) — and what is NOT

Verified by running, on this machine:
- The onnxruntime shim reproduces hey-buddy's scoring: Kokoro-synthesized
  "hey buddy" scores **0.991** on the stand-in model, "hey June" 0.23,
  unrelated speech 0.001. The plumbing (wake → transcribe → OpenCode turn → TTS)
  is unchanged from PRs 2–4 and its tests pass at the new 120 ms hop.
- The pipeline is gain-invariant (scores stable from 3e-5x to 100x input scale),
  so mic level differences won't break detection.

NOT yet verified (rule 8 — stated, not implied): real-mic acoustic detection on
hardware, false-accept rate over hours of ambient audio, and everything about the
actual `hey_june.onnx` — which does not exist until someone runs Step 3.
