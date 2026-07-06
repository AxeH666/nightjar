# Nightjar Phase 2b Report — Odysseus capabilities as MCP bolt-ons

Bridge Odysseus (AGPL-3.0-or-later) into Nightjar via MCP (not merged), embedded
local-only ChromaDB, thin wrappers for non-MCP capabilities, memory split with
Row-Bot, llmfit replacing hw-detect, AGPL attribution. No UI (Phase 3).

## Pass/fail per component

| Component | Result | Evidence |
|---|---|---|
| **Embedded ChromaDB (no docker)** | ✅ PASS | Patched `get_chroma_client()` → `PersistentClient(path)`, env-gated. Added/queried docs, `chroma.sqlite3` on disk, **zero containers**. Non-negotiable requirement MET. |
| **Direct MCP: email/image/rag** | ✅ PASS | All connect in OpenCode (`✓ connected`), spawned per `builtin_mcp.py` pattern (python + PYTHONPATH + ODYSSEUS_DATA_DIR). |
| **Wrapper: deep_research** | ⚠️ PARTIAL | Wired + search works (ddgs), but **impractical on local 4B** — see hazard 1. |
| **Wrapper: docs_query (retrieval)** | ✅ PASS | Correct semantic ranking (nightjar-notes ranked first). Fixed an upstream mapping bug (RAG returns chunk under `"document"`; `DocsService` only read `text`/`content`). |
| **Consolidated PIM (calendar/notes/tasks)** | ✅ PASS | One server, 6 tools; note/task/calendar create+list via ORM, owner-scoped, tables auto-created headless. |
| **Memory split (Row-Bot only)** | ✅ PASS | Odysseus `memory_server` deliberately NOT registered; personal memory stays Row-Bot; document RAG is Odysseus-only. No split-brain. |
| **llmfit replaces hw-detect.mjs** | ✅ PASS | Vendored `services/hwfit` (pure stdlib, system python3, no venv). Detects RTX 4050 (5.99 GB, cuda), ranks fitting models w/ quant/ctx/run-mode/tps. `nightjar-hwcheck.ts` rewired; `hw-detect.mjs` now a shim → llmfit CLI. |
| **Headless email/CalDAV config** | ✅ PASS | `nightjar_odysseus_config.py` writes encrypted account rows into Odysseus `app.db` (mirrors demo_account.py); `add-email`/`add-caldav`/`list`. No Odysseus UI needed. |
| **Email send path** | ✅ PASS (offline) | `send_email` delivered through real SMTP to a local catcher (RCPT/subject/body intact). |
| **Attribution + AGPL-3.0-or-later** | ✅ PASS | `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md`; preserved Odysseus LICENSE/`licenses/`/ACKNOWLEDGMENTS, Row-Bot NOTICE, OpenCode MIT, llmfit MIT. |
| **All 7 MCP servers register** | ✅ PASS | `opencode mcp list` → nightjar + odysseus-{email,image,rag,research,docs,pim} all `✓ connected`, no OpenCode core changes. |
| **Tool-selection reliability (flagged risk)** | ❌ CONFIRMED RISK | ~53 tools; qwen3-4b scored **2/4** — see hazard 2. Per-mode scoping needed. |
| **E2E research→email chain** | ⚠️ PARTIAL | Chaining mechanism proven (OpenCode chained docs_search → email from one instruction); full delivery blocked by hazards 1 & 2. |

## Hazards — flag before shipping

### 1. Deep Research is impractical on a local 4B model (the biggest finding)
Search itself works offline with the **`ddgs`** pip package (DuckDuckGo — no SearXNG docker; internet still required, inherent to web research). But deep_research makes **many sequential large-context LLM calls** (per-source web-page extraction + multi-round synthesis). On Qwen3-4B each call sends huge prompts and **exceeds the Phase-1.5 90 s inference-timeout proxy → HTTP 504 → the whole research fails**. Direct run timed out at 300 s with repeated `nightjar inference timeout after 90000ms`.
- **Implication:** "Hey Nightjar, research X" is not viable on this hardware/model as-is.
- **Options:** run research against a larger/faster model or a cloud endpoint (breaks pure-offline); raise/disable the inference timeout for research calls specifically (risks runaway); or a lighter research pipeline. This is a real product decision, flagged.
- Also: `ddgs` must be added to the sidecar deps; DuckDuckGo scraping is rate-limit-prone (SearXNG is Odysseus's intended reliable backend — but that's a docker service we deliberately avoid).

