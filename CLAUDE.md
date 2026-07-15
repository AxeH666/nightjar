# Nightjar — Operating Rules for Claude Code

Nightjar is an offline, local-first AI coding + personal assistant (AGPL-3.0-or-later),
built by bolting OpenCode (agent engine) + Row-Bot (voice/vision/memory/browser) +
Odysseus (email/RAG/PIM) + orb-ui together via MCP and a WebSocket side-channel.
Full architecture/history: `research/AUDIT_REPORT.md`. Known open issues:
`KNOWN_ISSUES.md`.

The rules below are not generic best practice — each one codifies an incident that
actually happened during this project. Follow them without re-deriving the incident
each time; the "why" is here so you can judge edge cases the rule doesn't explicitly
cover.

## 1. Gate with `permission`, never with `tools:{x:true}`

An OpenCode agent mode's `tools: {x: true}` map does not just make a tool
*visible* — it compiles to an **allow** rule, which auto-approves every call and
means `permission.asked` never fires. A Phase-3 mode defined this way let the
coding agent write a file with zero approval prompt, silently defeating the
entire permission/approval safety system.

**Rule:** any tool that should require user approval (edit, write, bash,
send_email, and — going forward — anything OS-level like Phase 5's
computer-use actions) must be gated through the agent's **`permission` field**
(`permission: {x: "ask" | "allow" | "deny"}`), not the `tools` boolean map.
Reserve `tools: {x: false}` for genuinely hard-hiding a tool from a mode; it is
never a substitute for gating. When adding or reviewing any agent-mode
definition, check the `permission` field specifically — do not assume a tool
being merely "on" for a mode means it prompts.

## 2. Snapshot pre-existing dirty state before any git-based scope check

The Phase-1.5 `git-gate` safety plugin scope-checks each edit against
`git status` and rolls back anything out-of-scope. Its first version treated
*any* uncommitted file it saw as "out of scope" — including files the user had
already left dirty before the run started — and deleted them. That is real
data loss caused by a safety mechanism.

**Rule:** before writing any logic that inspects git state to decide what's
"in scope" (for rollback, cleanup, or diff-based validation), capture a
snapshot of the pre-existing dirty/untracked state *first*, and diff against
that snapshot — never treat "currently uncommitted" as synonymous with
"created by this run." This applies to any future safety harness, not just
`git-gate`.

## 3. Every long-running model call or process needs a hard wall-clock timeout

Phase 1.5 found that a single model generation could run unbounded (llama.cpp's
`--predict` defaults to -1/infinity) — a repetition loop toward the context
limit that the doom-loop guard cannot catch, because doom-loop detects
*repeated completed identical calls*, not one call that never completes. The
fix required three independent layers: a wall-clock-timeout proxy that
hard-aborts mid-stream, a token cap, and a server-side `--predict`/`--timeout`
backstop.

**Rule:** doom-loop/repeat detection is necessary but not sufficient — it only
catches loops made of *finished* calls. Any new long-running model call,
subprocess, or external-service round-trip (a grounding-model tier in Phase 5,
a CAD-generation call in Phase 6, a cloud BYOK request) needs its own explicit
wall-clock timeout, independent of any loop-detection logic layered on top.

## 4. A failed structured edit must return the error, never fall back to a full rewrite

Phase 1 found `qwen3:1.7b` would, when an `edit` call's arguments failed
validation, fall back to overwriting the entire file with `write` — a
destructive full-file rewrite triggered by what should have been a recoverable
argument error. The Phase-1.5 `no-destructive-write` plugin exists specifically
to block this pattern in the models Nightjar drives.

**Rule:** this applies both to models Nightjar orchestrates and to your own
behavior as the harness — if a structured/targeted edit fails (bad match, no
match, ambiguous target), surface the error and retry the *edit*, or ask for
guidance. Never silently substitute a full-file `write`/rewrite as a recovery
path for a failed structured edit; that trades a small, recoverable failure for
a large, hard-to-review, potentially destructive one.

## 5. Read a dependency's actual LICENSE file before judging compatibility — never trust `package.json`

