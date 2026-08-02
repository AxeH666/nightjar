#!/usr/bin/env python3
"""Venv-wide copyleft guard: no GPL/AGPL may enter phase2-mcp's runtime graph.

Why this exists: #139 removed the GPL G2P stack (phonemizer-fork GPL-3.0 +
espeakng-loader's stripped espeak-ng binary), but its guard (test_tts_no_gpl.py)
only covers the TTS path. A copyleft package arriving through any OTHER pin —
the canonical near-miss being trafilatura, GPLv3+ before v1.8.0 and Apache-2.0
only from v1.8.0 — would have sailed past it. This test sweeps EVERY installed
distribution. Its very first run caught phonemizer-fork + espeakng-loader still
physically installed in the dev venv (dropped from requirements in #139, but
pip never removes on requirement removal — the setup-script purge only covers
managed installs).

Rule 5 discipline: classification reads the ACTUAL license file text shipped by
each distribution (found via its RECORD, so files inside the package directory
count too) — never the METADATA `License:` field, never classifiers. Metadata
is exactly what lied for espeakng-loader, and what a pre-1.8 trafilatura's
classifier would launder.

Classification notes, each earned from a real false/true positive in this venv:
  * GPL-family requires the license TITLE **and** the FSF "verbatim copies"
    preamble. Title alone flags prose that merely mentions the GPL
    (typing_extensions' PSF history text, pywin32's bundled IDLE notes).
  * A full GPL text accompanied by "GCC RUNTIME LIBRARY EXCEPTION" in the same
    file is the bundled GCC runtime (libgfortran/libquadmath in numpy/scipy
    wheels). The exception exists precisely to permit unrestricted
    redistribution — acceptable by rule, not by allowlist.
  * A distribution shipping NO license file at all is a HARD FAIL unless
    allowlisted with recorded reasoning — the espeakng-loader failure mode.
  * The allowlist is verdict-scoped: an entry tolerates ONLY its recorded
    verdicts, so if e.g. certifi (tolerated: MPL) ever ships GPL, it still fails.

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_no_copyleft_venv.py
"""
from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# ---------------------------------------------------------------- policy

FSF_PREAMBLE = "EVERYONE IS PERMITTED TO COPY AND DISTRIBUTE VERBATIM COPIES"
GCC_EXCEPTION = "GCC RUNTIME LIBRARY EXCEPTION"

# (title phrase, verdict) — AFFERO before LESSER before GENERAL: the longer
# titles contain the shorter ones as substrings of their own prose.
GPL_TITLES = [
    ("GNU AFFERO GENERAL PUBLIC LICENSE", "AGPL"),
    ("GNU LESSER GENERAL PUBLIC", "LGPL"),
    ("GNU LIBRARY GENERAL PUBLIC", "LGPL"),
    ("GNU GENERAL PUBLIC LICENSE", "GPL"),
]
WEAK_TITLES = [
    ("MOZILLA PUBLIC LICENSE", "MPL"),
    ("ECLIPSE PUBLIC LICENSE", "EPL"),
]

# "unreadable" is fatal too (Bugbot): a license file we cannot read could be the
# GPL one — an unreadable notice must fail exactly like a missing one, not pass.
FATAL_VERDICTS = {"AGPL", "GPL", "LGPL", "MPL", "EPL", "no-file", "unreadable"}

# Packaging tooling lives in every venv and is not part of Nightjar's runtime
# graph (never imported, never shipped as a Nightjar capability). pip in
# particular vendors third-party license texts that belong to pip, not to us.
TOOLING = {"pip", "setuptools", "wheel", "pkg_resources"}

