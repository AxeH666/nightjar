#!/usr/bin/env python
"""Generate synthetic wake-word training samples with Kokoro-82M.

This replaces stages 1-2 of hey-buddy's `heybuddy train` (100k positives + 100k
adversarials via Piper TTS). Everything downstream of sample generation —
augmentation, reverb, embedding extraction, the three-stage trainer — is used
unchanged from the vendored fork.

WHY PIPER IS NOT USED (NJ-59, rule 5)
--------------------------------------
Both openWakeWord's recommended `piper-sample-generator` and hey-buddy's built-in
generator default to the same voice, and it is encumbered for our purpose. The
chain, each link read at its primary source:

  heybuddy/piper/pretrained.py -> `piper-libritts-en-r-medium.safetensors`
    (num_speakers=904, i.e. Piper's en_US-libritts_r-medium)
  rhasspy/piper-voices en/en_US/libritts_r/medium/MODEL_CARD:
    "Fine-tuned from English lessac medium on train-clean-360."
  en/en_US/lessac/medium/MODEL_CARD: trained from scratch on Lessac Blizzard 2013.
  Blizzard 2013 licence: "Research Purposes" ... "excludes ... developing,
    adapting, amending or otherwise using the Materials for any commercial
    purpose, including the development, marketing, commercialisation, sale or
    licencing of voice synthesis or speech recognition products or services".

That final clause names Nightjar's exact use case. Note that LibriTTS-R itself is
CC-BY-4.0 — the encumbrance is the lessac CHECKPOINT it was fine-tuned FROM, so
reading only the dataset licence would have missed it entirely.

Kokoro-82M is Apache-2.0, imposes no field-of-use or output restriction, and is
already in Nightjar's stack for TTS. Recorded fallback if its voice count proves
insufficient: a from-scratch LibriTTS voice (CC-BY-4.0, 2,456 speakers) — never
anything fine-tuned from lessac.

SYNTHETIC AND MULTI-SPEAKER, ALWAYS
------------------------------------
This is a product, not a personal tool. A model trained on one person's voice
recognises that person and fails for everyone else. There is deliberately NO code
path here that ingests recorded audio, and `check_speaker_diversity()` refuses to
generate a shippable corpus from too few distinct speakers. Both properties are
asserted by tests/test_wakeword_samples.py — if you find yourself removing either,
you are about to ship a model that only works for you.

Kokoro has 54 voices but only 28 English ones, well short of Piper's 904 speakers.
Two multipliers close most of that gap, mirroring what hey-buddy does with Piper's
speaker embeddings (`DEFAULT_TTS_SLERP_WEIGHTS`, `DEFAULT_TTS_LENGTH_SCALES`):

  * STYLE BLENDING — a Kokoro voice is a style tensor, and a weighted blend of two
    of them is a new, valid timbre. 28 voices -> 378 pairs x 3 blend weights.
  * SPEED VARIATION — several rates per identity, covering hurried and drawled
    speech.

Together that is ~4,500 distinct (timbre, rate) combinations before phrase
variants, which is the same order as the Piper pipeline it replaces.

Usage:
  python generate_samples.py positives  <out_dir> [count]
  python generate_samples.py adversarial <out_dir> [count]
"""
from __future__ import annotations

import itertools
import random
import sys
import wave
from pathlib import Path
from typing import Iterator, List, Sequence, Tuple

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from nightjar_capabilities import voice  # noqa: E402

# ── the phrase ───────────────────────────────────────────────────────────────
# The product wake phrase is "Hey June". (Until PR 5 this file still generated
# "Hey Nightjar" — the pre-rebrand name — so every sample it produced trained the
# wrong phrase.)
POSITIVE_PHRASES: Tuple[str, ...] = (
    "Hey June", "Hey June.", "Hey, June", "hey june", "Hey June!", "Hey June?",
)

