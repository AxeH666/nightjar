"""Grapheme-to-phoneme for Nightjar's Kokoro TTS — no GPL in the runtime graph.

Kokoro-82M (Apache-2.0) and kokoro-onnx (MIT) are both fine. The GPL came from
kokoro-onnx's *tokenizer*, which is mandatory in that package:

  * `kokoro_onnx.tokenizer` imports `phonemizer` (phonemizer-fork, GPL-3.0-or-later)
    and `espeakng_loader` (ships a compiled espeak-ng.dll with every license
    notice stripped) at module scope, and
  * `Tokenizer.__init__` calls `ctypes.cdll.LoadLibrary(<espeak dll>)`, while
    `Kokoro.__init__` constructs `Tokenizer` unconditionally.

So merely constructing `Kokoro` loaded a GPL binary in-process. Nightjar's
combined work is AGPL-3.0-or-later today (GPL-3.0 is compatible *into* AGPL-3.0,
so this was never a violation) — this module removes the GPL so the TTS path
does not block a future relicense.

The replacement is **misaki** (Apache-2.0), the reference G2P Kokoro was
actually trained with, which emits Kokoro's own phoneme alphabet directly. Its
espeak pieces are optional: `misaki.en` never imports `misaki.espeak`, and the
`EspeakFallback` is only built if you pass one. We pass our own instead.

Two Nightjar-specific pieces live here:

  1. `NightjarFallback` — misaki with `fallback=None` does NOT letter-spell
     unknown words. It emits `unk` ('\N{BLACK QUESTION MARK ORNAMENT}'), which is not in Kokoro's
     114-char table, so the tokenizer drops it and **the word vanishes from the
     audio** ("I searched Wikipedia for that" -> "I searched ... for that").
     This fallback closes that: a small curated lexicon, then letter-spelling
     using misaki's own letter-name phonemes so output stays inside Kokoro's
     alphabet by construction.

  2. `GOLD_OVERRIDES` — homographs misaki resolves to the wrong sense for a
     CAD assistant. 'fillet' is in its gold lexicon as the culinary
     "fi-LAY", so the fallback never fires for it; the gold entry must be
     overridden directly.

See KNOWN_ISSUES.md NJ-42 … NJ-46 for the residual hazards.
"""
from __future__ import annotations

import re
from typing import Optional

# spaCy model misaki's English G2P needs for POS tagging. Provisioned at install
# time by requirements.txt — see `build_g2p` for why we refuse to auto-download.
SPACY_MODEL = "en_core_web_sm"

UNK = "\N{BLACK QUESTION MARK ORNAMENT}"

# Homographs misaki resolves to the wrong sense for a mechanical-CAD assistant.
# Values are in Kokoro's alphabet (A=eI, I=aI, O=oU, W=aU, Y=OI; ' primary
# stress, , secondary).
GOLD_OVERRIDES = {
    "fillet": "fˈɪlət",       # CAD, not the culinary "fi-LAY"
    "fillets": "fˈɪləts",
    "filleted": "fˈɪlətəd",
}

# Proper nouns / jargon JUNE actually speaks that misaki's lexicon lacks.
# Deliberately small — this is Nightjar's own vocabulary, not a general dictionary.
CURATED = {
    "nightjar": "nˈItʤˌɑɹ",
    "june": "ʤˈun",
    "ollama": "Olˈɑmə",
    "kokoro": "kOkˈOɹO",
    "misaki": "mɪsˈɑki",
    "wikipedia": "wˌɪkɪpˈidiə",
    "qwen": "kwˈɛn",
    "onnx": "ˈɑnˌɛks",
    "opencode": "ˈOpənkˌOd",
    "electron": "ɪlˈɛktɹɑn",
    "toolpath": "tˈulpˌæθ",
    "von": "vˈɑn",
    "mises": "mˈizəz",
    "counterbore": "kˈWntəɹbˌɔɹ",
    "gusset": "ɡˈʌsət",
    "kerf": "kˈɜɹf",
    "brep": "bˈiɹˌɛp",
    "gearset": "ɡˈɪɹsˌɛt",
    "involute": "ˈɪnvəlˌut",
}


class NightjarFallback:
    """Stage-2 G2P fallback. Contains no GPL code.

    misaki's `G2P(fallback=...)` takes any callable `(MToken) -> (phonemes, rating)`;
    this is the same seam its GPL `EspeakFallback` plugs into. Rating follows
    misaki's convention: 4=gold, 3=silver, 2=fallback.
    """

    def __init__(self, lexicon, curated: Optional[dict] = None):
        # Letter-name phonemes come from misaki's own gold lexicon (Apache-2.0),
        # so anything we spell is guaranteed to be inside Kokoro's vocab.
        self._letters = {}
        for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
            ps = lexicon.golds.get(c)
            if isinstance(ps, dict):
                ps = ps.get("DEFAULT")
            self._letters[c] = ps
        self.curated = dict(CURATED)
        if curated:
            self.curated.update({k.lower(): v for k, v in curated.items()})
        # observability — wake_daemon logs these so real OOV shows up in the wild
        self.curated_hits: list[str] = []
        self.spelled: list[str] = []

    def _spell(self, word: str) -> Optional[str]:
        out = [self._letters.get(c.upper()) for c in word if c.isalpha()]
        out = [p for p in out if p]
        return " ".join(out) if out else None

    def __call__(self, token):
        text = (token.text or "").strip()
        if not text:
            return None, None
        key = re.sub(r"[^\w]", "", text).lower()
        if key in self.curated:
            self.curated_hits.append(text)
            return self.curated[key], 3
        ps = self._spell(text)
        if ps:
            self.spelled.append(text)
            return ps, 2
        return None, None


def build_g2p(british: bool = False):
    """Construct misaki's English G2P with Nightjar's non-GPL Stage-2 fallback.

    Raises if the spaCy model is missing rather than letting misaki reach for the
    network: `misaki/en.py` does `if not spacy.util.is_package(name):
    spacy.cli.download(name)`, which is a download-on-first-use — the same
    offline-posture violation already flagged for the gemma3 auto-pull. The
    model is provisioned at *install* time via requirements.txt.
    """
    import spacy

    if not spacy.util.is_package(SPACY_MODEL):
        raise RuntimeError(
            f"spaCy model {SPACY_MODEL!r} is not installed. Nightjar refuses to "
            "download it at runtime (offline-first posture). Install it with:\n"
            "  phase2-mcp/venv/Scripts/python -m pip install -r phase2-mcp/requirements.txt"
        )

    # Imported here, not at module scope: keeps the import graph explicit and
    # keeps `import nightjar_capabilities.tts_g2p` cheap for the CI guard.
    from misaki import en

    g2p = en.G2P(trf=False, british=british, fallback=None)
    g2p.fallback = NightjarFallback(g2p.lexicon)
    g2p.lexicon.golds.update(GOLD_OVERRIDES)
    return g2p
