# Custom "Hey June" wake word — training recipe

**Status: pipeline built + validated; the custom base model is NOT yet trained
(see hazard below). Nightjar runs today with a stock stand-in model; drop in a
trained `hey_june.onnx` and set `NIGHTJAR_WAKEWORD_MODEL` to activate the
real phrase — no code changes.**

## PRODUCT REQUIREMENTS (voice-phase PR 5 — read before training)

1. **The model must be trained SYNTHETICALLY, on thousands of generated voices**
   (openWakeWord's recommended piper-sample-generator pipeline), **never on
   recordings of one person**. A model trained on the maintainer's voice
   recognises the maintainer and fails for customers — this is a product, not a
   personal tool. The kokoro generator below (5 same-engine, all-female voices ×
   3 speeds) is NOT sufficient diversity for the shipped model; treat it as a
   smoke-test source only.
2. **Licensing is why this model exists (NJ-58):** the stock openWakeWord models
   (incl. the `hey_jarvis` stand-in Nightjar currently falls back to) are
   **CC-BY-NC-SA 4.0 — non-commercial** per the package's own license statement.
   No paid build may ship the stock fallback. Before shipping `hey_june.onnx`,
   also verify (rule 5) the licenses of: the shared embedding backbone
   (claimed Apache-2.0, re-implemented from Google's speech_embedding), the
   negative-feature datasets (ACAV100M etc.), and piper-sample-generator + its
   voices — the trained model's license follows its training inputs.

## Why this isn't trained in-repo (hazard)

openWakeWord's pip package (`openwakeword==0.4.0`) ships **inference only** — no
`train` module. Training a brand-new wake *phrase* (not refining an existing one)
requires the openWakeWord **GitHub** training pipeline, which needs:

- **PyTorch + TensorFlow** (heavy; contradicts Nightjar's deliberately torch-free
  runtime — inference here is onnxruntime/CTranslate2 only),
- a **large negative speech corpus** (e.g. ACAV100M precomputed features, multi-GB),
- room-impulse-response + noise augmentation data,
- a GPU and ~1–several hours.

That's an offline, build-farm task, not something to run inside the runtime
environment. So this directory ships the **positive-sample generator** (done) and
the exact **recipe** to finish on a training-capable machine.

(openWakeWord *does* offer a lightweight `custom_verifier_model` — scikit-learn,
torch-free — but it only *refines* an existing base phrase for a specific speaker;
it cannot create the new "Hey Nightjar" phrase. Hence full training is required.)

## Steps

1. **Generate positives (local, done here):**
   ```
   python wakeword_training/generate_samples.py /path/to/positives 2000
   ```
   These use the same kokoro-onnx TTS Nightjar ships — smoke-test positives only
   (see PRODUCT REQUIREMENTS above): the shipped model's positives must come from
   the piper-sample-generator pipeline (thousands of distinct synthetic voices).
   Do NOT train on recordings of a single real person — that overfits the model
   to that speaker.

2. **On a training machine (GPU, torch/TF ok):**
   ```
   git clone https://github.com/dscripka/openWakeWord
   pip install -r openWakeWord/requirements.txt   # torch, tensorflow, etc.
   # download the negative-feature datasets per their notebooks/README
   ```

3. **Run the automatic training** using openWakeWord's
   `notebooks/automatic_model_training.ipynb` (or `train.py`), pointing the
   positive set at the clips from step 1. It computes melspectrogram+embedding
   features (shared `embedding_model.onnx`) and trains the classifier, exporting
   **`hey_nightjar.onnx`**.

4. **Deploy into Nightjar (zero code change):**
   ```
   cp hey_nightjar.onnx ~/.nightjar/models/
   export NIGHTJAR_WAKEWORD_MODEL=~/.nightjar/models/hey_nightjar.onnx
   ```
   `wakeword.resolve_model_path()` picks it up; `is_custom=True`; the stock-model
   warning disappears; the exact same detection pipeline now triggers on
   "Hey Nightjar" instead of the stand-in phrase.

## Validation already done (phase 2)

- Detection pipeline exercised end-to-end (openWakeWord onnx inference on WAV
  frames): fires at score 0.999 on its trained phrase, rejects a non-trained
  phrase at 0.06 — so quality of the *model* is the only open variable; the
  plumbing (wake → hand off to faster-whisper → command) is proven.
