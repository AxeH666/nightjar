"""Nightjar voice capability — clean, file/bytes-based STT + TTS.

Derived from Row-Bot's voice stack (Apache-2.0): same faster-whisper (CTranslate2,
CPU int8) STT and same Kokoro TTS model as Row-Bot, but reimplemented as a
minimal module with NO live-mic loop, NO sounddevice playback, and NO realtime/
cloud provider glue (all of which the audit scoped out). The always-listening
mic path is provided separately by the wake-word module + side-channel; here we
operate on audio files / arrays so it runs headless and is testable without a
sound card.

TTS no longer uses the `kokoro-onnx` *package*, only the Kokoro ONNX weights
(Apache-2.0). `Kokoro.__init__` unconditionally builds a `Tokenizer` that
`ctypes.cdll.LoadLibrary()`s a GPL espeak-ng binary, so constructing it pulled
GPL into the runtime graph. We drive the ONNX session directly and phonemize
with misaki (Apache-2.0) instead — see `tts_g2p.py` for the full rationale and
`tests/test_tts_no_gpl.py` for the regression guard.
"""
from __future__ import annotations

import json
import re
import wave
from pathlib import Path
from typing import Optional, Union

import numpy as np
import requests

from . import config

# --- kokoro model (same release Row-Bot uses) ---
_KOKORO_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
_KOKORO_MODEL = "kokoro-v1.0.fp16.onnx"
_KOKORO_VOICES = "voices-v1.0.bin"
_DEFAULT_VOICE = "af_heart"

# Kokoro's phoneme->id table, vendored from kokoro-onnx (MIT) so the package
# itself — and therefore its GPL tokenizer — is no longer a dependency. 114
# single-char entries with IDs sparse over 1..177 (178 is the embedding table
# size, NOT the alphabet size). Verified byte-identical to
# kokoro_onnx.config.DEFAULT_VOCAB at the pinned 0.5.0.
_VOCAB_PATH = Path(__file__).with_name("kokoro_vocab.json")
_SAMPLE_RATE = 24000
_MAX_PHONEME_LENGTH = 510

_whisper = None
_kokoro = None
_vocab: Optional[dict] = None


def _kokoro_dir() -> Path:
    d = config.MODELS_DIR / "kokoro"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
        tmp.rename(dest)


# ---------------- STT (faster-whisper) ----------------

def _get_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel(config.WHISPER_SIZE, device="cpu", compute_type="int8")
    return _whisper


def transcribe(audio: Union[str, bytes, np.ndarray]) -> str:
    """Transcribe speech to text.
    - str: path to an audio file (wav/mp3/etc — decoded by faster-whisper)
    - bytes: raw int16 PCM mono @ 16 kHz
    - np.ndarray: float32 mono @ 16 kHz in [-1, 1]
    """
    model = _get_whisper()
    if isinstance(audio, bytes):
        audio = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = model.transcribe(audio, beam_size=5, language="en", vad_filter=True)
    return " ".join(s.text.strip() for s in segments).strip()


# ---------------- TTS (Kokoro weights + misaki G2P, no kokoro-onnx) ----------------

def _get_vocab() -> dict:
    global _vocab
    if _vocab is None:
        _vocab = json.loads(_VOCAB_PATH.read_text(encoding="utf-8"))["vocab"]
    return _vocab


class _KokoroSession:
    """The ONNX session + voice styles + G2P, without `kokoro_onnx.Kokoro`."""

    def __init__(self, model_path: str, voices_path: str):
        import onnxruntime as rt

        from .tts_g2p import build_g2p

        self.sess = rt.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.voices = np.load(voices_path)
        self.vocab = _get_vocab()
        self.g2p = build_g2p()
        self._input_names = [i.name for i in self.sess.get_inputs()]

    @staticmethod
    def _split_phonemes(phonemes: str) -> list[str]:
        """Batch to <= _MAX_PHONEME_LENGTH, preferring punctuation boundaries."""
        batches: list[str] = []
        cur = ""
        for part in re.split(r"([.,!?;])", phonemes):
            part = part.strip()
            if not part:
                continue
            if len(cur) + len(part) + 1 >= _MAX_PHONEME_LENGTH:
                batches.append(cur.strip())
                cur = part
            elif part in ".,!?;":
                cur += part
            else:
                cur = f"{cur} {part}" if cur else part
        if cur:
            batches.append(cur.strip())
        return batches

    def _create_audio(self, phonemes: str, style, speed: float):
        # Chars misaki emits that aren't in Kokoro's table (notably the unk
        # ornament) are dropped here, exactly as kokoro-onnx's tokenizer did.
        tokens = [i for i in map(self.vocab.get, phonemes[:_MAX_PHONEME_LENGTH])
                  if i is not None]
        if not tokens:
            return np.zeros(0, dtype=np.float32)
        voice_vec = style[len(tokens)]  # style is indexed by unpadded length
        padded = [[0, *tokens, 0]]      # pad token 0 at each end
        if "input_ids" in self._input_names:
            inputs = {
                "input_ids": padded,
                "style": np.array(voice_vec, dtype=np.float32),
                "speed": np.array([speed], dtype=np.int32),
            }
        else:
            inputs = {
                "tokens": padded,
                "style": voice_vec,
                "speed": np.ones(1, dtype=np.float32) * speed,
            }
        return self.sess.run(None, inputs)[0]

    def create(self, text: str, voice: str, speed: float):
        if voice not in self.voices:
            raise ValueError(f"voice {voice!r} not in {sorted(self.voices.keys())}")
        style = self.voices[voice]
        phonemes, _ = self.g2p(text)
        parts = [self._create_audio(p, style, speed)
                 for p in self._split_phonemes(phonemes)]
        parts = [p for p in parts if len(p)]
        audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
        return audio, _SAMPLE_RATE


def _get_kokoro() -> _KokoroSession:
    global _kokoro
    if _kokoro is None:
        d = _kokoro_dir()
        model_p, voices_p = d / _KOKORO_MODEL, d / _KOKORO_VOICES
        _download(f"{_KOKORO_BASE}/{_KOKORO_MODEL}", model_p)
        _download(f"{_KOKORO_BASE}/{_KOKORO_VOICES}", voices_p)
        _kokoro = _KokoroSession(str(model_p), str(voices_p))
    return _kokoro


def speak(text: str, out_path: Optional[str] = None, voice: str = _DEFAULT_VOICE,
          speed: float = 1.0) -> str:
    """Synthesize `text` to a WAV file (no live playback — no sound card here).
    Returns the output path. Row-Bot's `speak_now` played via sounddevice; we
    write a file the caller (or a future UI/side-channel) can play."""
    if not 0.5 <= speed <= 2.0:
        raise ValueError(f"speed must be in [0.5, 2.0], got {speed}")
    kokoro = _get_kokoro()
    samples, sr = kokoro.create(text, voice=voice, speed=speed)
    out = out_path or str(config.DATA_ROOT / "tts_out.wav")
    pcm = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype(np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm16.tobytes())
    return out
