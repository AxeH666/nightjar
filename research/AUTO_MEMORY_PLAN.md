# Auto-memory — design & plan

Status: **design approved (2 decisions), not yet built.** Depends on 5b (complete) +
PR-C's `system` injection path + per-project cloud-consent gate.

Auto-memory gives a project a **generated summary of what's been learned from its own
chats**, that **regenerates as chats accumulate**, is **user-editable with edits that
survive regeneration**, alongside **manual notes** — the reference-product (Claude
Projects) behaviour.

## Approved decisions

1. **Edit vs regeneration = propose, don't overwrite.** A regeneration produces a
   *proposed* `autoMemory` shown old-vs-new with **Accept / Discard**; it NEVER silently
   overwrites. This is deliberate: Nightjar drives a weak local model (CLAUDE.md rule 4 —
   these models misbehave), so it cannot be trusted to faithfully preserve a user's edits
   by re-summarising over them. Nothing is applied without the user's Accept, so edits (and
   manual notes) always survive.
2. **Generation model = local only (v1).** Memory is always generated on-device
   (Qwen3-4B), regardless of the active chat model. Summarising a whole project's chats is
   the most sensitive egress there is, so it stays offline. Cloud generation can be a
   consent-gated option in a later version.

## Data model (per project, `projectContent`)

- `manualNotes: string` — free-form user text. The EXISTING "Memory" textarea becomes
  this. **Never touched by regeneration** → the deterministically-safe zone.
- `autoMemory: string` — the generated summary block (user-editable).
- `autoMemoryProposal?: string` — a pending regenerated proposal awaiting Accept/Discard;
  absent when none is pending.
- `memoryMeta: { lastGeneratedAt: number; sourceChatCount: number }` — drives the
  "stale / N new chats since last memory" hint.

All join `purgeProjectStorage`'s fan-out (mutation-checked — the NJ-40/41 leak class).

## Injection (reuses PR-C exactly)

The effective project memory (`manualNotes` + `autoMemory`) is appended to the SAME
`system` string as Instructions, under the SAME per-project cloud-consent gate (memory is
at least as sensitive as instructions, so it is gated identically — never egresses to a
cloud model without opt-in). Computed in ProjectChat from live state and passed via
`send({ system })`, exactly like Instructions. This finally wires Memory into the agent
(PR-C deferred it).

Order in the system block: manual notes → auto-memory → (Instructions already handled).

## Generation

- Trigger: a manual **Regenerate** button, plus a non-intrusive hint
  ("{N} new chats since last memory — regenerate?") once enough new chat content has
  accumulated since `lastGeneratedAt`. No aggressive background regen (local model is slow;
  surprise model calls are bad UX offline).
- Input: concatenate the project's chat transcripts (`projectChatIds` → `getMessages`),
  most-recent-first, capped to fit the 4B context (chunk / summarise-of-summaries if long).
- Model: LOCAL_MODEL always (decision 2). A dedicated one-shot prompt (ephemeral session or
  a reused summariser session) with a summarise directive, wrapped in a rule-3 wall-clock
  timeout (a summarisation call is a long-running model call → own timeout, CLAUDE.md rule 3).
- Prompt shape (propose-flow): "Here is the current project memory (may include the user's
  edits) + recent chats. Produce an UPDATED memory that preserves what's still true and
  integrates new learnings." Output → `autoMemoryProposal` (NOT applied).

## UI (ProjectView → Knowledge → Memory panel)

Split the current Memory panel into:
- **Auto-memory** — the generated block (editable textarea), a "last updated {time}" line,
  a **Regenerate** button, and — when `autoMemoryProposal` is set — an old-vs-new review
  with **Accept** (proposal → autoMemory) / **Discard** (drop proposal).
- **Manual notes** — the current textarea, relabelled.

## Staging (one PR at a time off fresh main)

- **AM-1 (built)** — wire the existing project **Memory** into the gated `system` injection
  alongside Instructions (reuse PR-C's machinery exactly, generalised: `buildProjectSystem`
  assembles labelled Instructions + Memory and bakes in the cloud-consent gate). The consent
  banner + notes now cover Instructions + Memory. Pure `buildProjectSystem`/`hasProjectContext`
  unit-tested (assert-then-mutate). No new storage (Memory + its purge already exist); dropped
  the now-dead `loadProjectInstructions`/`shouldInjectInstructions` from the PR-C fix.
- **AM-2a (built)** — `autoMemory` field (editable, injected as a third labelled `buildProjectSystem`
  section) + the Knowledge split (manual **Notes** vs auto **Memory**) + storage (own delete path,
  not copied on duplicate, joins the purge fan-out, mutation-checked). No generation. Headless.
- **AM-2b (built)** — the generator: `client.prompt` (synchronous `POST /session/:id/message`, own
  120s wall-clock bound) + `SessionsContext.summarizeProjectChats` running on an EPHEMERAL throwaway
  session (never registered/shown/GC'd; tools-denied `summary` agent; LOCAL model only) + the pure
  `lib/autoMemory` helpers (transcript assembly with an explicit truncation marker, prompt building,
  count-based staleness) + `autoMemoryProposal`/`memoryMeta` + the propose→Accept/Discard UI +
  Regenerate button + the "N new chats since" hint. The summariser output quality is live-verify.

## Open risks / notes (rule 7)

- 4B context limit vs long chat history → capping/chunking strategy needs live tuning
  (AM-2). Flag the cap so truncated coverage isn't silently presented as complete (rule 8).
- Generation is a long-running model call → rule-3 wall-clock timeout is mandatory.
- Memory egress is gated identically to Instructions; keep the two in lockstep if the gate
  changes.
- Cloud generation + Memory/Files injection are explicit follow-ups, not silently folded in.
