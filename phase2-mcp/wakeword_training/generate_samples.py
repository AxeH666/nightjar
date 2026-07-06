#!/usr/bin/env python
"""Generate synthetic 'Hey Nightjar' positive training clips with kokoro-onnx.

openWakeWord's custom-model training uses many synthetic utterances of the wake
phrase (across voices/speeds) as positives, plus a large negative speech corpus.
This produces the POSITIVES locally with the same TTS Nightjar already ships —
no extra deps. Scale up `VOICES`/`SPEEDS`/repetitions for a production model.

Usage: python wakeword_training/generate_samples.py [out_dir] [count]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from nightjar_capabilities import voice  # noqa: E402

PHRASES = ["Hey Nightjar", "Hey Nightjar.", "Hey, Nightjar", "hey nightjar"]
VOICES = ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_nova"]
SPEEDS = [0.9, 1.0, 1.1]


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/hey_nightjar_positives")
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for v in VOICES:
        for sp in SPEEDS:
            for i, phrase in enumerate(PHRASES):
                if n >= limit:
                    print(f"generated {n} positive clips in {out}")
                    return
                path = out / f"heynightjar_{v}_{sp}_{i}.wav"
                voice.speak(phrase, out_path=str(path), voice=v, speed=sp)
                n += 1
    print(f"generated {n} positive clips in {out}")


if __name__ == "__main__":
    main()
