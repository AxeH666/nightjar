# JUNE — v1 shipping plan (source of truth)

> **This file is the authoritative v1 plan.** Other planning/config files reconcile to it — see **Files to reconcile** below. Make those edits in **separate follow-up PRs, one at a time**, not in this pass.
>
> **v1 plan — Task 4 (attachments) is SHIPPED (PR #46); Tasks 3 → 1+2 → 5 → 6 remain.** Sequencing follows the one-PR-at-a-time rule (branch off fresh `main`, merge, pull, then next). Every task keeps a **rule-6 live-verify** (re-trigger the real behavior on a running instance, not just typecheck/build). **File:line references here are approximate guides — they drift as code changes; re-locate by symbol/grep.**

---

## Working rules (project — persists across chats; do not drift)

**The per-PR cycle — follow in order, every PR. No stacking, ever.**

1. **Branch off fresh `main`** (`git checkout main && git pull` first). Never branch the next PR off the previous PR's branch.
2. **Implement one task → one PR.** `typecheck` + `build` + any pure-logic unit tests before pushing.
3. **WAIT for BugBot to finish.** Poll `gh pr checks <#>` until *Cursor Bugbot* leaves `pending`. The PR is **not** done until BugBot has posted its review.
4. **If BugBot flags anything → verify it, fix on the SAME branch, re-push.** Never open a new PR for the fix. **BugBot reviews ONCE and does NOT re-run on the fix** — a lingering comment may be stale (check its "Reviewed … for commit `<sha>`" footer vs. the fix commit). Get it right in that one pass.
5. **Clean → I merge it, delete the branch, and pull `main`** (`gh pr merge <#> --merge --delete-branch` → `git checkout main && git pull`). "Clean" = CI/checks green **and** BugBot addressed.
6. **Only then start the next PR** (back to step 1).

**Also:**
- **Rule-6 live-verify** on every task — re-trigger the real behavior on a running instance (actually drop files / click Browse / send a message), not just `typecheck` + `build`. State honestly when a path needs the GUI / GPU / keys and can't be driven headless.
- **I merge, not the user** (changed 2026-07-14 — reverses the earlier "user merges" rule). Once a PR is clean I merge it, delete the branch, pull `main`, then start the next PR.

---

## v1 scope

**Ships in v1:**
- **(a) Desktop app — Chat** with local Qwen / BYOK, behind the global **Local/Cloud** toggle (Tasks 1–2).
- **(b) Prompt-to-CAD** — the "Iron Man" conversational 3D feature (Task 5).
- **(c) Telegram scheduling/reminders** — natural-language reminders delivered to your phone (Task 6).

**NOT in v1 — explicitly deferred:**
- **All email / Gmail / communications** → **v2 (Communications)**. Parked below; out of the v1 sequence.
- **Cowork tab** → **v2**. **Keep it hidden/disabled in the v1 build** — the "Cowork — coming soon" surface stays gated off; do not release it.
- **"Hey June" voice activation** → **last**, after (a)/(b)/(c) ship. Built once the core is solid, not now.

## Architecture (v1)

Local-first desktop app **+ one thin always-on scheduler server** (the *only* hosted piece; everything else runs on-device).

- **Login = Telegram identity.** No passwords. The **same Telegram connection is both login and the reminder channel** — everyone connects Telegram through the server; only the always-on scheduling/persistence is paid.
- **Pricing tiers:**

  | Tier | Reminders | How it works |
  |---|---|---|
  | **Free** | Local **desktop notifications**, **only while the app is open** | a **local scheduler** in the Electron app — no server |
  | **Paid ($7/mo)** | Delivered to your **phone via Telegram, anytime** (laptop closed or not) | the **server** holds the schedule + stays awake |

## Files to reconcile to this plan (separate follow-up PRs — NOT this pass)

- **`phase2-odysseus/workspace/opencode.json`** — agent/permission config: **park** the email tools out of the active agent, add the CAD MCP + `websearch` agent + Telegram wiring.
- **Cowork-tab gating** — hide/disable the Cowork tab in the v1 build ([TabBar.tsx](phase3-ui/src/renderer/src/shell/TabBar.tsx), [AppShell.tsx](phase3-ui/src/renderer/src/shell/AppShell.tsx), [CoworkScreen.tsx](phase3-ui/src/renderer/src/screens/CoworkScreen.tsx)).
- **`KNOWN_ISSUES.md` / NJ-\*** — record the `task_create` dead-rows + no-daemon blockers (now Task 6 prerequisites) and the parked email-config caveats.

---

# v1 tasks

## Task 4 — Fix file attachment (drag-and-drop **and** Browse) — ✅ SHIPPED (PR #46)

> **Status: ✅ FIXED in PR #46.** What shipped: (1) **DnD** — window-level `dragover`/`drop` `preventDefault` (main.tsx) + a `will-navigate` guard anchored to the current document URL (index.ts) + the **whole chat surface** is now a drop zone with a "Drop files to attach" overlay; (2) **Browse** — `pickAttachments` no longer silently swallows a `readAttachment` reject (root cause was the 25 MB cap on a large photo) → errors are surfaced, the cap is raised to 100 MB, and a visible **📎 attach button** was added. BugBot flagged the `will-navigate` `file://`-prefix bug; fixed on the same branch (`1ecad99`). The diagnosis + fix detail below is kept as the record; **live GUI drop/Browse verify is the user's step** (can't be driven headless).

**Root cause — drag-and-drop (diagnosed):** DnD *is* wired ([ChatSurface.tsx:115-118,187-195](phase3-ui/src/renderer/src/components/ChatSurface.tsx#L115-L118), [attachments.ts](phase3-ui/src/renderer/src/lib/attachments.ts)), but:
1. **No window-level drop guard.** There is **no** document/window `dragover`/`drop` `preventDefault` and no `will-navigate` guard in main (only a `before-quit` handler at [index.ts:498](phase3-ui/src/main/index.ts#L498)). In Electron/Chromium, a file dropped **anywhere except** the handler makes the window **navigate to the `file://`** — the app is replaced by the raw file/image. That reads as "DnD is broken / the app breaks."
2. **Drop target is only the ~50px composer bar** ([ChatSurface.tsx:187-195](phase3-ui/src/renderer/src/components/ChatSurface.tsx#L187-L195)). Users drop onto the large message area, which isn't a target → miss (or navigate, per #1).
- *Good news:* the content path uses `FileReader` + `saveAttachment` ([attachments.ts:37-56](phase3-ui/src/renderer/src/lib/attachments.ts#L37-L56)), **not** `File.path`, so it's safe on Electron 33 (which removed `File.path`).

**Root cause — Browse / attach option (diagnosed + fixed):** the dialog opened and returned the path fine, but `pickAttachments` wrapped `readAttachment` in a `catch {}` that **silently swallowed the reject** (the 25 MB size cap on a large photo) — so the picked file was dropped with no chip and no message. Fixed: per-file errors are surfaced, the cap raised to 100 MB, and a visible 📎 attach button added. (Paste uses the `FileReader` path, which worked — that's why only Browse hit this.)

### Fix
- **Window-level guard (the critical fix):** in [main.tsx](phase3-ui/src/renderer/src/main.tsx) (or `AppShell`), add document-level `dragover` + `drop` listeners that always `preventDefault()` (so a stray drop can never navigate). Add `webContents.on("will-navigate", e => e.preventDefault())` in [index.ts](phase3-ui/src/main/index.ts) as defense-in-depth.
- **Full-surface drop zone:** make the **entire chat surface** (message list + composer) a drop target with a clear "Drop files to attach" overlay while dragging — not just the composer bar. Apply to every composer-bearing screen still in v1 (Chat; Code).
- **Browse path:** fix whatever the diagnosis finds — verify `pickFiles` opens the dialog and `readAttachment` round-trips.
- Keep the `attachmentsFromDataTransfer` → `fileToAttachment` pipeline (it's correct); just widen where drops are accepted and stop navigation.

### Files
- [main.tsx](phase3-ui/src/renderer/src/main.tsx) or [AppShell.tsx](phase3-ui/src/renderer/src/shell/AppShell.tsx): global `dragover`/`drop` preventDefault + full-surface overlay.
- [ChatSurface.tsx](phase3-ui/src/renderer/src/components/ChatSurface.tsx): move the drop target from the composer bar to the whole surface.
- [index.ts](phase3-ui/src/main/index.ts): `will-navigate` guard; verify the `pickFiles` / `readAttachment` handlers.
- [attachments.ts](phase3-ui/src/renderer/src/lib/attachments.ts): verify the Browse pipeline.

### Verify (rule 6 — actually attach, don't just read)
Drop an **image** onto the message area → it attaches, previews, sends, and (local vision ready) analyzes. Drop a **non-image file** → attaches as a file part. Click **Browse / attach** → picker opens → file attaches (the reported-broken path). Drop **outside** the composer → **no navigation**, app intact. Paste still works.

---

## Task 3 — Split Web Search vs Deep Research into two distinct tools

**Problem (confirmed):** the composer's **Research** and **Web search** toggles both collapse to one flag — [ChatSurface.tsx:140](phase3-ui/src/renderer/src/components/ChatSurface.tsx#L140) sends `research: tools.research || tools.webSearch`, and [ChatScreen.tsx:18-19](phase3-ui/src/renderer/src/screens/ChatScreen.tsx#L18-L19) routes that to the **`research` agent → the heavy `deep_research` pipeline** ([deep_research_server.py](phase2-odysseus/servers/deep_research_server.py)). A quick lookup therefore runs the multi-round DeepResearcher and hits the ~90s cap on the local model.

**Goal:** a genuinely lightweight **`web_search`** tool (quick query → search → short summary, *no* multi-step synthesis) separate from full **`deep_research`** (iterative, full report). Two distinct options in the composer `+` menu (Claude's Research/Web-Search distinction).

### Design
**(a) New lightweight `web_search` MCP tool** — add a second `@mcp.tool` to the existing `odysseus-research` server ([deep_research_server.py](phase2-odysseus/servers/deep_research_server.py)) so it reuses the running process + the same backend resolver:
- `web_search(query, max_time=25)`: `ddgs` quick search (top ~5 results: title/snippet/url, ~10s cap) → **one** short LLM call via `resolve_research_llm()` ([research_backend.py](phase2-odysseus/servers/research_backend.py)) with small `max_tokens` (~400) and a short `asyncio.wait_for` (~30s) → concise answer + source links. **No `DeepResearcher`, no rounds, no heavy page-fetch** (summarize from snippets; optionally fetch just the top 1 page briefly).
- It **inherits research's Local/Cloud backend** via `NIGHTJAR_RESEARCH_PROVIDER` (so it follows the global toggle automatically — no new capability/env needed).
- Keep `deep_research` unchanged (its `max_time+30` cap stays).

**(b) New `websearch` agent mode** in [opencode.json](phase2-odysseus/workspace/opencode.json): `permission {"*":"deny","odysseus-research_web_search":"allow"}`, short prompt ("do a quick web search and answer concisely with sources — do NOT deep-research or email"). Leave the `research` agent (deep_research) as-is.

**(c) Composer routing split:**
- [ChatSurface.tsx](phase3-ui/src/renderer/src/components/ChatSurface.tsx): stop the `research || webSearch` collapse (L140); make Research and Web-search **mutually exclusive** (selecting one clears the other) and pass a distinct signal, e.g. `onSend(t, { attachments, mode: "research" | "websearch" | undefined })`.
- [ChatScreen.tsx](phase3-ui/src/renderer/src/screens/ChatScreen.tsx#L18-L19): `agent: mode === "research" ? "research" : mode === "websearch" ? "websearch" : "assistant"`.
- [ToolsMenu.tsx](phase3-ui/src/renderer/src/components/composer/ToolsMenu.tsx) already renders both rows — make them radio-like; keep the armed-chip UI.

### Files
- [deep_research_server.py](phase2-odysseus/servers/deep_research_server.py): add `web_search` tool (+ a pure helper for testability, mirroring `research_backend`).
- [opencode.json](phase2-odysseus/workspace/opencode.json): `websearch` agent + allow `odysseus-research_web_search` in it.
- [ChatSurface.tsx](phase3-ui/src/renderer/src/components/ChatSurface.tsx) + [ChatScreen.tsx](phase3-ui/src/renderer/src/screens/ChatScreen.tsx) + [ToolsMenu.tsx](phase3-ui/src/renderer/src/components/composer/ToolsMenu.tsx): split routing + mutually-exclusive toggles.

### Verify (rule 6)
On the **local** model, a simple "web search: X" returns a short answer **well under 30s** (the case that timed out today); "research: X" still runs the full pipeline. Confirm the two `+`-menu options route to different agents/tools. Unit-test the pure search+summarize helper offline (mock the LLM call).

---

## Task 1 — One global Cloud/Local toggle (replace the 4 per-capability toggles)

**Goal:** collapse the per-capability rows into a **single Local ⇄ Cloud switch** that governs **everything, including chat**. Local = all on-device; Cloud = all use one explicitly-chosen provider. **Keep the per-capability resolver + store logic exactly as-is** — this is a UI fan-out over the existing prefs.

**Decisions (settled):**
1. **Chat is included.** Cloud → chat uses the chosen provider's default chat model; Local → the local Qwen model. The header model-switcher remains a manual per-model override (the global toggle overrides it when changed).
2. **Provider dropdown = every configured provider** (not just the image-capable ones). A provider that can't do a given capability is handled with a **use-time message**, not by hiding it.

**Where it is today:** [CapabilitiesSettings.tsx](phase3-ui/src/renderer/src/components/CapabilitiesSettings.tsx) renders one row per `UI_CAPABILITIES` (`image`,`research`,`vision`,`browser`) inside the BYOK modal; each row calls `capabilities.set(id, pref)` → `capabilities:set` IPC → per-capability apply in [index.ts](phase3-ui/src/main/index.ts#L394-L400).

### Design
- Global toggle governs **6** things: chat, image, research, vision, browser, and `websearch` (Task 3).
- **Derive** toggle state from the store: all caps `offline` (and chat local) → **Local**; all `online` with the *same* provider → **Cloud (provider)**; mixed → normalize on next change.
- **Cloud provider dropdown** lists **every provider with a configured key**. On **Cloud + provider X**:
  - chat → set `activeModel = X/<defaultModel>` (from `BYOK_PROVIDERS`) + persist chat pref, via `useModel().setActiveModel(...)` ([ModelContext.tsx](phase3-ui/src/renderer/src/context/ModelContext.tsx)).
  - image/research/vision/browser/websearch → `capabilities.setBulk({online, X})`.
  - **Local** → chat = `LOCAL_MODEL`; all caps `offline`.
- **Bulk apply** (avoid 5–6 engine restarts): add `capabilities.setBulk(prefs)` in [capabilities.ts](phase3-ui/src/main/capabilities.ts) + a `capabilities:setBulk` IPC in [index.ts](phase3-ui/src/main/index.ts) doing **one** `reconcileImageEndpoint()` + **one** `restartService("opencode-serve", …)`.
- CAD (Task 5) writes its build123d code via the **chat/coding model**, so it follows this toggle automatically — no separate CAD provider control.

### Capability-provider support handling (decision 2)
A provider only supports the capabilities in its `onlineProviders` set: **image/vision = openai, openrouter**; **browser = openrouter, openai**; **research/websearch = openai, openrouter, groq, deepseek, mistral, xai**; **chat = all**. When Cloud + X is chosen:
- **In settings (upfront transparency):** show a one-line support summary for X, e.g. `☁ openai — chat, image, vision, research, browser ✓` vs `☁ groq — chat, research ✓ · image/vision/browser: not supported`.
- **At use-time (the explicit ask):** if the user triggers **image generation** while the chosen provider can't do images (X ∉ {openai, openrouter} **and** no local diffusion model present), show **"Current API doesn't support image generation."** instead of a silent failure — no dispatch. Implement as a pure `imageGenAvailable(imagePref, localImagePresent)` check surfaced in the Create-Image flow ([SessionsContext.createImage](phase3-ui/src/renderer/src/context/SessionsContext.tsx#L589) / the composer's Create-Image action) as an inline notice.
- **vision / research / browser** with an unsupported provider **fall back to local today** (their resolvers already return local — functional, but not "cloud"). Recommend the same honesty: a subtle "(running locally — `<X>` doesn't support this)" note. Lead with the image message (your ask); apply the pattern to the others as a small consistency follow-up.

### Files
- Rewrite [CapabilitiesSettings.tsx](phase3-ui/src/renderer/src/components/CapabilitiesSettings.tsx): 4 rows → 1 Local/Cloud toggle + provider `<select>` (all configured providers) + the support summary.
- [capabilities.ts](phase3-ui/src/main/capabilities.ts): add `setBulk`; **do not** touch `CAPABILITIES`/`envForOpencode`/resolvers.
- [index.ts](phase3-ui/src/main/index.ts): `capabilities:setBulk` (one reconcile + one restart).
- [preload/index.ts](phase3-ui/src/preload/index.ts) + [lib/capabilities.ts](phase3-ui/src/renderer/src/lib/capabilities.ts): `setBulk` bridge + client; add pure `capabilitySupport(providerId)` + `imageGenAvailable(...)` helpers (unit-testable).
- Chat hookup: toggle calls `setActiveModel` ([ModelContext.tsx](phase3-ui/src/renderer/src/context/ModelContext.tsx)).
- Image message: pre-check + inline notice in [SessionsContext.createImage](phase3-ui/src/renderer/src/context/SessionsContext.tsx#L589) / [ChatSurface.tsx](phase3-ui/src/renderer/src/components/ChatSurface.tsx) / [ChatScreen.tsx](phase3-ui/src/renderer/src/screens/ChatScreen.tsx).

### Verify (rule 6)
Cloud+OpenAI → chat/image/research/vision all use OpenAI. Cloud+**Groq** → chat + research use Groq; **Create Image shows "Current API doesn't support image generation"**; vision/browser fall back to local (noted). Local → all on-device, chat = Qwen. One engine restart per switch. Unit-test `deriveGlobalMode`, `capabilitySupport`, `imageGenAvailable`.

---

## Task 2 — "Switched to Local" limitations popup (every time)

**Goal:** a dismissible modal that appears **every time** the user switches the global toggle to Local, stating the current real limitations. Dismiss per-appearance; **no "don't show again"** — it reappears on the next switch.

### Design
- New `LocalModeNotice.tsx` modal (reuse the BYOK modal shell: `fixed inset-0 … bg-black/60`, title bar, a single **Dismiss** button).
- **Copy (exact):**
  > Image generation is unavailable offline (no local model wired yet). Deep research and web search may be slow or fail on the local model.
- **Trigger:** in the Task-1 toggle handler, when the target is Local (and it's an explicit user switch, not initial render), set `showLocalNotice = true`. Dismiss sets it false. **No `localStorage`** — state is ephemeral, so it fires on every switch.
- Fire only on the Local *transition* (guard against re-firing while already Local / on modal re-render).
- Keep the copy in one constant so it's easy to extend; reflects the honest post-PR3 behavior (offline image = no backend unless the GPU sidecar is present).

### Files
- New `phase3-ui/src/renderer/src/components/LocalModeNotice.tsx`.
- Wire trigger + render in [CapabilitiesSettings.tsx](phase3-ui/src/renderer/src/components/CapabilitiesSettings.tsx) (or lift to [AppShell.tsx](phase3-ui/src/renderer/src/shell/AppShell.tsx) if the toggle moves).

### Verify (rule 6)
Switch to Local → popup shows → dismiss → switch Cloud → switch Local again → **popup shows again**. Confirm it does NOT show on app launch or while already Local.

---

## Task 5 — Prompt-to-CAD (the "Iron Man" 3D feature)

**Goal:** a conversational prompt → **reliable** 3D CAD geometry, with an **exploded-view / drill-down / reassemble** viewer, living in **Chat (or a dedicated CAD surface) — NOT Cowork** (Cowork is deferred to v2).

**Why it's reliable (the trick):** an LLM writing raw CAD code one-shot produces invalid geometry often; a **see-measure-correct loop** (the model executes code, renders a view, measures, and corrects) raises CAD validity from **~88% → ~100%**. That loop is exactly what `build123d-mcp` exposes as tools.

### Design
- **Geometry core:** **build123d** (Apache-2.0) — Python code-CAD over OpenCASCADE.
- **LLM driver:** [pzfreo/build123d-mcp](https://github.com/pzfreo/build123d-mcp) wired as an **MCP server in OpenCode**, giving the model a tool loop: `execute` (run build123d code) → `render_view` (see it) → `measure` (mass / bbox / clearance / wall-thickness) → `export` (emit a file). The sandbox **blocks fs/subprocess/network**, so **all file output routes through `export`** — never arbitrary writes.
- **CAD Python env:** a dedicated **Python 3.12** venv via **`uv`** (VTK / `cadquery-ocp` wheels pin to 3.12 — do **not** use 3.13).
- **Viewer:** a **three.js** viewer in the Electron renderer for exploded-view / drill-down / reassemble, fed **GLB** from the mcp `export` tool. **Evaluate `yacv` (MIT) as a drop-in viewer first** before building bespoke three.js.
- **Feasibility warnings (tier 1 — no FEA/CFD in v1):** LLM + a **material-property table** (evaluate `pymat-mcp`, MIT) + `measure`'s built-in mass / clearance / wall-thickness → conversational sanity checks ("beeswax wings can't fly"). Physical simulation is out of v1.
- **Model routing:** the build123d code is written by the **chat/coding model** (follows the global Local/Cloud toggle) — a stronger BYOK model produces better geometry; local Qwen is the offline baseline.
- **Demo strategy:** open prompting **only for bounded single parts**; **pre-author the complex hero assembly** (a clean **4–8 part** model that explodes convincingly) rather than open-generating a full car live.
- **Surface:** Chat or a dedicated CAD panel — **not Cowork**.

### Files (new)
- CAD MCP wiring in [opencode.json](phase2-odysseus/workspace/opencode.json) (build123d-mcp under its Python-3.12 `uv` env; permission **`ask`** on `execute`/`export` per rule 1).
- A CAD Python project (e.g. `phase-cad/`): `uv` pinned to **3.12** + build123d + build123d-mcp + ocp/VTK deps.
- Viewer component in the renderer (three.js or `yacv`) + IPC/preload to receive the exported **GLB** and load it.

### Verify (rule 6) — verify-before-load-bearing checklist
- **License:** confirm the **`build123d-mcp` repo license at the pinned commit** (don't trust the current README/HEAD).
- **Export fidelity:** confirm `export` emits **GLB with the assembly hierarchy intact** (exploded-view needs per-part nodes); if not, fall back to **pythonOCC XDE → GLB**.
- **Python pin:** confirm the **3.12 pin holds** end-to-end (ocp/VTK import + render succeed).
- **The loop, live:** drive a real prompt → `execute` → `render_view` → `measure` → `export` → load in the viewer → explode/reassemble. A **bounded single part** must round-trip; the **hero assembly** must explode convincingly.

---

## Task 6 — Telegram scheduling backend (the always-on server)

**Goal:** the one hosted piece — a **thin always-on server** that takes natural-language reminders over Telegram and delivers them to the user's **phone** on schedule, laptop closed or not (paid). Plus a **local** desktop-notification path while the app is open (free).

**Prerequisites — promoted from footnotes to v1 blockers (this task fixes them):**
- **`pim_server.task_create` writes dead rows.** It writes `status='active'` tasks with **no `next_run`, and nothing polls them** ([pim_server.py:54-64](phase2-odysseus/servers/pim_server.py#L54-L64)) — so "tasks/reminders" silently never fire today. **Fixing `task_create` (real `next_run` + a poller) is a subtask here.**
- **No daemon.** JUNE has no long-lived host process (MCP servers are stdio; the Electron main runs no scheduler). The local scheduler (free) and the server (paid) **are** that missing daemon.

### Design
- **The server (thin, always-on — the only hosted component):**
  - **Telegram bot listener** — **aiogram v3** (MIT) *or* **python-telegram-bot** (LGPL); prefer MIT (aiogram) unless a PTB feature wins.
  - **APScheduler** (MIT) with a **SQLite job store** (survives restarts) — holds the schedule + fires jobs.
  - A small **FastAPI** endpoint the desktop app POSTs reminders to (so the app can schedule server-side).
- **Flow:** user texts the bot in natural language ("meeting with xyz at 2, remind me at 1") → **LLM parses to a structured intent** `{title, when, repeat}` → APScheduler job created → at fire time, the reminder is delivered to Telegram.
- **The main new work (call it out):**
  1. **Natural-language → structured-intent parsing layer** — the NL reminder → `{title, when, repeat}` extractor. This is the core new component and needs its own tests (spread of phrasings, timezones, relative times).
  2. **Per-user LLM routing.** The always-on Telegram brain must use a **cloud** model — a sleeping laptop can't run local Qwen to answer a phone message. See the finalized decision below.
- **Paid-tier LLM (finalized): Option 3 — server-side shared key.** The server uses a single Anthropic/OpenAI key (ours, server-only) to parse paid users' Telegram reminders. Users never receive or paste a key for this; their desktop BYOK key stays local and unchanged. Per-user usage counter + daily cap to prevent abuse. This resolves the server-side-key tension flagged earlier — **user keys never leave their machine.**
- **Login = Telegram identity** — no passwords; the same Telegram connection is login + reminder channel. Everyone connects Telegram through the server.
- **Free / paid split:**
  - **Free:** reminders as **local desktop notifications**, **only while the app is open** — a **local scheduler** in the Electron main, no server dependency (this is also where `task_create` gets fixed for the local case).
  - **Paid ($7/mo):** the **server** holds the schedule and stays awake → Telegram delivery anytime.

### Files (new)
- A new `telegram-scheduler/` service: aiogram/PTB listener + APScheduler (SQLite store) + FastAPI, with its own venv + deploy unit.
- The NL-intent parser (server-side; reuse the same logic for the local path).
- Local scheduler in [index.ts](phase3-ui/src/main/index.ts) (Electron main) for the free desktop-notification path + **fix `pim_server.task_create`** ([pim_server.py](phase2-odysseus/servers/pim_server.py)) to write a real `next_run` and be pollable.
- App ↔ server bridge: the POST-reminder endpoint + the Telegram-login flow.

### Verify (rule 6)
- Text the bot "remind me at 1pm to call Sara" → a job is scheduled → **fires to Telegram at 1pm** (paid path) with the laptop closed.
- Free path: schedule a reminder → a **local desktop notification** fires while the app is open; confirm it does **not** require the server.
- Telegram login round-trips (no password). Unit-test the NL parser on a spread of phrasings → structured intent (offline, mock LLM). Confirm APScheduler jobs **survive a server restart** (SQLite store).

---

## v1 sequencing (one PR at a time)

1. ~~**Task 4 — file attachment fix** (drag-drop + Browse).~~ ✅ **SHIPPED (PR #46).**
2. **Task 3 — web search vs deep research split** ← **NEXT.** Lightweight `web_search` tool + `websearch` agent + composer routing.
3. **Tasks 1 + 2 — global Local/Cloud toggle + Local-mode popup.** Bundled (Task 2's trigger lives in Task 1's toggle).
4. **Task 5 — Prompt-to-CAD.** The hero feature; larger, gated on the verify-before-load-bearing checklist.
5. **Task 6 — Telegram scheduling backend.** The always-on server + local scheduler; fixes `task_create` dead rows.

All **email/communications activations are parked below (v2)** and are **out of the v1 sequence.** Each PR: `typecheck` + `build` + targeted unit tests where there's pure logic (global-mode derivation, web-search helper, NL-intent parser, CAD export checks), **plus the per-task rule-6 live check.** Live cloud / GPU / Ollama / CAD / Telegram paths need the running stack (+ real keys / a bot token).

---

# Parked — NOT in v1

## v2 — Communications (email / Gmail)

Moved out of the active sequence. Activations (all `opencode.json` permission flips):

| Activation | What it unlocks | Gate |
|---|---|---|
| `read_email` | Open & read a full message (today JUNE can list but not read) | allow |
| `search_emails` | Free-text IMAP search across folders | allow |
| `mark_email_read` | Reversible read/unread triage | ask/allow |
| `list_email_accounts` | Enumerate configured inboxes | allow |

**Blockers to resolve when this is picked up:** email is unconfigured out-of-box (no `IMAP_*`/`SMTP_*` in `opencode.json`); **Gmail needs an app password** (no OAuth/XOAUTH2 wired — it lives only in Odysseus's Flask route JUNE doesn't run); email creds should be stored **encrypted like BYOK keys**, not plaintext in config. Read tools also depend on account setup, so both the flips **and** a cred path are needed together.

## v2 — Knowledge / RAG (personal documents)

| Activation | What it unlocks | Gate |
|---|---|---|
| `manage_rag` | Populate the RAG index `document_search` already queries (server wired, no agent allow-lists it) | **ask** |
| `document_stats` | Read-only RAG index stats | allow |

Parked out of v1 (not core to Chat / CAD / Telegram). **Blocker:** `manage_rag`'s `list` vs `document_search` use different file-extension sets (Office/EPUB mismatch) — fix before enabling.

## v2 — Cowork

The Cowork tab is **deferred to v2** and stays **hidden/disabled in the v1 build** ("Cowork — coming soon" gated off). No v1 work beyond ensuring it's not shipped active.

## Later — "Hey June" voice activation

Voice/wake-word activation is the **final** step, built after (a) Chat/BYOK, (b) Prompt-to-CAD, and (c) Telegram scheduling are shipped and solid — not part of the v1 sequence.
