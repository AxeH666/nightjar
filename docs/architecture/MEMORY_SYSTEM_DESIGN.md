# JUNE Memory System Design

**Version:** 0.1  
**Status:** Founder-approved Memory V1 system design  
**Date:** 15 August 2026  
**Parent architecture:** [`JUNE_MASTER_ARCHITECTURE.md`](JUNE_MASTER_ARCHITECTURE.md) v0.1  
**Canonical repository target:** `C:\dev\june`  
**Product:** JUNE

> **Document authority**  
> This document is the implementation-level design authority for JUNE Memory V1. It defines product behaviour, ownership, data structures, write and retrieval lifecycles, privacy controls, failure handling, migration, evaluation, and acceptance gates. Implementation PRs may refine internal details, but must not silently violate the product contract or safety boundaries recorded here.
>
> This document refines [`JUNE_MASTER_ARCHITECTURE.md`](JUNE_MASTER_ARCHITECTURE.md) for the Memory subsystem. It cannot silently contradict the Master, which remains the top-level JUNE 0.1 authority for product boundaries, cross-system ownership, and global build order.

> **Design basis**  
> This design is based on the completed JUNE memory research, public memory behaviours in leading assistants, LongMemEval, LoCoMo, LoCoMo-Plus, Memora, security guidance for RAG/agent systems, the JUNE Master Architecture, and founder-approved product decisions. ChatGPT parity is a measurable target, not a claim that JUNE already reproduces OpenAI's proprietary implementation.

## Contents

1. Executive summary  
2. Scope and non-goals  
3. Founder-approved Memory V1 decisions  
4. Design principles  
5. System context and canonical ownership  
6. Memory taxonomy and scopes  
7. User experience and memory modes  
8. Target architecture and components  
9. Canonical data model  
10. Memory write and update lifecycle  
11. Retrieval and context packaging  
12. Conversation history and Deep Recall  
13. Time, conflicts, consolidation, and forgetting  
14. Voice integration  
15. Orchestrator and capability integration  
16. Security, privacy, and trust  
17. Storage, encryption, keys, backup, and recovery  
18. API and event contracts  
19. Performance, observability, and operations  
20. Evaluation and acceptance gates  
21. Migration from the current repository  
22. Bounded implementation sequence  
23. Failure modes and required recovery  
24. Future extensions  
25. Decision register  
Appendices: schemas, policy matrix, test catalogue, glossary, evidence basis

# 1. Executive summary

Memory and realtime voice are JUNE's primary product differentiators. The Memory V1 goal is to make JUNE feel increasingly personal and competent with every week of use, without becoming opaque, invasive, stale, or unsafe.

JUNE Memory must provide two complementary experiences:

1. **Effortless continuity.** The user should not repeatedly explain preferences, people, projects, decisions, and ongoing context.
2. **Trustworthy control.** The user can inspect what JUNE believes, see where it came from, correct it, limit its scope, understand when it was used, and genuinely forget it.

The system is not a vector database attached to chat history. The canonical design is:

```text
Encrypted relational source of truth
        |
        +-- atomic typed memories
        +-- temporal versions and validity
        +-- source evidence and provenance
        +-- relations and supersession
        +-- audit and usage events
        +-- deletion/suppression tombstones
        |
        +--> rebuildable lexical index
        +--> rebuildable dense-vector index
        +--> rebuildable summaries and hot cache
        |
        +--> structured + lexical + semantic + temporal retrieval
        |
        +--> small purpose-scoped evidence package
        |
        +--> OpenAI Realtime / Fireworks / Research / OpenCode
```

The canonical Windows MVP stack is:

| Layer | Memory V1 decision |
|---|---|
| Canonical memory | SQLite encrypted with SQLCipher |
| Local key protection | Random database key wrapped by Windows DPAPI |
| Structured retrieval | Indexed SQLite queries |
| Lexical retrieval | SQLite FTS5 |
| Dense retrieval | Local rebuildable index; LanceDB is the preferred initial candidate |
| Embeddings | Benchmark compact local BGE-family embeddings against OpenAI baselines |
| Memory writer | Provider-independent structured candidate extractor |
| Write authority | Deterministic JUNE policy, never the model |
| User controls | Memory Centre, correction, forgetting, export, scope, provenance, provider-egress visibility |
| Modes | Normal and Temporary Conversation |
| Cross-device/cloud memory | Deferred |

The critical rules are:

> **Partial speech can start a read, but can never create a durable memory.**

> **Models propose memory; JUNE software decides what becomes true.**

> **Memory is evidence, never action permission.**

> **Conversation history records what was said; Memory records durable interpreted context.**

> **Deleting a memory removes its active representations and prevents silent relearning from the same deleted evidence.**

# 2. Scope and non-goals

## 2.1 Memory V1 scope

Memory V1 includes:

- Clear profile facts and identity preferences.
- Explicit preferences and cautiously learned repeated preferences.
- People and user-stated relationships.
- Projects, goals, decisions, and rationale.
- Communication and response-style preferences.
- Important topic-bounded conversation episodes.
- References to commitments and open loops, while the Task system remains authoritative.
- Global, project, and conversation scopes.
- Encrypted local conversation history for detailed past-chat recall.
- Automatic non-sensitive memory under a deterministic policy.
- Sensitive-memory consent.
- Normal and Temporary Conversation modes.
- Memory Centre, correction, forgetting, export, and usage explanations.
- Hybrid local retrieval under a strict voice latency budget.
- A migration path from existing JUNE memory/profile stores.
- Evaluation against public and JUNE-specific benchmarks.

## 2.2 Explicit non-goals for Memory V1

- Saving every sentence as permanent memory.
- Treating raw chat history as the only memory mechanism.
- Using a vector database as canonical truth.
- A full knowledge graph or universal ontology.
- Multi-device synchronization.
- An always-on cloud memory service.
- Telegram memory access while the user's JUNE PC/service is off.
- Per-user model fine-tuning or federated learning.
- Multimodal photo/video/screen memories.
- Agent-team procedural memory or computer-use skill memory.
- Storing passwords, OTPs, API keys, recovery codes, tokens, or private keys.
- Letting memory grant permission for actions.
- Claiming best-in-class parity without benchmark evidence.

# 3. Founder-approved Memory V1 decisions

| Decision | Approved position |
|---|---|
| Automatic remembering | Clear, useful, non-sensitive user statements are remembered automatically |
| Implicit preferences | Learned only from repeated evidence and remain lower-confidence until confirmed |
| Conversation history | Retained locally and encrypted as separate evidence for detailed past-chat recall |
| Scope | Global, project, and conversation; use the narrowest sensible scope |
| Sensitive information | Durable storage requires explicit consent or an approved category policy |
| Secrets | Never stored as memory |
| Memory UX | Quiet `Memory updated` and `Used memories` affordances plus a full Memory Centre |
| Conversation modes | Normal and Temporary Conversation in MVP; Read-only Memory deferred |
| Conversation deletion | Offer conversation-only deletion or conversation-plus-derived-memory deletion |
| Telegram | Uses the same Memory Service only while the user's JUNE PC/service is running in MVP |
| Local/cloud boundary | Canonical memory and normal retrieval remain local; providers receive only relevant bounded evidence |
| Correction | Explicit user correction applies immediately to the next turn |
| Time | Previous facts remain historically traceable when a changing fact is superseded |
| Authority | Memory never grants permission or certifies external action success |