# name (normalized) -> (tolerated verdicts, recorded reasoning)
# An allowlisted package failing OUTSIDE its tolerated verdicts still fails.
ALLOWLIST: dict[str, tuple[set[str], str]] = {
    # LGPL-2.1 confirmed by reading its COPYING. Maintainer decision 2026-08-02
    # (NJ-42): KEEP — pure Python, dynamically imported, trivially replaceable,
    # so LGPL §5-conformant even in a proprietary distribution. Replacing it
    # means ~150 lines plus a permanent patch against misaki.
    "num2words": ({"LGPL"}, "NJ-42 maintainer decision: keep (LGPL-2.1, replaceable)"),
    # Ships NO license file — only `License: MIT` metadata. Resolved via its
    # CycloneDX SBOM (dist-info/sboms/): 236 statically-linked Rust components,
    # all MIT/Apache-2.0/BSD/ISC/Zlib/Unicode-3.0/0BSD, zero copyleft. NJ-52.
    "primp": ({"no-file"}, "NJ-52: SBOM audited — 0 copyleft in 236 components"),
    # MPL-2.0 (real, from its LICENSE). File-level copyleft on certifi's own
    # files only; unmodified redistribution imposes nothing on the app.
    # Ubiquitous (requests/httpx hard-depend on it).
    "certifi": ({"MPL"}, "MPL-2.0, unmodified redistribution — file-level terms only"),
    # Dual MPL-2.0 + MIT (its LICENCE embeds both; the MPL part covers a subset
    # of files). Same file-level reasoning as certifi.
    "tqdm": ({"MPL"}, "dual MPL-2.0/MIT, unmodified — file-level terms only"),
    # pywin32 is PSF-licensed; its wheel BUNDLES adodbapi (LGPL-2.1, real —
    # licenses/adodbapi/license.txt carries the full text + preamble). Nightjar
    # never imports adodbapi. LGPL + dynamic import = shippable (NJ-42 rationale).
    "pywin32": ({"LGPL"}, "bundled adodbapi is LGPL-2.1; unused by Nightjar; NJ-53"),
    # REAL finding (NJ-53): the wheel redistributes FFmpeg binaries (LGPL) in
    # cv2/ — LICENSE-3RD-PARTY.txt says so explicitly. Dynamically-linked DLLs,
    # replaceable by the user, so LGPL-conformant to ship; recorded for any
    # future strict-relicense review.
    "opencv_python_headless": ({"LGPL"}, "bundles FFmpeg (LGPL) DLLs; dynamically linked; NJ-53"),
    # Wheels that ship no license file anywhere (metadata-only claims). Upstream
    # repos are the authoritative source: huggingface/tokenizers (Apache-2.0),
    # google/flatbuffers (Apache-2.0), OpenNMT/CTranslate2 (MIT). Same packaging
    # gap as primp, without an SBOM to close it — recorded in NJ-53.
    "tokenizers": ({"no-file"}, "wheel omits LICENSE; upstream huggingface/tokenizers is Apache-2.0 (NJ-53)"),
    "flatbuffers": ({"no-file"}, "wheel omits LICENSE; upstream google/flatbuffers is Apache-2.0 (NJ-53)"),
    "ctranslate2": ({"no-file"}, "wheel omits LICENSE; upstream OpenNMT/CTranslate2 is MIT (NJ-53)"),
    # playwright/driver/LICENSE is Node.js's AGGREGATE license file. Its GPL
    # sections (verified by reading the context around each) are autoconf build
    # macros — "File: aclocal.m4 (only for ICU4C) / pkg.m4" — carrying the
    # Autoconf special exception, whose condition ICU4C's own note confirms is
    # met. Build-time tooling notices inside an aggregate, not runtime code.
    "playwright": ({"GPL"}, "Node driver aggregate: GPL = pkg.m4 autoconf macros w/ Autoconf exception (NJ-53)"),
    # REAL finding (NJ-53): python-soundfile (BSD) ships libsndfile_x64.dll —
    # LGPL-2.1, full text in _soundfile_data/COPYING. Loaded via ctypes at
    # runtime (dynamic linking), so LGPL-conformant to ship; replaceable DLL.
    "soundfile": ({"LGPL"}, "bundles libsndfile DLL (LGPL-2.1); ctypes-loaded, replaceable (NJ-53)"),
}

LICENSE_NAME_RE = re.compile(r"licen[cs]e|copying|copyright|notice", re.I)


def classify(text: str) -> str:
    t = text.upper()
    for phrase, verdict in GPL_TITLES:
        if phrase in t:
            # Order matters (Bugbot): the preamble check comes FIRST. Without it
            # the exception string could wave through a file that only mentions
            # GPL in prose — and, worse, the exception must only ever downgrade
            # a REAL license text, never substitute for the preamble test.
            if FSF_PREAMBLE not in t:
                return "gpl-mention-only"  # prose reference, not the license itself
            if GCC_EXCEPTION in t:
                # Residual granularity limit, stated: classification is per-file,
                # so an aggregate containing real GPL text for component A and a
                # GCC-exception notice for component B would still be excepted
                # here. No such file exists in this venv (numpy/scipy's files
                # attach the exception to their only GPL text, libgfortran's);
                # if one appears, the allowlist — not this rule — is the tool.
                return "GPL-with-GCC-runtime-exception"
            return verdict
    for phrase, verdict in WEAK_TITLES:
        if phrase in t:
            return verdict
    if "APACHE LICENSE" in t:
        return "Apache-2.0"
    if "PERMISSION IS HEREBY GRANTED, FREE OF CHARGE" in t:
        return "MIT-style"
    if "REDISTRIBUTION AND USE IN SOURCE AND BINARY FORMS" in t:
        return "BSD-style"
    if "PYTHON SOFTWARE FOUNDATION" in t or "PSF LICENSE" in t:
        return "PSF"
    if "THE UNLICENSE" in t or "PUBLIC DOMAIN" in t:
        return "permissive"
    return "unrecognized"