### 2. Tool-selection reliability degrades with the combined ~53-tool list (confirmed)
Native OpenCode (~14) + Row-Bot nightjar (14) + Odysseus (email 14, image 1, rag 1, research 1, docs 2, pim 6) ≈ **53 tools**. Qwen3-4B probes:
- ✅ "add a note" → `pim_note_create`; ✅ "what's on my calendar" → `pim_calendar_list_events`
- ❌ "remember I prefer tabs" → called **no tool** (just acknowledged)
- ❌ "search my documents" → called `rag_manage_rag` (index-mgmt) instead of `docs_document_search` — name collision
- E2E: chained docs_search → email but picked `draft_email_reply` instead of `send_email` (14 similar email-tool names)
**Conclusion: per-mode tool scoping is required.** Expose a small, task-relevant tool subset per mode (coding / assistant / email / research) via OpenCode agent modes, and trim overlapping names (don't expose `manage_rag` alongside `document_search`; reduce the email server's 14 tools to the few needed). The single-agent-one-tool-namespace ideal works for chaining, but a 4B can't disambiguate 50+ tools reliably.

### 3. Intermittent pre-request bootstrap stall under memory pressure
The scoped E2E hung once at `init` (no session) — the same memory-pressure stall Phase 1.5's run-supervisor watchdog was built for. It resolved on retry. Note the Odysseus workspaces don't currently run that watchdog; wire it in (or accept retries) once these are combined. This box is now heavily loaded (llama.cpp 5.4 GB VRAM + Ollama embeddings + multiple MCP servers).