# 4. Design principles

## 4.1 Remember utility, not volume

The objective is to reduce unnecessary repetition and improve decisions. High recall with low relevance is a product failure. JUNE should remember information with likely future utility rather than indiscriminately accumulating personal data.

## 4.2 Canonical truth is inspectable

Important user facts must not exist only inside model weights, one opaque summary, or an embedding index. Canonical memories are typed records that can be viewed, corrected, versioned, exported, and deleted.

## 4.3 Evidence is inseparable from memory

Every durable memory links to supporting evidence and source trust. If JUNE cannot explain where a memory came from, it must treat the memory as unverified or abstain.

## 4.4 Time is a first-class dimension

Many personal facts change. JUNE stores `valid_from`, `valid_to`, current status, and supersession relationships so it can distinguish current truth from historical truth.

## 4.5 Models propose; deterministic software governs

A model may extract or rank candidate memories. It cannot write directly to the canonical store, change sensitivity, override explicit preferences, or bypass consent.

## 4.6 Memory is data, not instruction

Retrieved memory is clearly labelled as non-authoritative evidence. System policy and current authenticated user instructions outrank memory. External content cannot smuggle instructions into memory.

## 4.7 Transactional truth stays in its domain

Tasks, reminders, expenses, permissions, action receipts, credentials, and repository state remain in their authoritative systems. Memory stores personal context or references, not duplicate operational truth.

## 4.8 Voice latency is protected

Read retrieval is bounded and can be prefetched. Memory writing and consolidation are asynchronous and add no first-audio delay.

## 4.9 Forgetting must be real

A successful forget operation invalidates all active representations and prevents the same old evidence from silently reconstructing the deleted memory.

## 4.10 Privacy grows stricter as memory grows richer

Aggregated memory is more sensitive than individual facts. Canonical storage is local and encrypted; cloud egress is purpose-limited, sensitivity-filtered, and auditable.

# 5. System context and canonical ownership

## 5.1 Position in JUNE

```text
Voice / Desktop text / Telegram
              |
              v
Canonical Conversation System
              |
              +--> conversation.turn.finalized --> Memory Writer
              |
              v
JUNE Orchestrator --purpose/scope--> Memory Broker
              |                           |
              |                           +--> canonical memory
              |                           +--> retrieval indexes
              |                           +--> user policy
              |
              +--> OpenAI Realtime
              +--> Fireworks / Research
              +--> OpenCode
              +--> Scheduling / Money / other capabilities
```

## 5.2 Systems of record

| Domain | System of record | What Memory may retain |
|---|---|---|
| Exact speech/text | Conversation System | Source references and interpreted durable context |
| Personal preferences/profile | Memory System | Canonical typed memory |
| Tasks/reminders | Task/Scheduling | Preference context and task references only |
| Expenses/budgets | Money Tracking | Categorisation preferences and contextual patterns only |
| Permissions/consent | Orchestrator Policy Store | No authority; optional explanation reference only |
| External actions | Action Ledger | Durable personal lesson or preference, never the action receipt itself |
| Secrets/sessions | Credential Store | Link-state metadata only; never secret material |
| Code/repository | Repository and OpenCode outputs | Project conventions and accepted decisions within coding scope |
| World facts/research | Research artifacts | User-accepted decisions or project context; external content is not personal memory by default |

## 5.3 Memory Service boundary

Only the Memory Service/Broker opens the canonical memory database. The Electron renderer, OpenAI, Fireworks, OpenCode, Telegram, Research, and other capabilities use authenticated service APIs with purpose, scope, user, and sensitivity limits.

# 6. Memory taxonomy and scopes

## 6.1 MVP memory kinds

| Kind | Purpose | Example | Default lifecycle |
|---|---|---|---|
| `profile` | Stable identity/context | Preferred name, timezone, language | Durable until corrected |
| `preference` | Choice or aversion | Prefers concise explanations | Durable/evolving |
| `person` | User-stated person/relationship context | Rahul is the user's business partner | Durable, time-aware |
| `project` | Goal and bounded work context | JUNE is the current priority project | Active, then archived |
| `decision` | Chosen direction plus rationale | Voice V1 uses OpenAI Realtime because quality and maturity matter | Durable until superseded |
| `style` | Communication/output behaviour | Direct answer first, more detail on request | Durable/evolving |
| `episode` | Important topic-bounded event/discussion | Memory architecture planning discussion | Soft-retained and decaying |
| `routine` | Repeated workflow/pattern | Prefers weekly spending summary on Sunday | Explicit or repeated-evidence |
| `commitment_ref` | Contextual reference to an authoritative task/open loop | There is an active task to review Voice V1 | Follows task lifecycle |
| `capability_preference` | How a capability should behave | Ask before sending external messages | Durable; cannot replace policy |

## 6.2 Future memory kinds

- Procedural/skill memory for capabilities.
- Agent-team shared project memory.
- Computer-use environment and workflow memory.
- Multimodal episode memory.
- Cross-device state and device-specific preferences.
- Learned local ranking/profile models.

## 6.3 Sensitivity is independent of kind

`kind` describes what a memory is. `sensitivity` describes how it may be stored and used. The same kind can be ordinary or sensitive.

Example:

```text
preference + personal:
User prefers vegetarian meals.

preference + sensitive:
User follows a diet because of a medical condition.
```

## 6.4 Scopes

| Scope | Meaning | Example |
|---|---|---|
| `global` | Useful across JUNE | User prefers concise answers |
| `project:<id>` | Only for one project | JUNE Voice V1 uses OpenAI Realtime |
| `conversation:<id>` | Only in one conversation unless promoted | Temporary planning assumption |
| `capability:<name>` | Only for a specialised system | Coding response must include tests and diff |

The MVP user-facing scope controls are global, project, and conversation. Capability scope is an internal enforcement mechanism.

## 6.5 Stability and explicitness

```text
stability:
stable | evolving | ephemeral

explicitness:
explicit_user | repeated_user_evidence | inferred | authoritative_tool | legacy_import
```

Explicit user corrections and current statements outrank every other class.

# 7. User experience and memory modes

## 7.1 Normal Conversation

- Reads relevant persistent memory.
- May create memory candidates only after `conversation.turn.finalized`.
- Applies normal sensitivity, scope, and consent policy.
- Stores final conversation history according to the user's retention setting.

## 7.2 Temporary Conversation

- Does not read persistent personal memory.
- Does not write persistent personal memory.
- Does not allow the conversation to become evidence for future memory extraction.
- May use only explicit context provided within that temporary conversation.
- Can be discarded according to the temporary-conversation retention policy.

## 7.3 Future Read-only Memory mode

Deferred from V1:

- Existing memory may be read.
- Nothing from the current conversation is written.

## 7.4 Quiet memory affordances

Normal conversation should not be interrupted by repetitive save confirmations. The UI uses:

