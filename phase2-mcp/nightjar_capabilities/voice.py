"""Nightjar voice capability — clean, file/bytes-based STT + TTS.

Derived from Row-Bot's voice stack (Apache-2.0): same faster-whisper (CTranslate2,
CPU int8) STT and same kokoro-onnx TTS model as Row-Bot, but reimplemented as a
minimal module with NO live-mic loop, NO sounddevice playback, and NO realtime/
cloud provider glue (all of which the audit scoped out). The always-listening
mic path is provided separately by the wake-word module + side-channel; here we
operate on audio files / arrays so it runs headless and is testable without a
sound card.
"""
from __future__ import annotations

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

_whisper = None
_kokoro = None


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


# ---------------- TTS (kokoro-onnx) ----------------

def _get_kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        d = _kokoro_dir()
        model_p, voices_p = d / _KOKORO_MODEL, d / _KOKORO_VOICES
        _download(f"{_KOKORO_BASE}/{_KOKORO_MODEL}", model_p)
        _download(f"{_KOKORO_BASE}/{_KOKORO_VOICES}", voices_p)
        _kokoro = Kokoro(str(model_p), str(voices_p))
    return _kokoro


def speak(text: str, out_path: Optional[str] = None, voice: str = _DEFAULT_VOICE,
          speed: float = 1.0) -> str:
    """Synthesize `text` to a WAV file (no live playback — no sound card here).
    Returns the output path. Row-Bot's `speak_now` played via sounddevice; we
    write a file the caller (or a future UI/side-channel) can play."""
    kokoro = _get_kokoro()
    samples, sr = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
    out = out_path or str(config.DATA_ROOT / "tts_out.wav")
    pcm = np.clip(samples, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype(np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm16.tobytes())
    return out
