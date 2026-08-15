# JUNE 0.1 — Product Requirements Document

**Product:** JUNE<br>
**Version:** 0.1<br>
**Status:** Founder-approved product baseline for implementation<br>
**Audience:** Engineering, QA, design, and product contributors<br>
**Canonical repository:** `C:\dev\june`<br>
**Architecture authority:** `docs/architecture/JUNE_MASTER_ARCHITECTURE.md`<br>
**Detailed system designs:**

- `docs/architecture/VOICE_SYSTEM_DESIGN.md`
- `docs/architecture/MEMORY_SYSTEM_DESIGN.md`
- `docs/architecture/ORCHESTRATOR_SYSTEM_DESIGN.md`

> **How to use this document**<br>
> This PRD defines **what JUNE 0.1 must do, why it matters, and how the product will be accepted**. The architecture and subsystem documents define **how the system is built**. A pull-request plan defines the exact files and implementation scope for one bounded change. Engineers must not treat this PRD as permission to redesign architecture or implement broad features outside an assigned PR.

---

## 1. Product vision

> **JUNE is a voice-first personal operating layer that speaks naturally, remembers the user over time, understands ongoing context, and reliably helps with the user’s digital life.**

JUNE should feel less like opening a chatbot and more like speaking to a persistent personal assistant. It should become more useful to one individual the longer they use it.

The long-term product moat is:

```text
Voice quality
× personal context
× action depth
× accumulated relationship
```

JUNE 0.1 does not attempt to build the entire long-term vision. It establishes the trustworthy foundation: natural voice, durable memory, one canonical conversation, controlled task execution, and a small set of practical capabilities.

---

## 2. Problem statement

Current assistants commonly fail in four ways:

1. They feel slow, robotic, or awkward during spoken conversation.
2. They repeatedly forget the user’s preferences, people, projects, and prior decisions.
3. They discuss tasks but cannot reliably complete and track them.
4. Their permissions, state, and failure recovery are unclear, especially when tools or external actions are involved.

JUNE 0.1 must prove that a personal assistant can be:

- Natural to speak with.
- Consistent across voice and text.
- Personally aware without being invasive.
- Useful for everyday work.
- Safe, inspectable, and recoverable.

---

## 3. Target user

### 3.1 Initial user

JUNE 0.1 is designed for:

- One primary user per Windows installation.
- An English-speaking user.
- A user who wants a persistent personal assistant rather than a disposable chat session.
- A user willing to use cloud intelligence for higher quality, with clear consent and privacy controls.
- A user who may interact from the desktop and, while the JUNE PC is running, through private Telegram messages.

Every important record must contain `user_id` even though the first product is single-user.

### 3.2 Initial platform

- Windows desktop is the primary target.
- JUNE is source-run during development.
- The app continues running in the Windows system tray when the visible window is closed.
- Explicit **Quit JUNE** stops the background runtime safely.
- JUNE 0.1 does not operate while the user’s PC is powered off.

---

## 4. Product principles

### P-01 — Human conversation first

JUNE should respond, pause, listen, and recover like a capable human assistant. Voice quality is judged end to end, not by one provider benchmark.

### P-02 — Memory should compound value

The user should need to repeat themselves less over time. JUNE should remember useful information, apply it when relevant, and stop using it when corrected or deleted.

### P-03 — One JUNE across channels

Desktop voice, desktop text, and Telegram are channels into the same assistant. They must not create separate personalities, memories, or task systems.

### P-04 — JUNE owns canonical state

OpenAI, Fireworks, OpenCode, Telegram, and MCP services are replaceable components. JUNE owns the canonical conversation, memories, permissions, tasks, actions, and audit history.

### P-05 — Models propose; software governs

Models may interpret intent and propose work. Deterministic JUNE software validates, authorizes, executes, records, verifies, reconciles, and recovers.

### P-06 — Privacy is an architectural behavior

Privacy must be enforced through local wake gating, explicit cloud state, minimal provider context, encrypted storage, user controls, and fail-closed behavior—not only through policy text.

### P-07 — Progressive autonomy

Read-only and low-risk reversible work can be smooth. Consequential, destructive, external, financial, or security-sensitive actions require stronger confirmation and audit.

### P-08 — Existing working behavior is preserved during migration

The current voice and capability paths remain available until replacements are measured and proven. No large rewrite is authorized.

---

## 5. JUNE 0.1 goals

JUNE 0.1 must deliver the following product outcomes.

### G-01 — Natural voice conversation

The user can activate JUNE, speak naturally, receive fast spoken responses, interrupt JUNE, and continue with follow-up turns without repeating the wake phrase every time.

### G-02 — Shared voice and text conversation

