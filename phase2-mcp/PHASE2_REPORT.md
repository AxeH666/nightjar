# Nightjar Phase 2 Report — Row-Bot capabilities as an MCP bolt-on

Extract Row-Bot's voice / vision / memory / browser into a standalone package,
drop LangChain/LangGraph/NiceGUI, add wake-word activation, wrap as an MCP server
for OpenCode + a WebSocket side-channel, move auto-recall into an OpenCode plugin.
No UI / orb-ui work (Phase 3).

## Result: works end-to-end. Headline E2E passed.

**voice clip → wake detected (openWakeWord) → transcribed (faster-whisper) →
command handed to OpenCode → real OpenCode tool call.** Verified: a synthesized
spoken command was detected, transcribed to `"list the files in the project
directory."`, fed to `opencode run`, and OpenCode executed a real `Glob "**/*"`
(100 matches) and answered from the result. Plus memory, vision, and browser
each validated independently, and OpenCode reports the MCP server `✓ connected`.

Everything runs **fully local and torch-free** (faster-whisper=CTranslate2,
kokoro/openWakeWord=onnxruntime, embeddings=Ollama `nomic-embed-text`, vision=Ollama
`gemma3:4b`). No cloud, no torch, no LangChain.

---

## What was built (all under `phase2-mcp/`)

- `nightjar_capabilities/` — the standalone package:
  - `_vendor/row_bot/` — Row-Bot's `knowledge_graph.py`, `memory.py`,
    `embedding_config.py`, `vision.py`, `tools/browser_tool.py` **preserved
    faithfully** (Apache-2.0), with a small set of **stub modules** replacing the
    orchestration/config glue we dropped (`data_paths`, `stability`, `wiki_vault`,
    `documents`→Ollama embedder, `models`, `agent`, `ui.state`, `tools.base/registry`,
    `providers.*`). Only three targeted patches to the vendored code: browser
    `headless=True`, force bundled Chromium, and neutralize one top-level
    `langchain_core` import (used solely by the dropped LangChain adapter).
  - `embeddings.py` — Ollama embedding backend + `OllamaEmbedder` (the
    `embed_query`/`embed_documents` seam the memory engine expects), replacing
    Row-Bot's HuggingFace/torch provider.
  - `memory.py`, `vision.py`, `voice.py`, `browser.py`, `wakeword.py` — clean
    capability wrappers exposing a small surface to the MCP server.
  - `voice.py` is a **clean reimplementation** (not a vendored import): same
    faster-whisper (CPU int8) + kokoro-onnx models Row-Bot uses, but with NO
    live-mic loop and NO sounddevice playback (both scoped out) — file/array based.
- `mcp_server.py` — FastMCP server (stdio) exposing **14 tools**: `transcribe`,
  `speak`, `analyze_image`, `capture_screen`, `save_memory`, `search_memory`,
  `list_memory`, `browser_navigate/click/type/snapshot/scroll/back`, `wake_word_listen`.
- `sidechannel.py` — WebSocket hub broadcasting the streaming/stateful signals MCP
  can't carry: `wake`, `transcription`, `browser_state`, `tts`.
