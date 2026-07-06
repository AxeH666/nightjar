"""Nightjar wake-word capability — openWakeWord (MIT, offline) always-listening
trigger in front of the voice pipeline.

New for Nightjar (Row-Bot had no wake word). On detection of "Hey Nightjar" the
daemon hands the following speech to faster-whisper (voice.transcribe) and emits
a `wake` event on the side-channel.

This module is the detector + file/array scanner. The live-mic feed loop lives
in the daemon (needs a sound card — absent in this dev box, so detection is
validated here on audio arrays/WAVs instead of a live mic).

Custom model: point NIGHTJAR_WAKEWORD_MODEL at a trained `hey_nightjar.onnx`.
If unset/missing, falls back to a bundled stock model with a loud warning (so
the pipeline is testable, but production must ship the custom phrase model).
"""
from __future__ import annotations

import os
import sys
import wave
from pathlib import Path
from typing import Optional, Dict, Any

import numpy as np

FRAME = 1280            # 80 ms @ 16 kHz — openWakeWord's frame size
SR = 16000
DEFAULT_THRESHOLD = 0.5


def _bundled_dir() -> Path:
    import openwakeword
    return Path(os.path.dirname(openwakeword.__file__)) / "resources" / "models"


def resolve_model_path() -> tuple[str, bool]:
    """Return (path, is_custom). Prefer the trained Hey-Nightjar model; else a
    stock fallback (flagged is_custom=False)."""
    custom = os.environ.get("NIGHTJAR_WAKEWORD_MODEL")
    if custom and Path(custom).exists():
        return custom, True
    fallback = _bundled_dir() / "hey_jarvis_v0.1.onnx"
    return str(fallback), False


class WakeWordDetector:
    def __init__(self, model_path: Optional[str] = None, threshold: float = DEFAULT_THRESHOLD):
        from openwakeword.model import Model
        if model_path is None:
            model_path, is_custom = resolve_model_path()
        else:
            is_custom = True
        self.is_custom = is_custom
        self.threshold = threshold
        self.model_key = Path(model_path).stem
        if not is_custom:
            print(f"[nightjar-wakeword] WARNING: using STOCK model '{self.model_key}' — "
                  f"train a custom 'Hey Nightjar' model and set NIGHTJAR_WAKEWORD_MODEL "
                  f"before shipping.", file=sys.stderr)
        self._model = Model(wakeword_model_paths=[model_path])

    def reset(self) -> None:
        self._model.reset()

    def process_frame(self, frame_int16: np.ndarray) -> float:
        """Feed one 1280-sample int16 frame; return this model's score [0,1]."""
        preds = self._model.predict(frame_int16)
        return float(preds.get(self.model_key, list(preds.values())[0]))

    def scan(self, pcm_int16: np.ndarray) -> Dict[str, Any]:
        """Scan a full int16 PCM array (16 kHz mono). Returns detection info."""
        self.reset()
        max_score = 0.0
        hit_at = -1
        n = len(pcm_int16) // FRAME
        for i in range(n):
            frame = pcm_int16[i * FRAME:(i + 1) * FRAME]
            s = self.process_frame(frame)
            if s > max_score:
                max_score = s
            if s >= self.threshold and hit_at < 0:
                hit_at = i
        return {
            "detected": hit_at >= 0,
            "max_score": round(max_score, 4),
            "detect_time_s": round(hit_at * FRAME / SR, 2) if hit_at >= 0 else None,
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
        import math
        ratio = SR / sr
        idx = (np.arange(int(len(data) * ratio)) / ratio).astype(np.int64)
        idx = np.clip(idx, 0, len(data) - 1)
        data = data[idx]
    return data.astype(np.int16)


def detect_in_wav(path: str, model_path: Optional[str] = None,
                  threshold: float = DEFAULT_THRESHOLD) -> Dict[str, Any]:
    pcm = _read_wav_16k_mono_int16(path)
    return WakeWordDetector(model_path=model_path, threshold=threshold).scan(pcm)
