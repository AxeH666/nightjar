# Nightjar — Known Issues (tracking)

Issues discovered mid-phase and deliberately deferred to a dedicated pass, so
they don't derail the phase that found them. Newest first. Resolved items are
kept for the historical record with their root cause + fix + verification.

---

## 🧪 MANUAL VERIFICATION CHECKLIST (NJ-4 … NJ-11)

The Phase 0–6 pass (PRs #29–#35) code-wired every open item. Per **CLAUDE.md rule 6**,
nothing below is marked RESOLVED yet — each fix was implemented in a **headless** env with
no live stack/hardware, so it must be re-triggered on a real running instance before it
graduates. Run each check on the live app; when it passes, move that NJ item to ✅ RESOLVED
with the observed result.

**A. No special hardware — just the running app:**
- [ ] **NJ-4** (SSE reconnect): with a chat streaming, kill `opencode-serve` (`pkill -f "serve --port 4096"`); confirm the renderer auto-reconnects (recreates session + resubscribes) and the *next* prompt works — no window reload. (Also the BYOK-restart path.)
- [ ] **NJ-9** (image retry keeps its kind): force a **cloud** image turn to fail (bad/expired key or rate limit) → click **Retry on local model** → confirm it regenerates an **image**, not a chat reply about the prompt.
- [ ] **NJ-10** (persistent Stop): drive a coding edit so the permission ask fires; interrupt so the abort is dropped → confirm the ask clears, the session stays busy, and the red **Stop** stays clickable (session remains interruptible).
- [ ] **NJ-8** (large-artifact mitigation): on the **local 4B**, ask for a large single-file page → confirm you get multi-file output or a clean error, never a silent/garbage artifact; confirm a stronger BYOK model renders a big artifact fine.

**B. Needs Ollama + `gemma3:4b`:**
- [ ] **NJ-7** (local vision): with Ollama + `gemma3:4b` running → attach an image + ask about it → analysis works. Stop Ollama → composer **warns** (doesn't silently fail). Text docs (`.md`/`.txt`) work on any model.

**C. Needs a real GPU + `Z-Image-Turbo` pulled:**
- [ ] **NJ-6 / NJ-14** (offline image): with the model + GPU venv present and **Image = Offline** → generate → served **locally/offline**. Stop the diffusion server → image gen has **no backend** (NOT an auto cloud fallback anymore — NJ-14 removed that); set **Image = Online + a provider** to use cloud explicitly.
- [ ] **NJ-11 / B3** (diffusion wall-clock cap): the follow-up — add the server-side `--gen-timeout` backstop to `diffusion_server.py` and verify a hung generation is aborted server-side. GPU-only; lands with the NJ-6 hardware check.

**D. Needs a leftover/dev engine (adopt path):**
- [ ] **NJ-5** (adopted-engine restart): start a stray `opencode serve --port 4096` **before** launching June (so June *adopts* it) → change a BYOK key → confirm June restarts the adopted engine and the new key takes effect. Watch for orphaned MCP children (documented tradeoff).

**Also needs a real key (independent of the above):** the **cloud** image path was only mock-verified — with a real key, **set Image = Online** and pick the provider (NJ-14 — no longer auto-wired from key presence), then chat → approve → image, once for a real **OpenAI** key and once for a real **OpenRouter `sk-or-…`** key.

---

## 🔧 FIX IMPLEMENTED — RUNTIME/HARDWARE VERIFY PENDING

_All items below were code-wired in the Phase 0–6 pass (PRs #29–#35), plus a post-merge
audit follow-up (**PR #37** — NJ-12 + three hardening fixes surfaced by an independent
13-agent audit of the merged code). They stay here (not in ✅ RESOLVED) until re-triggered
on a live stack per the checklist above + CLAUDE.md rule 6. The only genuinely un-fixed
remainder is **NJ-11 / B3** (the server-side diffusion wall-clock cap), a GPU-only follow-up._

## NJ-18 — upstream (build123d): `export_gltf` reports SUCCESS while writing an EMPTY GLB, and an `import_step` tree cannot be exported at all — FLAGGED + MITIGATION IDENTIFIED (blocks the Task-5 CAD viewer) 2026-07-14

- **Severity:** high **for the CAD feature** (it silently produces an empty 3D model), zero today (no CAD code shipped yet). Found by probing the real library **before** writing the converter, per CLAUDE.md rule 6 — not by reading its docs.
- **Context:** Task 5's exploded-view viewer needs a **GLB with one named node per part**. `build123d-mcp`'s sandboxed `export` tool **cannot emit GLB** (formats are `step`/`stl`/`dxf`/`svg` only, and the sandbox strips `open`/`os`/`pathlib`), so Nightjar's design is: the model exports **STEP**, and a **trusted Nightjar-side converter** does STEP → GLB via `build123d.export_gltf`. Both halves of that conversion turn out to be booby-trapped.
- **What (verified on build123d 0.11.1 / cadquery-ocp-novtk, Python 3.12):**
  1. **`import_step`'s tree is not exportable.** Re-importing a STEP assembly yields a tree that is *structurally identical* to the original — same labels, same `wrapped` handles, same volumes, same solid count, and `PreOrderIter` walks it correctly — yet `export_gltf` on it writes a GLB with **0 nodes and 0 meshes**. It fails even for a **single** re-imported solid. Explicitly calling `.mesh(...)` on every node first does **not** help, so this is **not** a tessellation problem — the imported shape objects themselves cannot be serialized.
  2. **`export_gltf` returns `True` anyway.** It returned `True` in *every* case, including both empty-output ones. Its `raise RuntimeError` on write failure is commented out in the source, and the boolean it returns instead is **not** a reliable success signal either. **Checking the return value is NOT sufficient** — an earlier note in `JUNE_better.md` claimed it was; that has been corrected.
- **Mitigation (verified working):** in the trusted converter, **rebuild the tree** from the imported shapes' raw OCCT handles before exporting — wrap each child's `.wrapped` in a fresh `Solid(...)`, carry its `.label` across, and assemble a fresh `Compound`. That round-trips correctly and **preserves the per-part names** the exploded view depends on:

  | approach | GLB nodes |
  |---|---|
  | single re-imported solid | 0 |
  | re-imported tree, as-is | 0 |
  | re-imported tree + explicit `mesh()` | 0 |
  | **rebuilt `Compound` from `wrapped` handles** | **✅ `['planetary_gearset','sun_gear','planet_gear_1']`, 2 meshes** |

- **To do (lands with the Task-5 converter PR):** the converter must (a) rebuild the tree as above, and (b) **validate the emitted GLB bytes** — parse the JSON chunk and assert `nodes > 0` and `meshes > 0` — rather than trusting `export_gltf`'s return value. Without (b) a regression here ships an empty 3D model that looks like a success.

---

## NJ-17 — no scheduler daemon: JUNE has no long-lived process that could ever fire a reminder — FLAGGED (Task-6 prerequisite) 2026-07-14

- **Severity:** high for the reminders feature; it is the structural reason NJ-16's dead rows are never noticed.
- **What:** JUNE has **no long-lived host process**. The MCP servers are **stdio** children of the OpenCode engine (they exist only for the duration of a tool call), and the Electron main process runs **no scheduler/poller**. Odysseus upstream *does* ship a scheduler (`research/odysseus/` even has a `test_scheduler_restart_doublefire.py`), but Nightjar runs only the MCP wrappers — **not** Odysseus's Flask/FastAPI app or its scheduler. So even a correctly-written `next_run` would have nothing to act on it.
- **Consequence:** "remind me at 1pm" can be *stored* and can never *fire*. Both halves of Task 6 exist precisely to supply this missing daemon: the **local scheduler** in the Electron main (free tier — notifications while the app is open) and the **always-on server** (paid tier — Telegram delivery with the laptop closed).
- **To do:** Task 6. Closes together with NJ-16.

---

## NJ-16 — `pim_server.task_create` writes DEAD rows: no `next_run`, and nothing polls them — reminders silently never fire — FLAGGED (Task-6 prerequisite) 2026-07-14

- **Severity:** high — it is a **silent** failure. The tool returns `{"id", "name", "schedule"}` and the model cheerfully tells the user the reminder is set. Nothing ever fires.
- **Root cause:** `phase2-odysseus/servers/pim_server.py` `task_create` inserts a `ScheduledTask` with `status="active"` but writes only `name`/`prompt`/`task_type`/`schedule`/`scheduled_time`. It never computes **`next_run`** — even though `ScheduledTask.next_run` is a real, **indexed** column (`core/database.py`) that exists exactly to be polled. It also leaves `scheduled_date` (the "once" case) and `scheduled_day` (weekly/monthly) `NULL`, so the row does not even carry enough information to derive a fire time later.
- **Compounding:** nothing polls the table at all (see **NJ-17**), so the dead rows are never surfaced. `task_list` happily lists them as `active`, which makes the failure look like success from every angle.
- **To do (Task 6, first PR):** compute a real `next_run` on create (for `once`/`daily`/`weekly`/`monthly`, honoring the user's timezone → stored UTC), add `task_due` / `task_mark_fired` so a scheduler can claim and advance jobs, and migrate the existing dead rows. Unit-test the `next_run` math offline. Closes together with NJ-17.

---

## NJ-15 — latent: Odysseus's role-based endpoint resolver (email-AI path) is cloud-capable via settings-pointer / OAuth / Tailscale and leaks "Odysseus" branding on OpenRouter — FLAGGED (dormant; not activated by the provider-selection work) 2026-07-11

> **Update 2026-07-14 (PR #51 — email parked for v1):** this is now **more** dormant, not less. The entry below notes the path was gated by the assistant agent allowing only `list_emails`/`send_email`; **both of those allows have since been removed**, the research agent's `send_email` allow is gone, and the `odysseus-email` MCP server is `enabled: false` — so the `ai_draft_email_reply` tool that reaches this resolver is unreachable **and its server is not even spawned**. Re-check this entry when email is activated for v2; the caveats below (unconfigured creds, Gmail needing an app password, creds stored in plaintext config rather than encrypted like BYOK keys) are all still open and must be resolved *together* with the permission flips.

- **Severity:** low — **dormant**. Surfaced by the provider-selection audit + close-out review (CLAUDE.md rule 7: flag, don't silently fix or ignore). Not reachable in the shipped config.
- **What:** `research/odysseus/src/endpoint_resolver.py` has its OWN backend-selection machinery, separate from Nightjar's five capabilities: `resolve_endpoint(role)` picks a `ModelEndpoint` by a settings **pointer** (`{role}_endpoint_id` → `utility_` → caller fallback → `default_`), with fallback **chains** (`*_model_fallbacks`) and a **second** vision resolver (`resolve_vision_fallback_candidates`). It is reached by the `odysseus-email` `ai_draft_email_reply` MCP tool (`email_server.py`), and cloud routing there can come from three mechanisms the capability model doesn't cover: a static DB `api_key`, a **session-backed OAuth** credential (`provider_auth_id` → ChatGPT-subscription / Copilot, `resolve_endpoint_runtime`), and **Tailscale** host remap (`resolve_url` → `tailscale status` fallback). It also hardcodes OpenRouter branding `HTTP-Referer: https://github.com/pewdiepie-archdaemon/odysseus` + `X-OpenRouter-Title: Odysseus` in `_provider_headers`/`build_headers` (identity-rule violation, relates to **NJ-1**).
- **Why it's dormant (not a live leak):** the assistant agent's permission map denies the AI-email tool (`"*": "deny"`, only `list_emails`/`send_email` allowed), AND Nightjar never seeds `utility_`/`default_endpoint_id` (only `settings.image_model` is seeded), so these resolvers return "no endpoint configured" rather than routing anywhere. It is latent machinery, not an active path.
- **Mitigation already in place:** Nightjar's new cloud paths (research/vision, PR #43/#44) call `llm_call_async` / OpenAI-compatible endpoints **directly** with pre-set **Nightjar** attribution headers, so they never emit the Odysseus branding and never go through this resolver.
- **To address (when/if the AI-email path is enabled):** either fix `_provider_headers`'s OpenRouter branding **as an odysseus patch** under `phase2-odysseus/odysseus-patches/` (the submodule stays a clean upstream mirror — do NOT edit `research/odysseus/**` directly), and route the email-AI backend through the same explicit per-capability selection; or keep the tool permission-denied. Confirm on a live stack per rule 6 before enabling.

## NJ-14 — explicit per-capability Online/Offline + provider selection replaces all implicit local-vs-cloud precedence — FIX IMPLEMENTED (runtime-verify pending for live cloud/GPU paths) 2026-07-11

- **Severity:** medium — a cross-cutting behavior change to a safety/privacy surface (PRs #39–#45). Closes a real privacy leak (below) and removes two contradictory hidden precedences.
- **What changed:** every capability (chat/coding, image, deep research, vision, browser) now runs **Offline/local by default**; going **Online** and picking a provider is an explicit, persisted per-capability choice (BYOK "Capabilities" panel). A stored BYOK key **alone** never routes any capability to the cloud.
  - **Image gen:** removed the `OpenAI > OpenRouter` precedence (`applyImageEndpoint` now seeds only the explicitly-chosen backend; pure `resolveImageBackend`).
  - **Browser agent (privacy leak fixed):** previously routed to the cloud whenever ANY OpenRouter/OpenAI key was stored (`PREFER` defaulted to `byok`, MCP inherits `NIGHTJAR_BYOK_*`) — silent cloud egress that defeated the `byok.ts` scoping guarantee. Now defaults to local; only an explicit `NIGHTJAR_BROWSERUSE_PROVIDER` routes cloud.
  - **Deep research & vision:** gained **new** explicit cloud paths (were local-only / dead-stub), each with a rule-3 wall-clock timeout; vision's `vision_settings.json` is now aligned to `NIGHTJAR_VISION_MODEL` (source-of-truth fix).
- **Behavior changes to expect (intentional):** (1) **default Offline** — anyone who relied on the old implicit cloud image path picks a provider once; (2) **NJ-6's auto cloud-fallback-when-sidecar-down is removed** — Offline stays Offline (a down local sidecar means image gen has no backend, not a silent cloud call).
- **Close-out review fixes (this PR, #45):** a `restartService("opencode-serve")` **race** (now that `capabilities:set` for browser/research/vision joins `byok:set/remove` as an un-serialized restart caller) → made single-flight + coalesced like `reconcileImageEndpoint` (regression test in `test-supervisor-restart.ts`); stale comments (`services.ts`, `index.ts`) that described the removed cloud-fallback were corrected. Residual (low): a rare seed/unseed subprocess failure can transiently leave zero (or, if an unseed fails, a stale) image row — logged, and healed by the next reconcile.
- **To close (rule 6, needs a real key / GPU / Ollama):** for EACH capability set Online→pick a provider→exercise it and confirm the chosen provider is used; set Offline and confirm on-device. Critically: **with an OpenRouter/OpenAI key set but Browser = Offline, run a browser task and confirm it uses the LOCAL model (not cloud)** — the leak is closed. Verified headless so far: all four backend resolvers + the leak-closure/consistency review (0 findings) + the restart coalescing; the live cloud round-trips are not drivable headless.

## NJ-12 — supervisor: a service that misses its readiness window is frozen "unhealthy" and never re-probed, silently defeating the NJ-6 local-first image fallback — FIX IMPLEMENTED (runtime-verify pending) 2026-07-09
- **Severity:** medium — surfaced by the **post-merge independent audit** of the Phase 0–6 work (a control-flow gap confirmed by code read, not a live repro). GPU-only manifestation, silent, self-heals on app restart.
- **Symptom:** on a machine where the local diffusion sidecar's ~6GB cold GPU load exceeds `readyTimeoutMs` (180s — contended/cold GPU or slow disk), image generation stays pinned to the **cloud/BYOK** endpoint (or none) even though a fully-working local model is up and serving on :8100 — the exact offline local-first guarantee NJ-6 was built to protect.
- **Root cause:** in `phase3-ui/src/main/supervisor.ts` `spawn()`, the readiness loop's **timeout path** set the service `"unhealthy"` and returned **without** starting any probe. `beginHealthWatch` — the only thing that flips `unhealthy → healthy` — was reached only from the healthy-within-timeout path, the adopt path, and `restartService` (never invoked for `diffusion-server`; only `opencode-serve` is restarted). So once the model finished loading and began serving, nothing re-probed it: its state stayed `unhealthy` indefinitely, the supervisor status callback's `diffHealthy` never went false→true, and the NJ-6 transition reconcile (`index.ts`) never fired. The `index.ts` comment even explicitly *promised* to cover "a slow ~6GB cold load finishing past the readyTimeout" — the one case it did not.
- **Fix (PR #37):** the timeout path now starts a new **`beginRecoveryWatch(m)`** — a *passive* recovery probe that flips `unhealthy → healthy` once the service finally answers, then hands off to `beginHealthWatch`. It deliberately does **not** kill/restart on continued misses (unlike `beginHealthWatch`, whose 3-miss SIGKILL would restart the slow load from scratch → a doom loop): the process is alive and may just need more time, and the child's own `--timeout` + its `exit` handler still own the crash-restart (rule 3). It re-checks its guards after each `await` so a `stop()`/`restartService` landing mid-probe is not clobbered, and shares the `healthTimer` slot so both cancel it. General by design — **any** slow-loading managed service now self-heals after a readiness timeout instead of freezing.
- **To close (rule 6):** on a real **GPU box** where the Z-Image-Turbo cold load exceeds 180s (or force it by lowering the diffusion `readyTimeoutMs`), confirm the sidecar recovers to `healthy` once it starts serving and image gen switches from cloud back to **local** with no app restart.

## NJ-11 — image endpoint: seeded model was pinned but the resolver probed anyway; local diffusion server has no per-generation wall-clock cap — B13 FIXED / B3 OPEN 2026-07-09
- **Severity:** low — surfaced while wiring the NJ-6 local-first image backend.
- **B13 (FIXED — this PR, via `nightjar-odysseus.patch`):** `phase2-odysseus/seed_image_endpoint.py`
  pins the model (`ep.pinned_models = [model]`, commented "so it resolves without probing"),
  but Odysseus's `_resolve_model` (`research/odysseus/src/ai_interaction.py`) ignored pinned
  models for OpenAI-compatible endpoints and hit `/v1/models` on **every** image generation —
  an extra round-trip that hard-fails on the 5s probe timeout or a rate limit. The resolver now
  consults pinned models first (getattr-guarded, no-op without pins), resolving with no network
  call. (Setting `cached_models` alone was insufficient — it's only read when `build_models_url`
  is falsy, which never happens for OpenAI/OpenRouter.)
- **B3 (OPEN — follow-up):** `research/odysseus/scripts/diffusion_server.py` has **no server-side
  per-generation wall-clock cap** (rule 3) — a hung/looping pipeline `__call__` is bounded only by
  the client httpx read-timeout (300s) / the opencode MCP timeout, not server-side. Add a
  `--gen-timeout` backstop (run the pipeline call under a thread with a hard abort) when the local
  diffusion backend is driven on real GPU hardware.
- **Scheduled:** B13 ships with the NJ-6 local-image PR; B3 lands with the GPU-hardware verification
  of the local diffusion backend (it's GPU-only code — can't be exercised headless, per rule 6).

## NJ-10 — permission: a genuinely-undelivered abort leaves no in-UI re-abort control (rare) — FIX IMPLEMENTED (runtime-verify pending) 2026-07-09
- **Resolution (PR #31, Phase 2):** a persistent per-session **Stop** control in the composer, backed by `abortSession(id)` in `PermissionContext` — the session you are **viewing** is always interruptible even with no ask shown; on a failed abort `busy` stays true so Stop remains, and `client.abort()` is 10s-bounded (a 404 = already gone → clears). **To close (rule 6):** drive a coding edit so the ask fires, simulate a dropped abort, confirm the ask clears, `busy` stays, and the red **Stop** stays clickable.
- **Caveat (audit, not a regression):** the Stop control lives inside each tab's `ChatSurface`, so it renders for the session you are **viewing** but not for a **background** tab's session (its screen is `display:none`). A background session running with no pending ask therefore can't be stopped without switching to its tab — the global permission **Abort** still surfaces for any background *ask*, so only a running-with-no-ask background session is affected. Session-scoped by design (each Stop calls `abortSession(id)` for its own slot); left as-is. Revisit if a global "stop any running session" affordance is wanted.
- **Severity:** low — only on an actual `POST /session/:id/abort` failure (uncommon
  against the loopback engine), and it does **not** hard-wedge (the composer stays
  usable because `abort()` clears the session's `busy` before the POST).
- **Detail:** in the Stage-4 multi-session permission **queue** (`PermissionContext`),
  a failed `reply()` re-surfaces the ask only when it is genuinely still pending —
  reconciled against the `permission.replied` SSE stream (`repliedIds`) so a lost-ACK
  doesn't create a "zombie" already-answered ask. `abort()` **cannot** use that
  signal: the server resolves an aborted permission by cancelling the fiber and
  **silently deleting the pending permission with no `permission.replied` event**
  (confirmed in the vendored OpenCode source). With no way to tell a lost-ACK
  (already aborted) from a genuinely-undelivered abort, re-surfacing on abort would
  risk a zombie ask masking a live cross-session ask — worse than the residual. So
  abort deliberately does not re-surface: a genuinely-dropped abort leaves the
  session paused server-side with no in-UI re-abort control until reload/reconnect.
- **Root cause:** at-most-once semantics over an unreliable POST, with no engine-side
  ack/idempotency for the "abort resolves a pending permission" path.
- **Fix ideas:** (a) have the engine emit a `permission.replied`-family event when an
  abort cancels a pending permission — then the same reconciliation `reply()` uses
  would cover abort; (b) client-side, add a persistent per-session stop/interrupt
  control (independent of the ask) so a paused session is always abortable even when
  no ask is shown.
- **Scheduled:** documented tradeoff introduced with the multi-session permission
  queue (`feat/ui-redesign-sessions`, PR #23); recorded inline in `PermissionContext.abort()`.
  Revisit if the engine gains an abort-resolved permission event.

## NJ-9 — Create-Image recovery resends the raw prompt as a plain chat message (loses the generate_image directive) — FIX IMPLEMENTED (runtime-verify pending) 2026-07-09
- **Resolution (PR #32, Phase 3):** fallback/rate-limit offers now carry a `SendKind` (`"chat" | "image"`); the local-retry path re-dispatches an image offer through `createImage()` (which re-wraps the `generate_image` directive) instead of the plain `send()`, so an image request stays an image request on recovery. **To close (rule 6):** force a cloud image turn to fail (bad key / rate limit), click **Retry on local model**, confirm it regenerates an *image* — not a chat reply describing one.
- **Severity:** low — only when a **cloud** image-generation turn fails via
  `session.error`, and the local model *may* still opportunistically call the tool.
- **Detail:** `SessionsContext.createImage()` stores the **raw** description in
  `refs.lastSent`, while the prompt actually sent is the wrapped *"Use the
  generate_image tool…"* directive (never stored). If the image turn fails on a cloud
  model (`session.error` → `handleSessionError`), the recovery offer's `text` is the
  raw prompt; clicking **Retry on local model** runs `send(…, prompt)` and dispatches
  the bare prompt as an **ordinary chat message**, so the model chats *about* the
  prompt instead of regenerating the image.
- **Root cause:** the recovery offer carries no *kind* (chat vs image); `lastSent` is
  the raw prompt, not the directive, and retry always uses the plain `send` path.
  **Pre-existing** — the identical wiring existed in the former single-session
  `ChatContext`; the PR #23 adversarial review surfaced it (did not introduce it).
- **Fix idea:** tag the recovery offer with the send kind (`chat` | `image`) and
  re-dispatch an image retry through `createImage()` (which re-wraps the directive),
  or store the directive-wrapped text for image sends.
- **Scheduled:** small follow-up; natural home is the chat-attachments / image-gen
  path (relates to **NJ-6**/**NJ-7**). Not a blocker for the multi-session PR.

## NJ-8 — live-preview: large single-file artifacts truncate on the local 4B — MITIGATED (runtime-verify pending) 2026-07-09
- **Resolution (PR #30, Phase 1):** this is a local-model *capacity* limit, not a bug, so it's **mitigated** rather than closed. The coding prompt now steers the local 4B toward **concise, multi-file** writes (each under budget); an opt-in `NIGHTJAR_DESIGN_PROFILE=1` raises the predict/context caps **and** the matching wall-clock timeouts **together** and each stays finite (rule 3 — never the global default, `services.ts`); a truncated `write` still fails cleanly (empty part → `error`, no partial file). **To close (rule 6):** on a real local 4B ask for a large single-file page → confirm it emits multi-file (or a clean error), never a silent/garbage artifact; a stronger BYOK model renders big artifacts directly.
- **Severity:** low — the live-preview panel *mechanism* (mirror write/edit tool-call content → sandbox → loopback server → iframe + markdown render + download) is implemented and **verified end-to-end** (`phase3-ui/test-preview-e2e.ts`: coffee-shop HTML + markdown doc, 5/5; `test-preview-server.ts` 18/18). Only the model's ability to emit a *big* artifact in one tool call is limited.
- **Detail:** the coding agent writes files via its `write` tool. The local **Qwen3-4B** is capped at `--predict 2048` tokens (a rule-3 safety backstop, `services.ts`). An elaborate single self-contained page can exceed that, so the `write` tool-call JSON is **truncated → the part goes `pending → error` with empty `input`** (observed). The preview correctly renders nothing for an errored write (no partial/garbage file). A **concise** page or a **markdown doc** fits the budget and renders fine; so does any artifact on a **stronger BYOK/OpenRouter model**.
- **Mitigations in place:** the coding-mode system prompt steers previewable artifacts under a (gitignored) `preview/` dir **using the write tool** (not inline), and toward concise output; multi-file output (separate `index.html`/`style.css`/`script.js`) also keeps each write within budget.
- **Fix ideas:** encourage multi-file/concise generation more strongly; raise `--predict` only behind a "design" profile (never the global default — rule 3); rely on a BYOK model for large artifacts.
- **Scheduled:** revisit with the full UI redesign (AUDIT §10 Step 7) and/or a stronger local model; documented behavior of the live-preview feature (`feat/live-preview-panel`).

## NJ-7 — attached-image analysis is model-dependent (local needs Ollama gemma3; Create-Image reliability) — FIX IMPLEMENTED (code-wired; needs Ollama+gemma3 to verify) 2026-07-09
- **Resolution (PR #33, Phase 4):** the composer now gates on a **vision-readiness** probe — `useVisionReadiness()` returns `boolean | null` (null = status not yet known), keyed on `ollama === "running"`, and only *blocks/warns* on an explicit `=== false` so it never false-warns before status arrives; the local route saves the image + hints the path and `nightjar_analyze_image` is permission-granted (assistant mode); `vision.py`'s `_local_vision_blocker()` probes the active model and fails **open** (skips cloud/`/`-prefixed models). Create-Image reliability improved via a retry-once. **To close (rule 6):** with **Ollama + `gemma3:4b`** running, attach an image → analysis works; with it stopped → composer warns (not silently fails); text docs work on any model. The gemma3 bundling is an installer task (Step 11).
- **Severity:** low — the attach-and-send *mechanism* (paste/drag/browse → file part → agent) works; only the downstream image *analysis* is conditional.
- **Detail:** the local Qwen3-4B is **text-only**, so an attached image is only *seen* directly by a **cloud vision model** (BYOK OpenAI/Anthropic/Google). For the **local** route the composer saves the image to disk + hints the path, and `nightjar_analyze_image` is now permission-granted (assistant mode) — but that tool needs **Ollama + `gemma3:4b`** installed/running; without it the call errors. Text docs (`.txt`/`.md`/…) are read server-side and injected as text, so they work on **any** model.
- **Also:** the **Create Image** button uses a strong directive (OpenCode exposes no client-side `tool_choice`), so a small local model may occasionally not call `generate_image` on the first try.
- **Fix idea:** bundle/guide the `gemma3:4b` install in the installer (Step 11); optionally ship a vision-capable local model (mmproj); if OpenCode adds forced tool-choice, wire Create-Image to it directly.
- **Scheduled:** the gemma3 dependency → installer (Step 11); otherwise documented behavior of the chat-attachments feature (`feat/chat-attachments`).

## NJ-6 — image_gen: cloud path enabled (OpenAI + OpenRouter); local-first backend now code-wired — FIX IMPLEMENTED (code-wired; needs GPU+Z-Image-Turbo to verify) 2026-07-09
- **Resolution (PR #34, Phase 5):** the **local-first/offline** backend is now wired end-to-end (previously the remaining gap). `services.ts` adds a best-effort `diffusion-server` sidecar, launched **only** when both the model dir (`~/models/Z-Image-Turbo` with `model_index.json`) and the GPU venv exist (mirrors the ollama gate), wall-clock-gated by `readyTimeoutMs:180000` (rule 3 at process level); `index.ts` picks **local-first** (only unseeds the cloud endpoint after a *confirmed* local seed) and reconciles on diffusion-server health transitions. Two odysseus patch fixes ride along: **B13** (`_resolve_model` consults pinned models → no `/v1/models` probe per generation) and **B12** (`response_format=b64_json` + retry-without-param). **To close (rule 6):** on a real **GPU box + Z-Image-Turbo pulled**, generate → served locally (offline); stop the local server → falls back to cloud (with a BYOK key). Residual **B3** (no server-side per-generation cap) tracked under **NJ-11**. Installer model-pull is Step 11.
- **Severity:** medium (was: does not work at all). Chat→image now works via a **cloud**
  endpoint once seeded — either **OpenAI** or **OpenRouter** (auto-wired from the BYOK key,
  OpenAI takes precedence); the **local-first/offline** backend is still pending.
- **✅ Progress (2026-07-06):**
  - **Gap 1 FIXED** — `odysseus-image_generate_image` granted (`"ask"`) in **assistant** mode
    (`opencode.json`), so the agent can call it (still approval-gated, per rule 1).
  - **Gap 2 — cloud endpoint mechanism added + verified.** `phase2-odysseus/seed_image_endpoint.py`
    registers an OpenAI-compatible image endpoint in Odysseus's `model_endpoints` DB (key
    Fernet-encrypted at rest), enables `image_gen_enabled`, and sets `image_model`. **Verified
    end-to-end** by `phase2-odysseus/test_image_gen.py` against a **mock** OpenAI endpoint: the
    real `image_gen_server.py` path resolved the endpoint → POST `/images/generations` → b64
    decode → **wrote a real PNG** → returned a link (PASS).
  - **Gap 2b — auto-wired from the single BYOK key (no separate script).** The main process
    (`phase3-ui/src/main/index.ts`) now runs the seed automatically whenever an **OpenAI**
    key is set/removed in the BYOK panel (`byok:set`/`byok:remove`, passing the decrypted key
    via env → `NIGHTJAR_IMAGE_MODEL=dall-e-3` by default), and re-seeds any stored key at
    startup. So pasting the OpenAI key is the only step — image gen, chat, etc. all work from
    it. Verified end-to-end (mock OpenAI): set→endpoint row (encrypted key decrypts) + image
    generated; remove→endpoint deleted. (`test_image_gen.py`, 4/4.)
  - **Gap 2c — OpenRouter added as a second cloud backend (2026-07-07).** Image gen can now
    also run through **OpenRouter's Unified Image API** (`POST https://openrouter.ai/api/v1/images`,
    request `{model, prompt, …}` → response `{data:[{b64_json}]}` — same shape OpenAI uses, only
    the path differs: `/images` vs `/images/generations`). `image_gen_server.py` picks the dialect
    from the endpoint host (`_image_api_style()`; override `NIGHTJAR_IMAGE_API_STYLE` for tests) and
    relaxes the DALL·E-3 size clamp for non-OpenAI models (FLUX/Seedream/etc). `index.ts` now
    reconciles **one** active image endpoint from the stored BYOK keys with **OpenAI taking
    precedence** — an OpenRouter key wires image gen only when **no OpenAI key** is present
    (default model `openai/gpt-image-1`; override `NIGHTJAR_IMAGE_OPENROUTER_MODEL`). `seed_image_endpoint.py`
    is now provider-neutral (`NIGHTJAR_IMAGE_API_KEY`, back-compat `OPENAI_API_KEY`). **Verified
    end-to-end** against a **mock OpenRouter** endpoint: seed→`/images` POST (never `/images/generations`)
    →b64→PNG→link, host-dialect detection (openrouter.ai→openrouter, api.openai.com→openai),
    encrypted-key row + unseed. (`test_image_gen_openrouter.py`, 7/7; `test_image_gen.py` still 4/4.)
  - ⚠️ **Not yet verified against real OpenAI / real OpenRouter** (no key in this environment; `gpt-image-1`
    needs OpenAI org verification — `dall-e-3`, the auto-wire default, works without). The full
    live **paste-key → chat → approval → image** flow needs a running-app + real-key check, for
    both a real OpenAI key and a real OpenRouter `sk-or-…` key (the Electron `reconcileImageEndpoint`
    precedence + subprocess seed wasn't driven headless here — mock-verified only).
  - **Still OPEN:** the **local-first/offline** backend (Z-Image-Turbo via `diffusion_server.py`)
    is deferred to **Step 11** (installer model-download) as planned — the cloud path above is
    an interim opt-in that sends prompts off-machine.
- **Severity note (original, for history):** image generation **did not work at all** — two
  independent gaps below.
- **Gap 1 — no mode can call the tool.** All three agent modes in `opencode.json`
  (assistant/coding/research) are deny-by-default (`"*": "deny"`) and none whitelists
  `odysseus-image_generate_image`, so the agent is **not permitted to invoke it even when the
  user asks in chat** (correct per rule 1 — the tool was simply never added to an allow-list).
- **Gap 2 — no image endpoint configured (not local-first).** The `odysseus-image` MCP
  (`research/odysseus/mcp_servers/image_gen_server.py`) is API-based and resolves its endpoint
  from **Odysseus's own `ModelEndpoint` DB — NOT Nightjar's BYOK keys** — which is empty, so
  even a permitted call returns "No image model found." As shipped it would only work by
  pointing at **cloud** OpenAI (`gpt-image-1`/`dall-e-3`), contradicting local-first.
- **Root cause:** the tool was never granted to a mode, and the local `diffusers` server
  (`research/odysseus/scripts/diffusion_server.py`) exists but is launched/wired nowhere with
  no `image_model` configured.
- **Fix idea (Step-3 audit recommendation):** (a) grant `odysseus-image_generate_image` to a
  mode (e.g. assistant, `"ask"`); (b) run `diffusion_server.py --model Tongyi-MAI/Z-Image-Turbo`
  (Apache-2.0, ~6 GB VRAM) as a managed sidecar and register it as the Odysseus image endpoint;
  pull the model in the installer's model-download step. **Never** default to FLUX.1-dev / SD 3.5
  (non-commercial / community-licensed). Full audit + license table:
  `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` → "Image-generation model licenses".
- **Scheduled:** small implementation task — natural home is the **one-command installer**
  (Step 11, model download) + a one-line `opencode.json` permission grant. The license audit
  itself (Step 3) is ✅ done.

## NJ-5 — BYOK key change can't be applied to an *adopted* opencode-serve — FIX IMPLEMENTED (runtime-verify pending) 2026-07-09
- **Resolution (PR #35, Phase 6):** the supervisor now **captures the external PID at adoption** via a cross-platform `pidOnPort()` (linux `ss`→`lsof`→`fuser`, darwin `lsof`, win32 `netstat`; `execFile` with a 2s timeout + `windowsHide` per rule 3), returning a PID **only when exactly one distinct listener is found** (rule 4 — never an ambiguous kill target). `restartService()`'s adopted branch **re-queries the current listener at restart time** (no stale PID), then SIGTERM→wait→SIGKILL→wait→bail-if-still-held, else re-spawns with the new `NIGHTJAR_BYOK_*` env — so a BYOK change now applies to an adopted engine. **Known tradeoff (rule 7):** restarting an adopted engine we didn't spawn can orphan MCP children it started; documented inline in `supervisor.ts` + the PR. **To close (rule 6):** leave a stray `opencode serve` on :4096, start June, change a BYOK key → confirm the adopted engine restarts and the new key takes effect.
- **Hardening (PR #37, audit):** the adopted-restart SIGKILL now **re-queries `pidOnPort` immediately before killing** and fires only if the port's sole listener is **still the same PID** — closing a narrow window where an external respawn + OS PID-recycle during the SIGTERM wait could have signalled an innocent process (rule 4). If the PID changed, it skips the kill and the honest "didn't release" surface reports instead.
- **Severity:** low — only affects the adopt path (a `opencode serve` already on
  :4096 when Nightjar starts, e.g. a leftover/dev instance); the normal path
  where Nightjar spawns the engine is unaffected.
- **Symptom:** adding/removing a cloud key does not take effect; the key stays
  inert until Nightjar (and the engine) is fully restarted.
- **Root cause:** the supervisor adopts a healthy service by *port probe* and
  never captures the external PID, so `restartService()` has no process to stop
  and cannot re-exec it with the new `NIGHTJAR_BYOK_*` env.
- **Mitigation shipped (feat/byok-cloud-keys):** `restartService()` now detects
  this instead of spawning a colliding second engine that the stale one would
  shadow — it surfaces an "adopted / can't apply" state + health-strip detail
  telling the user to restart Nightjar. So the failure is honest, not silent.
- **Fix idea:** capture the PID at adoption (port→PID lookup) so adopted services
  can be cleanly restarted, or offer to take over the port.
- **Scheduled:** **Step 15 (real-hardware QA)** in the `AUDIT_REPORT.md` §10 confirmed
  order — the adopted/leftover-engine scenario is exercised during multi-process
  real-hardware testing, and the supervisor lifecycle fix lands with it.

## NJ-4 — Renderer SSE stream does not auto-reconnect after an engine restart — FIX IMPLEMENTED (runtime-verify pending) 2026-07-08
- **Severity:** medium — chat silently stops working (dead stream + stale session
  id) until a full window reload.
- **Symptom:** after `opencode-serve` restarts, the renderer keeps its original
  one-shot SSE subscription and session id; new prompts target a session that no
  longer exists and no events arrive.
- **Root cause:** the connect `useEffect` in `App.tsx` subscribes exactly once and,
  on stream close, only calls `setStatus("stream closed…")` — it never re-enters
  the connect/retry loop. Predates BYOK; the supervisor's crash→auto-restart of
  opencode-serve already triggered it.
- **Mitigation shipped (feat/byok-cloud-keys):** the BYOK-triggered restart now
  forces a reconnect (recreate session + resubscribe) via a `reconnectTick`. The
  **crash-restart** path is still uncovered.
- **Fix idea:** on SSE close, re-enter the bounded connect/retry loop (the same one
  used at startup) instead of parking on a status string.
- **Fix (implemented — redesign Stage 3, 2026-07-08, `feat/ui-redesign-nj4`):** in the
  reworked connection layer (`phase3-ui/src/renderer/src/context/ConnectionContext.tsx`),
  the single SSE subscription now re-enters the bounded connect/retry loop on **any**
  stream termination — a clean close (`.then`) OR an error (`.catch`) — not just the
  BYOK restart; both bump the same `reconnectNonce`, recreating the session + resubscribe.
  A 1s settle floor plus the loop's existing 2s `listAgents` backoff bound flapping if the
  engine crash-loops; an aborted-guard prevents a reconnect fired after teardown so it
  never double-connects.
- **Hardening (PR #31, Phase 2):** the multi-session refactor added a **superseded-run guard**
  so a reconnect that fires after a newer session/subscription has taken over cannot deliver
  stale SSE events into the live session, plus the stale-ask prune in `PermissionContext`.
  Reconnect is now covered on **both** the BYOK-restart and the crash-restart paths.
- **Correction + hardening (PR #37):** an earlier version of this entry claimed "`gcSessions`
  won't abort a still-busy session" — that was **backwards**. B9 (`SessionsContext.tsx`)
  *deliberately* aborts a still-busy **unbound** session before forgetting it, so a mid-turn
  session dropped by a slot rebind can't wedge un-droppable server-side (it has no Stop control
  once unbound). That behavior is correct; the doc line was stale. The audit also found B9 read
  "busy" only from the `sessionsRef` mirror (which can lag a send by one flush) while its sibling
  B3 reap uses a synchronous `lastSent` belt — B9 now uses the **same belt**, so a session GC'd in
  the same tick it sent is still aborted, not forgotten mid-turn.
- **Verification:** ⚠️ **PENDING** — implemented in a headless env with no reachable
  opencode-serve, so the actual kill-engine → auto-resubscribe → working-prompt path was
  NOT driven end-to-end (CLAUDE.md rule 6). Drive it on a live stack before moving this to
  RESOLVED.

---

## ✅ RESOLVED

## NJ-13 — BYOK: the `NIGHTJAR_BYOK_ALLOW_INSECURE` test hatch still threw on a keychain-less box (saving any key failed) — FIXED 2026-07-09
- **Severity:** medium (test/dev only) — with the hatch **on**, saving *any* cloud key (repro'd with OpenRouter) failed with `Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.`, so BYOK could not be exercised at all on a machine without an OS keyring (WSL2 / headless Linux). Found during manual testing.
- **Root cause:** `setKey()` in `phase3-ui/src/main/byok.ts` treated the `ALLOW_INSECURE` branch as *log-a-warning-then-continue* — it fell through to an **unconditional** `safeStorage.encryptString(trimmed)`. The code (and its comments) assumed Electron's `safeStorage` silently falls back to a `basic_text` backend when no keychain is present; it does **not** — with `isEncryptionAvailable() === false`, `encryptString` **throws**. So the hatch only ever "worked" on a box where a keyring happened to be present (masking the bug since the first BYOK commit); it wasn't a UI-redesign regression, just first surfaced now under real keychain-less manual testing.
- **Fix:** `setKey()` now routes on `isEncryptionAvailable()`: keychain present → `safeStorage.encryptString` tagged `enc:`; keychain absent + `ALLOW_INSECURE` → store the key with a clearly-labeled **base64 obfuscation** tagged `insec:`, **bypassing safeStorage entirely** (never calling the throwing API). `decrypt()` routes by tag (`insec:` → base64 decode with no safeStorage; `enc:`/legacy-un-prefixed → `decryptString`), so the key round-trips and `envForOpencode()` injects `NIGHTJAR_BYOK_OPENROUTER` into the engine. Misleading `basic_text` comments corrected.
- **Verification:** `phase3-ui/test-byok-insecure.ts` (13/13) mocks `electron` to reproduce the exact throw (`isEncryptionAvailable()=false`, `encryptString` throws) and proves: save no longer throws, the key round-trips, `listStatus` reports it present, and `envForOpencode` injects it — **plus** the real-keychain `enc:` path and legacy un-prefixed back-compat still work, and an undecryptable ciphertext is still reported absent. ⚠️ The full **in-app** paste-key → save → live OpenRouter **cloud call** was not driven here (headless, rule 6) — but injection uses the same `{env:NIGHTJAR_BYOK_*}` path the encrypted flow already uses.

## NJ-3 — Duplicate messages in the chat surface — FIXED 2026-07-05
- **Severity:** medium — UX; no data loss.
- **Symptom:** the user's message rendered twice in `ChatSurface`.
- **Root cause (confirmed by capturing the real SSE stream during a prompt):**
  `send()` optimistically adds the user's message with a client id
  (`local-<ts>`), and OpenCode *also* echoes the same user message over the
  event stream with its own server id (`msg_…`, `role:"user"`) plus a text
  part. `handleEvent` created a second message for that server id → the user's
  turn rendered twice. A latent second bug compounded it: the
  `message.part.updated` handler hard-coded `role:"assistant"` for every part
  (`part.messageID === sessionRef.current ? "assistant" : "assistant"` — both
  branches identical).
- **Fix (`phase3-ui/src/renderer/src/App.tsx`):** track `roleById` from
  `message.updated`, only render **assistant** messages/parts from the server,
  and drop the server's echo of the user message (the client already renders it
  optimistically). Removed the dead ternary.
- **Verified:** loaded the real built app against the live stack, sent a real
  message, counted rendered bubbles in the DOM → `you: 1, nightjar: 1` (exactly
  once each). Screenshot confirms a single "YOU" + single "NIGHTJAR" bubble.

## NJ-2 — Mode selector showed OpenCode's built-in agents — FIXED 2026-07-05
- **Severity:** low — cosmetic clutter (selecting Build/Plan ran OpenCode's
  stock agents instead of a Nightjar mode).
- **Root cause:** `OpenCodeClient.listAgents()` filtered only `hidden!==true`
  and `mode!=="subagent"`; OpenCode's `build`/`plan` are non-hidden primary
  agents, so they passed. Confirmed via `GET /agent`: `build`/`plan` carry
  `native:true`; Nightjar's own modes carry `native:false`.
- **Fix (`phase3-ui/src/renderer/src/lib/opencode.ts`):** add `native !== true`
  to the `listAgents()` filter. Robust — any agent defined in our
  `opencode.json` is `native:false`, so no hardcoded name list is needed and
  future Nightjar modes appear automatically.
- **Verified:** ran the real `listAgents()` against the live server →
  `["assistant","coding","research"]` exactly (no build/plan). Screenshot of the
  running app shows the header selector with only Assistant / Coding / Research.

## NJ-1 — Agent identified itself as "Odysseus" instead of "Nightjar" — FIXED 2026-07-05
- **Severity:** medium — branding + trust.
- **Root cause (confirmed by live probing):** the `research` and `coding` agent
  prompts contained **no identity anchor** ("You research a topic…", "You are a
  coding agent…"), while the system prompt is saturated with the string
  "odysseus" — every Odysseus tool is namespaced `odysseus-*` (in the always-present
  tool list) and OpenCode injects an `<mcp_instructions><server name="odysseus-…">`
  block per server (`packages/opencode/src/session/system.ts`). With no
  counter-signal, the model latched onto that. Reproduced pre-fix: `research`
  mode answered *"I am not Odysseus or Nightjar… I leverage the capabilities of
  Nightjar and Odysseus"* — explicitly disowning its Nightjar identity. (Note:
  the MCP servers do **not** set an explicit persona via `instructions=`; the
  leak was the namespace + missing anchor, not an injected "you are Odysseus".)
- **Fix (`phase2-odysseus/workspace/opencode.json`):** prepend a strong, shared
  identity rule to **all three** agent prompts — asserts "You are Nightjar",
  states that `odysseus-`/`nightjar_`/`row-bot` prefixes are internal component
  names (not identity), and forbids identifying as Odysseus/OpenCode/Row-Bot.
- **Verified:** after reloading the config, re-ran the identity-pressure probe
  in all three modes → each answers "I am Nightjar… not Odysseus/Row-Bot".
  Also confirmed identity holds *after invoking a real Odysseus tool*: in
  assistant mode, "list my notes then tell me your name" returned the real notes
  via the `odysseus-pim` tool and still answered "My name is Nightjar."
