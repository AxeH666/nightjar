#!/usr/bin/env python3
# End-to-end test of Nightjar's image_gen path against a MOCK *OpenRouter* Unified
# Image API. Proves: seed_image_endpoint.py (OpenRouter base_url + encrypted key in DB)
# -> _resolve_model -> POST <base>/images  (NOT /images/generations) -> b64 decode ->
# PNG saved -> link returned. The ONLY mocked piece is OpenRouter's server; everything
# Nightjar-side is the real code. Also unit-checks that _image_api_style() picks the
# OpenRouter dialect from the real openrouter.ai host (no override) and OpenAI otherwise.
# Runs on a throwaway COPY of the real Odysseus DB (no pollution). Skips cleanly if
# Odysseus isn't set up on this box.
#   Run: phase2-odysseus/venv/bin/python phase2-odysseus/test_image_gen_openrouter.py
import asyncio, importlib, json, os, shutil, subprocess, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO = os.environ.get("NIGHTJAR_ROOT") or str(Path(__file__).resolve().parents[1])
PORT = int(os.environ.get("NIGHTJAR_IMAGE_TEST_PORT", "8198"))
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII="

real = Path(os.path.expanduser("~/.nightjar/odysseus"))
if not (real / "app.db").exists() or not (real / ".app_key").exists():
    print("SKIP: Odysseus not set up (~/.nightjar/odysseus/app.db missing) — run scripts/setup.sh first")
    sys.exit(0)

tmp = Path(tempfile.mkdtemp(prefix="odys-orimgtest-"))
try:
    for f in real.glob("app.db*"):
        shutil.copy2(f, tmp / f.name)
    shutil.copy2(real / ".app_key", tmp / ".app_key")

    # Mock OpenRouter: serves the dedicated /api/v1/images endpoint (no /generations),
    # returning the same {data:[{b64_json}]} shape OpenAI uses. A hit on the OpenAI-style
    # /images/generations path 404s, so a wrong path selection fails the test loudly.
    hits = {"images": 0, "generations": 0}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, obj, code=200):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
        def do_GET(self):
            self._send({"data": [{"id": "openai/gpt-image-1"}, {"id": "black-forest-labs/flux.2-pro"}]})
        def do_POST(self):
            self.rfile.read(int(self.headers.get("content-length", 0) or 0))
            if self.path.endswith("/images/generations"):
                hits["generations"] += 1
                self._send({"error": {"message": "mock: OpenAI path hit — expected /images"}}, 404)
            elif self.path.endswith("/images"):
                hits["images"] += 1
                self._send({"created": 1, "data": [{"b64_json": PNG_B64}], "usage": {"cost": 0.04}})
            else:
                self._send({"error": {"message": f"mock: unhandled {self.path}"}}, 404)

    srv = HTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    # phase 1: real seed script against the mock OpenRouter endpoint
    env = {**os.environ, "NIGHTJAR_ROOT": REPO, "ODYSSEUS_DATA_DIR": str(tmp),
           "NIGHTJAR_IMAGE_BASE_URL": f"http://127.0.0.1:{PORT}/api/v1",
           "NIGHTJAR_IMAGE_MODEL": "openai/gpt-image-1",
           "NIGHTJAR_IMAGE_ENDPOINT_NAME": "OpenRouter (image)",
           "NIGHTJAR_IMAGE_API_KEY": "test-mock-or-key"}
    r = subprocess.run([sys.executable, f"{REPO}/phase2-odysseus/seed_image_endpoint.py"],
                       env=env, capture_output=True, text=True)
    print(r.stdout + r.stderr, end="")
    assert r.returncode == 0, "seed script failed"

    # phase 2: invoke the REAL Nightjar image tool.
    os.environ["ODYSSEUS_DATA_DIR"] = str(tmp)
    sys.path.insert(0, f"{REPO}/research/odysseus")
    sys.path.insert(0, f"{REPO}/research/odysseus/mcp_servers")
    ig = importlib.import_module("image_gen_server")
    from src.constants import GENERATED_IMAGES_DIR

    # --- unit: dialect detection from the REAL host (override unset) ---
    os.environ.pop("NIGHTJAR_IMAGE_API_STYLE", None)
    ok_detect_or = ig._image_api_style("https://openrouter.ai/api/v1") == "openrouter"
    ok_detect_oa = ig._image_api_style("https://api.openai.com/v1") == "openai"

    # The mock runs on localhost (can't match openrouter.ai), so force the dialect the
    # way production auto-detects it from the openrouter.ai host.
    os.environ["NIGHTJAR_IMAGE_API_STYLE"] = "openrouter"

    before = set(Path(GENERATED_IMAGES_DIR).glob("*.png")) if Path(GENERATED_IMAGES_DIR).exists() else set()
    res = asyncio.run(ig.call_tool("generate_image", {"prompt": "a red panda astronaut"}))
    text = res[0].text
    print("[tool result] " + text.replace("\n", " | "))
    after = set(Path(GENERATED_IMAGES_DIR).glob("*.png")) if Path(GENERATED_IMAGES_DIR).exists() else set()
    srv.shutdown()

    ok_link = "Direct link:" in text and "Error" not in text
    new = after - before
    ok_file = bool(new) and next(iter(new)).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    ok_path = hits["images"] == 1 and hits["generations"] == 0  # hit /images, never /images/generations

    # --- auto-wire contract: the row the main process's reconcile writes, and remove ---
    from src.database import SessionLocal, ModelEndpoint
    import src.secret_storage as ss
    db = SessionLocal()
    row = db.query(ModelEndpoint).filter(ModelEndpoint.model_type == "image",
                                         ModelEndpoint.name == "OpenRouter (image)").first()
    ok_row = (bool(row) and row.is_enabled and ss.decrypt(row.api_key) == "test-mock-or-key"
              and (row.base_url or "").endswith("/api/v1")
              and json.loads(row.pinned_models or "[]") == ["openai/gpt-image-1"])
    # remove path (byok:remove -> reconcile -> unseed by name)
    subprocess.run([sys.executable, f"{REPO}/phase2-odysseus/seed_image_endpoint.py"],
                   env={**env, "NIGHTJAR_IMAGE_UNSEED": "1"}, capture_output=True, text=True)
    db.expire_all()
    ok_unseed = db.query(ModelEndpoint).filter(ModelEndpoint.model_type == "image",
                                               ModelEndpoint.name == "OpenRouter (image)").first() is None
    db.close()

    all_ok = ok_link and ok_file and ok_path and ok_detect_or and ok_detect_oa and ok_row and ok_unseed
    print(f"\nRESULT: link-ok={ok_link}  png-written={ok_file}  used-/images={ok_path}  "
          f"detect-openrouter={ok_detect_or}  detect-openai={ok_detect_oa}  "
          f"endpoint-row+key={ok_row}  unseed-removed={ok_unseed}  ->  " + ("PASS ✅" if all_ok else "FAIL ❌"))
    sys.exit(0 if all_ok else 1)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
