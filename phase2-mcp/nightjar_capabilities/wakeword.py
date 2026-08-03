"""Nightjar wake-word capability — always-listening trigger in front of the voice
pipeline. onnxruntime only: no torch, no TensorFlow, no `openwakeword`.

WHY THIS WAS REWRITTEN (voice-phase PR 5, NJ-58/NJ-59)
------------------------------------------------------
The previous implementation drove `openwakeword.model.Model`. openWakeWord's CODE
is Apache-2.0, but its README states that *all* of its bundled pretrained models —
including the `hey_jarvis` stand-in Nightjar actually fell back to — are
CC-BY-NC-SA 4.0, i.e. NON-COMMERCIAL. That blocked any paid build, and upstream
never answered the question (issues #313 and #338: 0 comments, both still open).
So the engine moved to hey-buddy (Apache-2.0 code, permissive artifacts) and the
`openwakeword` dependency is gone.

The pipeline is a straight port of hey-buddy's JavaScript inference path, which is
vendored at `wakeword_training/heybuddy_vendor/src/js/src/` and is NORMATIVE: a
wake model is a classifier over frozen backbone embeddings, so if our geometry
drifts from the geometry the model was trained and validated against, scores stop
meaning anything. Read that JS before changing any constant here.

    16 kHz int16 mic
      -> rolling 1.08 s window (17280 samples), advanced 120 ms (1920) per hop
      -> mel-spectrogram.onnx      -> [T, 32] log-mel, 10 ms hop, then /10 + 2
      -> 76-frame windows, stride 8
      -> speech-embedding.onnx     -> 4 x 96-d embeddings per hop
      -> rolling buffer of the last 16 embeddings
      -> <phrase>.onnx             -> one sigmoid score in [0, 1]

BACKBONE PROVENANCE (rule 5, and verified by RUNNING — NJ-58)
-------------------------------------------------------------
`speech-embedding.onnx` is Google's `speech_embedding` (Apache-2.0, confirmed at
the primary source: kaggle.com/models/google/speech-embedding). Loading it beside
openWakeWord's `embedding_model.onnx` shows 37 shared weight initializers, ALL
numerically identical, both files produced by `tf2onnx` — two conversions of one
TensorFlow network. They are NOT interchangeable, though: openWakeWord's graph
adds a Pad and a Relu+BatchNormalization, which shifts activations (per-row cosine
~0.977). A wake model must be scored with the backbone it was trained against.

Full licence reasoning for every artifact: `phase2-mcp/model_licenses.json`.

INPUT SCALING — the two upstream reference paths disagree, and it turns out not to
matter
-----------------------------------------------------------------------------
hey-buddy's Python trainer feeds the mel model **int16-range float32**
(`embeddings.py`: `audio_tensor *= 32767.0`); its browser path feeds Web Audio's
[-1, 1] floats with no rescale — a 32768x discrepancy between the two.

MEASURED (PR 5), before assuming it was a hazard: the pipeline is effectively
gain-invariant. Scoring one synthesized "hey buddy" clip at gains from 3e-5 to
1e2 moved the score only between 0.9905 and 0.9910. The log-mel plus the `/10 + 2`
transform absorb overall level, which is the behaviour you want from a detector
that has to work across mic gains anyway.

So this is a cosmetic inconsistency upstream, not a correctness trap. We follow the
trainer's convention regardless — it costs nothing (the mic hands us int16 and we
just widen the dtype) and it is what the weights actually saw. Don't bother
"normalising" it; don't panic if you see the browser doing something different.

NO VAD, deliberately
--------------------
hey-buddy's browser path gates wake scoring behind Silero VAD. We score every hop
instead — which is what the openWakeWord path did too, so this is not a
regression. It costs some CPU and admits false accepts on non-speech that VAD
would have suppressed. Recorded as a named follow-up rather than silently dropped.

MODEL SELECTION
---------------
`NIGHTJAR_WAKEWORD_MODEL` -> a trained `hey_june.onnx` (is_custom=True). Otherwise
the bundled `hey_june.onnx` if it exists, else the bundled `hey-buddy.onnx`
interim stand-in (is_custom=False, loud warning, phrase is "hey buddy").
"""
from __future__ import annotations

import os
import sys
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, Optional, Tuple

import numpy as np

# ── geometry (hey-buddy defaults; see src/js/src/hey-buddy.js constructor) ────
SR = 16000                  # target sample rate
WINDOW_SAMPLES = 17280      # batchSeconds 1.08 * 16000
FRAME = 1920                # batchIntervalSeconds 0.12 * 16000 — one hop
MEL_BINS = 32               # spectrogramMelBins
EMB_DIM = 96                # embeddingDim
EMB_WINDOW = 76             # embeddingWindowSize (mel frames per embedding)
EMB_STRIDE = 8              # embeddingWindowStride
WAKE_FRAMES = 16            # wakeWordEmbeddingFrames — the classifier's sequence length
DEFAULT_THRESHOLD = 0.5     # wakeWordThreshold