Spoken and typed turns appear in the same visible conversation. The user can inspect transcripts, responses, tool activity, task progress, interruptions, and results.

### G-03 — Durable personal memory

JUNE remembers useful non-sensitive facts, preferences, people, projects, decisions, and communication style across conversations, while allowing correction, provenance inspection, export, and genuine forgetting.

### G-04 — Controlled durable work

JUNE can create, track, pause, resume, cancel, restart, reconcile, and report long-running tasks without relying on one provider session.

### G-05 — Useful baseline capabilities

JUNE supports:

- Scheduling, reminders, tasks, and a local calendar.
- Manual expense and budget tracking.
- Private Telegram access while the JUNE PC is running.
- Quick Search and Deep Research.
- OpenCode as a specialized coding capability.

### G-06 — Trust and reliability

JUNE does not silently duplicate external effects, accept stale audio, store secrets as memory, or claim success without evidence.

---

## 6. Non-goals for JUNE 0.1

The following are explicitly outside the release scope:

- Email sending or mailbox control.
- Google or Microsoft calendar mutation.
- Swiggy, Instamart, grocery, food, travel, or purchase execution.
- Banking, payments, UPI, card transactions, investments, or regulated financial advice.
- General browser or operating-system control.
- Mobile apps or broad cross-device synchronization.
- Always-on cloud JUNE while the PC is off.
- Dynamic agent swarms or multi-agent app-building workflows.
- Cloud computer workers and credential/session brokering.
- Productionized vision, device control, smart-home control, or broad CAD workflows.
- Completing quizzes, examinations, identity checks, legal declarations, or other acts requiring the user’s own judgment or performance.
- Supporting multiple realtime voice providers in the initial product.

These are reserved for future architecture and must not enter JUNE 0.1 PRs unless separately approved.

---

## 7. Primary user journeys

### UJ-01 — Start a natural voice conversation

1. The user says **Hey JUNE** or activates voice explicitly.
2. The orb immediately shows that JUNE is listening.
3. JUNE opens a clearly indicated active cloud voice session.
4. The user speaks naturally.
5. The final transcript appears in the current conversation.
6. JUNE begins speaking without waiting unnecessarily.
7. The assistant response appears in the same visible conversation.
8. JUNE remains ready for a follow-up turn for an adaptive period.

### UJ-02 — Interrupt JUNE

1. JUNE is speaking.
2. The user begins talking over it.
3. Local playback becomes silent immediately.
4. Unplayed audio is discarded.
5. The active provider response is cancelled.
6. Late audio from the old generation is rejected.
7. The previous message is marked interrupted and records what the user actually heard.
8. JUNE listens to the new turn.

Interrupting speech does not automatically pause or cancel a durable background task.

### UJ-03 — Ask a memory-supported question

Example: “What did we decide about JUNE’s voice provider?”

1. JUNE retrieves only relevant current memories and source evidence.
2. The answer uses the correct project scope.
3. The response can expose **Used memories**.
4. The user can inspect why JUNE remembered the information.
5. If the memory is uncertain, JUNE says so rather than inventing continuity.

### UJ-04 — Correct or forget a memory

Example: “I moved from Mumbai to Bengaluru.”

1. JUNE records Bengaluru as current.
2. Mumbai remains historically true but is no longer treated as current.
3. The correction affects the next relevant turn.

Example: “Forget everything about that relationship.”

1. JUNE removes the active canonical memory.
2. Derived lexical/vector indexes and caches are invalidated.
3. Affected summaries are regenerated.
4. The old evidence cannot silently recreate the deleted memory.

### UJ-05 — Create a reminder

Example: “Remind me tomorrow at 8 PM to call Rahul.”

1. JUNE recognizes a local reversible scheduling write.
2. The Scheduling capability creates the reminder durably.
3. JUNE confirms the exact time and task.
4. The reminder survives an app restart.
5. Notification delivery is recorded.

### UJ-06 — Record an expense

Example: “I spent ₹650 on dinner.”

1. JUNE extracts amount, currency, date, category, and optional merchant.
2. It asks a short question only if a material field is ambiguous.
3. The Money system records the expense.
4. JUNE confirms the result and offers correction or undo.
5. The expense is available in summaries and CSV export.

### UJ-07 — Start and manage deep research

Example: “Research the strongest evidence for dinosaur evolution.”

1. JUNE starts a durable read-only research task immediately.
2. JUNE acknowledges it naturally.
3. Sources, notes, checkpoints, progress, and the final report belong to the durable task.
4. The user may ask for status, pause, resume, cancel, reopen, or restart.
5. Interrupting JUNE’s voice does not cancel research.
6. Results return to the initiating conversation/channel with citations.