# Phonetic near-misses. The classifier needs to learn where the phrase ENDS, not
# just where it starts, or it fires on anything beginning "hey j-". hey-buddy
# generates 250 of these; this seed list is expanded by `ADVERSARIAL_SUFFIXES`.
ADVERSARIAL_PHRASES: Tuple[str, ...] = (
    "Hey Jane", "Hey Joan", "Hey Dune", "Hey soon", "Hey moon", "Hey tune",
    "Hey Judy", "Hey Julie", "Hey Junior", "Hey jury", "Hey June's",
    "Hay June", "A June", "They dune", "Obey June", "Hey, you",
    "Hey there", "Hey Google", "Hey Siri", "Hey buddy",
    "In June", "Last June", "June", "Hey", "Hey Jude",
    "Hey Joon", "Hey chune", "Hey shoe", "Hey do", "Hey new",
)

# Real speech does not stop at the wake word; hey-buddy augments the phrase with
# common follow-ups so the model tolerates a continuing utterance.
FOLLOW_UPS: Tuple[str, ...] = (
    "", "", "", ", what's the weather", ", set a timer", ", open the browser",
    ", remind me later", " can you help", " play something", ", search for that",
)
ADVERSARIAL_SUFFIXES: Tuple[str, ...] = ("", " please", " now", " again", " today")

# ── speakers ─────────────────────────────────────────────────────────────────
# Kokoro's English voices: af_/am_ are American, bf_/bm_ are British; f/m is the
# voice's gender. The old generator used five af_* voices — all American, all
# female — which is exactly the single-demographic overfit this module exists to
# prevent. All 28 are used, and the mix is asserted by the tests.
ENGLISH_VOICES: Tuple[str, ...] = (
    "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore",
    "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael",
    "am_onyx", "am_puck", "am_santa",
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
)

# Non-native English accents. Kokoro's other-language voices still render English
# phonemes, with an accent — useful diversity for a general-purpose model, but
# lower quality, so they are opt-in via --accents rather than on by default.
ACCENT_VOICES: Tuple[str, ...] = (
    "ef_dora", "em_alex", "ff_siwis", "hf_alpha", "hm_omega",
    "if_sara", "im_nicola", "pf_dora", "pm_alex",
)

BLEND_WEIGHTS: Tuple[float, ...] = (0.25, 0.5, 0.75)
SPEEDS: Tuple[float, ...] = (0.8, 0.9, 1.0, 1.1, 1.25)

# Below this, the corpus is a speaker-overfit risk rather than a training set.
MIN_DISTINCT_SPEAKERS = 20

TARGET_SR = 16000   # the wake pipeline's rate; Kokoro synthesizes at 24 kHz


class SingleSpeakerError(RuntimeError):
    """Raised when a run would produce a corpus too narrow to generalise."""


def check_speaker_diversity(voices: Sequence[str]) -> None:
    """Refuse to generate a corpus that would overfit to one speaker or demographic.

    Deliberately a hard error, not a warning: a warning in a batch job scrolls past
    and the resulting model still gets shipped."""
    if len(set(voices)) < MIN_DISTINCT_SPEAKERS:
        raise SingleSpeakerError(
            f"only {len(set(voices))} distinct voice(s) selected; need at least "
            f"{MIN_DISTINCT_SPEAKERS}. A wake model trained on a narrow speaker set "
            f"recognises those speakers and fails for everyone else — see this "
            f"module's docstring. Never substitute recordings of one person."
        )
    genders = {v[1] for v in voices if len(v) > 1}
    accents = {v[0] for v in voices if v}
    if len(genders) < 2:
        raise SingleSpeakerError(
            f"all selected voices share one gender ({genders}); the corpus must span "
            f"both. This is the specific defect the pre-PR-5 generator shipped with."
        )
    if len(accents) < 2:
        raise SingleSpeakerError(
            f"all selected voices share one accent group ({accents}); include both "
            f"American (a*) and British (b*) voices at minimum."
        )


def blend_style(session, voice_a: str, voice_b: str, weight: float) -> np.ndarray:
    """Linear blend of two Kokoro style tensors -> a new synthetic speaker identity.

    Kokoro conditions on a style vector, so interpolating two of them yields a
    timbre between the two. This is what turns 28 voices into thousands of
    identities; it is the same trick hey-buddy applies to Piper's speaker
    embeddings via DEFAULT_TTS_SLERP_WEIGHTS.

    Linear rather than spherical: these are style vectors of similar magnitude, not
    unit-norm directions, so a linear mix stays in-distribution. (Verified by
    listening/scoring rather than assumed — see tests.)"""
    a = np.asarray(session.voices[voice_a], dtype=np.float32)
    b = np.asarray(session.voices[voice_b], dtype=np.float32)
    if a.shape != b.shape:
        raise ValueError(f"style shape mismatch: {voice_a}{a.shape} vs {voice_b}{b.shape}")
    return (1.0 - weight) * a + weight * b


