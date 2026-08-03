#!/usr/bin/env python
"""Mirror the wake-word training artifacts to Nightjar-controlled storage.

WHY: the brief for the hey-buddy move (voice-phase PR 5) is to SELF-HOST every
model artifact and training dataset — no hot-linking a ~44-star single-maintainer
project's HuggingFace repos from the training pipeline. The small ONNX artifacts
are vendored in-repo (nightjar_capabilities/models/wakeword/, sha256-pinned in
model_licenses.json). The datasets are up to 72 GB and need real object storage,
which does not exist yet — so this script is the bridge:

  plan   : enumerate every file of every source repo (name, size, sha/etag) and
           write mirror_manifest.json — the exact bill of materials to copy.
  fetch  : download everything into a local staging directory, verifying sizes.
  verify : re-walk a staging directory or mirror against the manifest.

When a storage target exists (S3/R2/HF org — maintainer decision, deliberately
not hardcoded here), `fetch` + your uploader of choice + `verify` completes the
job; the manifest is the durable record either way.

Licence gate: refuses to plan/fetch any repo that is not commercial-clean in
phase2-mcp/model_licenses.json — so the UNVERIFIED mit-impulse-response entry
blocks its own mirror until someone reads its terms (rule 5), rather than the
copy quietly implying approval.

Uses only requests + the HF public API (no huggingface_hub dependency): the
training box that runs this has hf installed, but the manifest planning must be
runnable from the plain phase2-mcp venv too.

Usage (from phase2-mcp/):
  venv/Scripts/python wakeword_training/mirror_datasets.py plan
  venv/Scripts/python wakeword_training/mirror_datasets.py fetch  <staging_dir> [repo_id]
  venv/Scripts/python wakeword_training/mirror_datasets.py verify <staging_dir>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import requests

HERE = Path(__file__).resolve().parent
PHASE2 = HERE.parent
MANIFEST_PATH = HERE / "mirror_manifest.json"
LICENSES = json.loads((PHASE2 / "model_licenses.json").read_text(encoding="utf-8"))

# Everything the training pipeline reads from the network, keyed by HF repo.
SOURCES: List[Dict[str, str]] = [
    {"repo": "benjamin-paine/hey-buddy", "type": "dataset",
     "license_entry": "benjamin-paine/hey-buddy (precalculated)",
     "role": "precalculated negatives + validation (up to 72 GB)"},
    {"repo": "benjamin-paine/freesound-laion-640k-commercial-16khz-full", "type": "dataset",
     "license_entry": "benjamin-paine/freesound-laion-640k-commercial-16khz-full",
     "role": "augmentation: background sound effects"},
    {"repo": "benjamin-paine/free-music-archive-commercial-16khz-full", "type": "dataset",
     "license_entry": "benjamin-paine/free-music-archive-commercial-16khz-full",
     "role": "augmentation: background music"},
    {"repo": "benjamin-paine/mit-impulse-response-survey-16khz", "type": "dataset",
     "license_entry": "benjamin-paine/mit-impulse-response-survey-16khz",
     "role": "augmentation: room impulse responses"},
    # The pretrained model repo too: the vendored copies in-tree are the runtime's,
    # but the training box fetches from this repo via the vendored heybuddy code,
    # and a mirror lets us repoint pretrained_model_url at ourselves.
    {"repo": "benjamin-paine/hey-buddy", "type": "model",
     "license_entry": "speech-embedding.onnx",
     "role": "pretrained backbone + upstream wake models"},
]

TIMEOUT = 60


def _license_ok(entry_id: str) -> tuple[bool, str]:
    for a in LICENSES["artifacts"]:
        if a["id"] == entry_id:
            if a.get("commercial_ok") or a.get("commercial_ok_reason"):
                return True, a.get("license", "?")
            return False, (f"{entry_id} is not commercial-clean in model_licenses.json "
                           f"(license={a.get('license')!r}) — read its terms and update "
                           f"the manifest before mirroring it (rule 5)")
    return False, f"{entry_id} has NO entry in model_licenses.json — add one first"


def _repo_files(repo: str, rtype: str) -> List[Dict[str, Any]]:
    api = f"https://huggingface.co/api/{'datasets' if rtype == 'dataset' else 'models'}/{repo}"
    r = requests.get(api, params={"blobs": "true"}, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    out = []
    for s in data.get("siblings", []):
        out.append({
            "path": s["rfilename"],
            "size": s.get("size"),
            "sha": (s.get("lfs") or {}).get("sha256") or s.get("blobId"),
            "url": f"https://huggingface.co/"
                   f"{'datasets/' if rtype == 'dataset' else ''}{repo}/resolve/main/{s['rfilename']}",
        })
    return out


def plan() -> int:
    manifest: Dict[str, Any] = {"_generated_by": "mirror_datasets.py plan", "sources": []}
    blocked = []
    for src in SOURCES:
        ok, detail = _license_ok(src["license_entry"])
        entry: Dict[str, Any] = {**src, "license": detail if ok else None,
                                 "license_blocked": not ok}
        if not ok:
            print(f"BLOCKED  {src['repo']} ({src['role']}): {detail}", file=sys.stderr)
            blocked.append(src["repo"])
            manifest["sources"].append(entry)
            continue
        files = _repo_files(src["repo"], src["type"])
        total = sum(f["size"] or 0 for f in files)
        entry.update(files=files, total_bytes=total)
        manifest["sources"].append(entry)
        print(f"planned  {src['repo']} ({src['type']}): {len(files)} files, "
              f"{total / 1e9:.1f} GB — {src['role']}")
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nwrote {MANIFEST_PATH}")
    if blocked:
        print(f"NOTE: {len(blocked)} source(s) licence-blocked and NOT planned: {blocked}\n"
              f"Resolve their entries in model_licenses.json first.", file=sys.stderr)
    return 0


def fetch(staging: Path, only_repo: str | None = None) -> int:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for src in manifest["sources"]:
        if src.get("license_blocked"):
            print(f"skipping licence-blocked {src['repo']}")
            continue
        if only_repo and src["repo"] != only_repo:
            continue
        for f in src["files"]:
            dest = staging / src["repo"] / f["path"]
            if dest.exists() and (f["size"] is None or dest.stat().st_size == f["size"]):
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            print(f"fetch {f['url']} -> {dest}")
            with requests.get(f["url"], stream=True, timeout=TIMEOUT) as r:
                r.raise_for_status()
                tmp = dest.with_suffix(dest.suffix + ".part")
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(chunk_size=1 << 22):
                        fh.write(chunk)
                if f["size"] is not None and tmp.stat().st_size != f["size"]:
                    tmp.unlink()
                    raise RuntimeError(f"size mismatch for {f['path']}: "
                                       f"got {tmp.stat().st_size}, want {f['size']}")
                tmp.rename(dest)
    print("fetch complete")
    return 0


def verify(staging: Path) -> int:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    missing, bad = [], []
    for src in manifest["sources"]:
        if src.get("license_blocked"):
            continue
        for f in src["files"]:
            dest = staging / src["repo"] / f["path"]
            if not dest.exists():
                missing.append(str(dest))
            elif f["size"] is not None and dest.stat().st_size != f["size"]:
                bad.append(f"{dest}: {dest.stat().st_size} != {f['size']}")
    print(f"verify: {len(missing)} missing, {len(bad)} size-mismatched")
    for m in missing[:10]:
        print(f"  missing: {m}")
    for b in bad[:10]:
        print(f"  bad:     {b}")
    return 1 if (missing or bad) else 0


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("plan", "fetch", "verify"):
        print(__doc__)
        return 2
    cmd = sys.argv[1]
    if cmd == "plan":
        return plan()
    if len(sys.argv) < 3:
        print(f"{cmd} needs a staging directory", file=sys.stderr)
        return 2
    staging = Path(sys.argv[2])
    if cmd == "fetch":
        return fetch(staging, sys.argv[3] if len(sys.argv) > 3 else None)
    return verify(staging)


if __name__ == "__main__":
    sys.exit(main())