### UJ-08 — Request coding work

Example: “Fix the failing tests in this repository.”

1. JUNE routes the request to the OpenCode coding capability.
2. Workspace, path, shell, network, Git, time, and model policies are applied.
3. Consequential mutations require the correct approval tier.
4. OpenCode returns changed files, diff, tests, diagnostics, and result status.
5. JUNE records and presents the verified outcome.

### UJ-09 — Use JUNE through Telegram

1. A securely linked private Telegram account sends a message.
2. JUNE maps it to the same `user_id`, memory, task state, and orchestrator.
3. Duplicate Telegram updates do not create duplicate tasks.
4. The user can create reminders/expenses, ask questions, start research, and inspect task status.
5. Sensitive confirmations are bound to exact actions.
6. Telegram works only while the JUNE PC/background service is running in 0.1.

---

## 8. Functional requirements

Requirement priorities:

- **P0:** Required for JUNE 0.1 acceptance.
- **P1:** Required before a public production release, but may land after the first integrated internal vertical slice.
- **Future:** Reserved outside JUNE 0.1.

### 8.1 Conversation and identity

| ID | Priority | Requirement |
|---|---:|---|
| CONV-001 | P0 | JUNE must maintain one canonical `user_id` for the local user. |
| CONV-002 | P0 | Voice and desktop text must use the same visible canonical conversation. |
| CONV-003 | P0 | Telegram must map to the same user, memory, and task systems. |
| CONV-004 | P0 | Every durable interaction must use JUNE-owned identifiers, including `conversation_id`, `voice_session_id`, `turn_id`, and `generation_id`. |
| CONV-005 | P0 | Partial voice transcripts must remain provisional and must not become canonical messages. |
| CONV-006 | P0 | Final voice transcripts must become ordinary user messages. |
| CONV-007 | P0 | Assistant speech transcripts must appear in the same conversation. |
| CONV-008 | P0 | Interrupted assistant responses must be visibly marked and must record the portion actually heard. |
| CONV-009 | P0 | Tool calls, confirmation requests, task progress, results, and action receipts must attach to the relevant conversation/turn. |
| CONV-010 | P1 | Conversation export and deletion must be supported. |

### 8.2 Voice

| ID | Priority | Requirement |
|---|---:|---|
| VOICE-001 | P0 | Voice V1 must use OpenAI Realtime API with `gpt-realtime-2.1`, subject to availability verification immediately before integration. |
| VOICE-002 | P0 | The desktop media path must use WebRTC. |
| VOICE-003 | P0 | Wake detection, microphone/speaker ownership, pre-wake audio, immediate mute, and privacy gating must remain local. |
| VOICE-004 | P0 | No intentional microphone audio may leave the device before activation. |
| VOICE-005 | P0 | JUNE must support natural multi-turn spoken conversation. |
| VOICE-006 | P0 | The user must be able to interrupt JUNE while it speaks. |
| VOICE-007 | P0 | Interruption must stop local playback immediately, cancel remote generation, clear queued audio, and reject stale audio. |
| VOICE-008 | P0 | JUNE must support follow-up turns without requiring the wake phrase after every response. |
| VOICE-009 | P0 | JUNE must support Natural Conversation Mode and Privacy-Enhanced Mode. |
| VOICE-010 | P0 | Provider sessions must be temporary and reconstructable from JUNE state. |
| VOICE-011 | P0 | OpenAI must receive only a narrow JUNE delegation tool, not unrestricted direct access to capabilities. |
| VOICE-012 | P0 | Permanent OpenAI credentials must remain outside renderer-visible storage; the client uses ephemeral credentials. |
| VOICE-013 | P0 | Normal telemetry must not contain raw audio, full transcripts, complete replies, or credentials. |
| VOICE-014 | P1 | A production-quality **Hey JUNE** wake model must replace the current stand-in before public release. |
| VOICE-015 | P1 | Voice must pass Windows device, noise, echo, sleep/resume, reconnect, and long-session acceptance testing. |

### 8.3 Memory