- `Memory updated` after a successful ordinary write.
- `Confirm memory` only when policy requires consent or clarification.
- `Used N memories` on responses where memory materially influenced output.
- A Memory Centre for full inspection and control.

## 7.5 Memory Centre

The Memory Centre must support:

- Search and category filters.
- Global/project/conversation scope filters.
- Current, stale, superseded, expired, and deleted views.
- Source conversation/turn and supporting evidence.
- Confidence and explicitness.
- Sensitivity and provider-egress policy.
- Created, updated, last confirmed, and last used times.
- Correction, scope change, expiry, and forgetting.
- Human-readable and machine-readable export.
- `What does JUNE know about me?` summary generated from canonical records.
- `Why was this used?` and `Where did this come from?` explanations.

## 7.6 Natural-language controls

JUNE must understand requests such as:

```text
Remember that I prefer short answers.
Don't remember anything from this conversation.
Keep this only inside the JUNE project.
That is no longer true.
Why do you think I live in Bengaluru?
Forget everything about that relationship.
Show what you learned from this chat.
What do you remember about me?
```

# 8. Target architecture and components

## 8.1 Components

| Component | Responsibility |
|---|---|
| `MemoryBroker` | Sole product-facing API; applies user, purpose, scope, and sensitivity boundaries |
| `MemoryWriteCoordinator` | Consumes `conversation.turn.finalized` and coordinates extraction and policy |
| `MemoryExtractor` | Produces constrained candidate records; provider-independent adapter |
| `MemoryPolicyEngine` | Deterministically commits, asks, keeps temporary, supersedes, or discards |
| `CanonicalMemoryStore` | Encrypted relational source of truth and audit state |
| `LexicalIndexer` | Maintains FTS5 representations |
| `DenseIndexer` | Maintains rebuildable embeddings/vector index |
| `RetrievalPlanner` | Chooses hot/structured/lexical/dense/deep-recall paths |
| `RetrievalFusion` | Combines rankings, applies deterministic boosts/penalties, deduplicates |
| `MemoryContextPackager` | Produces bounded evidence packages for a purpose/provider |
| `HotContextCache` | Tiny revision-aware cache for frequently used stable context |
| `ConsolidationWorker` | Deduplication, episode summaries, stale checks, derived projections |
| `DeletionCoordinator` | Propagates forget/delete and creates suppression tombstones |
| `MemoryAudit` | Records writes, changes, usage, egress, and policy decisions |
| `MemoryCentreAPI` | Lists, edits, exports, explains, and deletes memories |
| `LegacyMemoryAdapter` | Temporary facade for current repository stores during migration |

## 8.2 Trust zones

```text
Trusted local control:
MemoryBroker, policy, canonical store, indexes, key management

Trusted authenticated user inputs:
conversation.turn.finalized after Conversation Service authentication, normalisation, acceptance, and persistence

Domain-authoritative tools:
Scheduling, Money, Action Ledger inside their own fields

Model proposals:
Extraction/ranking suggestions, never write authority

Untrusted external data:
Web pages, files, emails, research sources, code comments
```

# 9. Canonical data model

## 9.1 `memory_item`

```sql
memory_item (
    memory_id           UUID PRIMARY KEY,
    user_id             UUID NOT NULL,

    scope_type          TEXT NOT NULL,
    scope_id            UUID NULL,

    kind                TEXT NOT NULL,
    subject_key         TEXT NULL,
    predicate           TEXT NULL,
    value_json          JSON NOT NULL,

    display_text        TEXT NOT NULL,
    retrieval_text      TEXT NOT NULL,

    stability           TEXT NOT NULL,
    sensitivity         TEXT NOT NULL,
    explicitness        TEXT NOT NULL,
    confidence          REAL NOT NULL,

    status              TEXT NOT NULL,
    valid_from          TIMESTAMP NULL,
    valid_to            TIMESTAMP NULL,
    expires_at          TIMESTAMP NULL,

    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    last_confirmed_at   TIMESTAMP NULL,
    last_used_at        TIMESTAMP NULL,
    revision            INTEGER NOT NULL
)
```

## 9.2 `memory_evidence`

```sql
memory_evidence (
    evidence_id         UUID PRIMARY KEY,
    memory_id           UUID NOT NULL,
    source_type         TEXT NOT NULL,
    source_id           UUID NOT NULL,
    source_span_start   INTEGER NULL,
    source_span_end     INTEGER NULL,
    source_hash         TEXT NOT NULL,
    author_class        TEXT NOT NULL,
    trust_class         TEXT NOT NULL,
    observed_at         TIMESTAMP NOT NULL,
    extraction_model    TEXT NULL,
    extraction_version  TEXT NULL
)
```

## 9.3 `memory_relation`

```sql
memory_relation (
    from_memory_id      UUID NOT NULL,
    relation_type       TEXT NOT NULL,
    to_memory_id        UUID NOT NULL,
    created_at          TIMESTAMP NOT NULL
)
```

Initial relation types:

```text
supersedes
superseded_by
contradicts
supports
derived_from
related_to
references_task
references_project
```

## 9.4 `memory_event`

```sql
memory_event (
    event_id            UUID PRIMARY KEY,
    memory_id           UUID NULL,
    event_type          TEXT NOT NULL,
    actor               TEXT NOT NULL,
    reason_code         TEXT NULL,
    previous_hash       TEXT NULL,
    new_hash            TEXT NULL,
    occurred_at         TIMESTAMP NOT NULL,
    correlation_id      UUID NULL
)
```

## 9.5 `memory_usage`

```sql
memory_usage (
    usage_id            UUID PRIMARY KEY,
    turn_id             UUID NOT NULL,
    memory_id           UUID NOT NULL,
    retrieval_rank      INTEGER NOT NULL,
    retrieval_reason    JSON NOT NULL,
    sent_to_provider    BOOLEAN NOT NULL,
    provider_class      TEXT NULL,
    occurred_at         TIMESTAMP NOT NULL
)
```

## 9.6 `memory_suppression`

```sql
memory_suppression (
    suppression_id      UUID PRIMARY KEY,
    user_id             UUID NOT NULL,
    subject_key         TEXT NULL,
    predicate           TEXT NULL,
    source_hash         TEXT NULL,
    scope_type          TEXT NULL,
    scope_id            UUID NULL,
    reason              TEXT NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    expires_at          TIMESTAMP NULL
)
```

A suppression record contains the minimum information required to prevent re-extraction from deleted evidence. It must not preserve the sensitive fact in plaintext merely to enforce forgetting.

## 9.7 `memory_policy`

Stores user choices for:

- Automatic ordinary memory.
- Sensitive categories.
- Conversation retention.
- Temporary mode.
- Provider egress ceilings.
- Default scope behaviour.
- Optional expiry rules.

## 9.8 Canonical versus derived data

Canonical:

- Memory items.
- Evidence.
- Relations.
- Events.
- Usage metadata.
- Suppression/tombstone state.
- User policy.

Derived and rebuildable:

- FTS entries.
- Embedding vectors.
- ANN indexes.
- Hot cache.
- Project/global summaries.
- Episode projections.
- Ranking features.

# 10. Memory write and update lifecycle

## 10.1 Trigger