def dist_name(dist_info: Path) -> str:
    return re.split(r"-\d", dist_info.name)[0].lower().replace("-", "_")


def license_files(dist_info: Path, site_packages: Path) -> list[Path]:
    """Every license-ish file the distribution installed, per its RECORD —
    catches wheels (onnxruntime) that put LICENSE inside the package dir
    rather than dist-info."""
    out = [f for f in dist_info.rglob("*")
           if f.is_file() and LICENSE_NAME_RE.search(f.name)
           and f.suffix.lower() != ".json"
           and f.name not in ("RECORD", "METADATA", "WHEEL", "INSTALLER", "REQUESTED")]
    record = dist_info / "RECORD"
    if record.exists():
        for line in record.read_text(encoding="utf-8", errors="replace").splitlines():
            rel = line.split(",")[0]
            base = rel.rsplit("/", 1)[-1]
            if LICENSE_NAME_RE.search(base) and not base.endswith((".py", ".pyc", ".json", ".h", ".c")):
                p = (site_packages / rel).resolve()
                try:
                    inside = p.is_file() and p.relative_to(site_packages.resolve())
                except ValueError:
                    inside = False  # RECORD can point outside site-packages (scripts/) — skip
                if inside and p not in out:
                    out.append(p)
    return out


def scan(site_packages: Path) -> dict:
    report: dict = {}
    for d in sorted(site_packages.glob("*.dist-info")):
        name = dist_name(d)
        if name in TOOLING:
            continue
        verdicts = []
        for f in license_files(d, site_packages):
            try:
                rel = str(f.relative_to(site_packages))
            except ValueError:
                rel = f.name
            try:
                verdicts.append((rel, classify(f.read_text(encoding="utf-8", errors="replace"))))
            except OSError:
                verdicts.append((rel, "unreadable"))
        hit = {v for _, v in verdicts} & FATAL_VERDICTS
        if not verdicts:
            hit.add("no-file")
        tolerated, why = ALLOWLIST.get(name, (set(), ""))
        fatal = sorted(hit - tolerated)
        report[name] = {"files": verdicts, "fatal": fatal,
                        "allowlisted": name in ALLOWLIST, "why": why}
    return report


# ---------------------------------------------------------------- main

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        FAILS.append(label)