| ID | Priority | Requirement |
|---|---:|---|
| MEM-001 | P0 | JUNE must automatically remember clear, useful, non-sensitive information stated by the user. |
| MEM-002 | P0 | Inferred preferences require repeated evidence and remain lower-confidence until confirmed. |
| MEM-003 | P0 | Memory must support global, project, and conversation scopes. |
| MEM-004 | P0 | Canonical memory must be local, encrypted, typed, temporal, and provenance-backed. |
| MEM-005 | P0 | Models may propose memory candidates but may not directly commit canonical memory. |
| MEM-006 | P0 | Durable memory writes may occur only from final canonical user turns. |
| MEM-007 | P0 | Partial speech, assistant claims, external webpages/files, and untrusted tool content must not directly create personal memory. |
| MEM-008 | P0 | Sensitive durable memory requires explicit consent or an approved category policy. |
| MEM-009 | P0 | Passwords, OTPs, API keys, recovery codes, private keys, and authentication tokens must never be stored as memory. |
| MEM-010 | P0 | Explicit corrections must supersede stale current facts and affect the next turn. |
| MEM-011 | P0 | JUNE must provide a Memory Centre for inspection, correction, forgetting, scope, provenance, sensitivity, export, and provider-egress visibility. |
| MEM-012 | P0 | JUNE must support Normal and Temporary Conversation modes. Temporary mode neither reads nor writes persistent personal memory. |
| MEM-013 | P0 | Forgetting must propagate through canonical records, indexes, caches, summaries, and relearning suppression. |
| MEM-014 | P0 | Memory must never grant action permission. |
| MEM-015 | P0 | Ordinary retrieval must return a small relevant evidence package rather than the user’s entire memory. |
| MEM-016 | P1 | Memory quality must be evaluated against public benchmarks, JUNE-MemBench, and a controlled ChatGPT parity study. |

### 8.4 Orchestrator, tasks, and actions

| ID | Priority | Requirement |
|---|---:|---|
| ORCH-001 | P0 | JUNE must use a small JUNE-owned deterministic control plane, not OpenCode or one unrestricted LLM as the universal authority. |
| ORCH-002 | P0 | Only final authenticated user turns or authorized scheduled triggers may create durable or effect-bearing work. |
| ORCH-003 | P0 | Clear, safe requests may use deterministic fast paths; ambiguous requests may use a structured model router. |
| ORCH-004 | P0 | Model routing/planning output must be validated against a trusted Capability Registry. |
| ORCH-005 | P0 | Every durable task must survive app/process restarts. |
| ORCH-006 | P0 | Task lifecycle must distinguish pending, running, waiting, paused, blocked, reconciling, completed, failed, cancelled, and discarded states. |
| ORCH-007 | P0 | Pause, resume, cancel, reopen, restart, and discard must have distinct deterministic behavior. |
| ORCH-008 | P0 | Restarting from scratch creates a new linked task; it must not rewrite prior history. |
| ORCH-009 | P0 | Every long-running task must have finite time, model/API, tool-call, retry, parallel-worker, and deadline budgets. |
| ORCH-010 | P0 | Consequential operations must pass through one Action Gateway. |
| ORCH-011 | P0 | Consequential execution must create a durable write-ahead action record before the effect is attempted. |
| ORCH-012 | P0 | Approval must bind to the exact action parameters and become invalid if those parameters materially change. |
| ORCH-013 | P0 | A timeout or disconnect after an external write must produce an uncertain state, not automatic failure. |
| ORCH-014 | P0 | JUNE must reconcile uncertain external actions before retrying. |
| ORCH-015 | P0 | JUNE must prevent duplicate effects caused by retries, reconnects, replays, or duplicated channel messages. |
| ORCH-016 | P0 | Safe read-only work may resume automatically after a crash; uncertain external writes may not. |
| ORCH-017 | P0 | Proactive messages are limited to authorized reminders, useful progress, completion, failures, confirmations, and budget alerts. |
| ORCH-018 | P1 | The orchestrator must pass JUNE-OrchBench, fault injection, process-kill, and duplicate-action tests. |

### 8.5 Permission tiers

| ID | Priority | Requirement |
|---|---:|---|
| PERM-001 | P0 | R0 read-only work may run automatically after feature consent. |
| PERM-002 | P0 | R1 reversible local changes may run automatically when clearly requested and must expose result/undo. |
| PERM-003 | P0 | R2 protected or consequential local changes require explicit task-scoped approval. |
| PERM-004 | P0 | R3 external, irreversible, financial, destructive, public, or security-sensitive actions require exact-action confirmation immediately before execution. |
| PERM-005 | P0 | Memory and learned preferences must never raise a permission ceiling or silently grant authority. |
| PERM-006 | P0 | Grants must be scoped, revocable, auditable, and least-privilege. |

### 8.6 Capability system

| ID | Priority | Requirement |
|---|---:|---|
| CAP-001 | P0 | Every capability must have a reviewed, versioned JUNE manifest. |
| CAP-002 | P0 | The manifest must declare schemas, risk, permissions, side effects, retry class, verification, cancellation, budgets, secrets, and egress policy. |
| CAP-003 | P0 | MCP may implement transport/interoperability but must not replace JUNE’s capability authority. |
| CAP-004 | P0 | Unsupported pause/resume/cancel/reconcile operations must be explicit. |
| CAP-005 | P0 | Capability completion claims must be verified through receipts, postconditions, tests, or reconciliation. |
| CAP-006 | P0 | Unknown or untrusted capabilities may not execute. |