For conversation-derived memory, only `conversation.turn.finalized`—emitted after the Conversation Service has authenticated, normalised, accepted, and persisted the final user turn—may initiate normal candidate extraction. `voice.user.transcript.final` means only that Voice STT produced its final transcript; it does not authorise durable memory-candidate extraction or a durable write. Temporary conversations, partial transcripts, assistant messages, and untrusted external content do not initiate personal-memory writes.

A separately authorised scheduled/system trigger may initiate only explicitly scoped processing of otherwise eligible canonical evidence. It cannot become personal-memory evidence or bypass Memory source-trust, consent, sensitivity, suppression, or write policy.

## 10.2 Pipeline

```text
conversation.turn.finalized
    |
    +--> inexpensive memorability gate
    |        |
    |        +--> skip clearly non-memorable turns
    |
    +--> MemoryExtractor structured candidates
             |
             +--> schema validation
             +--> source-span validation
             +--> trust classification
             +--> sensitivity classification
             +--> scope proposal
             +--> novelty/deduplication
             +--> conflict/currentness analysis
             +--> suppression-tombstone check
             |
             +--> MemoryPolicyEngine
                       |
                       +--> commit
                       +--> pending_confirmation
                       +--> ephemeral_only
                       +--> discard
```

## 10.3 Candidate contract

```json
{
  "kind": "preference",
  "subject_key": "user",
  "predicate": "communication.answer_length",
  "value": {"preference": "concise"},
  "display_text": "The user prefers concise answers.",
  "stability": "evolving",
  "explicitness": "explicit_user",
  "sensitivity": "personal",
  "confidence": 0.99,
  "scope": {"type": "global", "id": null},
  "source_span": {"start": 0, "end": 31},
  "proposed_action": "upsert"
}
```

The extractor cannot supply canonical IDs, bypass policy, execute SQL, grant consent, or label secrets as memory.

## 10.4 Automatic commit rules

May auto-commit when all are true:

- Source is an authenticated final user turn persisted as canonical by the Conversation Service, with the completed commit signalled by `conversation.turn.finalized`.
- Statement is explicit and supported by the cited span.
- Information is likely useful beyond the current turn.
- Category is ordinary personal information.
- Scope is valid.
- No unresolved strong conflict exists.
- No suppression record blocks it.
- Confidence and extraction validation exceed the approved threshold.

## 10.5 Confirmation rules

Require confirmation for:

- Sensitive durable memory.
- Ambiguous relationships or identity.
- Two equally strong explicit conflicting stable facts.
- A broad/global scope when a narrower project scope may be safer.
- An inferred preference with meaningful downstream consequences.
- Third-party sensitive information.

## 10.6 Repeated-evidence inference

Repeated behaviour can produce a low-confidence candidate only when:

- Evidence comes from multiple independent user actions/choices.
- The inferred preference has a bounded purpose.
- It does not reveal a sensitive trait.
- It does not override an explicit statement.
- It decays unless reinforced.

Example:

```text
Observed several times:
User repeatedly moves optional meetings to mornings.

Permitted low-confidence candidate:
The user may prefer optional meetings in the morning.

Not permitted:
The user is a morning person and is more productive before noon.
```

## 10.7 Explicit correction fast path

When the user clearly corrects memory:

```text
No, I moved to Bengaluru.
That preference is no longer true.
Rahul is my co-founder, not my employee.
```

JUNE applies the canonical correction synchronously before the next generation, closes or supersedes the prior record, emits an event, invalidates hot cache, and schedules derived-index repair.

## 10.8 Authority hierarchy

```text
1. Explicit user correction
2. Explicit current user statement
3. Domain-authoritative tool state inside that tool's domain
4. Repeated authenticated user evidence
5. Assistant inference
6. External web/file/research content
```

Assistant inference and external content cannot directly create durable personal memory.

# 11. Retrieval and context packaging

## 11.1 Retrieval tiers

### Hot context

Revision-aware in-memory cache for:

- Preferred name.
- Language and timezone.
- Stable speaking/output preferences.
- Current top projects.
- A small number of active high-priority facts.

Target: less than 10 ms p95.

### Ordinary per-turn retrieval

Purpose-specific retrieval across structured, lexical, and semantic paths. Target: less than 100 ms p95 on the minimum supported Windows machine.

### Deep Recall

Explicit slower path for:

- Exact past discussions.
- Multi-session historical reasoning.
- `What did we decide three months ago?`
- Long topic reconstruction.

Deep Recall may become a durable orchestrator task and must not hold ordinary first audio hostage.

## 11.2 Query planning

The Orchestrator supplies:

```text
user_id
query
purpose
allowed_scopes
project_id/capability
sensitivity_ceiling
current_time
token_budget
```

The Retrieval Planner derives:

- Named people/entities.
- Project and conversation scope.
- Temporal intent (`now`, `last year`, `before we changed X`).
- Exact-fact versus semantic/episodic recall.
- Need for authoritative task/finance/action lookup.

## 11.3 Candidate generation

Parallel sources:

1. Hot exact lookup.
2. Structured SQL predicates and entity lookups.
3. FTS5 lexical/BM25 search.
4. Dense semantic retrieval.
5. Conversation episode/source expansion when needed.

## 11.4 Hard filters before model use

Reject candidates that are:

- Deleted, expired, or superseded for a current-state query.
- Outside allowed scopes.
- Above the sensitivity ceiling.
- Unsupported by valid evidence.
- From an untrusted author/source class for the requested use.
- Blocked by a suppression record.
- Incompatible with the query's temporal point.

The LLM is never asked to enforce these hard boundaries itself.

## 11.5 Fusion and ranking

Initial production ranking:

1. Retrieve bounded candidates from each channel.
2. Combine ranks using a provider-independent rank-fusion method.
3. Apply deterministic bonuses for exact entity/predicate match, explicit user source, project match, temporal validity, and recent confirmation.
4. Apply penalties for inference, staleness, weak evidence, and scope distance.
5. Deduplicate equivalent memories.
6. Select a small evidence package under the token budget.

Do not freeze arbitrary coefficients before JUNE-MemBench tuning.

## 11.6 Context package

```json
{
  "purpose": "conversation",
  "scope": ["global", "project:june"],
  "items": [
    {
      "memory_id": "mem_...",
      "kind": "decision",
      "content": "Voice V1 uses OpenAI Realtime.",
      "confidence": 0.99,
      "validity": {"current": true},
      "source": {"turn_id": "turn_...", "observed_at": "..."},
      "reason": ["active project", "explicit founder decision"]
    }
  ],
  "budget_used": 84
}
```

Normal voice target:

- 4-8 atomic memories.
- Approximately 600-1,200 memory tokens.
- No wholesale profile or conversation dump.

## 11.7 Abstention

JUNE should say it does not remember when:

- No memory passes minimum evidence/score.
- Conflicting facts cannot be temporally resolved.
- A source was deleted or is inaccessible.
- Scope prevents using the memory.
- The user requests exact wording but only an interpretation remains.

# 12. Conversation history and Deep Recall

## 12.1 Separate evidence store

Conversation System retains encrypted final turns, interrupted-state metadata, channel, timestamps, and source identity. Memory points to those turns rather than duplicating raw chat as memory.