def main() -> int:
    sp = Path(sys.prefix) / "Lib" / "site-packages"
    if not sp.exists():
        cands = list((Path(sys.prefix) / "lib").glob("python*/site-packages"))
        sp = cands[0] if cands else sp
    print(f"== sweeping {sp} ==")
    report = scan(sp)
    print(f"   {len(report)} distributions (tooling excluded: {sorted(TOOLING)})")

    print("\n== 1. no unallowlisted copyleft / missing-license distributions ==")
    bad = {n: r for n, r in report.items() if r["fatal"]}
    for n, r in sorted(bad.items()):
        detail = "; ".join(f"{v}" for v in r["fatal"])
        srcs = [p for p, v in r["files"] if v in r["fatal"]] or ["(no license file shipped)"]
        print(f"  [FAIL] {n}: {detail}  <- {srcs[0]}")
        FAILS.append(f"{n}: {detail}")
    if not bad:
        print("  [PASS] every distribution is permissive, rule-acceptable, or explicitly allowlisted")

    print("\n== 2. allowlist sanity ==")
    for name, (tolerated, why) in sorted(ALLOWLIST.items()):
        if name not in report:
            print(f"  [stale] {name}: not installed — prune this entry when convenient")
            continue
        print(f"  [noted] {name}: tolerates {sorted(tolerated)} — {why}")
    if "num2words" in report:
        check("num2words is still LGPL (a license CHANGE would need NJ-42 re-review)",
              any(v == "LGPL" for _, v in report["num2words"]["files"]),
              str(report["num2words"]["files"]))

    print("\n== 3. negative controls: the guard actually fails on the bad cases ==")
    with tempfile.TemporaryDirectory(prefix="copyleft-negctl-") as td:
        fake_sp = Path(td)
        # (a) pre-1.8 trafilatura: real GPL-3.0 text, lying Apache classifier
        di = fake_sp / "trafilatura-1.6.2.dist-info"
        di.mkdir()
        (di / "LICENSE").write_text(
            "                    GNU GENERAL PUBLIC LICENSE\n"
            "                       Version 3, 29 June 2007\n\n"
            " Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>\n"
            " Everyone is permitted to copy and distribute verbatim copies\n"
            " of this license document, but changing it is not allowed.\n",
            encoding="utf-8")
        (di / "METADATA").write_text(
            "Metadata-Version: 2.1\nName: trafilatura\nVersion: 1.6.2\n"
            "Classifier: License :: OSI Approved :: Apache Software License\n",
            encoding="utf-8")
        # (b) the espeakng-loader failure mode: nothing shipped at all
        di2 = fake_sp / "espeakng_loader-0.2.4.dist-info"
        di2.mkdir()
        (di2 / "METADATA").write_text("Metadata-Version: 2.1\nName: espeakng-loader\n", encoding="utf-8")
        # (c) prose mention must NOT trip it
        di3 = fake_sp / "prose_mention-1.0.dist-info"
        di3.mkdir()
        (di3 / "LICENSE").write_text(
            "MIT License. Permission is hereby granted, free of charge... Note: earlier\n"
            "releases were distributed under the GNU General Public License (GPL).\n",
            encoding="utf-8")
        # (d) Bugbot: the GCC-exception string must NOT rescue a file that lacks
        # the FSF preamble — that is a prose mention, and stays one.
        di4 = fake_sp / "exception_prose-1.0.dist-info"
        di4.mkdir()
        (di4 / "LICENSE").write_text(
            "This bundle references the GNU General Public License and the\n"
            "GCC RUNTIME LIBRARY EXCEPTION in passing, but contains no license text.\n",
            encoding="utf-8")
        neg = scan(fake_sp)
        check("pre-1.8 trafilatura flagged as GPL despite lying metadata",
              "GPL" in neg["trafilatura"]["fatal"], str(neg["trafilatura"]["fatal"]))
        check("no-license-file package fails loudly",
              "no-file" in neg["espeakng_loader"]["fatal"], str(neg["espeakng_loader"]["fatal"]))
        check("a prose GPL mention does NOT false-positive",
              not neg["prose_mention"]["fatal"], str(neg["prose_mention"]["fatal"]))
        check("GCC-exception string cannot rescue a preamble-less mention",
              not neg["exception_prose"]["fatal"]
              and neg["exception_prose"]["files"][0][1] == "gpl-mention-only",
              str(neg["exception_prose"]["files"]))

        # (e) Bugbot: an UNREADABLE license file must fail like a missing one.
        # Windows mandatory file locks make the read raise; on other platforms
        # this control degrades to a stated skip rather than a fake pass.
        di5 = fake_sp / "locked_license-1.0.dist-info"
        di5.mkdir()
        lf = di5 / "LICENSE"
        lf.write_text("could be anything — the point is it cannot be read\n", encoding="utf-8")
        locked = False
        try:
            import msvcrt
            fh = open(lf, "r+")
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            locked = True
        except (ImportError, OSError):
            fh = None
        if locked:
            try:
                neg5 = scan(fake_sp)
                check("an unreadable license file is fatal, not a silent pass",
                      "unreadable" in neg5["locked_license"]["fatal"],
                      str(neg5["locked_license"]))
            finally:
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
                fh.close()
        else:
            print("  [skip] unreadable-file control needs Windows mandatory locks (not available here)")

    print("\n== 4. installed-license census ==")
    from collections import Counter
    counts: Counter = Counter()
    for n, r in report.items():
        vs = {v for _, v in r["files"]}
        if r["allowlisted"]:
            counts["ALLOWLISTED"] += 1
        elif vs & {"AGPL", "GPL", "LGPL", "MPL", "EPL"}:
            counts[next(iter(vs & {"AGPL", "GPL", "LGPL", "MPL", "EPL"}))] += 1
        else:
            counts["/".join(sorted(vs)) if vs else "no-file"] += 1
    for k, c in counts.most_common():
        print(f"   {c:4d}  {k}")

    print("\n" + ("FAILED: " + "; ".join(FAILS[:10]) if FAILS else "ALL CHECKS PASSED"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
