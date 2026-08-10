#!/usr/bin/env python3
"""Regression guard for NJ-82 G2P recovery and NJ-86 counters.

This drives the real Misaki G2P path with the historical failing reply and
representative contaminated tokens. It does not synthesize or play audio. Exact
reply text and raw fragment names remain inside this isolated test output; the
normal JUNE logging path receives counts and bounded codepoint metadata only.

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_tts_spellout.py
"""
import importlib.util
import inspect
import io
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.stdout = io.TextIOWrapper(
    sys.stdout.buffer,
    encoding="utf-8",
    errors="replace",
)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILS.append(label)


if not (importlib.util.find_spec("misaki") and importlib.util.find_spec("spacy")):
    print("BLOCKED: misaki/spacy not installed")
    sys.exit(2)

import spacy  # noqa: E402

from nightjar_capabilities.tts_g2p import (  # noqa: E402
    CURATED,
    NightjarFallback,
    build_g2p,
)

if not spacy.util.is_package("en_core_web_sm"):
    print("BLOCKED: spaCy model en_core_web_sm not installed")
    sys.exit(2)

g2p = build_g2p()
fallback = g2p.fallback


def phonemize(text: str):
    """Return phonemes and freshly drained fallback details for one call."""
    fallback.drain()
    phonemes, _ = g2p(text)
    return phonemes, fallback.drain()


print("== 1. historical reply that reproduced NJ-82 ==")
REAL_REPLY = (
    "I’m Nightjar, your offline, local‑first AI assistant. "
    "How can I help you today?"
)
phonemes, stats = phonemize(REAL_REPLY)
check("nothing letter-spelled", not stats.get("spelled"), str(stats.get("spelled")))
check("'local' pronounced", "lˈOkəl" in phonemes, repr(phonemes))
check("'first' pronounced", "fˈɜɹst" in phonemes)
check("'nightjar' pronounced", "nˈItʤˌɑɹ" in phonemes)
check(
    "recovery stage handled local",
    "local" in stats.get("recovered", []),
    str(stats),
)

print("\n== 2. contamination classes that reach the fallback ==")
CONTAMINATED = [
    ("U+2011 non-breaking hyphen", "a local‑first tool", "lˈOkəl"),
    ("U+00A0 non-breaking space", "Nightjar is here.", "nˈItʤˌɑɹ"),
    ("doubled space", "Okay!  Was that helpful?", "wʌz"),
    ("markdown emphasis", "It **was** here.", "wʌz"),
    ("markdown code span", "the `value` is set", "vˈælju"),
    ("U+2014 em dash", "Nightjar—the assistant", "nˈItʤˌɑɹ"),
]
for label, text, expected in CONTAMINATED:
    phonemes, stats = phonemize(text)
    check(
        f"{label}: not spelled",
        not stats.get("spelled"),
        f"{text!r} -> {phonemes!r} spelled={stats.get('spelled')}",
    )
    check(f"{label}: correct phonemes", expected in phonemes, repr(phonemes))

print("\n== 2b. ASCII-hyphenated compounds ==")
for text, expected in [
    ("Nightjar is local-first and fast.", "lˈOkəl fˈɜɹst"),
    ("*local-first*", "lˈOkəl fˈɜɹst"),
    ("**offline-first** by design", "ˌɔflˈIn fˈɜɹst"),
    ("a well-known fact", "wˈɛl nˈOn"),
]:
    phonemes, stats = phonemize(text)
    check(
        f"{text[:26]!r}: not spelled",
        not stats.get("spelled"),
        f"{phonemes!r} spelled={stats.get('spelled')}",
    )
    check(f"{text[:26]!r}: correct phonemes", expected in phonemes, repr(phonemes))

phonemes, _ = phonemize("a read-only thing")
check("'read-only' keeps its whole-compound reading", "ɹˈidˌOnli" in phonemes, repr(phonemes))
check("'read-only' is not 'RED only'", "ɹˈɛd" not in phonemes, repr(phonemes))

phonemes, stats = phonemize("a gpu-bound task")
check("'gpu-bound' spells only its unknown half", stats.get("spelled") == ["gpu"], str(stats))
check("'bound' is pronounced", "bˈWnd" in phonemes, repr(phonemes))

