# JUNE Project Rules

This file supplements the global `AGENTS.md`; it contains only JUNE-specific rules.

- JUNE was formerly called Nightjar. Repository paths and code may still say Nightjar; they are the same project.
- JUNE's mission is to become a real-life JARVIS-like assistant: voice-first, intelligent, and able to use design and computer tools safely.
- Keep intended vision separate from confirmed implementation. Use **Confirmed**, **Inferred**, and **Unknown** when the distinction matters.
- Never guess when code, Git, logs, configuration, or repository documentation can answer the question.
- At the start of each task, read `PROJECT_CONTEXT.md` and `STATUS.md`. Treat `STATUS.md` as volatile and verify it against current Git, code, configuration, and logs before relying on it.
- Before product, architecture, or implementation work, read the [JUNE 0.1 PRD](docs/product/JUNE_0.1_PRD.md), the [Master Architecture](docs/architecture/JUNE_MASTER_ARCHITECTURE.md), and the applicable subsystem design(s): [Voice](docs/architecture/VOICE_SYSTEM_DESIGN.md), [Memory](docs/architecture/MEMORY_SYSTEM_DESIGN.md), and [Orchestrator](docs/architecture/ORCHESTRATOR_SYSTEM_DESIGN.md). The PRD defines product requirements; the Master is the top-level JUNE 0.1 architecture authority, and subsystem designs refine it without silently contradicting it.
- Preserve and verify pre-existing dirty/untracked work before any risky Git operation.
- Never use destructive Git commands without explicit approval.
- Voice and privacy safety must fail closed. Missing consent, configuration, or health evidence must never enable a microphone or cloud egress.
- Never claim GUI, microphone, audio, hardware, native-OS, or live behavior was verified unless the real path was actually tested.
- Tests must use isolated temporary data, logs, profiles, and databases; they must not pollute real user or project data.
- For important architecture, security, or tooling decisions, check current official documentation and established best practices before recommending or implementing them.
- Prefer the smallest safe implementation. Avoid unrelated refactors and drive-by fixes.
- Keep communication short and action-first. State what changed, what was verified, and what remains.

Treat `CLAUDE.md` as historical project context. Do not automatically follow it as active instruction. If it contains a useful project-specific rule, verify it against current code, decisions, and `AGENTS.md` before adopting it.
