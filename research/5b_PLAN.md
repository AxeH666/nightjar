# 5b — Per-project chat isolation + gated Instructions injection (plan of record)

Resume point after PRs #124/#125. Implements `audit1.md` §P2-19. This doc is the durable
record of the design and the maintainer decisions taken while scoping it (2026-07-21), so they
survive past the conversation that made them. Derived from a 5-probe design pass + an adversarial
completeness/risk critic.

## Goal

Today a project (`lib/projects.ts`, `lib/projectContent.ts`, `ProjectView.tsx`) holds
Instructions/Memory/Files per project, but opening one gives **no** project-scoped chat and the
Instructions never reach the agent. 5b: key chat sessions by `(slot, projectId)`; give an opened
project a scoped `ChatSurface`; and prepend the project's Instructions to the agent prompt through
a gated, cloud-consented path.

## Architecture (the decision that dissolves the hard problem)

The blocker was **adopt-on-connect**: the chat slot adopts the connection's *primary* session
before any project exists, so there is no "current project" at adoption time.

**Resolution — a first-class "General" (no-project) scope + a composite `chat::<projectId>` scope:**

- `General` reuses the EXISTING localStorage keys verbatim (`nightjar.sessionIds.chat`,
  `nightjar.codeSessionIds`, `nightjar.sessionIds.cad`) → **zero migration**; a user's pre-5b
  history *is* their General history.
- A project chat is a separate scope the primary-adopt effect never touches, so the adopted
  primary still lands in General exactly as today. The hard question is answered by construction.
- **Quarantined parallel map, not composite** (REVISED 2026-07-21, during PR-B implementation).
  The original call here was composite (`chat::<projectId>` inside `slots`). After reading the
  actual 1064-line `SessionsContext`, that was revised — with the maintainer's confirmation — to a
  separate `projectChats: Record<projectId, sessionId>` map kept OUTSIDE `slots`. Rationale: the
  user chose a *single* persistent chat per project (not a recents rail), so composite's uniform
  slot machinery buys nothing, while its widening of `Record<SlotId,…>` would touch every fragile
  `#122/#123` `=== "chat"` check — risking a regression to the shipped, working General chat.
  Parallel-map leaves that machinery byte-for-byte untouched. The critic's sole objection to
  parallel-map — `gcSessions` would garbage-collect a project chat on reconnect (a rule-2 hazard) —
  is answered by teaching `gcSessions` to union the project-chat ids into its `bound` set (one
  line). The guardrail is widened to `isChatScope`; the `chatBoundManually` pins stay literal
  `slots.chat`. Net: the new complexity is quarantined in three enumerated spots (gc, guardrail,
  delete) rather than spread across the fragile path.
- Only the **chat** slot becomes project-scoped in 5b; code/cad stay General.

### The single most error-prone edit — RESOLVED by parallel-map (PR-B)

The composite approach would have needed the same `=== "chat"` check widened in **opposite
directions** (guardrail widens to all chat scopes; pins stay literal General-`chat`) — the highest-
risk edit. Parallel-map sidesteps most of it: project chats never flow through `resumeSession`/
`newSession`/the adopt effect (they go through `openProjectChat`), so the `chatBoundManually` pins
are literally never reached by a project chat and stay untouched. Only the guardrail is widened
(via `isChatScope`), because a project chat IS a write-tool-less assistant chat whose false-save
claim must still be corrected.

### Other risks the critic surfaced (handled in the relevant PR)

- `createImage()` is a **second send path** (NJ-9 class) — the injection + cloud gate must cover
  both `send()` and `createImage()`.
- Recovery offers (`FallbackOffer`/`RateLimitOffer`) carry no `projectId` — a cloud-failure retry
  would drop the Instructions or re-egress to an unconsented provider. Thread project context through.
- Cloud consent is the **NJ-40/41 class**: it must be in a delete-only part set, never copied to a
  duplicate (a duplicated project must not inherit egress authorization).
- **Rule-1 honesty:** a prompt prepend fires no tool call → no `permission.asked`, no audit trail.
  The per-project cloud gate is a *product* consent gate, not a rule-1 tool gate. The banner is the
  only user-visible egress signal, so it must be verified firing on-device (rules 6/8).

## Maintainer decisions (2026-07-21) — SETTLED, design around these

