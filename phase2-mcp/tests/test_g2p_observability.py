#!/usr/bin/env python3
"""No-audio regression tests for NJ-86 privacy-safe G2P observability."""
from __future__ import annotations

import io
import logging
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILS: list[str] = []


def check(label: str, ok: bool) -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
    if not ok:
        FAILS.append(label)


with tempfile.TemporaryDirectory(prefix="june-g2p-observability-") as data_dir:
    os.environ["NIGHTJAR_DATA_DIR"] = data_dir

    from nightjar_capabilities import voice

    secret = "PRIVATE_REPLY_MARKER"

    print("== 1. bounded, text-free input diagnostics ==")
    many_codepoints = secret + "".join(chr(0x2000 + index) for index in range(20))
    diagnostics = voice._g2p_input_diagnostics(many_codepoints)
    check(
        "suspect codepoint list is bounded",
        len(diagnostics["suspect_codepoints"]) <= voice._G2P_CODEPOINT_LIMIT,
    )
    check("omitted distinct codepoints are counted", diagnostics["codepoints_omitted"] == 8)
    check("diagnostics contain no input text", secret not in str(diagnostics))

    print("\n== 2. Kokoro boundary logs counts only ==")

    class FakeFallback:
        def __init__(self):
            self._drains = [
                {"spelled": ["stale-sensitive-fragment"]},
                {
                    "curated_hits": [secret],
                    "recovered": [secret],
                    "spelled": [secret],
                    "lexicon_errors": [f"{secret}: SyntheticError"],
                },
            ]

        def drain(self):
            return self._drains.pop(0) if self._drains else {}

    class FakeG2P:
        def __init__(self):
            self.fallback = FakeFallback()

        def __call__(self, _text):
            return "abc", None

    session = object.__new__(voice._KokoroSession)
    session.g2p = FakeG2P()
    session.voices = {"test": object()}
    session._create_audio = lambda _phonemes, _style, _speed: np.array(
        [0.1], dtype=np.float32
    )

    captured_log = io.StringIO()
    handler = logging.StreamHandler(captured_log)
    old_handlers = list(voice._log.handlers)
    old_level = voice._log.level
    old_propagate = voice._log.propagate
    voice._log.handlers = [handler]
    voice._log.setLevel(logging.INFO)
    voice._log.propagate = False
    try:
        audio, sample_rate = session.create(
            f"{secret} — private response",
            voice="test",
            speed=1.0,
        )
    finally:
        voice._log.handlers = old_handlers
        voice._log.setLevel(old_level)
        voice._log.propagate = old_propagate

    safe_log = captured_log.getvalue()
    check("stub produced audio without model or hardware", len(audio) == 1)
    check("sample rate contract preserved", sample_rate == 24000)
    check("normal voice log emits a diagnostics record", "g2p diagnostics:" in safe_log)
    check("normal voice log includes classification counts", "'spelled': 1" in safe_log)
    check("normal voice log includes lexicon error count", "'lexicon_errors': 1" in safe_log)
    check("normal voice log includes bounded codepoints", "U+2014x1" in safe_log)
    check("normal voice log contains no reply fragments", secret not in safe_log)
    check("no detached process-global stats bridge remains", not hasattr(voice, "last_g2p_stats"))

    print("\n== 3. wake daemon does not read detached G2P state ==")
    import wake_daemon

    wake_logs: list[str] = []
    published: list[tuple] = []

    class FakeMic:
        def read_frame(self):
            return np.zeros(wake_daemon.FRAME, dtype=np.int16)

    class FakeOpenCode:
        def prompt_and_wait(self, _command, _timeout):
            return f"{secret} — private response"

    replacements = {
        "COMMAND_WINDOW_S": wake_daemon.COMMAND_WINDOW_S,
        "PLAY_TTS_LOCALLY": wake_daemon.PLAY_TTS_LOCALLY,
        "log": wake_daemon.log,
        "publish": wake_daemon.publish,
        "transcribe": wake_daemon._voice.transcribe,
        "speak": wake_daemon._voice.speak,
    }
    wake_daemon.COMMAND_WINDOW_S = wake_daemon.FRAME / wake_daemon.SR
    wake_daemon.PLAY_TTS_LOCALLY = False
    wake_daemon.log = wake_logs.append
    wake_daemon.publish = lambda kind, **payload: published.append((kind, payload))
    wake_daemon._voice.transcribe = lambda _audio: "make a private reply"
    wake_daemon._voice.speak = lambda _text, **_kwargs: str(Path(data_dir) / "fake.wav")
    detached_stats_reads: list[bool] = []
    wake_daemon._voice.last_g2p_stats = lambda: detached_stats_reads.append(True) or {}
    try:
        wake_daemon.handle_wake(FakeMic(), FakeOpenCode(), 0.99)
    finally:
        wake_daemon.COMMAND_WINDOW_S = replacements["COMMAND_WINDOW_S"]
        wake_daemon.PLAY_TTS_LOCALLY = replacements["PLAY_TTS_LOCALLY"]
        wake_daemon.log = replacements["log"]
        wake_daemon.publish = replacements["publish"]
        wake_daemon._voice.transcribe = replacements["transcribe"]
        wake_daemon._voice.speak = replacements["speak"]
        del wake_daemon._voice.last_g2p_stats

    joined_wake_logs = "\n".join(wake_logs)
    check("wake logs contain no assistant reply", secret not in joined_wake_logs)
    check("wake logs report reply length", "reply received (chars=" in joined_wake_logs)
    check("wake does not read detached stats", not detached_stats_reads)
    check("TTS event still reaches the live side channel", any(kind == "tts" for kind, _ in published))

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