def _resample_to_16k(samples: np.ndarray, src_sr: int) -> np.ndarray:
    """24 kHz float32 -> 16 kHz int16. The wake pipeline is 16 kHz-only, so writing
    Kokoro's native 24 kHz here would silently train on resampled-at-read audio."""
    if src_sr != TARGET_SR:
        ratio = TARGET_SR / src_sr
        idx = (np.arange(int(len(samples) * ratio)) / ratio).astype(np.int64)
        idx = np.clip(idx, 0, len(samples) - 1)
        samples = samples[idx]
    return (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)


def _write_wav(path: Path, pcm16: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TARGET_SR)
        w.writeframes(pcm16.tobytes())


def speaker_plan(voices: Sequence[str], rng: random.Random) -> Iterator[Tuple[str, str, float]]:
    """Endless stream of (voice_a, voice_b, blend_weight) speaker identities.

    Yields every pure voice first so a small run is still fully covered, then
    cycles blended pairs in a shuffled order so truncating at any count keeps the
    speaker mix broad rather than alphabetical."""
    for v in voices:
        yield v, v, 0.0
    pairs = [(a, b, w) for a, b in itertools.combinations(voices, 2) for w in BLEND_WEIGHTS]
    rng.shuffle(pairs)
    while True:
        for p in pairs:
            yield p


def generate(kind: str, out_dir: Path, count: int, voices: Sequence[str],
             seed: int = 0) -> int:
    """Write `count` clips of `kind` ('positives'|'adversarial') into out_dir."""
    if kind not in ("positives", "adversarial"):
        raise ValueError(f"kind must be 'positives' or 'adversarial', got {kind!r}")
    check_speaker_diversity(voices)

    rng = random.Random(seed)
    session = voice._get_kokoro()          # noqa: SLF001 — style blending needs the session
    out_dir.mkdir(parents=True, exist_ok=True)

    if kind == "positives":
        texts = [p + f for p in POSITIVE_PHRASES for f in FOLLOW_UPS]
    else:
        texts = [p + s for p in ADVERSARIAL_PHRASES for s in ADVERSARIAL_SUFFIXES]

    plan = speaker_plan(voices, rng)
    written = 0
    while written < count:
        va, vb, weight = next(plan)
        style = session.voices[va] if weight == 0.0 else blend_style(session, va, vb, weight)
        text = texts[written % len(texts)]
        speed = SPEEDS[written % len(SPEEDS)]

        phonemes, _ = session.g2p(text)
        parts = [session._create_audio(p, style, speed)      # noqa: SLF001
                 for p in session._split_phonemes(phonemes)]  # noqa: SLF001
        parts = [p for p in parts if len(p)]
        if not parts:
            raise RuntimeError(f"Kokoro produced no audio for {text!r} — G2P returned nothing")
        pcm16 = _resample_to_16k(np.concatenate(parts), 24000)

        tag = va if weight == 0.0 else f"{va}+{vb}@{weight}"
        _write_wav(out_dir / f"{kind}_{written:06d}_{tag}_{speed}.wav", pcm16)
        written += 1
        if written % 500 == 0:
            print(f"  {written}/{count}", flush=True)

    print(f"generated {written} {kind} clips in {out_dir} "
          f"({len(set(voices))} base voices, blends enabled)")
    return written


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    use_accents = "--accents" in sys.argv
    if not args:
        print(__doc__)
        return 2
    kind = args[0]
    out = Path(args[1]) if len(args) > 1 else Path("./wakeword_samples") / kind
    count = int(args[2]) if len(args) > 2 else 24

    voices = list(ENGLISH_VOICES) + (list(ACCENT_VOICES) if use_accents else [])
    try:
        generate(kind, out, count, voices)
    except SingleSpeakerError as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