- `workspace/.opencode/plugin/nightjar-auto-recall.ts` + `recall.py` — the OpenCode
  `chat.message` plugin that injects high-confidence recalled memories into the
  prompt (Row-Bot's auto-recall logic, moved out of the MCP layer per the audit).
- `workspace/opencode.json` — registers the MCP server (`mcp.nightjar`, local
  stdio) alongside the llama.cpp provider. **No OpenCode core changes.**
- `wakeword_training/` — `generate_samples.py` (kokoro positive-corpus generator)
  + `README.md` (full custom-model training recipe).
- `NOTICE` + `LICENSE.row-bot` — Apache-2.0 compliance (see below).

## Tests (honest methods for a headless, sound-card-less box)

| Capability | Test | Result |
|---|---|---|
| Memory | save 3 memories, semantic recall | dark-mode query → correct hit 0.802; Nightjar query → 0.802 ✓ |
| Vision | analyze a generated image (red circle + "NIGHTJAR") via gemma3:4b | "A red circle is drawn, and the word 'NIGHTJAR' is written." ✓ |
| Browser | headless navigate + snapshot + type + click a local page | 3 refs found; type cleared placeholder; click set title→"CLICKED" ✓ |
| Voice | TTS "Hey Nightjar, list the files…" → WAV → STT | transcript exact-matched input ✓ |
| Wake-word | openWakeWord on WAV frames | fires 0.999 on trained phrase, rejects untrained 0.06 ✓ |
| MCP server | stdio client: list tools + call memory/browser/wake | 14 tools; recall 0.817; wake→command "what time is it?" ✓ |
| Side-channel | WS subscriber during MCP calls | received `browser_state`, `wake`, `transcription` ✓ |
| MCP registration | `opencode mcp list` | `✓ nightjar connected` ✓ |
| Auto-recall plugin | save "user is Axe", ask "what name do I go by?" | plugin injected 1 line; model answered "You go by the name Axe" ✓ |
| **E2E** | **voice clip → wake → transcribe → OpenCode run** | **real `Glob "**/*"` tool call executed from the spoken command ✓** |

## Failures / friction hit along the way

1. **openWakeWord API drift.** 0.4.0 renamed the constructor param
   (`wakeword_model_paths`, not `wakeword_models`), dropped `inference_framework`,
   and has no module-level `download_models`. Base feature models ship bundled.
   Resolved by reading the actual signatures.
2. **Vendored-code coupling was small but real.** The four modules only hard-import
   `row_bot.data_paths` at top level; everything else is lazy inside removable
   paths — so the stub-package approach worked with just 3 code patches. `documents.py`
   (LangChain-FAISS) was bypassed entirely by making the embedding seam return the
   Ollama embedder directly.

## Hazards discovered (carry forward)

1. **Custom "Hey Nightjar" model is not trained — genuine offline task.**
   openWakeWord's pip package is inference-only; training a *new phrase* needs the
   GitHub pipeline with **PyTorch+TensorFlow + multi-GB negative corpora + GPU +
   hours** — which would break the torch-free runtime and doesn't belong in this
   environment. **Mitigation shipped:** the detection pipeline is complete and
   phrase-agnostic; `wakeword_training/` has the positive-corpus generator (kokoro)
   and the exact training recipe; dropping a trained `hey_nightjar.onnx` +
   `NIGHTJAR_WAKEWORD_MODEL` activates it with zero code change. The E2E used the
   stock wake model + a "Hey Jarvis" stand-in clip to prove the plumbing — this is
   the one requirement not fully met (custom phrase pending offline training),
   flagged prominently rather than faked.
2. **No sound card / mic / camera in this environment** (`/dev/snd` empty, no
   `/dev/video*`). Live always-listening mic capture, live TTS playback, and camera
   vision **cannot be validated here** — only via files/arrays (which is how every
   voice/vision/wake test was run). These paths must be validated on real hardware
   before shipping. *(**⚠️ corrected — see UPDATE at end of this report:** the box
   runs WSLg with working PulseAudio; the mic/TTS paths were later validated
   on-box, only camera stayed untested.)* `capture_screen` (mss) is best-effort under WSLg and returns a
   clean error if the display is unavailable rather than crashing.
3. **GPU contention.** With llama.cpp holding ~5.4 GB of the 6 GB VRAM, the vision
   model (gemma3:4b) fell back to **CPU** (slow). Running the coding model + vision
   model + embeddings concurrently on one 6 GB GPU is not viable; the deferred
   model/VRAM orchestration (Phase 1.5 hazard #3) will need to coordinate which
   model holds the GPU, or accept CPU fallback latency for vision/embeddings.
4. **Wake→command segmentation is naive.** `wake_word_listen` transcribes the whole
   clip and strips a leading wake phrase heuristically. A real always-listening loop
   needs proper endpointing (VAD-based command capture after the wake trigger) —
   fine for file-based testing, needs work for live mic.
5. **Stateful browser lives in the MCP process, not the side-channel daemon.** The
   MCP server is long-lived so the persistent browser session survives across tool
   calls, and it *pushes* state to the side-channel — but if OpenCode restarts the
   MCP server, the browser session resets. For Phase 3, consider moving the browser
   into the side-channel daemon so the UI and MCP share one session lifecycle.

## License compliance (Apache-2.0, per the audit)

- `LICENSE.row-bot` — full Apache-2.0 text preserved (§4a).
- `NOTICE` — preserves Row-Bot's original NOTICE attribution and records the
  BlackKrait/Nightjar modifications (§4b, §4d). Each vendored file carries a
  "modified extract" header.

## Not done (out of Phase 2 scope, as instructed)

UI and orb-ui untouched. Live-mic always-on loop, custom-wake training run, and
multi-model GPU orchestration are flagged for their respective later phases.

---

# UPDATE — post-Phase-4 (2026-07-05)

Two Phase-2 conclusions were **overtaken by later work** and are corrected here:

- **"Headless, sound-card-less box / audio can't be validated here"** (§ "Tests"
  header + Hazard 2). The raw observation (`/dev/snd` empty) was right, but the
  conclusion was wrong: this box runs **WSLg**, which exposes audio via
  **PulseAudio** (not ALSA) and a working X display. Post-Phase-4, a real
  **wake→transcribe→reply→TTS audio loop ran end-to-end on this machine** and the
  Nightjar UI was launched + screenshotted. So Hazard 2's "these paths cannot be
  validated here / must be validated on real hardware" no longer holds for
  **audio** (a real *camera* was still not tested).
- **"Live-mic always-on loop flagged for later phases."** It's now **built and
  tested E2E**: `phase2-mcp/wake_daemon.py` (parec → openWakeWord per 80 ms frame
  → faster-whisper → OpenCode → Kokoro), wired into the Electron supervisor
  (`phase3-ui/src/main/services.ts`, health port 8766). Hazard 4's naive-
  endpointing caveat still stands (fixed follow-up window, not VAD); custom-wake
  training + GPU orchestration remain open as originally flagged.

See `phase3-ui/PHASE4_REPORT.md` (UPDATE section) and `research/AUDIT_REPORT.md`
(Status) for the full post-Phase-4 picture.
