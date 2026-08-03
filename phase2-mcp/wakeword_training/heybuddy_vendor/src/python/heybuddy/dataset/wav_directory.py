# NIGHTJAR PATCH (voice-phase training PR, 2026-08-03) — this file is NOT part of
# the upstream hey-buddy snapshot. It exists so training positives/adversarials can
# come from a directory of pregenerated WAVs (Nightjar: Kokoro-82M, Apache-2.0)
# instead of the built-in Piper TTS, whose default voice is lessac/Blizzard-2013-
# derived and licence-forbidden for commercial speech products (KNOWN_ISSUES.md
# NJ-59). Recorded in ../../../../VENDOR.md; the same patch is pushed to the
# AxeH666/hey-buddy fork.
from __future__ import annotations

import hashlib
import os
import wave
from typing import Any, Dict, Iterator, List, Optional

import numpy as np

from heybuddy.dataset.generator import AudioDatasetGenerator
from heybuddy.util import logger

__all__ = ["WavDirectorySpeechGenerator"]

# Disjoint role partitions, assigned per-file by stable hash so that train/testing/
# validation NEVER share a clip. The Piper generator gets this for free (every call
# synthesizes fresh samples); a finite directory does not, and reusing training
# clips for validation would silently inflate every validation metric the trainer
# uses to steer its stages.
ROLE_BUCKETS = {"training": (0, 80), "testing": (80, 90), "validation": (90, 100)}


class WavDirectorySpeechGenerator(AudioDatasetGenerator):
    """Yields speech samples from a directory of WAV files, in the same
    ``{"audio": {"array", "sampling_rate"}, "phrase"}`` shape PiperSpeechGenerator
    yields, so everything downstream (augmentation, embedding, caching) is
    untouched.

    Files are partitioned by role (training/testing/validation) via a stable
    per-filename hash, then served in a deterministically shuffled order. If a
    role's partition holds fewer files than requested, it wraps around WITH A
    LOGGED WARNING — sampling with replacement, never a silent truncation.
    """

    def __init__(
        self,
        audio_dir: str,
        device_id: Optional[int] = None,
        target_sample_rate: int = 16000,
        seed: int = 8571,
    ) -> None:
        super().__init__(device_id=device_id)
        self.audio_dir = audio_dir
        self.target_sample_rate = target_sample_rate
        self.seed = seed
        if not os.path.isdir(audio_dir):
            raise FileNotFoundError(
                f"audio_dir {audio_dir!r} is not a directory — generate samples first "
                f"(Nightjar: wakeword_training/generate_samples.py)"
            )
        self._files = sorted(
            f for f in os.listdir(audio_dir) if f.lower().endswith(".wav")
        )
        if not self._files:
            raise FileNotFoundError(f"audio_dir {audio_dir!r} contains no .wav files")

    # ── partitioning ──────────────────────────────────────────────────────────
    def files_for_role(self, role: str) -> List[str]:
        if role not in ROLE_BUCKETS:
            raise ValueError(f"role {role!r} not in {sorted(ROLE_BUCKETS)}")
        lo, hi = ROLE_BUCKETS[role]
        out = []
        for f in self._files:
            # sha1 of the filename -> [0,100) bucket; stable across runs/machines.
            h = int(hashlib.sha1(f.encode("utf-8")).hexdigest()[:8], 16) % 100
            if lo <= h < hi:
                out.append(f)
        if not out:
            raise FileNotFoundError(
                f"no files landed in the {role!r} partition of {self.audio_dir!r} "
                f"({len(self._files)} total) — the directory is too small to split"
            )
        rng = np.random.default_rng(self.seed)
        rng.shuffle(out)
        return out

    # ── loading ───────────────────────────────────────────────────────────────
    def _load(self, name: str) -> np.ndarray:
        with wave.open(os.path.join(self.audio_dir, name), "rb") as w:
            sr = w.getframerate()
            n_ch = w.getnchannels()
            width = w.getsampwidth()
            raw = w.readframes(w.getnframes())
        if width != 2:
            raise ValueError(f"{name}: expected 16-bit PCM, got {width * 8}-bit")
        data = np.frombuffer(raw, dtype=np.int16)
        if n_ch > 1:
            data = data.reshape(-1, n_ch)[:, 0]
        audio = data.astype(np.float32) / 32768.0
        if sr != self.target_sample_rate:
            ratio = self.target_sample_rate / sr
            idx = (np.arange(int(len(audio) * ratio)) / ratio).astype(np.int64)
            idx = np.clip(idx, 0, len(audio) - 1)
            audio = audio[idx]
        return audio

    # ── the generator contract (matches PiperSpeechGenerator.__call__) ────────
    def __call__(
        self,
        num_samples: int,
        role: str = "training",
        **kwargs: Any,
    ) -> Iterator[Dict[str, Any]]:
        files = self.files_for_role(role)
        if num_samples > len(files):
            logger.warning(
                f"WavDirectorySpeechGenerator: {num_samples} samples requested from the "
                f"{role!r} partition of {self.audio_dir!r} which holds only "
                f"{len(files)} files — wrapping around (sampling with replacement)."
            )
        for i in range(num_samples):
            name = files[i % len(files)]
            yield {
                "audio": {
                    "array": self._load(name),
                    "sampling_rate": self.target_sample_rate,
                },
                "phrase": os.path.splitext(name)[0],
            }
