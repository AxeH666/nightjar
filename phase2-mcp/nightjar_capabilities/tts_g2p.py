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
     This fallback closes that, in three stages: a small curated lexicon, then a
     re-query of misaki's own lexicon per clean fragment, then letter-spelling
     using misaki's own letter-name phonemes so output stays inside Kokoro's
     alphabet by construction.

     The middle stage exists because of NJ-82. A Stage-2 fallback does NOT only
     receive genuinely unknown words: misaki can only look up characters in
     `LEXICON_ORDS` (apostrophe, hyphen, A-Za-z -- `misaki/en.py:71`), so one
     out-of-alphabet character glued to a word by spaCy can make
     `Lexicon.__call__` return `(None, None)` and hand us the whole contaminated
     token. Spelling it unconditionally is how the historical reply containing
     `local-first` was spoken as L-O-C-A-L-F-I-R-S-T. The word was in the gold
     lexicon; only the glue hid it. Strip the glue, ask misaki again, and spell
     only what is still genuinely unresolvable.

  2. `GOLD_OVERRIDES` — homographs misaki resolves to the wrong sense for a
     CAD assistant. 'fillet' is in its gold lexicon as the culinary
     "fi-LAY", so the fallback never fires for it; the gold entry must be
     overridden directly.

See KNOWN_ISSUES.md NJ-42 … NJ-46 for the residual hazards.
"""
from __future__ import annotations

import re
import unicodedata
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

# Characters misaki's lexicon can look up (`misaki/en.py:71` LEXICON_ORDS):
# apostrophe, hyphen, A-Z, a-z. Other runs are token glue, not part of a word.
_GLUE_RE = re.compile(r"[^'\-A-Za-z]+")

# Each bucket lives for the daemon lifetime. Keep it bounded even if a caller
# fails to drain it after a turn (NJ-86).
_OBS_CAP = 200

# The only single letters that are also English words. Any other one-character
# fragment that reaches this fallback is emitted as a letter name, not a word.
_ONE_LETTER_WORDS = frozenset({"a", "i"})


class NightjarFallback:
    """Stage-2 G2P fallback. Contains no GPL code.

    misaki's `G2P(fallback=...)` takes any callable `(MToken) -> (phonemes, rating)`;
    this is the same seam its GPL `EspeakFallback` plugs into. Rating follows
    misaki's convention: 4=gold, 3=silver, 2=fallback.

    Three stages, in order: curated lexicon -> re-query misaki per clean
    fragment -> letter-spell. See the module docstring for why the middle stage
    is load-bearing (NJ-82).
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
        # Kept for the stage-2 re-query. The targeted regression test pins the
        # vendored API signature so an upstream change fails visibly.
        self._lexicon = lexicon
        # Per-turn observability consumed through drain() (NJ-86).
        self.curated_hits: list[str] = []
        self.recovered: list[str] = []
        self.spelled: list[str] = []
        self.lexicon_errors: list[str] = []
        self._ctx_cls = None

    def _note(self, bucket: list, item: str) -> None:
        bucket.append(item)
        if len(bucket) > _OBS_CAP:
            del bucket[:-_OBS_CAP]

    def drain(self) -> dict:
        """Pop and return bounded per-turn G2P classification details."""
        out = {
            "curated_hits": list(self.curated_hits),
            "recovered": list(self.recovered),
            "spelled": list(self.spelled),
            "lexicon_errors": list(self.lexicon_errors),
        }
        for bucket in (
            self.curated_hits,
            self.recovered,
            self.spelled,
            self.lexicon_errors,
        ):
            bucket.clear()
        return out

    def _context(self):
        """Return a neutral TokenContext for a fallback re-query.

        A Stage-2 fallback cannot see the following token, so
        `future_vowel=None` is the honest value. Importing lazily keeps the
        module-level graph free of misaki.
        """
        if self._ctx_cls is None:
            from misaki.en import TokenContext

            self._ctx_cls = TokenContext
        return self._ctx_cls()

    def _spell(self, word: str) -> Optional[str]:
        out = [self._letters.get(c.upper()) for c in word if c.isalpha()]
        out = [p for p in out if p]
        return " ".join(out) if out else None

    def _lookup(self, frag: str, tag: Optional[str], ctx):
        """Return `(phonemes, from_curated)` for one clean fragment."""
        key = frag.lower()
        if key in self.curated:
            return self.curated[key], True
        # The original tag belongs to the contaminated token and can be wrong.
        # Keep all-caps fragments on misaki's initialism path instead of reading
        # e.g. LED as the past tense of lead.
        if len(frag) > 1 and frag.isupper():
            tag = "NNP"
        try:
            ps, _ = self._lexicon.get_word(frag, tag, None, ctx)
            return ps, False
        except Exception as exc:  # noqa: BLE001 -- TTS must degrade visibly
            self._note(
                self.lexicon_errors,
                f"{frag}: {type(exc).__name__}: {exc}",
            )
            return None, False

    def _resolve(self, text: str, tag: Optional[str]):
        """Strip token glue, re-query clean fragments, then spell real OOV."""
        # Replay the normalization Lexicon.__call__ performs before lookup.
        text = unicodedata.normalize("NFKC", text)
        text = text.replace("‘", "'").replace("’", "'")
        fragments = [fragment.strip("'-") for fragment in _GLUE_RE.split(text)]
        fragments = [fragment for fragment in fragments if fragment]
        if not fragments:
            return None, False

        ctx = self._context()
        out: list[str] = []
        spelled_any = False
        for fragment in fragments:
            phonemes, from_curated = self._lookup(fragment, tag, ctx)
            if phonemes:
                if (
                    len(fragment) == 1
                    and fragment.lower() not in _ONE_LETTER_WORDS
                ):
                    self._note(self.spelled, fragment)
                    spelled_any = True
                else:
                    bucket = self.curated_hits if from_curated else self.recovered
                    self._note(bucket, fragment)
                out.append(phonemes)
                continue

            # Hyphen is valid in misaki's alphabet, but many compounds have no
            # whole-word entry. Preserve known whole-compound readings by only
            # retrying the parts after the whole lookup fails.
            if "-" in fragment:
                parts = [part for part in fragment.split("-") if part]
                resolved = [self._lookup(part, tag, ctx) for part in parts]
                if any(part_phonemes for part_phonemes, _ in resolved):
                    for part, (part_phonemes, part_curated) in zip(parts, resolved):
                        if part_phonemes:
                            if len(part) == 1 and part.lower() not in _ONE_LETTER_WORDS:
                                self._note(self.spelled, part)
                                spelled_any = True
                            else:
                                bucket = (
                                    self.curated_hits
                                    if part_curated
                                    else self.recovered
                                )
                                self._note(bucket, part)
                            out.append(part_phonemes)
                            continue
                        spelled = self._spell(part)
                        if spelled:
                            self._note(self.spelled, part)
                            out.append(spelled)
                            spelled_any = True
                    continue

            spelled = self._spell(fragment)
            if spelled:
                self._note(self.spelled, fragment)
                out.append(spelled)
                spelled_any = True

        if not out:
            return None, False
        return " ".join(out), spelled_any

    def __call__(self, token):
        text = (token.text or "").strip()
        if not text:
            return None, None
        key = re.sub(r"[^\w]", "", text).lower()
        if key in self.curated:
            self._note(self.curated_hits, text)
            return self.curated[key], 3
        ps, spelled_any = self._resolve(text, getattr(token, "tag", None))
        if ps:
            # 2 = fallback (something was spelled), 3 = recovered known words.
            return ps, 2 if spelled_any else 3
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
    # NJ-87: Misaki routes unknown all-caps words through its initialism
    # speller before our fallback runs. Promote only jargon that has no native
    # gold or silver entry so its curated pronunciation is stable across case
    # without changing real initialisms or overriding Misaki's known words.
    g2p.lexicon.golds.update(
        {
            word: phonemes
            for word, phonemes in CURATED.items()
            if word not in g2p.lexicon.golds
            and word not in g2p.lexicon.silvers
        }
    )
    g2p.lexicon.golds.update(GOLD_OVERRIDES)
    return g2p