## 12.2 Exact wording

If the user asks:

> What exactly did we say?

JUNE retrieves the source conversation. It does not present a memory summary as a verbatim quote.

## 12.3 Episode summaries

After the atomic foundation is stable, JUNE may create topic-bounded episode summaries with explicit source ranges. Episode summaries are derived and regenerate after source deletion or correction.

## 12.4 Deep Recall lifecycle

```text
User asks historical question
        |
        +--> ordinary memory lookup
        |
        +--> if insufficient: create Deep Recall task
                 |
                 +--> search conversations and episodes
                 +--> expand source turns
                 +--> resolve temporal versions
                 +--> return evidence-backed answer
```

# 13. Time, conflicts, consolidation, and forgetting

## 13.1 Temporal versioning

For changing facts:

```text
Old record:
location = Mumbai
valid_to = 2026-08-01
status = superseded

New record:
location = Bengaluru
valid_from = 2026-08-01
status = active
```

This supports both current and historical questions.

## 13.2 Conflict policy

| Conflict | Required behaviour |
|---|---|
| Explicit user correction | Supersede immediately |
| Explicit time-varying change | Close old validity and create new current version |
| Implicit signal conflicts with explicit preference | Keep explicit preference |
| Two explicit stable facts conflict without time | Ask once |
| Trusted domain tool updates its own state | Reference authoritative tool receipt |
| Assistant inference conflicts with user evidence | Discard inference |
| Sensitive inference | Do not auto-commit |

## 13.3 Consolidation

Background/idle worker may:

- Merge exact duplicates.
- Increase support from repeated evidence.
- Mark weak inferred memories stale.
- Create topic-bounded episode summaries.
- Regenerate global/project summaries.
- Detect temporal anomalies.
- Identify pending reconfirmations.

Every derived result remains traceable to canonical items/evidence.

## 13.4 Soft forgetting

- Stable explicit facts remain until corrected or deleted.
- Explicit preferences remain durable but may receive lower retrieval weight when old.
- Inferred preferences decay unless reinforced.
- Ephemeral events expire.
- Completed-project memories move to archived scope.
- Episodes decay in general ranking but remain available for explicit historical queries.

## 13.5 Hard forgetting

```text
memory.forget
    |
    +--> mark/delete canonical active record
    +--> remove FTS entry
    +--> remove dense vector revision
    +--> invalidate hot cache
    +--> regenerate affected summaries
    +--> update/remove relations
    +--> write deletion event
    +--> write minimal suppression tombstone
    +--> verify active retrieval returns zero
```

## 13.6 Conversation deletion choices

```text
Delete conversation only
Delete conversation and memories learned from it
```

If other independent evidence supports a memory, deleting one source removes that evidence and recomputes support rather than necessarily deleting the still-supported memory.

# 14. Voice integration

## 14.1 Session start

At realtime session activation, JUNE may preload a small stable profile snapshot:

- Preferred name.
- English language preference.
- Speaking/answer style.
- Active top project context.
- A few high-value stable preferences.

This snapshot contains canonical memory IDs/revisions and is invalidated by corrections.

## 14.2 During user speech

- Stable partial transcript may start speculative read-only retrieval.
- No partial transcript reaches the write pipeline.
- Local retrieval can overlap the user's remaining speech.

## 14.3 End of turn

- `voice.user.transcript.final` confirms or replaces the speculative read-only query, but does not authorise a durable write.
- The Conversation Service authenticates, normalises, accepts, and persists the user message before emitting `conversation.turn.finalized`.
- Retrieval filters and packages the final relevant memories.
- The package is injected through the trusted JUNE control/sideband path where supported.
- If retrieval misses its budget, JUNE does not delay ordinary first audio indefinitely.

## 14.4 After response

- Candidate extraction starts asynchronously only from `conversation.turn.finalized`.
- Memory writes do not affect first-audio latency.
- `memory_usage` records which memories were used and what left the device.

## 14.5 Explicit historical request

JUNE may respond naturally:

> Let me check our earlier conversations.

and delegate Deep Recall rather than fabricating continuity.

## 14.6 Emotional cues

Tone or emotional inference from voice is session/turn context by default, not durable memory. JUNE stores it only if the user explicitly states a durable fact or requests retention.

# 15. Orchestrator and capability integration

## 15.1 Orchestrator role

The Orchestrator specifies purpose, scopes, token budget, and sensitivity ceiling. It does not query raw database tables or implement retrieval ranking.

## 15.2 Memory Broker API examples

```text
Voice:
memory.retrieve(
    purpose="conversation",
    scopes=["global", "project:june"],
    token_budget=700,
    sensitivity_ceiling="personal"
)

Research:
memory.retrieve(
    purpose="research",
    scopes=["project:june"],
    token_budget=1800,
    sensitivity_ceiling="personal"
)

OpenCode:
memory.retrieve(
    purpose="coding",
    scopes=["project:june", "capability:coding"],
    token_budget=1200,
    sensitivity_ceiling="personal"
)
```

## 15.3 OpenCode boundary

OpenCode may receive:

- Repository conventions.
- Accepted architecture decisions.
- Test commands.
- Coding style preferences.
- Known project constraints.

It must not receive unrelated family, health, financial, relationship, or personal-history memory.

## 15.4 Research boundary

Research may receive user context that changes the question, such as country, budget, dietary restriction, or project objective. Retrieved web content cannot directly create personal memory. A user-accepted conclusion can become a project decision memory.

## 15.5 Scheduling and Money boundaries

```text
Memory:
User prefers reminders 15 minutes early.

Scheduling:
The actual reminder, due time, delivery, and completion state.
```

```text
Memory:
Restaurant expenses are normally categorised as Dining.

Money:
The actual expense transaction and budget totals.
```

## 15.6 Telegram boundary

For MVP, Telegram requests reach the same local Memory Broker through an authenticated channel link while the user's JUNE PC/service is online. Telegram does not maintain a separate memory store.

# 16. Security, privacy, and trust

## 16.1 Data classes

```text
PUBLIC
PERSONAL
SENSITIVE
SECRET
```

- Personal may be used when relevant under normal policy.
- Sensitive requires purpose and consent.
- Secret is never memory.

## 16.2 Sensitive durable-memory policy

Sensitive classes include health, intimate/sexual information, religion, political affiliation, highly private finances, precise private location, and sensitive third-party details.

These may be used transiently in the current conversation. Durable memory requires explicit user request or an approved category setting. Inference alone can never create a durable sensitive record.

## 16.3 Secret rejection

The write policy detects and rejects likely:

- Passwords.
- OTPs.
- API keys.
- OAuth tokens.
- Recovery codes.
- Private keys.
- Session cookies.

If JUNE needs such material, it is routed to a separate OS-backed credential/session system under explicit permission.

## 16.4 Source trust and memory poisoning

External webpages, emails, documents, browser content, research results, and code comments are untrusted data. They cannot call the durable memory writer or promote their instructions into personal memory.

An authenticated user statement may accept a conclusion:

> Remember that we selected Postgres for this project.

That final user acceptance is the authoritative evidence, not the webpage that recommended Postgres.

## 16.5 Provider egress