### 8.7 Scheduling and reminders

| ID | Priority | Requirement |
|---|---:|---|
| SCHED-001 | P0 | Users can create, list, modify, complete, pause, resume, and cancel local tasks/reminders. |
| SCHED-002 | P0 | Scheduling supports date/time, timezone, recurrence, missed reminders, and restart recovery. |
| SCHED-003 | P0 | Reminder creation and rescheduling must be idempotent. |
| SCHED-004 | P0 | Delivery attempts record planned time, actual time, channel, and result. |
| SCHED-005 | P0 | Desktop and Telegram notifications use one canonical reminder/task. |
| SCHED-006 | P1 | Windows sleep/hibernate, clock changes, and daylight-saving behavior must be covered by acceptance tests. |

### 8.8 Money tracking

| ID | Priority | Requirement |
|---|---:|---|
| MONEY-001 | P0 | Users can add, correct, and delete expenses by voice, desktop text, or Telegram. |
| MONEY-002 | P0 | Expense records support amount, currency, date, category, merchant, payment method reference, and note. |
| MONEY-003 | P0 | INR is the initial default, but currency must be stored per record. |
| MONEY-004 | P0 | Users can define recurring expenses, budgets, and category limits. |
| MONEY-005 | P0 | JUNE provides daily, weekly, and monthly summaries plus CSV export. |
| MONEY-006 | P0 | Ambiguous amount/currency/intent requires a short clarification. |
| MONEY-007 | P0 | Finance domain records—not memory—are authoritative. |

### 8.9 Search and research

| ID | Priority | Requirement |
|---|---:|---|
| RES-001 | P0 | Quick Search and Deep Research must be distinct capabilities. |
| RES-002 | P0 | Quick Search handles bounded current lookups and returns sources. |
| RES-003 | P0 | Deep Research runs as a durable checkpointed task. |
| RES-004 | P0 | Research supports status, pause, resume, cancel, reopen, and restart. |
| RES-005 | P0 | Research stores objective, constraints, sources, evidence, notes, completed/remaining questions, checkpoints, synthesis, and final report. |
| RES-006 | P0 | Material factual claims must carry source provenance/citations. |
| RES-007 | P0 | External web content is untrusted data and may not alter permissions or personal memory. |
| RES-008 | P0 | Fireworks may support deeper reasoning behind a JUNE adapter; exact model remains replaceable. |

### 8.10 OpenCode coding capability

| ID | Priority | Requirement |
|---|---:|---|
| CODE-001 | P0 | OpenCode is a specialized coding capability, not the canonical assistant runtime. |
| CODE-002 | P0 | Every coding task receives a bounded workspace, objective, path policy, shell/network policy, Git policy, time budget, and model policy. |
| CODE-003 | P0 | Read-only inspection is lower risk than editing, Git mutation, remote push, destructive reset, or deletion. |
| CODE-004 | P0 | Coding results include changed files, diff, diagnostics, tests, Git state, and summary. |
| CODE-005 | P0 | OpenCode must not receive unrelated personal memory, finance records, credentials, or unrestricted filesystem access. |
| CODE-006 | P1 | Future parallel coding workers must use isolated worktrees/workspaces and an independent verification gate. |

### 8.11 Telegram

| ID | Priority | Requirement |
|---|---:|---|
| TG-001 | P0 | Telegram supports private one-to-one chats only in JUNE 0.1. |
| TG-002 | P0 | A secure linking flow maps Telegram account/chat identity to `user_id`. |
| TG-003 | P0 | Unlinked users receive no personal data or access to tasks/memory. |
| TG-004 | P0 | Telegram update IDs must be deduplicated. |
| TG-005 | P0 | Telegram messages map into canonical conversations/tasks rather than a separate bot state. |
| TG-006 | P0 | Sensitive confirmations bind to exact actions and expire safely. |
| TG-007 | P0 | Bot tokens and secrets never enter renderer-visible state or ordinary logs. |
| TG-008 | P0 | Telegram operation requires the user’s JUNE PC/background service to be running. |

### 8.12 Notifications and system tray

| ID | Priority | Requirement |
|---|---:|---|
| SYS-001 | P0 | Closing the visible window keeps JUNE running in the Windows system tray. |
| SYS-002 | P0 | Explicit Quit performs a safe shutdown of owned services and durable workers. |
| SYS-003 | P0 | One background runtime owns the local durable queue and Telegram polling. |
| SYS-004 | P0 | Notifications support desktop, in-app conversation, and Telegram routing. |
| SYS-005 | P0 | Duplicate notifications are suppressed. |
| SYS-006 | P0 | Lock-screen/Telegram notification content respects privacy settings. |

