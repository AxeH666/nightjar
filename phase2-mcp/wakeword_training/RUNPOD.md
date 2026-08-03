# Training `hey_june.onnx` on a RunPod GPU pod — the complete recipe

From bare pod to a verified model file on your Windows box. Every command was
designed against the pinned repo state (this PR's merge commit); train against
that commit, not a moving branch.

**Decisions baked into this recipe** (maintainer, 2026-08-03): medium dataset
first (25 GB; rerun with full only if test 4 fails), 100k/100k samples, reverb
augmentation via **OpenSLR-26 simulated RIRs** (Apache-2.0 — NOT the MIT IR
survey, which has no licence grant anywhere; NJ-60).

## 0. Pod selection

| Choice | Recommendation | Why |
|---|---|---|
| GPU | **RTX 4090 24 GB** (community ~$0.35/h) or RTX A5000 24 GB (~$0.26/h) | true VRAM need is ~8–12 GB (tiny MLP; GPU work is augmentation + embedding extraction) — pick by price, not size |
| vCPUs | **16+** | Kokoro sample generation is CPU-side and parallel |
| Volume | **120 GB** | 25 GB negatives + ~48 GB augmentation + ~15 GB WAVs + features + env |
| Rental | plan **12–18 h**, billed hourly | estimates below are estimates; tmux + caching make interruptions cheap |

Estimated total cost: **$6–13** for a medium-dataset run; roughly double if a
full-dataset rerun is needed. Storage ~$0.50/day. Ingress free; the outputs you
export are a few MB.

## 1. Setup (once, ~20 min + downloads)

```bash
apt-get update && apt-get install -y git tmux unzip
git clone https://github.com/AxeH666/nightjar /workspace/nightjar
cd /workspace/nightjar   # pin: git checkout <merge commit of the training PR>

# env A — sample generation (light; CPU; no torch)
python3 -m venv /workspace/genv
/workspace/genv/bin/pip install numpy onnxruntime "misaki[en]" requests soundfile
/workspace/genv/bin/pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# env B — training (heavy; torch; NO piper-phonemize — the lazy-import patch means
# the Piper path is never touched when --positive-audio-dir is used)
cd phase2-mcp/wakeword_training
conda env create -f heybuddy_vendor/environment.yml -n heybuddy || true
conda activate heybuddy
pip install -e heybuddy_vendor          # installs the PATCHED vendored tree
# piper-phonemize will be ABSENT — that is deliberate and correct (NJ-59):
python -c "import importlib.util as u; assert u.find_spec('piper_phonemize') is None, 'remove piper-phonemize'; print('piper path uninstallable: OK')"

# reverb IRs — OpenSLR-26 simulated set (Apache-2.0, 178 MB)
mkdir -p /data/irs && cd /data/irs
wget https://www.openslr.org/resources/26/sim_rir_16k.zip && unzip -q sim_rir_16k.zip
# spot-check the READMEs you are relying on (they travel inside SLR28's zip; SLR26
# is the same simulated_rirs data standalone — see model_licenses.json entry)
```

## 2. Generate the corpora (CPU, ~3–8 h — overlap with the dataset download)

All inside `tmux`. `--shard i/N` splits one deterministic corpus across N
processes; the union is byte-identical to an unsharded run (verified in-repo).

```bash
cd /workspace/nightjar/phase2-mcp
N=16
for i in $(seq 0 $((N-1))); do
  /workspace/genv/bin/python wakeword_training/generate_samples.py positives   /data/pos 100000 --shard $i/$N &
done; wait
for i in $(seq 0 $((N-1))); do
  /workspace/genv/bin/python wakeword_training/generate_samples.py adversarial /data/adv 100000 --shard $i/$N &
done; wait
# the holdout evaluation set — 4 voices the training kinds REFUSE to include
/workspace/genv/bin/python wakeword_training/generate_samples.py holdout /data/holdout 400
```

Notes: the training kinds hard-fail (`HoldoutLeakError`) if a held-out voice is
ever passed in; don't fight it. Expect ~13 GB of WAVs. The trainer partitions
each directory 80/10/10 into disjoint train/testing/validation splits by
filename hash — do NOT pre-split by hand.

## 3. Train (GPU, ~3–8 h)

```bash
conda activate heybuddy && cd /workspace/nightjar/phase2-mcp/wakeword_training
heybuddy train "hey june" \
  --positive-audio-dir /data/pos \
  --adversarial-audio-dir /data/adv \
  --training-medium-default-dataset \
  --augmentation-no-default-impulse-dataset \
  --augmentation-impulse-dataset /data/irs/RIRS_NOISES/simulated_rirs
heybuddy convert checkpoints/hey_june_final.pt   # -> hey_june.onnx (~1.2 MB)
```

The two `--*-audio-dir` flags are the vendored patch (VENDOR.md § Local
modifications). Piper is never imported; providing only one of the two dirs is a
CLI error by design. `--augmentation-no-default-impulse-dataset` disables the
licence-blocked MIT IR set; the following flag substitutes SLR26.

## 4. Acceptance — RUN BEFORE TEARDOWN, exit code is the verdict

```bash
# validation negatives: the ~238 MB validation .npy from the heybuddy dataset
# (already on the volume from step 3's download; find it under the HF cache)
VAL=$(find ~/.cache -name "*validation*.npy" | head -1)
python wakeword_training/evaluate_hey_june.py hey_june.onnx \
  --holdout-dir /data/holdout \
  --adversarial-dir /data/adv \
  --training-dirs /data/pos,/data/adv \
  --validation-negatives "$VAL" --validation-hours 35
echo "exit=$?"   # 0 = PASS; anything else: do NOT tear down, read the FAIL lines
```

What it enforces (threshold 0.5): holdout integrity (leak ⇒ hard abort), ≥95%
clean held-out detection, ≥85% under noise, ≤5% adversarial accepts with
"hey buddy" mean <0.3, <0.5 false-accepts/hour over ~35 h of real speech, and
mean clean score ≥0.9. It also refuses to bless the interim stand-in (content
check). Calibration proof lives in the PR: the stand-in scores 0%/0%/0.584 and
exits 1.

If test 4 fails and everything else passes: rerun step 3 with
`--training-full-default-dataset` (72 GB) before giving up on the architecture.

## 5. Export

```bash
runpodctl send hey_june.onnx           # one-time code → runpodctl receive <code> on Windows
runpodctl send checkpoints/hey_june_final.pt   # keep the checkpoint: re-exports without re-training
```

Then on the Windows box: drop the file at
`phase2-mcp/nightjar_capabilities/models/wakeword/hey_june.onnx` (auto-detected;
`is_custom` flips via content check; the NJ-59 warning clears), record its
sha256 in `model_licenses.json` (`vendored: true`), and run
`tests/test_model_licenses.py` + the `--runtime-shim` spot-check from
`evaluate_hey_june.py` on a few holdout clips. That swap is its own small PR.

## Honesty ledger (rule 8)

Verified by running, on Windows, before this recipe shipped: sample generation +
holdout enforcement + shard determinism + the acceptance harness (calibration
and leak controls). NOT verified here: the patched trainer end-to-end (needs
Linux + GPU — the vendored patch is AST-checked and interface-matched, but its
first live run IS your pod run; if `heybuddy train` errors in step 3, suspect
the patch before the data), actual model quality, and real-mic behaviour
(NJ-57's PR-6 hardware item, unchanged).