_MODELS_DIR = Path(__file__).with_name("models") / "wakeword"
_MEL_MODEL = _MODELS_DIR / "mel-spectrogram.onnx"
_EMBEDDING_MODEL = _MODELS_DIR / "speech-embedding.onnx"
_CUSTOM_MODEL = _MODELS_DIR / "hey_june.onnx"
_FALLBACK_MODEL = _MODELS_DIR / "hey-buddy.onnx"

_STOCK_WARNING = (
    "[nightjar-wakeword] WARNING: using the INTERIM stand-in model {key!r} — the "
    "phrase is 'hey buddy', NOT 'hey june'. Train the real model "
    "(wakeword_training/README.md) and point NIGHTJAR_WAKEWORD_MODEL at it before "
    "shipping. Licensing: this stand-in is Apache-2.0/CC-BY-4.0 per upstream, but its "
    "training POSITIVES were generated with a Piper voice whose lineage traces to "
    "Lessac Blizzard 2013 — a licence that forbids commercial speech products "
    "(KNOWN_ISSUES.md NJ-59). Fine for a free build; must NOT ship in a paid one."
)


def resolve_model_path() -> Tuple[str, bool]:
    """Return (path, is_custom). Prefers a trained Hey-June model; falls back to the
    bundled hey-buddy stand-in (is_custom=False — different phrase, and NJ-59)."""
    env = os.environ.get("NIGHTJAR_WAKEWORD_MODEL")
    if env and Path(env).exists():
        return env, True
    if _CUSTOM_MODEL.exists():
        return str(_CUSTOM_MODEL), True
    return str(_FALLBACK_MODEL), False


class _OnnxModel:
    """One ONNX graph + its real input/output names.

    Names are read from the graph rather than hard-coded: the backbone's are
    tf2onnx artifacts (`input_1` -> `conv2d_19`) that would silently break on a
    re-export, and a wrong key raises an unhelpful onnxruntime error deep in a
    hot loop rather than at load time."""

    def __init__(self, path: Path, expect_inputs: int = 1) -> None:
        import onnxruntime as rt

        if not path.exists():
            raise FileNotFoundError(
                f"wake-word model missing: {path}. The three ONNX artifacts are vendored "
                f"in-tree under nightjar_capabilities/models/wakeword/ (see "
                f"phase2-mcp/model_licenses.json); a checkout that stripped them — or an "
                f"over-broad *.onnx ignore rule — is the usual cause."
            )
        opts = rt.SessionOptions()
        opts.log_severity_level = 3  # warnings from the tf2onnx graphs are not actionable
        self.sess = rt.InferenceSession(
            str(path), sess_options=opts, providers=["CPUExecutionProvider"])
        ins = self.sess.get_inputs()
        if len(ins) != expect_inputs:
            raise ValueError(f"{path.name}: expected {expect_inputs} input(s), got "
                             f"{[i.name for i in ins]}")
        self.input_name = ins[0].name
        self.output_name = self.sess.get_outputs()[0].name

    def run(self, x: np.ndarray) -> np.ndarray:
        return self.sess.run([self.output_name], {self.input_name: x})[0]


