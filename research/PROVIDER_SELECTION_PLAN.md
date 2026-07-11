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

## Delivery — stacked PRs (user merges each; verify before the next)

- [ ] **PR1 — Prefs store + bridge + IPC (+ persist chat selection).** No behavior
  change beyond chat selection now surviving restart.
  Files: `phase3-ui/src/main/capabilities.ts` (new), `src/main/index.ts` (IPC),
  `src/preload/index.ts` (bridge), `src/renderer/src/lib/capabilities.ts` (new),
  `src/renderer/src/context/ModelContext.tsx` (restore/persist chat).
  Verify: `bun test-capabilities.ts` (store round-trip + validation) + `typecheck`.
- [ ] **PR2 — Capabilities UI section** in `BYOKSettings.tsx` (reads/writes prefs; inert).
- [ ] **PR3 — Image-gen: replace precedence with explicit selection.** Delete the
  `if (openai) … else if (openrouter)` in `index.ts:128-134` and the local-first
  override; seed exactly the chosen endpoint; keep the single-row + coalesce machinery.
- [ ] **PR4 — Browser-use: explicit selection + Offline default** (closes the leak).
- [ ] **PR5 — Deep research: new cloud path** (provider resolver + `llm_headers` + timeout).
- [ ] **PR6 — Vision: new cloud tool path** (+ timeout; unify `vision_settings.json`
  vs `NIGHTJAR_VISION_MODEL` source of truth).
- [ ] **PR7 — `KNOWN_ISSUES.md` entries + per-capability banner + branding-header fix.**

Each PR is verified per CLAUDE.md rule 6 (re-trigger the real case), noting where a
GPU / Ollama / real key is required and can't be driven headless.

---

## Migration notes

- On upgrade with no prefs set, **all capabilities default to Offline**. Users who
  relied on the old implicit cloud image path pick a provider once (one-time note).
  No silent cloud egress is preserved.
- Image-gen keeps exactly ONE seeded `model_endpoints` row, which also sidesteps the
  `_resolve_model` "first enabled row wins by DB order" hazard.