---

## 9. Non-functional requirements

### 9.1 Voice performance

| Metric | Initial JUNE 0.1 target |
|---|---:|
| Wake detected → visible listening state | ≤150 ms p95 |
| End of normal user turn → first meaningful audio | ≤700 ms p50; ≤1.2 s p95 |
| User interruption → audible silence | ≤120 ms p95 |
| Live transcript lag | Approximately ≤350 ms median |
| Important names/numbers | ≥97% exact |
| Quiet English WER | ≤6% |
| Real-room/noisy English WER | ≤10% |
| Blind voice naturalness | ≥4.2/5 |
| Accepted stale audio after cancellation | Zero |

These are product targets, not current-state claims or provider guarantees.

### 9.2 Memory performance

| Metric | Target |
|---|---:|
| Ordinary local retrieval | <100 ms p95; <200 ms p99 |
| Hot-context lookup | <10 ms p95 |
| Explicit correction canonical commit | <250 ms p95 before derived indexing |
| Memory-write delay added to first audio | 0 ms by design |
| Ordinary explicit-fact extraction precision | ≥98% |
| Ordinary explicit-fact extraction recall | ≥95% |
| Forbidden/sensitive automatic writes | Zero in policy tests |
| Stale memory returned as current | <1% |
| Deleted memory returned after acknowledgement | Zero |

### 9.3 Orchestration performance and correctness

| Metric | Target |
|---|---:|
| Local orchestration dispatch overhead | <50 ms p95, excluding model/provider/tool work |
| Unauthorized R2/R3 actions | Zero |
| Duplicate external effects caused by JUNE retries | Zero |
| Changed action accepted under old approval | Zero |
| Blind retry of uncertain non-idempotent action | Zero |
| Duplicate Telegram update creating duplicate task | Zero |
| Durable task recovery in automated process-kill suite | ≥99.9% |
| Terminal task silently restarting | Zero |

### 9.4 Reliability

- Durable tasks survive renderer, provider, and background-worker restarts.
- Safe read-only work may resume from checkpoints.
- External writes with uncertain outcomes enter reconciliation.
- Provider failure does not delete canonical conversation or task state.
- Late/stale events cannot mutate a newer turn or task.
- Backups and migrations are tested and reversible.
- No production behavior depends solely on provider-owned session state.

### 9.5 Security

- Security-sensitive local IPC must be authenticated and access-controlled.
- The current unauthenticated side channel must not carry future protected control/actions.
- Permanent API keys and OAuth tokens remain outside the renderer.
- Secrets are supplied only to capabilities that require them.
- Prompt injection from web pages, code, files, tool outputs, or Telegram cannot grant permission or write personal memory.
- Paths, commands, schemas, capability IDs, and action parameters are validated structurally.
- Production telemetry is content-minimized and classified.

### 9.6 Privacy

- No intentional pre-activation cloud microphone traffic.
- Raw microphone audio is not stored by default.
- Users can see whether JUNE is listening locally or sending audio to the cloud.
- Cloud providers receive only context needed for the current purpose.
- Users can inspect, correct, export, and delete personal memory.
- Normal logs do not contain secrets or raw personal content.
- JUNE must not describe ordinary cloud processing as Signal-style end-to-end encryption.

### 9.7 Accessibility and usability

- All critical voice states must also have visible UI representation.
- Confirmation prompts must state the exact action clearly.
- Users can type when voice is unsuitable.
- Errors must be stated plainly without pretending a failed or uncertain task succeeded.
- Pause, cancel, retry, and take-over controls must be discoverable for durable tasks.

---

## 10. Data ownership summary

| Domain | Canonical owner |
|---|---|
| Identity and linked channels | JUNE Identity Service |
| Conversations and final messages | Conversation System |
| Partial voice transcripts and active audio | Ephemeral VoiceTurn state |
| Personal memories | Memory System |
| Tasks and checkpoints | Durable Task Store |
| Action attempts and receipts | Action Ledger |
| Reminders/calendar items | Scheduling System |
| Expenses/budgets | Money System |
| Permissions and consent | Policy/Consent Store |
| Credentials and sessions | Credential/Secret Store |
| OpenAI/Fireworks/OpenCode provider sessions | Ephemeral adapter state |

A subsystem must not duplicate another subsystem’s authoritative state merely for convenience.

---

## 11. JUNE 0.1 release acceptance