Both LobeChat (evaluated and rejected first) and Open WebUI (evaluated next,
also rejected as a fork target) looked permissively licensed from their
`package.json`/README framing, but their real license terms — in Open WebUI's
case, a BSD-3-derived license with a branding-lock clause gated at 50 users and
backed by a live license-verification service — were materially different and
only surfaced by reading the actual `LICENSE` file text. Getting this wrong
would have meant shipping Nightjar under a license grant it didn't actually
have.

**Rule:** before integrating, forking, or vendoring any third-party project —
regardless of what its `package.json` `license` field, README badge, or npm
registry metadata claims — open and read the actual `LICENSE`/`COPYING` file(s)
in that project's repo. Note any non-standard clauses (branding locks, field-
of-use restrictions, network-use requirements, dual-licensing) explicitly, and
cross-check against `research/AUDIT_REPORT.md` §4 and
`NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` conventions before concluding
compatibility.

## 6. Prove a safety fix by re-triggering the real failure case, not by re-reading the config

The Phase-3 permission-gate bug was only confirmed fixed by actually driving a
real `edit` call through the coding agent, observing `permission.asked` fire,
replying `once`, and confirming the write completed — not by inspecting the
mode's `permission` field and concluding it "looks right." Config that looks
correct can still fail to produce the runtime behavior it implies (exactly what
happened with `tools:{x:true}` in rule 1).

**Rule:** when you fix or touch anything safety-critical or destructive-path
(permission gates, rollback logic, doom-loop/timeout guards, approval flows,
future computer-use consent screens), verify by actually re-triggering the
specific failure scenario end-to-end against a real running instance — not by
reasoning from the config/code shape alone. If the real environment can't be
driven (headless box, no hardware), say so explicitly rather than implying the
fix is confirmed.

## 7. Flag new hazards explicitly and separately — don't silently fix or silently ignore

Every phase report in this project (`PHASE2_REPORT.md`, the Phase-5 scoping in
`AUDIT_REPORT.md` §10, `KNOWN_ISSUES.md`'s NJ-1 entry) follows the same
pattern: when something outside the current task's scope is discovered — a
hardware constraint, a residual limitation, a bug in already-shipped work — it
gets written down as its own labeled item, not folded silently into the current
diff and not swept under the rug.

**Rule:** if you notice a hazard, bug, or risk while doing something else (an
unrelated bug, a new dependency's license wrinkle, a resource-contention risk,
a hardware limit), do not quietly fix it as a drive-by (scope creep) and do not
quietly ignore it either. Call it out explicitly to the user as a separate,
named item — and if it's a defect in already-shipped Nightjar work rather than
a note on the current task, add it to `KNOWN_ISSUES.md` following the NJ-\*
format, so it survives past the current conversation.

## 8. Verify environment-dependent behavior on the environment it targets — and state what you couldn't

The WSL file-handling pass (PRs #72–#76, `KNOWN_ISSUES.md` NJ-26…NJ-32) repeatedly
hit features that pass or fail based on the *runtime environment*, not the code:
Windows→WSL drag-drop delivers no payload while native-Windows DnD works; clipboard
image paste yields an undecodable BMP under WSL; the GPU process can't initialise
under WSLg (a crash that read as "the app stopped responding"); `File.path` was
removed in Electron 32; a 4B chat + 4B vision model don't co-fit on a 6 GB GPU. A
*synthetic* drop dispatched into a headless renderer exercised the code path and
"passed" — but that is NOT the real OS delivery, so calling the feature "verified"
from it would have been a false green. Whether a GTK dialog honours `defaultPath`,
whether a real drop delivers files, whether notifications fire — none can be closed
under WSL/headless.

**Rule:** when a change depends on the runtime environment (WSL/WSLg vs native
Windows/macOS/Linux; real GPU vs software; headless vs a real GUI/keystroke; a
specific Electron/Chromium API version), detect and branch on it explicitly, and
**degrade gracefully with a visible fallback** rather than a silent no-op. Then
state **honestly which environment each fix was verified in** and which still needs
a native / GUI / real-input confirmation — never mark an environment-dependent
feature "verified" from a proxy (a synthetic event, a logic-only test) that isn't
the real path. This extends rule 6 (re-trigger the REAL failure) and pairs with
rule 7 (record the residual "needs native Windows / a real keystroke" as its own
`KNOWN_ISSUES.md` item).
