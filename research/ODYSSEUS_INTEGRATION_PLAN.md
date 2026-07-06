# Nightjar × Odysseus — Architecture Findings & Integration Plan

Audit-only (no code written yet). Determines Phase 2's true final scope: bring
Odysseus (github.com/pewdiepie-archdaemon/odysseus, **AGPL-3.0-or-later**) in
alongside Row-Bot as MCP-bridged capabilities — **not merged codebases**, same
"call it across a clean boundary" pattern as calling CUDA kernels from Python.

Repo verified real: 30 MB, 1292 files, FastAPI app, AGPL-3.0-or-later (README:76),
all claimed features present.

---

## 0. Headline findings

1. **Odysseus's 4 built-in MCP servers are standalone stdio servers** (`mcp.server.Server` + `stdio_server`, each with `__main__`). They bolt onto OpenCode's `opencode.json` **directly, no wrapper** — exactly how the Nightjar server is registered. Launch = `<python> mcp_servers/<name>_server.py` with `PYTHONPATH=<repo>` + `ODYSSEUS_DATA_DIR` (Odysseus's own registry `src/builtin_mcp.py:114-125` gives the exact command/env to copy).
2. **They do NOT need Odysseus's FastAPI web app running** — only the Odysseus package importable + its (light) deps + a populated `ODYSSEUS_DATA_DIR`. Memory/RAG additionally need a **ChromaDB service** (docker container) for vectors (degrade to keyword search without it).
3. **Odysseus is torch-free at its core** (embeddings = fastembed/ONNX, DB = SQLite, vectors = ChromaDB-over-HTTP). Compatible with Nightjar's lean local-first stack.
4. **No memory redundancy with Row-Bot** — different jobs (see §3). Run both.
5. **llmfit (Odysseus's `services/hwfit/`) is the cleanest liftable component in the repo** — pure Python + a 924-model JSON DB, MIT-origin, zero third-party deps. It should **replace my `hw-detect.mjs`** (see §4).
6. **License is clean**: AGPL-3.0-or-later combined work; OpenCode (MIT) + Row-Bot (Apache-2.0) are one-way compatible into AGPL. One watch-item: `PyMuPDF` (AGPL, optional) and SearXNG (AGPL, composed) — see §5.

---

## 1. Odysseus capability inventory + integration path

| Capability | Today in Odysseus | Integration path | Effort |
|---|---|---|---|
| **Email** (IMAP/SMTP) | stdio MCP server, **14 tools** (`email_server.py`) | **Direct** — point `opencode.json` at it | none (config) |
| **Image generation** | stdio MCP server, 1 tool `generate_image` | **Direct** | none (config) |
| **Memory** (fact store) | stdio MCP server, 1 tool `manage_memory` | **Skip** — Row-Bot owns personal memory (§3) | n/a |
| **RAG** (doc index mgmt) | stdio MCP server, 1 tool `manage_rag` (list/add/remove dirs only — **no query**) | **Direct** for index mgmt; **wrap** for query | small |
| **RAG query / Documents** | `DocsService.query()` service class — **no MCP** | **Thin wrapper** (clean async entry) | small |
| **Deep Research** | `ResearchService.research()` service class — **no MCP** | **Thin wrapper** (clean async entry) | small |
| **Calendar** (CalDAV) | route+ORM closures, `caldav` lib sync — **no service fn, no MCP** | **Wrapper over ORM/HTTP** | medium |
| **Notes** | route+ORM closures — **no service fn, no MCP** | **Wrapper over ORM** | medium |
| **Tasks / scheduling** | route+ORM closures + `src/task_scheduler.py` — **no MCP** | **Wrapper over ORM** | medium |
| **hwfit / llmfit** | `services/hwfit` pure-Python lib — **no MCP (nor needed)** | **Vendor as a library** (replaces hw-detect) | small |

**Direct-MCP (zero wrapper):** email (14 tools), image_gen, rag (index mgmt). Register in `opencode.json` with `command=<python>`, `args=[<repo>/mcp_servers/<x>_server.py]`, `env={PYTHONPATH:<repo>, ODYSSEUS_DATA_DIR:...}`.

**Thin MCP wrappers (Odysseus has a clean service class, just no MCP face):**
- Deep Research → wrap `services/research/service.py::ResearchService.research(topic, llm_endpoint, llm_model, max_time, on_progress) -> ResearchResult` (also `start_background`/`get_status`/`cancel` for long runs). **Highest value, cleanest wrap.**
- Document/RAG **query** → wrap `services/docs/service.py::DocsService.query(query, top_k) -> List[DocChunk]` (the MCP `manage_rag` tool does list/add/remove dirs but cannot *retrieve* — this fills the gap).

**Heavier wrappers (route+ORM-bound, no extracted service fn):** Calendar CRUD (`routes/calendar_routes.py` closures over `CalendarCal`/`CalendarEvent` + `src/caldav_sync.py`), Notes (`routes/note_routes.py` over `Note`), Tasks (`routes/task_routes.py` + `src/task_scheduler.py` over `ScheduledTask`). These need either a small wrapper calling the ORM directly, or Odysseus's HTTP API with the app running. **Recommend: bundle these into ONE "odysseus-pim" wrapper MCP server** (calendar+notes+tasks) that imports the ORM models directly, rather than three separate servers — less process sprawl.

---

## 2. Runtime shape — Odysseus as a sidecar

Odysseus runs as a **sidecar**: a Python environment with the Odysseus repo + its `requirements.txt` (light: fastapi/httpx/sqlalchemy/chromadb-client/fastembed/caldav/croniter/mcp — **no torch, no postgres**), a populated `ODYSSEUS_DATA_DIR` (SQLite `app.db` etc.), and — for RAG/memory vectors — a **ChromaDB container** (`chromadb/chroma`, Apache-2.0). The FastAPI web UI does **not** need to run for MCP/bridged use.

OpenCode spawns the direct MCP servers as stdio child processes (like it does the Nightjar server). The wrapper MCP servers (research, docs-query, pim) are new small Nightjar-authored stdio servers that `import` Odysseus's service classes/ORM (PYTHONPATH into the Odysseus repo) — the same vendoring-by-reference pattern, but pointing at Odysseus instead of Row-Bot.

**Config surfaces to prepare:** email accounts live in Odysseus's `app.db :: email_accounts` (encrypted via `.app_key`); CalDAV creds + settings likewise. So onboarding email/calendar means running Odysseus's setup once to populate config, then the MCP servers read it. Flag: initial account setup currently expects Odysseus's own UI/flows — Nightjar will need a headless config path or a one-time Odysseus-UI setup step.

---

## 3. Memory / RAG overlap — decision: RUN BOTH (they're different jobs)

- **Row-Bot memory** = self-contained **entity/relation knowledge graph** (SQLite + FAISS + NetworkX) with hybrid semantic+keyword+graph recall + Ollama embeddings. Job: "remember facts/preferences/relationships about the user," with graph traversal. Already wired into Nightjar with the auto-recall plugin (Phase 2, tested).
- **Odysseus memory** = a **flat owner-scoped fact list** (`memory.json` + Chroma cosine recall, categories fact/event/contact/preference, keyword-heuristic relevance). Simpler; no graph; hard-depends on external ChromaDB.
- **Odysseus RAG** = **document-chunk ingestion + retrieval** (directories → chunks → Chroma), which Row-Bot does **not** do.

**Decision:**
- **Personal memory → Row-Bot only.** Do NOT also expose Odysseus's `manage_memory` — two "remember this about me" write targets is exactly the split-brain to avoid, and Row-Bot's is richer + self-contained (no Chroma dependency). Leave Odysseus's memory server unregistered.
- **Document RAG → Odysseus.** Row-Bot has no document-corpus RAG; Odysseus fills it. Register `manage_rag` (index mgmt) + a wrapped `DocsService.query` (retrieval). This is a genuinely additive capability, not duplication.

Net: one personal-memory brain (Row-Bot), one document-RAG brain (Odysseus). No consolidation project needed; no duplication shipped.

---

## 4. hw-detect vs llmfit — decision: REPLACE hw-detect.mjs with llmfit

My Phase-1.5 `hw-detect.mjs` is a ~150-line heuristic that maps total VRAM to a hand-written tier list. Odysseus's **llmfit** (`services/hwfit/`) is a far more mature system:
- `detect_system()` probes NVIDIA/AMD/Apple/Windows RAM+VRAM+CPU (even over SSH).
- `rank_models(system, ...)` ranks a **924-model catalog** (pure-JSON `hf_models.json`) by fit level (perfect/good/marginal/too_tight), run mode (gpu/cpu_offload/cpu_only), auto-selected quant, max fitting context (halving down to 1024 until it fits), estimated speed (bandwidth model), and quality/speed/fit/context sub-scores.
- **Pure Python + JSON, zero third-party deps, MIT-origin, cleanly separable** (imports only stdlib + `core/platform_compat.py`).

**Decision: vendor llmfit (`services/hwfit/` + `core/platform_compat.py` + `hf_models.json`) into Nightjar and retire `hw-detect.mjs`.** Keep my *integration points* — the startup log line and the (deferred) model-auto-switch hook — but source the actual recommendation from `rank_models()`/`detect_system()` instead of my hand-rolled tiers. This directly upgrades the Phase-1.5 hardware-tier work and the future auto-switching. License: carry `licenses/llmfit-MIT-LICENSE.txt` + the ACKNOWLEDGMENTS entry (llmfit © 2026 Alex Jones, MIT); note the files as distributed are AGPL-covered (MIT code intermixed with Odysseus AGPL additions), so simplest is to keep them under the AGPL combined work while preserving the MIT attribution.

---

## 5. License — combined work is AGPL-3.0-or-later (clean)

Per the confirmed decision, Nightjar ships **AGPL-3.0-or-later**, open-source, from a personal GitHub (no closed BlackKrait product). Compatibility:

- **OpenCode** MIT → one-way compatible into AGPL ✓ (preserve MIT notice; note Odysseus *also* adapted opencode, so the notice appears twice-over — fine).
- **Row-Bot** Apache-2.0 → one-way compatible into AGPLv3 ✓ (preserve NOTICE + LICENSE, already done in `phase2-mcp/`).
- **Odysseus** AGPL-3.0-or-later → the copyleft anchor; combined work must be AGPL-3.0-or-later ✓. Preserve its `LICENSE`, entire `licenses/` dir, and `ACKNOWLEDGMENTS.md` verbatim.
- **Nightjar's own Phase-2 deps** (faster-whisper MIT, openWakeWord Apache-2.0-ish, kokoro-onnx, fastembed) — permissive, fine under AGPL.

**MCP process-boundary note (why this is clean either way):** the bridged systems run as **separate processes over MCP/JSON-RPC (stdio)**, not linked into one binary. Under the FSF's "at arm's length ⇒ mere aggregation" reading, that separation would not even force AGPL onto the OpenCode/Row-Bot processes. But since the whole distribution is *deliberately* AGPL-3.0-or-later anyway, the question is moot — compliance holds under both the strict (single combined work) and lenient (aggregation) interpretations, because every component is AGPL-compatible.

**Watch-items to document (not blockers):**
- **AGPL §13 network clause:** if Nightjar is ever offered to users *over a network* (a hosted/remote-access mode), the Complete Corresponding Source must be offered to those users. For an offline local-first app this rarely triggers, but any "share my Nightjar over the LAN/web" feature would. Document prominently.
- **PyMuPDF (AGPL, optional):** Odysseus uses it only for PDF form-filling (`requirements-optional.txt`). If Nightjar ships it, its terms apply to that feature; if not needed, leave it out.
- **SearXNG (AGPL) + ChromaDB (Apache-2.0):** composed as Docker services, not linked. If Deep Research uses SearXNG, it's a separate AGPL service (fine; document it). ChromaDB is Apache-2.0.
- **caldav** dual GPL-3.0-or-later/Apache-2.0 — usable under Apache-2.0; fine in AGPL work.

**Attribution to preserve in the Nightjar distribution:** OpenCode MIT notice · Row-Bot NOTICE (Apache-2.0) · Odysseus LICENSE + `licenses/` (opencode-MIT, llmfit-MIT, DeepResearch-Apache-2.0, OpenDyslexic-OFL) + ACKNOWLEDGMENTS.md · a top-level Nightjar NOTICE/README stating the combined work is AGPL-3.0-or-later and listing the three upstreams.

---

## 6. Updated master architecture — three tiers, one voice

```
                         ┌──────────────────────────────────────────────┐
        "Hey Nightjar,   │  WAKE + VOICE  (Nightjar / Row-Bot-derived)    │
         research X and  │  openWakeWord → faster-whisper → text          │
         email me a      │  (kokoro TTS back; WebSocket side-channel for  │
         summary"        │   wake/transcript/browser/tts state)           │
                         └───────────────────────┬──────────────────────┘
                                                 │ transcribed command (text)
                                                 ▼
                         ┌──────────────────────────────────────────────┐
                         │  NATIVE ENGINE — OpenCode (MIT)                │
                         │  the ONE agent loop + tool executor + local    │
                         │  model (llama.cpp + timeout proxy + watchdog + │
                         │  safety plugins). Sees ALL tools below in ONE  │
                         │  unified MCP tool namespace and orchestrates.  │
                         └───────┬───────────────────────┬───────────────┘
                                 │ MCP (stdio)            │ MCP (stdio)
                    ┌────────────▼───────────┐  ┌─────────▼───────────────────────┐
                    │ ROW-BOT BOLT-ON        │  │ ODYSSEUS BOLT-ON / SIDECAR       │
                    │ (nightjar MCP server)  │  │ (Odysseus repo + ChromaDB +      │
                    │ • voice transcribe/    │  │  its light deps; no FastAPI UI)  │
                    │   speak                │  │ DIRECT stdio servers:            │
                    │ • wake_word_listen     │  │  • email (14 tools)              │
                    │ • vision analyze       │  │  • image_gen                     │
                    │ • PERSONAL MEMORY      │  │  • rag (index mgmt)              │
                    │   (entity graph) +     │  │ THIN WRAPPERS (Nightjar-authored │
                    │   auto-recall plugin   │  │  stdio servers over Odysseus     │
                    │ • browser (Playwright) │  │  services/ORM):                  │
                    └────────────────────────┘  │  • deep_research (ResearchService)│
                                                 │  • docs_query (DocsService.query)│
                                                 │  • odysseus-pim: calendar/notes/ │
                                                 │    tasks (ORM)                   │
                                                 └──────────────────────────────────┘
        hwfit/llmfit (MIT, vendored) → hardware detection + model-fit  (replaces hw-detect.mjs)
```

- **What runs as OpenCode's native engine:** the agent loop, tool dispatch, local-model inference (llama.cpp + the Phase-1.5 timeout proxy + run-supervisor watchdog + safety plugins). This is the single brain that decides which tool to call.
- **What runs as Row-Bot's MCP bolt-on:** voice (STT/TTS), wake-word, vision, **personal entity-graph memory** (+ auto-recall plugin), browser. (Built + tested in Phase 2.)
- **What runs as Odysseus's MCP bolt-on/sidecar:** email, image-gen, document RAG (index + query), deep research, calendar, notes, tasks. Direct stdio servers where they exist; thin Nightjar-authored wrappers over Odysseus's clean service classes/ORM where they don't. Odysseus runs headless (no web UI) as a sidecar with its SQLite data dir + a ChromaDB container.
- **hardware layer:** llmfit (vendored, MIT) does detection + model-fit ranking, feeding the startup check and the (deferred) auto-switcher.

### How one "Hey Nightjar" command routes to any of the three systems
There is **no separate router to build** — MCP already unifies it:
1. Wake (openWakeWord) → transcribe (faster-whisper) → the command becomes plain text.
2. That text goes to **OpenCode as the single agent**. OpenCode's model sees **one flat tool list** aggregated from all MCP servers (its own native tools + Row-Bot's + Odysseus's), each tool namespaced by server (e.g. `nightjar_*`, `odysseus_email_*`, `odysseus_research_*`).
3. The model **picks and chains the right tools** regardless of which system provides them. "Research X and email me a summary" → `deep_research` (Odysseus wrapper) → `send_email` (Odysseus direct) — one flow, one voice command, orchestrated by OpenCode.
4. Streaming/stateful signals (wake state, live transcript, browser state) ride the existing **WebSocket side-channel** to the (future) UI; discrete calls ride MCP.

**Tool-namespace hygiene (the one real routing risk):** with three tool sources, avoid name collisions and model confusion — hence the §3 decision to expose **only one memory tool** (Row-Bot's), and keep tool names/descriptions distinct. A small model juggling 30+ tools may mis-select; mitigations for the build phase: concise disambiguating descriptions, and optionally OpenCode agent "modes" that scope tool subsets per task.

---

## 7. Revised phase scope

Phase 2's **true final scope** grows to include the Odysseus bolt-on. Proposed sequencing (each independently testable, same rigor as before):

- **2a (done):** Row-Bot bolt-on — voice/wake/vision/memory/browser MCP + side-channel + auto-recall.
- **2b — Odysseus sidecar bring-up:** stand up Odysseus headless (Python env + `ODYSSEUS_DATA_DIR` + ChromaDB container), register the 3 direct stdio MCP servers (email, image_gen, rag) in `opencode.json`; test each is callable from OpenCode. Preserve AGPL LICENSE + `licenses/` + ACKNOWLEDGMENTS.
- **2c — Odysseus thin wrappers:** author `deep_research` and `docs_query` MCP wrappers over the clean service classes; test.
- **2d — Odysseus PIM wrapper:** one `odysseus-pim` MCP server for calendar/notes/tasks over the ORM; handle headless config for email/CalDAV accounts; test.
- **2e — hardware layer swap:** vendor llmfit, retire `hw-detect.mjs`, rewire the startup hardware check to `rank_models()`/`detect_system()`.
- **2f — unified voice E2E:** "Hey Nightjar" → a command that provably routes into an Odysseus capability (e.g. deep research or a calendar list) via OpenCode, end-to-end.
- **Then Phase 3 (UI/orb) as before.**

**Open risks / hazards to carry:**
- Odysseus memory/RAG need a **ChromaDB service** — a new runtime dependency (container) vs. Nightjar's otherwise self-contained stack. Acceptable (Apache-2.0, light), but it's the one added infra piece. **⚠️ Update (resolved in Phase 2b): NO container is used.** Phase 2b runs ChromaDB **embedded** via `PersistentClient` — zero docker (the non-negotiable "runs on any laptop" gate) — so this "one added infra piece" was eliminated (`phase2-odysseus/PHASE2B_REPORT.md`).
- **Email/CalDAV account onboarding** currently assumes Odysseus's own setup flows; a headless config path is needed (flagged for 2d).
- **Tool-count explosion** (Row-Bot + Odysseus + native = 30+ tools) may degrade small-model tool selection — validate with the 4B model; may need per-mode tool scoping.
- **GPU contention** (already flagged Phase 2): coding model + vision + embeddings on one 6 GB GPU; llmfit's fit-ranking can inform which model holds the GPU.
- **AGPL §13** if any networked/hosted mode is ever added.