print("\n== 2c. curly apostrophes ==")
for text, expected, forbidden in [
    ("I’m Nightjar.", "ˌIm", "ˈI ˈɛm"),
    ("Let’s run the tests.", "lˈɛts", "lˈɛt ˈɛs"),
    ("the users’ files", "jˈuzəɹz", None),
]:
    phonemes, stats = phonemize(text)
    check(f"{text[:16]!r}: contraction intact", expected in phonemes, repr(phonemes))
    if forbidden:
        check(f"{text[:16]!r}: not spelled apart", forbidden not in phonemes, repr(phonemes))
    check(f"{text[:16]!r}: nothing spelled", not stats.get("spelled"), str(stats))

print("\n== 2d. contaminated all-caps fragments keep letter-name readings ==")
for text, expected in [
    ("a **LED** here", "ˌɛlˌidˈi"),
    ("**RIP** is fine", "ˌɑɹˌIpˈi"),
]:
    phonemes, _ = phonemize(text)
    check(f"{text!r} keeps its initialism reading", expected in phonemes, repr(phonemes))

print("\n== 3. genuine OOV still letter-spells ==")
for word in ["gpu", "usb", "npm", "cron", "kubectl", "hdmi", "zorblatt"]:
    _, stats = phonemize(f"the {word} thing")
    check(f"{word!r} still spelled", word in stats.get("spelled", []), str(stats))

print("\n== 4. neutral fallback context does not spell function words ==")
# A fallback cannot see the following token, so this checks that its neutral
# TokenContext returns phonemes without claiming contextual-prosody equivalence.
for text, word, expected in [
    ("The  build  was  broken  and  the  test  failed.", "the", "ðə"),
    ("go  to  the  store", "to", "tu"),
    ("a  well‑known  fact", "a", "ɐ"),
]:
    phonemes, stats = phonemize(text)
    check(
        f"{word!r} not spelled",
        word not in [item.lower() for item in stats.get("spelled", [])],
        f"{phonemes!r} spelled={stats.get('spelled')}",
    )
    check(f"{word!r} resolves", expected in phonemes, repr(phonemes))
    check(
        f"{word!r}: no lexicon error swallowed",
        not stats.get("lexicon_errors"),
        str(stats.get("lexicon_errors")),
    )

print("\n== 5. vendored API pins ==")
lexicon = g2p.lexicon
check("Lexicon.get_word exists", callable(getattr(lexicon, "get_word", None)))
if callable(getattr(lexicon, "get_word", None)):
    parameters = list(inspect.signature(lexicon.get_word).parameters)
    check(
        "get_word(word, tag, stress, ctx)",
        parameters[:4] == ["word", "tag", "stress", "ctx"],
        str(parameters),
    )
try:
    from misaki.en import TokenContext

    check("TokenContext importable", True)
    check(
        "TokenContext().future_vowel defaults to None",
        TokenContext().future_vowel is None,
    )
except Exception as exc:  # noqa: BLE001
    check("TokenContext importable", False, str(exc))

print("\n== 6. observability contract (NJ-86) ==")
check("drain() exists", callable(getattr(fallback, "drain", None)))
_, stats = phonemize("Nightjar s test")
check(
    "one-character remnant is SPELLED, not recovered",
    "s" in stats.get("spelled", []),
    str(stats),
)
_, stats = phonemize("*Nightjar-s*")
check(
    "one-character hyphen part is SPELLED, not recovered",
    stats.get("spelled") == ["s"],
    str(stats),
)
_, stats = phonemize("s ")
check(
    "single fallback remnant is SPELLED, not recovered",
    "s" in stats.get("spelled", []),
    str(stats),
)
_, stats = phonemize("a test")
check("'a' is not misreported as spelled", not stats.get("spelled"), str(stats))
_, stats = phonemize("hello there")
check("drain() resets between turns", not any(stats.values()), str(stats))
for _ in range(400):
    fallback._note(fallback.spelled, "x")
check("observability lists are bounded", len(fallback.spelled) <= 200, str(len(fallback.spelled)))
fallback.drain()

print("\n== 7. curated table sanity ==")
check("'nightjar' is covered", "nightjar" in CURATED)
check("'june' is covered", "june" in CURATED)
phonemes, stats = phonemize("Nightjar and June")
check(
    "both pronounce without fallback spelling",
    not stats.get("spelled"),
    f"{phonemes!r} {stats}",
)

print("\n== 8. standalone fallback contract ==")
standalone = NightjarFallback(g2p.lexicon)
check("lexicon retained", standalone._lexicon is g2p.lexicon)
check(
    "drain() shape",
    set(standalone.drain())
    == {"curated_hits", "recovered", "spelled", "lexicon_errors"},
)

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