After local retrieval, the packager sends only the minimum relevant evidence. Each usage event records:

- Memory ID.
- Purpose.
- Provider class.
- Whether content left the device.
- Why the memory was selected.

The Memory Centre can explain:

> JUNE used your dietary preference and current city for this answer. Those two facts were sent to the active OpenAI conversation. No other memory was sent.

## 16.6 Memory cannot grant power

Even if memory is poisoned, it cannot:

- Authorise a purchase.
- Send a message.
- Delete a file.
- Increase permissions.
- Reveal a secret.
- Certify that an external action completed.

These decisions remain in deterministic policy and authoritative domain stores.

## 16.7 Logging

Normal telemetry records IDs, counts, classifications, timings, and error codes. It does not log raw memory text, transcripts, or retrieved personal context by default.

# 17. Storage, encryption, keys, backup, and recovery

## 17.1 Canonical database

- SQLite for transactional local canonical storage.
- SQLCipher for full-database encryption.
- Foreign keys, integrity checks, and versioned migrations enabled.
- Database accessible only through the Memory Service.

## 17.2 Key management

1. Generate a random database key on first initialization.
2. Wrap it with Windows DPAPI under the current Windows user.
3. Store only the wrapped key and metadata.
4. Never place the plaintext key in config, renderer storage, logs, or source.
5. On loss of the Windows user profile/machine, recovery requires the separately designed backup/recovery key flow; copying a DPAPI blob is insufficient.

## 17.3 Lexical index

FTS5 index is derived from active canonical `retrieval_text` and revision metadata. Repair/rebuild jobs reconcile missing or stale entries.

## 17.4 Dense index

The initial candidate is local LanceDB. Each vector record stores:

```text
memory_id
revision
embedding_model
embedding_dimensions
embedding_schema_version
retrieval_text_hash
indexed_at
```

A model change builds a new index generation, validates it, atomically switches active generation, and retains the prior generation for rollback.

## 17.5 Embedding selection

Benchmark:

- Compact local BGE-family model as privacy-first candidate.
- OpenAI `text-embedding-3-small` quality baseline.
- OpenAI `text-embedding-3-large` ceiling baseline.

Selection uses JUNE-MemBench, latency, privacy, footprint, and operational reliability. General embedding leaderboards are not sufficient.

## 17.6 Backup

- Encrypted backup package includes canonical DB, migration/version metadata, and deletion/tombstone ledger.
- Derived indexes need not be backed up because they are rebuildable.
- Restore replays deletions/suppressions before exposing data.
- Backup retention must be user-visible before production.

## 17.7 Recovery

- Canonical DB wins over derived indexes.
- Index mismatch triggers repair, not rollback of canonical memory.
- Migrations are monotonic, idempotent, journaled, and tested against backup/restore fixtures.
- Corrupt derived indexes can be discarded and rebuilt.

# 18. API and event contracts

## 18.1 Public service API

```text
memory.list(...)
memory.retrieve(...)
memory.correct(...)
memory.forget(...)
memory.explain_usage(...)
memory.export(...)
memory.set_policy(...)
```

Internal/event-driven:

```text
memory.record_candidates(final_turn_id)
memory.reindex(...)
memory.consolidate(...)
memory.reconcile_indexes(...)
```

## 18.2 Retrieve request

```json
{
  "user_id": "uuid",
  "query": "What did we decide about voice?",
  "purpose": "conversation",
  "scopes": ["global", "project:june"],
  "token_budget": 700,
  "sensitivity_ceiling": "personal",
  "current_time": "2026-08-15T00:00:00Z"
}
```

## 18.3 Events

```text
memory.candidate.created
memory.candidate.rejected
memory.confirmation.required
memory.committed
memory.corrected
memory.superseded
memory.marked_stale
memory.expired
memory.forgotten
memory.index.pending
memory.index.updated
memory.index.repaired
memory.retrieved
memory.used
memory.egress.recorded
memory.exported
memory.consolidation.completed
memory.migration.completed
```

Every event uses the JUNE event envelope and includes `user_id`, correlation ID, actor, `wall_time`, `monotonic_ns`, privacy class, and schema version. `wall_time` is an ISO-8601 UTC timestamp for persistence, diagnostics, and cross-process correlation. `monotonic_ns` is a non-negative integer from the emitting process's monotonic clock and is used only for durations and ordering within that process.

Cross-process correlation and stale-event handling use canonical IDs, producer/stream sequence numbers, causation and correlation IDs, `wall_time`, and explicit state/generation checks. Monotonic-clock origins are not comparable across processes, and wall-clock time alone is not reliable ordering.

# 19. Performance, observability, and operations

## 19.1 Budgets

| Metric | Memory V1 target |
|---|---:|
| Hot context lookup | Less than 10 ms p95 |
| Ordinary local retrieval | Less than 100 ms p95; less than 200 ms p99 |
| Explicit correction canonical commit | Less than 250 ms p95 before derived indexing |
| Async candidate processing | Less than 5 s p95 after `conversation.turn.finalized` |
| First-audio delay from memory write | 0 ms by design |
| Normal voice context | 4-8 items; approximately 600-1,200 tokens |

## 19.2 Trace points

```text
memory.retrieve.requested
memory.hot.finished
memory.structured.finished
memory.fts.finished
memory.dense.finished
memory.filters.finished
memory.fusion.finished
memory.package.finished
memory.usage.recorded

memory.extract.started
memory.extract.finished
memory.policy.finished
memory.commit.finished
memory.index.finished
```

## 19.3 Content-free metrics

- Retrieval p50/p95/p99.
- Candidate counts by channel.
- Recall/precision on benchmark labels.
- Stale/superseded retrieval rate.
- Abstention rate.
- Memory correction rate.
- Irrelevant/creepy personalisation reports.
- User repetition rate.
- Sensitive candidate and rejection counts.
- Deletion propagation failures.
- Index mismatch/repair rate.
- Provider egress count by sensitivity class.
- Token overhead per turn.

## 19.4 Operational rules

- One user's MVP data does not require distributed sharding.
- Benchmark 10k, 100k, and 1m synthetic records to locate scale thresholds.
- Do not enable approximate ANN indexes until exact/exhaustive search misses latency targets.
- Measure ANN recall loss separately from model/retrieval quality.

# 20. Evaluation and acceptance gates

## 20.1 Public benchmark suite

- LongMemEval: extraction, cross-session reasoning, temporal reasoning, updates, abstention.
- LoCoMo: long multi-session conversation memory.
- LoCoMo-Plus: implicit preference/constraint application.
- Memora: obsolete/stale memory and forgetting-aware accuracy.
- LongMemEval-V2 later for agent/workflow memory.

## 20.2 JUNE-MemBench

Initial target: approximately 250 reviewed scenarios; grow to 1,000+.

Required classes:

- Profile recall.
- Preference application.
- People and relationship disambiguation.
- Project scope.
- Decision and rationale recall.
- Open-loop/task references.
- Temporal changes.
- Explicit correction.
- Conflicting evidence.
- Negative preference changes.
- Voice transcription corrections.
- Sensitive-memory consent.
- Temporary conversations.
- Deletion and no-relearning.
- Voice/text/Telegram continuity.
- External prompt injection.
- Provider sensitivity ceilings.
- Abstention.
- Exact past-chat recall.