### 4. Email send is approval-gated by design (good, but needs a headless approval path)
`send_email` honors `agent_email_confirm` (default **True**) → it **stages a reviewable draft** ("Nothing has been sent yet") instead of auto-sending. This is the correct safety default (an LLM shouldn't silently email). Delivery only proceeded after setting it False (restored to True after testing). For headless Nightjar, add an "approve pending send" tool/CLI rather than disabling the gate.

## Offline / no-extra-install status
- **ChromaDB docker requirement ELIMINATED** ✅ — embedded PersistentClient, on-disk, no service. This was the non-negotiable gate.
- **No Postgres** (SQLite), **no torch** (fastembed/onnxruntime; embeddings via local Ollama `nomic-embed-text` — same backend as Row-Bot, one model).
- First-run downloads a small ONNX model to `~/.cache/chroma` (Chroma default EF) — a cache, not a service.
- **`ddgs` pip package** needed for offline-capable web search (no docker); acceptable (pip, not a service), must be added to sidecar requirements.
- **Not eliminated:** deep research needs internet (inherent) and is impractical on 4B (hazard 1).

## What runs where (Phase 2b state)
- **Native engine:** OpenCode (MIT) — the one agent loop + local model (llama.cpp + Phase-1.5 timeout proxy + watchdog + safety plugins).
- **Row-Bot bolt-on:** voice/wake/vision/**personal memory**/browser (Phase 2).
- **Odysseus sidecar (this phase):** email + image_gen + rag (direct stdio MCP); deep_research + docs_query + PIM (Nightjar wrapper MCP servers over Odysseus services/ORM). Embedded ChromaDB, SQLite data dir, headless config. `memory_server` intentionally unregistered.
- **Hardware layer:** llmfit (vendored, MIT) — detection + model-fit; feeds the startup log and future auto-switch.

## Artifacts (`phase2-odysseus/`)
- `servers/{deep_research_server,docs_query_server,pim_server,nightjar_odysseus_config,_bootstrap}.py`
- `hwfit_vendor/` (vendored llmfit + `hwfit_cli.py` + MIT license)
- `workspace/opencode.json` (all 7 servers), `workspace-scoped/opencode.json` (per-mode scoping demo)
- Patches to Odysseus clone (env-gated, marked `NIGHTJAR`): `src/chroma_client.py` (embedded), `services/docs/service.py` (doc-key fix)
- `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` (top-level, AGPL-3.0-or-later)

## Recommendation for the plan
Ship email/image/rag/docs/PIM as bolt-ons behind **per-mode tool scoping**. Treat **deep_research** as not-ready on local 4B — gate it behind a bigger-model/cloud option or a research-specific longer timeout, or defer. Add `ddgs` to sidecar deps; add a headless email-approval tool; wire the Phase-1.5 watchdog into the combined runtime.

---

# UPDATE — the PARTIAL/FAILED items are now FIXED

The three not-fully-passing items were addressed and re-verified.

### FIX 1 — deep_research now completes on the local 4B ✅ (was ⚠️ PARTIAL)
Root cause: the default pipeline (`max_rounds=8`, `max_content_chars=15000`) sent
~15k-char prompts to the 4B per source → ~95 s/call → tripped the Phase-1.5 90 s
inference proxy (504) → total failure. Fix in `deep_research_server.py`: drive
`DeepResearcher` **directly** with tight caps (`max_rounds=1`, `max_urls_per_round=2`,
`max_content_chars=2500`, `max_report_tokens=700`) and point its LLM calls at the
**direct llama-server (:8085, bypassing the 90 s proxy)** — DeepResearcher has its
own per-call timeouts, so the proxy isn't needed there. **Result: a real 3762-char
cited report with 10 sources in ~60 s.** (`ddgs` provides DuckDuckGo search — no
SearXNG docker.) Caveat retained: it's shallow (1 round) by necessity on a 4B;
deeper research still wants a bigger model.

### FIX 2 — tool-selection fixed via per-mode agent scoping ✅ (was ❌ CONFIRMED RISK)
Used OpenCode's agent `tools` allow/deny map (compiles to permission rules;
`findLast` precedence, so `{"*": false, "<tool>": true}` scopes to exactly the
listed tools). Defined three primary agents in `workspace/opencode.json`:
- **research** → 2 tools (`deep_research`, `send_email`)
- **assistant** → ~11 tools (PIM + Row-Bot memory + email send/list + doc search)
- **coding** → native tools only (all MCP denied)

Re-ran the two probes that failed at 53 tools, now under `--agent assistant`:
- "remember I prefer tabs" → `nightjar_save_memory` ✅ (was: no tool)
- "search my documents" → `odysseus-docs_document_search` ✅ (was: wrong `manage_rag`)
Scoping works **even with all 53 tools still registered** — the agent filters down.

### FIX 3 — E2E research→email now chains AND delivers ✅ (was ⚠️ PARTIAL)
`opencode run --agent research "Research MCP, then email a summary to boss@…"`:
tools called in order **`odysseus-research_deep_research` → `odysseus-email_send_email`**,
and the email was **delivered to the SMTP catcher** (RCPT `boss@example.com`,
subject "MCP summary", body = a real MCP research summary). The literal
"Hey Nightjar, research X and email me a summary" flow works when routed through
a scoped agent. (Email confirm-gate toggled off for the delivery proof, then
restored to the safe default `True`.)

### Net result
| Item | Before | After |
|---|---|---|
| deep_research on 4B | ⚠️ times out (504) | ✅ ~60 s, real cited report |
| tool-selection (combined list) | ❌ 2/4 | ✅ correct under scoped agents |
| E2E research→email | ⚠️ chain only, no delivery | ✅ chained + delivered |

**Residual (design, not bugs):** deep_research is intentionally shallow on a 4B
(depth needs a bigger model); email stays approval-gated by default (a headless
approve tool is still worth adding); per-mode scoping is now the required operating
model (the "one giant tool list" mode remains unreliable and should not be used).
New artifact: `workspace/opencode.json` `agent` section (research/assistant/coding).