1. **Staging:** three sequential PRs (A foundation / B session scoping / C gated injection), not one.
2. **Per-project chat surface:** ~~a single persistent chat per project~~ **REVISED 2026-07-21
   (maintainer, after seeing the single-chat build):** **multiple named chats per project with a
   collapsible history rail** — the same experience as the General chat. The collapsible rail is
   added to BOTH the project view and the General chat. `SessionList` was generalized (back-compat:
   still slot-driven for Code/CAD/labs; onNew/onResume for projects) so one rail component serves
   all. In `SessionsContext`, `projectChats` became the per-project ACTIVE chat and a new
   `projectChatIds` holds each project's history list; the PR-B reconnect/generation infra now
   guards the active chat. `newProjectChat`/`resumeProjectChat` drive the rail.
   **Chat naming (also 2026-07-21):** new chats are created WITHOUT a forced title so OpenCode's
   built-in `ensureTitle` (session/prompt.ts, gated on `isDefaultTitle`) names them from the
   conversation — the forced "June chat"/"June session" titles were suppressing it. `displayChatTitle`
   shows "New chat" until the real title lands. Same-provider small model, so no extra cloud egress.
   Client-generated titling is the fallback only if a live check shows the engine's "title" agent is
   absent.
3. **On project delete:** best-effort delete the underlying OpenCode sessions on the engine (inject
   the client into the delete path), consistent with the store's "must not linger on disk" stance.
4. **Cloud-egress consent:** a one-time per-`(project, provider)` opt-in + a persistent "sending
   `<project>` context to `<provider>`" banner in the project chat. No prepend on cloud until
   consent. (No persisted egress log for now — banner + opt-in is the chosen depth.)
5. **Instructions injection lives in the renderer `send()`** (reusing the image-attachment
   `promptText` prepend pattern), NOT the auto-recall plugin — the plugin has no project context.

### Auto-memory (design; builds with/after 5b) — SETTLED decisions

6. **Cloud-egress gating, per project:** inject freely on a LOCAL model; on BYOK CLOUD require the
   same per-project consent (sending transcripts/memory out is the same egress). Reuses decision 4.
7. **Manual regeneration first:** a user-clicked "Regenerate" button; periodic scheduling is a later
   step with its OWN rule-3 wall-clock bound (copy `scheduler.ts`'s interval/timeout/stopped-guard).
8. **Edits survive regeneration** via stable kebab-case topic keys + an edit overlay
   (revised/deleted/pinned) keyed by those keys; today's flat `memory` string migrates into a
   manual-notes layer. Versioned record with a migration (projectContent has none today).
9. **Feedback-drift guard from the start:** strip injected memory blocks from the summariser input
   and content-hash the input set to skip no-op runs — rule 3's doom-loop guard only catches
   *finished identical* calls, so it will NOT catch this drift.

## PR breakdown & verification split

- **PR-A — foundation (this PR; fully headless, zero behavior change).** `sessionScope.ts` (scope
  key math, the zero-migration contract, delete-hygiene helper); the authoritative
  `purgeProjectStorage` fan-out wired into `projects.remove()`; `duplicate()` documents that chat
  history is intentionally not copied. Unit-tested + mutation-checked. Headlessly complete.
- **PR-B — session scoping (needs live GUI verify).** The composite `SessionsContext` change (per
  the opposite-direction-widening note), project-chat resolution (single persistent chat), a lifted
  active-project context, a scoped `ChatSurface` in `ProjectView`, and best-effort engine-session
  delete on `remove()`. **Must verify live:** primary-adopt still lands in General after connect AND
  reconnect; a project chat SURVIVES a reconnect (not clobbered by adopt, not GC'd — the make-or-break
  test); delete/duplicate strand/bleed nothing.
- **PR-C — gated injection (needs live + privacy re-trigger).** Instructions prepend in BOTH send
  paths; per-`(project,provider)` cloud consent + banner; context threaded through recovery offers;
  the rule-1-honesty comment at the prepend site. **Must verify live (rule 6):** on a real cloud
  send the consent prompt appears, the banner shows, injection is BLOCKED without consent, and the
  Instructions demonstrably influence the model's reply.
- **Auto-memory — later PR(s).** Per decisions 6–9.

**Headlessly checkable** (vitest): scope key math + zero-migration identity; delete/copy hygiene;
the LOCAL/CLOUD/consent branch as a pure predicate. **Only verifiable on a real native-Windows GUI**
(rules 6/8): every session-lifecycle and cloud-egress claim above — a synthetic event is a false
green (rule 8).
