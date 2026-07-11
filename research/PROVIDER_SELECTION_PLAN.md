# Nightjar/JUNE — Explicit Online/Offline + Provider Selection

Status tracker for the cross-cutting change that replaces every **implicit**
local-vs-cloud / provider-precedence decision with an **explicit, persisted,
per-capability** choice. Offline/local is always the default; going Online and
picking a provider is always a deliberate user action.

Approved scope (decided with the user):
- **Build new cloud paths** for Deep Research and Vision (they have none today).
- **Fix the browser-agent silent-cloud leak** and default it to Offline.
- **House the controls** in the BYOK Settings panel ("Capabilities" section).

---

## Audit — how each backend is chosen TODAY (verified)

| Capability | Mechanism today | Explicit? | Real cloud path? |
|---|---|---|---|
| Chat / coding | Header model switcher → global `activeModel` | ✅ explicit | yes |
| Image gen | `applyImageEndpoint()` reconcile — Local-first → **OpenAI → OpenRouter** | ❌ hidden precedence | yes |
| Browser agent | `resolve_model_spec()` — override → **OpenRouter → OpenAI** → local; `PREFER` defaults to `byok` | ❌ hidden precedence, silently cloud | yes |
| Deep research | Hard-pinned local llama-server `:8085` | ❌ implicit | **no** |
| Vision (tool) | Hard-routed local `gemma3:4b`; cloud branch is dead stub | ❌ implicit | **no** (only via cloud chat model) |
| Embeddings / memory / voice / wakeword | Local-only | n/a | no |

Two hidden precedences existed, **inverted**: image-gen (OpenAI>OpenRouter) vs
browser-use (OpenRouter>OpenAI). Both replaced by explicit selection.

**Latent (dormant, not activated by this change — flagged per rule 7):** Odysseus
`endpoint_resolver.py` role-resolver behind the permission-denied email-AI tool;
an OAuth-credential cloud path; Tailscale host remap; and an OpenRouter
branding-header leak (`X-Title: "Odysseus"`, referer `pewdiepie-archdaemon/odysseus`)
that violates the "you are always Nightjar" identity rule.

---

## Design — one concept reused everywhere

Per-capability preference: `{ mode: "offline" | "online", providerId?, modelId? }`.

- **Stored** in the main process: `userData/capability-prefs.json` (mirrors
  `byok-keys.json`; holds no secrets).
- **Bridged** to the renderer via `nightjar.capabilities` (mirrors `nightjar.byok`).
- **Applied** through the existing "change → restart engine" path used for keys.
- **Default = offline** for every capability. Online with no valid key is blocked
  in the UI — never a silent fallback in either direction.

---

## Delivery — stacked PRs (user merged each; verified before the next)

- [x] **PR1 (#39) — Prefs store + bridge + IPC (+ persist chat selection).** `capabilities.ts`
  store, `nightjar.capabilities` bridge, chat-selection restore/persist. (+ Bugbot fixes:
  first-load restore race + heal-persists-offline.)
- [x] **PR2 (#40) — Capabilities UI section** in `BYOKSettings.tsx` (Offline/Online toggle
  + provider dropdown per capability; inert).
- [x] **PR3 (#41) — Image-gen: precedence removed** → explicit `resolveImageBackend`; seeds
  only the chosen endpoint; keeps the single-row + coalesce machinery.
- [x] **PR4 (#42) — Browser-use: explicit selection + Offline default** (silent-cloud leak closed).
- [x] **PR5 (#43) — Deep research: new cloud path** (`research_backend.py` resolver +
  `llm_headers` Bearer auth + rule-3 `asyncio.wait_for`).
- [x] **PR6 (#44) — Vision: new cloud tool path** (`vision_backend.py` + OpenAI-compatible
  call + timeout; `vision_settings.json` aligned to `NIGHTJAR_VISION_MODEL`).
- [x] **PR7 (#45) — Close-out:** `KNOWN_ISSUES.md` (NJ-14 feature, NJ-15 latent Odysseus
  resolver); per-capability cloud banner; corrected stale copy/comments; **+ fixes from an
  adversarial close-out review** — `restartService` single-flight/coalesce race fix (a new
  reachable defect) + image seed/unseed failure logging. Branding-header fix downgraded to
  an odysseus-patch follow-up under NJ-15 (submodule stays a clean mirror).

Each PR verified per CLAUDE.md rule 6 (re-trigger the real case) — all four backend
resolvers unit-tested (incl. leak-closed cases), the restart coalescing regression-tested,
and an 8-agent adversarial review found the leak-closure/consistency dimensions clean.
Live cloud round-trips (real key) and GPU/Ollama paths need the running stack.

---

## Migration notes

- On upgrade with no prefs set, **all capabilities default to Offline**. Users who
  relied on the old implicit cloud image path pick a provider once (one-time note).
  No silent cloud egress is preserved.
- Image-gen keeps exactly ONE seeded `model_endpoints` row, which also sidesteps the
  `_resolve_model` "first enabled row wins by DB order" hazard.