## 20.3 MVP quality gates

| Metric | Gate |
|---|---:|
| Explicit ordinary-fact extraction precision | At least 98% |
| Explicit ordinary-fact extraction recall | At least 95% |
| Forbidden/sensitive automatic durable writes | 0 in policy suite |
| Direct-fact Recall@10 | At least 95% |
| Direct-fact Precision@5 | At least 90% |
| Temporal/update accuracy | At least 90%, roadmap to 95% |
| Stale/superseded returned as current | Less than 1% |
| Provenance correctness | At least 99.5% |
| Deleted memory active retrieval | 0 after acknowledgement |
| External-content unauthorized durable writes | 0 |
| Ordinary local retrieval | Less than 100 ms p95 |
| End-to-end usefulness gain | At least 10 percentage points over no-memory baseline |

## 20.4 Baseline comparisons

Run the same model on:

1. No memory.
2. Full/raw history only.
3. Lexical only.
4. Dense-vector only.
5. Structured + lexical + dense + temporal policy.

Hybrid production retrieval must show statistically significant improvement without violating latency or privacy gates.

## 20.5 ChatGPT parity test

Create 150-250 longitudinal scenarios and compare current ChatGPT with JUNE on:

- Factual recall.
- Preference application.
- Temporal freshness.
- Corrections.
- Project isolation.
- Abstention.
- Source explainability.
- Deletion behaviour.

A defensible parity gate:

```text
JUNE is statistically non-inferior on:
factual recall, preference application,
temporal correctness, and correction fidelity

AND

JUNE is superior on at least:
provenance visibility, deletion propagation,
local data control, or sensitivity policy
```

## 20.6 Human evaluation

Rate:

- Helpful personalisation.
- Wrong or invasive personalisation.
- Staleness.
- Comfort/trust.
- Need to repeat known information.
- Confidence after correction.
- Whether the remembered fact should have been used at all.

# 21. Migration from the current repository

## 21.1 Strategy

Use a strangler migration. The existing working memory path remains available behind an adapter until new canonical writes, retrieval, deletion, and benchmarks prove readiness.

## 21.2 Stages

| Stage | Action | Cut-over gate |
|---|---|---|
| Inventory | Enumerate memory/profile/localStorage/OpenCode/conversation sources | Every source has owner, schema, count, sensitivity, export path |
| Facade | Route current reads/writes through `MemoryBroker` | No user-visible regression |
| Canonical store | Add encrypted schema and migrations | CRUD, correction, backup/restore, deletion pass |
| Import staging | Convert legacy data to staged candidates | Every item has legacy source ID/provenance |
| Deduplicate/conflicts | Resolve exact duplicates; quarantine ambiguity | No silent conflict loss |
| Index | Build FTS and dense indexes from canonical rows | Revision/count reconciliation passes |
| Shadow read | Run old and new retrieval; serve old result | New meets benchmark and privacy gates |
| New-write cutover | Canonical store receives all new durable writes | Restart/idempotency/fault suite passes |
| Read cutover | New broker becomes active | JUNE-MemBench and human tests pass |
| Legacy retirement | Freeze/export old stores after rollback window | Full reconciliation and rollback artifact verified |

## 21.3 Legacy confidence

Legacy items without reliable provenance are labelled:

```text
explicitness = legacy_import
confidence = migrated_unverified
```

Important legacy facts may be naturally reconfirmed instead of being silently promoted to high-confidence truth.

## 21.4 Shadow-read privacy

Log only memory IDs, ranks, scores, and labels during shadow comparison. Do not create a second raw-content log.

# 22. Bounded implementation sequence

One bounded PR per session.

## PR 1 - Memory design authority

- Add this document.
- Update the JUNE 0.1 Master Architecture without changing its product-baseline version.
- No implementation changes.

## PR 2 - Current memory inventory

- Enumerate all memory/profile/conversation/localStorage/OpenCode sources.
- Define ownership and migration mapping.
- No data movement.

## PR 3 - Memory Broker facade

- Provider-independent interfaces and canonical IDs.
- Route existing behaviour through the facade.
- No semantic behaviour change.

## PR 4 - Encrypted canonical store

- SQLCipher SQLite schema.
- DPAPI-wrapped key.
- Migrations, CRUD, evidence, relations, events, usage, suppression.
- Backup/restore fixtures.

## PR 5 - Deterministic write policy

- Fake extractor.
- Reject partial speech, assistant claims, external content, secrets, and unapproved sensitive candidates.
- Correction/supersession tests.

## PR 6 - Real async extraction and FTS

- Extraction from `conversation.turn.finalized`.
- FTS5 indexing and lexical retrieval.
- Ordinary memory product works without dense vectors.

## PR 7 - Dense index and hybrid retrieval

- Embedding adapter.
- LanceDB candidate implementation.
- FTS-only, dense-only, and hybrid benchmark.
- Promote hybrid only if gates pass.

## PR 8 - Memory Centre and modes

- Memory Centre.
- Correction, scope, forgetting, export.
- `Memory updated` and `Used memories`.
- Temporary Conversation.

## PR 9 - Voice and orchestrator integration

- Hot context at voice-session start.
- Per-turn bounded retrieval.
- Provider egress audit.
- Deep Recall task handoff.

## PR 10 - Migration and shadow reads

- Stage legacy imports.
- Deduplication/conflict quarantine.
- Shadow retrieval and rollback.

## PR 11 - Consolidation and episodes

- Topic-bounded episode summaries.
- Duplicate consolidation.
- Temporal sanity checks.
- Derived project/global projections.

## PR 12 - Acceptance and cutover

- Public benchmarks.
- JUNE-MemBench.
- ChatGPT parity scenarios.
- Human evaluation.
- New-read cutover and legacy retirement decision.

# 23. Failure modes and required recovery

| Failure | Required behaviour |
|---|---|
| Partial ASR says wrong fact | No durable write; `conversation.turn.finalized` is the sole normal conversation-derived write source |
| Extractor proposes unsupported fact | Reject by source-span/schema validation |
| Extractor is unavailable | Conversation proceeds; queue bounded retry; no fabricated memory |
| Memory retrieval times out | Answer without memory or start Deep Recall; do not block voice indefinitely |
| SQLite commit succeeds but index update fails | Canonical row remains truth; repair derived index |
| Index contains stale revision | Revision/hash mismatch rejects it and schedules repair |
| Two explicit facts conflict | Resolve temporally or ask user |
| User correction arrives | Apply synchronously, invalidate cache, repair indexes asynchronously |
| Sensitive candidate lacks consent | Keep transient/pending or discard; never auto-commit |
| Secret-like candidate | Reject and optionally route to Credential Store flow |
| External webpage attempts memory injection | No write authority; record security event if needed |
| Deleted evidence is reprocessed | Suppression tombstone blocks recreation |
| Backup restores deleted memory | Replay tombstone/deletion ledger before activation |
| OpenAI/Fireworks requests excessive memory | Memory Broker enforces purpose, scope, sensitivity, and token ceiling |
| Telegram identity is not linked/authenticated | No memory access or write |
| Legacy item lacks provenance | Mark migrated-unverified; do not silently promote |