class WakeWordDetector:
    """Streaming detector. Feed consecutive FRAME-sample int16 hops to
    `process_frame`; it returns this model's score for the trailing 1.08 s.

    Stateful by design (the rolling audio + embedding buffers ARE the receptive
    field), so call `reset()` between independent audio sources."""

    def __init__(self, model_path: Optional[str] = None,
                 threshold: float = DEFAULT_THRESHOLD) -> None:
        if model_path is None:
            model_path, is_custom = resolve_model_path()
        else:
            is_custom = True
        self.is_custom = is_custom
        self.threshold = threshold
        self.model_key = Path(model_path).stem

        self._mel = _OnnxModel(_MEL_MODEL)
        self._emb = _OnnxModel(_EMBEDDING_MODEL)
        self._wake = _OnnxModel(Path(model_path))

        if not is_custom:
            print(_STOCK_WARNING.format(key=self.model_key), file=sys.stderr)

        # Mirrors AudioBatcher: a zero-filled window that shifts left by one hop per
        # push, so scoring starts immediately on a zero-padded window rather than
        # waiting — matching the reference implementation's warm-up behaviour.
        self._audio = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
        self._embeddings: Deque[np.ndarray] = deque()
        self._per_hop: Optional[int] = None   # embeddings produced per hop (4)

    # ── lifecycle ────────────────────────────────────────────────────────────
    def reset(self) -> None:
        self._audio[:] = 0.0
        self._embeddings.clear()

    # ── the pipeline, one hop at a time ──────────────────────────────────────
    def _embed_window(self) -> np.ndarray:
        """Current 1.08 s window -> [n, 96] embeddings (n == 4 at the defaults)."""
        mel = self._mel.run(self._audio[np.newaxis, :])
        mel = np.squeeze(mel) / 10.0 + 2.0          # the reference post-transform
        if mel.ndim != 2 or mel.shape[1] != MEL_BINS:
            raise ValueError(f"unexpected mel shape {mel.shape}, want (T, {MEL_BINS})")

        n_frames = mel.shape[0]
        if n_frames < EMB_WINDOW:
            raise ValueError(f"window too short: {n_frames} mel frames < {EMB_WINDOW}")
        # Drop the ragged tail so every window is full — matches the JS
        # `numTruncatedFrames` computation exactly.
        truncated = n_frames - (n_frames - EMB_WINDOW) % EMB_STRIDE
        starts = range(0, truncated - EMB_WINDOW + 1, EMB_STRIDE)
        windows = np.stack([mel[s:s + EMB_WINDOW] for s in starts])
        windows = windows[..., np.newaxis].astype(np.float32)   # [n, 76, 32, 1]
        return self._emb.run(windows).reshape(-1, EMB_DIM)      # [n, 96]

    def process_frame(self, frame_int16: np.ndarray) -> float:
        """Feed one FRAME-sample int16 hop; return this model's score in [0, 1].

        Returns 0.0 while the embedding buffer is still filling (the first few
        hops), exactly as the reference withholds a verdict until it holds a full
        16-embedding sequence."""
        frame = np.asarray(frame_int16)
        if frame.shape != (FRAME,):
            raise ValueError(f"expected a {FRAME}-sample int16 frame, got shape {frame.shape}")

        # int16 -> float32 WITHOUT normalising: the trainer fed int16-range values.
        self._audio[:-FRAME] = self._audio[FRAME:]
        self._audio[-FRAME:] = frame.astype(np.float32)

        emb = self._embed_window()
        if self._per_hop is None:
            self._per_hop = emb.shape[0]
            if self._per_hop == 0 or WAKE_FRAMES % self._per_hop:
                raise ValueError(
                    f"{self._per_hop} embeddings per hop does not divide the classifier's "
                    f"{WAKE_FRAMES}-frame input; the geometry constants no longer match the "
                    f"backbone (see this module's docstring)")
            self._embeddings = deque(maxlen=WAKE_FRAMES // self._per_hop)
        self._embeddings.append(emb)

        if len(self._embeddings) < self._embeddings.maxlen:
            return 0.0
        seq = np.concatenate(self._embeddings, axis=0)[np.newaxis, :, :]  # [1, 16, 96]
        return float(np.asarray(self._wake.run(seq.astype(np.float32))).ravel()[0])

    # ── whole-buffer scan (files, tests, the MCP tool) ────────────────────────
    def scan(self, pcm_int16: np.ndarray) -> Dict[str, Any]:
        """Scan a full int16 PCM array (16 kHz mono). Returns detection info.

        One window of trailing silence is appended so a phrase at the very end of
        the clip still gets a fully-populated receptive field — without it, the
        last ~1 s of every file is scored only on partial context."""
        self.reset()
        pcm = np.asarray(pcm_int16, dtype=np.int16)
        padded = np.concatenate([pcm, np.zeros(WINDOW_SAMPLES, dtype=np.int16)])
        n_hops = len(padded) // FRAME

        max_score, hit_at = 0.0, -1
        for i in range(n_hops):
            s = self.process_frame(padded[i * FRAME:(i + 1) * FRAME])
            if s > max_score:
                max_score = s
            if s >= self.threshold and hit_at < 0:
                hit_at = i
        return {
            "detected": hit_at >= 0,
            "max_score": round(max_score, 4),
            # Hop index -> the time the window it scored ENDED at, clamped to the
            # real clip so trailing-pad hits don't report past the end.
            "detect_time_s": round(min((hit_at + 1) * FRAME, len(pcm)) / SR, 2)
            if hit_at >= 0 else None,
            "model": self.model_key,
            "is_custom": self.is_custom,
        }


def _read_wav_16k_mono_int16(path: str) -> np.ndarray:
    import soundfile as sf
    data, sr = sf.read(path, dtype="int16", always_2d=False)
    if data.ndim > 1:
        data = data[:, 0]
    if sr != SR:
        # simple linear resample to 16k (adequate for wake detection)
        ratio = SR / sr
        idx = (np.arange(int(len(data) * ratio)) / ratio).astype(np.int64)
        idx = np.clip(idx, 0, len(data) - 1)
        data = data[idx]
    return data.astype(np.int16)


def detect_in_wav(path: str, model_path: Optional[str] = None,
                  threshold: float = DEFAULT_THRESHOLD) -> Dict[str, Any]:
    pcm = _read_wav_16k_mono_int16(path)
    return WakeWordDetector(model_path=model_path, threshold=threshold).scan(pcm)