JUNE 0.1 is accepted only when the following end-to-end outcomes are demonstrated on the target Windows machine.

### 11.1 Voice

- Wake and explicit activation work.
- Voice and text share one conversation.
- OpenAI realtime speech-to-speech works through WebRTC.
- The user can interrupt JUNE and old audio never resumes.
- Follow-up conversation works naturally.
- Both privacy modes behave as documented.
- No intentional pre-wake audio is sent to the cloud.

### 11.2 Memory

- JUNE automatically remembers clear useful non-sensitive information.
- A user can inspect, correct, forget, and export memories.
- Sources and use reasons are visible.
- Sensitive information is not durably stored without consent.
- Secrets never enter memory.
- Partial voice cannot create memory.
- Corrections affect the next turn.
- Deleted memories do not return from indexes, summaries, caches, or old evidence.
- Memory improves results over no-memory and vector-only baselines.

### 11.3 Orchestrator

- Durable tasks survive a process restart.
- Pause, resume, cancel, reopen, restart, and discard remain distinct.
- Risk-tier permission behavior is correct.
- Duplicate effects are prevented.
- Uncertain external writes are reconciled rather than retried blindly.
- Budgets stop runaway tasks while preserving progress.

### 11.4 Capabilities

- Reminders/tasks survive restart and notify through configured channels.
- Expenses can be entered, corrected, summarized, budgeted, and exported.
- Telegram private chat uses the same user, memory, and tasks.
- Quick Search returns current sourced answers.
- Deep Research supports durable progress and cited results.
- OpenCode runs bounded coding work and returns verifiable artifacts.

### 11.5 Security and operations

- Protected local messages cannot be forged through the old unauthenticated path.
- Credentials are not renderer-visible.
- Normal logs contain no secrets or full private content.
- App/provider/network failure tests recover without corrupting canonical state.
- Packaging, migrations, backup/restore, and release security checks pass before public distribution.

---

## 12. Current implementation baseline

At the start of implementation:

- The clean Windows repository has already passed a founder smoke test for app launch, text chat, BYOK cloud chat, microphone, wake, STT, TTS/playback, settings, UI interaction, and the CAD smoke path.
- The current voice implementation is transitional:

```text
local wake
→ fixed ~3.96-second capture
→ local faster-whisper
→ hidden OpenCode voice session
→ complete buffered model response
→ complete Kokoro WAV
→ unauthenticated local WebSocket
→ renderer playback
```

- Voice and typed chat are not yet one canonical conversation.
- JUNE-owned turn/generation identifiers are not yet implemented.
- Real barge-in and unified cancellation are not yet implemented.
- Current TTS uses one shared WAV path.
- OpenCode currently owns broader assistant flows than its long-term coding-specialist role.
- The scheduler has a non-blocking poller failure whose detailed root cause is not yet known.

The architecture documents define the target. The current product must migrate incrementally without losing the working path.

---

## 13. Delivery milestones

The master architecture controls cross-system ordering.

### Milestone 0 — Architecture authority — complete

- Master, Voice, Memory, and Orchestrator documents are tracked and merged.

### Milestone 1 — Core visibility and contracts

- Privacy-safe baseline instrumentation.
- Canonical identifiers and event envelope.
- VoiceTurn controller.
- Shared voice/text conversation.
- Secure local IPC and single-owner background runtime.

### Milestone 2 — Deterministic agency foundation

- Capability/task/action contracts.
- Encrypted runtime database.
- Capability Registry.
- Routing and validation.
- Permission tiers and exact approval binding.
- Action Gateway, ledger, verification, reconciliation.
- Crash recovery, budgets, and fake-capability tests.

### Milestone 3 — OpenAI Voice V1

- Realtime adapter and WebRTC.
- Shared conversation integration.
- Narrow delegation to the Orchestrator.
- Full interruption, heard-duration truth, follow-up mode, AEC/echo handling.
- Natural and Privacy-Enhanced modes.

### Milestone 4 — Memory V1

- MemoryBroker facade around existing behavior.
- Encrypted canonical memory store.
- Deterministic write policy.
- Final-turn asynchronous extraction.
- FTS baseline, then benchmarked dense/hybrid retrieval.
- Memory Centre, Temporary mode, provenance, export, genuine forgetting.
- Shadow migration and benchmarks.

### Milestone 5 — Baseline capabilities

- Deep Research.
- Scheduling and notifications.
- Money tracking.
- OpenCode coding adapter.
- Telegram channel.
- Quick Search integration.

### Milestone 6 — Product hardening

- Production wake model.
- Windows/audio/network/long-session acceptance.
- JUNE-OrchBench, JUNE-MemBench, privacy tests, soak tests.
- CI, packaging, signing, updates/rollback, backup/restore, release gates.