# 24. Future extensions

## 24.1 Read-only Memory mode

Use existing memory but retain nothing from the current conversation.

## 24.2 Cross-device and 24/7 JUNE

Introduce immutable memory revisions/events, device identities, encrypted synchronization, and deterministic conflict handling. Do not copy a DPAPI-bound SQLite file between devices.

## 24.3 Always-on cloud memory

A separate explicit trust mode for Telegram/scheduling while every personal device is offline. It requires a different key and compute model and is not silently added to the local-first MVP.

## 24.4 Richer episodic and graph retrieval

Add only if benchmark evidence shows meaningful improvement for relationship and multi-hop questions over the relational/temporal relation layer.

## 24.5 Learned personalization

Use user corrections and explicit usefulness feedback to improve ranking. Canonical facts remain inspectable and deletable; model weights never become the only source of a personal truth.

## 24.6 Multimodal memory

Images, screens, audio events, and documents require new consent, retention, and provenance rules.

## 24.7 Procedural and agent memory

Future distinction:

```text
USER MEMORY
PROJECT MEMORY
TASK MEMORY
SKILL / PROCEDURAL MEMORY
WORLD / RESEARCH KNOWLEDGE
```

OpenCode and agent teams receive only project/procedural memory needed for their task.

# 25. Decision register

## 25.1 Final Memory V1 decisions

- Local-first encrypted canonical memory.
- SQLite + SQLCipher and DPAPI-wrapped key for Windows MVP.
- Conversation history is separate canonical evidence.
- Automatic explicit non-sensitive memory.
- Cautious repeated-evidence inference.
- Global/project/conversation scopes.
- Sensitive durable memory requires consent.
- Secrets are never memory.
- Models propose; deterministic policy commits.
- Conversation-derived writes only from `conversation.turn.finalized`; authorised scheduled/system processing cannot bypass source/write policy.
- Explicit corrections apply immediately.
- Structured + lexical + semantic + temporal retrieval.
- Derived indexes/summaries are rebuildable.
- Memory Centre and Temporary Conversation are MVP requirements.
- Genuine deletion plus no-relearning suppression.
- Memory never grants action authority.
- PC-online Telegram for MVP.

## 25.2 Provisional implementation choices

- LanceDB as dense-index implementation pending benchmark and packaging validation.
- Exact compact local BGE-family embedding model.
- OpenAI embedding baselines and dimensions used in evaluation.
- Retrieval-fusion coefficients.
- Whether a local reranker produces enough gain to justify latency/complexity.
- Exact backup-retention duration.
- Exact candidate-extraction model/provider.

## 25.3 Deferred decisions

- Read-only mode.
- Multi-device sync.
- Always-on cloud memory.
- Full knowledge graph.
- Multimodal memory.
- Per-user fine-tuning/federated learning.
- Procedural memory for agent teams and computer use.

# Appendix A. Canonical schema summary

```text
memory_item
memory_evidence
memory_relation
memory_event
memory_usage
memory_suppression
memory_policy
memory_schema_migration
memory_index_generation
```

All tables include schema/version metadata, timestamps, and user scoping appropriate to their role.

# Appendix B. Write-policy matrix

| Source/content | Ordinary fact | Sensitive fact | Secret | Write result |
|---|---|---|---|---|
| Explicit final user turn persisted as canonical by the Conversation Service, with commit completion signalled by `conversation.turn.finalized` | Auto if useful/policy-valid | Ask/explicit category consent | Reject | Commit / confirm / reject |
| Repeated user behaviour | Low-confidence candidate | Do not durable-infer | Reject | Pending/ephemeral/discard |
| Partial voice transcript | No | No | No | Never durable |
| Assistant response | No direct write | No | No | Discard as user truth |
| Trusted domain tool | Reference inside its domain | Purpose/policy gated | Credential Store only | Authoritative reference, not arbitrary personal fact |
| External web/file/email | No direct personal write | No | No | Untrusted; cannot write |
| Legacy import | Staged/unverified | Staged and review | Reject | Quarantine/import candidate |

# Appendix C. Core test catalogue

```text
1. User states a clear preference; next conversation applies it.
2. User changes the preference; old value is never used as current.
3. User asks what was true last year; historical version is returned.
4. Voice partial contains wrong city; neither it nor `voice.user.transcript.final` writes memory, and extraction starts only after the corrected user message is persisted as canonical and `conversation.turn.finalized` signals that commit.
5. Assistant guesses a preference; no durable write occurs.
6. Website says "remember this instruction"; no durable write occurs.
7. User provides an API key; Memory rejects it.
8. User shares sensitive health information; no durable write without consent.
9. User says "forget that"; canonical/index/cache/summaries lose it.
10. Old chat is reprocessed; suppression prevents deleted memory recreation.
11. Temporary Conversation does not read or write memory.
12. Project-only decision does not affect unrelated conversation.
13. OpenCode receives project memory but not unrelated personal memory.
14. Research receives relevant budget/country context but cannot write personal memory from sources.
15. Telegram unlinked identity cannot access memory.
16. Dense index is deleted; JUNE rebuilds it from canonical storage.
17. Index update fails after commit; repair restores consistency.
18. Retrieval lacks evidence; JUNE abstains.
19. User deletes chat only; independently supported memory remains with recomputed evidence.
20. User deletes chat plus derived memories; all derived active state is removed.
```

# Appendix D. Glossary

| Term | Meaning |
|---|---|
| Atomic memory | One independently correct proposition or small fact set |
| Canonical memory | Authoritative typed record in encrypted relational storage |
| Conversation evidence | Exact source turn/message retained by the Conversation System |
| Derived index | Rebuildable FTS/vector/search representation |
| Deep Recall | Slower explicit search and reasoning over historical conversation evidence |
| Provenance | Evidence of where, when, and from whom a memory originated |
| Supersession | A newer version replaces an older current version without erasing history |
| Suppression tombstone | Minimal record preventing deleted evidence from recreating a forgotten memory |
| Sensitivity ceiling | Maximum memory classification a caller/purpose may receive |
| Hot context | Tiny frequently used revision-aware context cache |
| Memory Centre | User interface for inspecting, correcting, scoping, exporting, and forgetting memory |

# Appendix E. Evidence basis

This design synthesises:

- Founder-approved Memory V1 decisions in the JUNE project discussion.
- **JUNE Memory System: Best-in-Class Personal Context Architecture**.
- **JUNE Master Architecture v0.1** and its voice/orchestrator ownership rules.
- Public product behaviours from ChatGPT, Claude, Gemini, and Copilot as recorded in the research report.
- LongMemEval, LoCoMo, LoCoMo-Plus, Memora, and related long-term-memory research.
- Security guidance concerning prompt injection, RAG data boundaries, agent tool authority, secrets, and cross-scope retrieval.

Time-sensitive provider/library details must be reverified during implementation. Product ownership, write authority, sensitive-memory consent, and deletion guarantees cannot be relaxed merely because a library or provider makes a different default convenient.

---

**End of JUNE Memory System Design v0.1**
