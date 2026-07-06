#!/usr/bin/env python3
"""
seed_image_endpoint.py — register an OpenAI-compatible IMAGE endpoint in Odysseus's
`model_endpoints` DB so the `odysseus-image` MCP tool has a backend to call.

Nightjar is headless (no Odysseus admin UI), so image endpoints are seeded here
instead of clicked in a browser. Idempotent: re-running upserts the same endpoint.
The `api_key` column is `EncryptedText`, so the key is encrypted at rest on commit.

Run with the Odysseus venv + the Nightjar data dir, e.g.:

    OPENAI_API_KEY=sk-...                         # your real key (cloud path)
    NIGHTJAR_ROOT=$(pwd)
    ODYSSEUS_DATA_DIR=$HOME/.nightjar/odysseus
    phase2-odysseus/venv/bin/python phase2-odysseus/seed_image_endpoint.py

Env knobs:
    OPENAI_API_KEY               required for the real cloud path (blank = mock/testing)
    NIGHTJAR_IMAGE_BASE_URL      default https://api.openai.com/v1
    NIGHTJAR_IMAGE_MODEL         default gpt-image-1  (note: dall-e-3 needs no OpenAI
                                 org verification, gpt-image-1 does)
    NIGHTJAR_IMAGE_ENDPOINT_NAME default "OpenAI (image)"
"""
import json
import os
import sys
import uuid
from pathlib import Path

REPO = os.environ.get("NIGHTJAR_ROOT") or str(Path(__file__).resolve().parents[1])
# Odysseus reads its data dir (DB + .app_key + settings.json) from ODYSSEUS_DATA_DIR.
os.environ.setdefault("ODYSSEUS_DATA_DIR", os.path.expanduser("~/.nightjar/odysseus"))
sys.path.insert(0, os.path.join(REPO, "research", "odysseus"))

from src.database import SessionLocal, ModelEndpoint  # noqa: E402
from src.settings import load_settings, save_settings  # noqa: E402

api_key = os.environ.get("OPENAI_API_KEY", "")
base_url = os.environ.get("NIGHTJAR_IMAGE_BASE_URL", "https://api.openai.com/v1")
model = os.environ.get("NIGHTJAR_IMAGE_MODEL", "gpt-image-1")
name = os.environ.get("NIGHTJAR_IMAGE_ENDPOINT_NAME", "OpenAI (image)")

db = SessionLocal()
try:
    ep = (
        db.query(ModelEndpoint)
        .filter(ModelEndpoint.model_type == "image", ModelEndpoint.name == name)
        .first()
    )
    if ep is None:
        ep = ModelEndpoint(id=str(uuid.uuid4()), name=name)
        db.add(ep)
    ep.base_url = base_url
    ep.api_key = api_key  # EncryptedText → encrypted at rest on commit
    ep.is_enabled = True
    ep.model_type = "image"
    ep.pinned_models = json.dumps([model])  # pin so it resolves without probing
    ep.owner = None  # shared row (single-user; owner_filter is a no-op)
    db.commit()
    print(f"[seed] image endpoint: name={name!r} base_url={base_url!r} model={model!r} "
          f"key={'set' if api_key else 'EMPTY (mock/testing)'}")
finally:
    db.close()

# Enable image generation (Odysseus defaults it OFF) and set the default image
# model so the tool skips auto-detection.
try:
    s = load_settings()
    s["image_gen_enabled"] = True
    s["image_model"] = model
    save_settings(s)
    print(f"[seed] settings.image_gen_enabled = True, settings.image_model = {model}")
except Exception as e:  # non-fatal: auto-detect still finds the pinned model
    print(f"[seed] (settings not updated: {e})")