---

## 14. Engineering working rules

These rules apply to every contributor.

1. One bounded PR per session.
2. No direct pushes to `main`.
3. Use a separate branch and preferably a separate worktree.
4. Inspect before editing.
5. Every assignment must specify objective, allowed files, forbidden files, acceptance criteria, tests, and stop conditions.
6. Do not redesign architecture inside an implementation PR.
7. Do not mix unrelated cleanup with product changes.
8. Preserve the working path until the replacement passes acceptance.
9. Open a Draft PR and stop for review.
10. Do not merge your own PR.
11. Unexpected architecture, data-ownership, permission, or security questions are stop conditions.
12. Tests must prove behavior; a convincing model response is not evidence of success.

### Suggested beginner-safe contribution lanes

**Quality and reliability lane**

- Instrumentation.
- Tests and fake providers/capabilities.
- Fault injection.
- Benchmark fixtures.
- Acceptance checklists.
- Reproduction of known errors.

**UI and bounded-adapter lane**

- Mocked shared-chat UI.
- Interrupted-response presentation.
- Task progress cards.
- Confirmation dialogs.
- Memory Centre UI against fake data.
- Scheduling/Money views after contracts are stable.

High-risk ownership remains with the lead until contributors demonstrate several clean reviewed PRs:

- Permission engine.
- Action Gateway.
- Database migrations.
- Encryption and credentials.
- Secure IPC.
- Memory write/deletion policy.
- Reconciliation and external side effects.
- Provider adapters.

---

## 15. Deferred product decisions

The following do not block foundation work and should be resolved through targeted implementation testing:

- Exact OpenAI voice preset.
- Detailed JUNE personality prompt.
- Exact AEC/VAD and production wake-model implementation.
- Exact follow-up timeout.
- Exact Fireworks reasoning model.
- Exact local embedding model and dense-index implementation after benchmarks.
- Exact routing coefficients or reranker.
- Exact internal process placement and SQLite journal settings.
- Notification wording/frequency tuning.
- Detailed Telegram linking UX.

The following require later architecture and approval:

- Always-on cloud JUNE and multi-device memory.
- Email and external calendar access.
- Commerce, purchases, and payments.
- General browser/computer use.
- Credential/session broker.
- Dynamic agent teams and Personal App Builder.
- Cloud workers.
- Vision/device/physical-world control.

---

## 16. Product metrics

JUNE 0.1 should track:

### Voice

- End-of-turn to first audio p50/p95/p99.
- Interruption to silence p50/p95/p99.
- False/missed endpointing.
- Transcript/entity accuracy.
- Audio underruns.
- Reconnect/session failure rate.
- Long-session completion rate.
- Human naturalness/preference score.

### Memory

- Unnecessary repetition rate.
- Wrong/irrelevant/invasive personalization rate.
- Automatic-write precision and recall.
- Retrieval precision/recall.
- Temporal correctness.
- User correction rate.
- Deleted-memory recurrence rate.
- Provenance accuracy.
- Retrieval latency.

### Orchestration and capabilities

- Intent/capability routing accuracy.
- Task completion rate.
- Permission correctness.
- Duplicate-action rate.
- Uncertain-action reconciliation rate.
- Crash-recovery success.
- Cancellation correctness.
- Budget exhaustion frequency.
- Progress usefulness.
- End-to-end task success.

### Trust

- Memory disabled/forgotten rate.
- Confirmation abandonment rate.
- User corrections after JUNE claims completion.
- Security/privacy policy violations.
- Number of hidden or unexplained external effects: target zero.

---

## 17. Definition of done for an individual feature

A JUNE 0.1 feature is not done merely because the happy path works. It is done when:

- Behavior matches this PRD and the relevant system design.
- Ownership and persistence are correct.
- Permission and privacy rules are enforced structurally.
- Cancellation and restart behavior are defined and tested.
- Failure and uncertain outcomes are represented honestly.
- Observability exists without leaking private content.
- Unit/integration/fault tests pass.
- Windows manual acceptance is completed where hardware behavior matters.
- Documentation is updated.
- The PR is reviewed and merged without unrelated changes.

---

## 18. Final product statement

> **JUNE 0.1 succeeds when one user can speak or type naturally to one persistent assistant, be remembered accurately across time, manage a small set of useful personal tasks, and trust that JUNE’s actions, permissions, failures, and data remain visible and controlled.**

The objective is not maximum feature count. The objective is a foundation that already feels personal and useful, and that can safely grow into the user’s interface to their digital world.

---

**End of JUNE 0.1 Product Requirements Document**
