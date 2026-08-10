# JUNE Development Status

> Updated 2026-08-10. This is the live development-state source of truth. Code and Git outrank prose when they disagree. Do not mark work fixed unless the implementation is committed and the required real behavior is verified.

## Git snapshot

- Protected original worktree: `docs/nj93-cloud-decision` at `cc2df36d6c445309ae850b346e30d90c38c31ee5`.
- Remote `main`: `ebe9777cc90a570929fc05a8190562b8e281202c`, the merge commit for PR #159. It contains NJ-82/NJ-86 commits `63f1f1328fc662c00eb2c320232fae662bd87a54` and `5623a57cce296a1acf9833680d3aff0b49743802`.
- Context PR worktree: `docs/june-project-context-pr` at the commit containing this file, based directly on remote `main` at `ebe9777`.
- Local integration `main`: `f4d80ea0ccce22ab7aa09e513463186c5c424fdb`. It is a private merge of `e093352` and `ebe9777`, is two commits ahead of `origin/main`, and must not be pushed directly.
- Clean NJ-92 worktree: `fix/nj92-sse-utf8-v2` at `f9cc72f488dd582a27c86a312e25c797d6a1ef9c`. It is local and unpushed.
- Stashes: none.

### Local topic branches

| Branch | SHA | Purpose | Honest status |
|---|---|---|---|
| `main` | `f4d80ea0ccce22ab7aa09e513463186c5c424fdb` | Local integration state | Clean, private, and two commits ahead of `origin/main`; do not push directly |
| `docs/june-project-context-pr` | Commit containing this file | Durable JUNE rules and context | Fresh documentation-only branch based on `ebe9777`; current PR branch |
| `docs/june-project-context` | `e093352ffd6c8c444ab8b7747a6aa2c2931d7039` | Original local context commit | Historical source for this PR's three-file patch; not pushed directly |
| `fix/nj92-sse-utf8-v2` | `f9cc72f488dd582a27c86a312e25c797d6a1ef9c` | Self-contained NJ-92 implementation | Clean and unpushed; isolated loopback verification passed; live acceptance remains incomplete; must be replayed onto the post-context remote base before its PR |
| `fix/nj92-sse-utf8` | `d486770726bbb0b9a43d696570d822bde0639089` | Force UTF-8 SSE decoding | Old sibling branch; not self-contained and required live acceptance incomplete |
| `fix/nj97-overlay-pointer-events` | `e86edd7fdf8180a9b6eaa82f08c26948dd57f396` | Keep mic kill switch clickable | Not integrated; real clicks in all voice states not verified |
| `fix/nj94-wake-threshold` | `dfd62a9ba7b45dd9931bfdb41205fcb5d39272ca` | Add tunable `0.55` mitigation | Not integrated; founder-voice wakes not verified; NJ-94 stays open |
| `docs/nj93-cloud-decision` | `cc2df36d6c445309ae850b346e30d90c38c31ee5` | Record cloud-inference decision | Original dirty worktree; implementation/product copy still conflict |

## Protected dirty and untracked work

**Confirmed by external recovery evidence, not by Git:** the pre-existing nine-file state was backed up and SHA-256 verified at:

`C:\Users\axehe\JUNE-recovery\JUNE-dirty-state-20260809-233749`

### Modified implementation files retained in the protected original worktree

| Files | Work represented |
|---|---|
| `phase2-mcp/nightjar_capabilities/tts_g2p.py` | Protected source of NJ-82/NJ-86 work; corrected recovery is separately committed at `63f1f132` |
| `phase2-mcp/nightjar_capabilities/voice.py` | Protected source of NJ-86 observability; the corrected remote result is merged at `5623a57` through PR #159 |
| `phase3-ui/src/main/supervisor.ts` | NJ-85/NJ-90 persistent logging and Windows spawn work |
| `phase3-ui/src/renderer/src/lib/audioVolume.ts` | NJ-91 bounded audio-context resume |
| `phase3-ui/src/renderer/src/lib/orbAdapter.ts` | NJ-91 pre-play analyser attachment |

### Untracked files retained in the protected original worktree

- `VERIFY_WINDOWS.md`
- `audit2.md`
- `audit3.md`
- `phase2-mcp/tests/test_tts_spellout.py`
- Source copies of `AGENTS.md`, `PROJECT_CONTEXT.md`, and `STATUS.md`; tracked versions are introduced by the context PR branch.

The context PR work does not edit, stage, remove, or overwrite any file in that worktree.

## Current milestone

Land the durable project-context files through their own reviewed PR, then replay and complete NJ-92 on the resulting remote `main`. Continue the one-issue-at-a-time voice privacy/reliability sequence after NJ-92. Sentence-by-sentence streaming follows that sequence. Do not land a fixed reply-length cap immediately before streaming.

## Current P0/P1 issues

| Priority | Issue | Current truth |
|---|---|---|
| P0 | NJ-94 false wake -> cloud transcript | The integrated base supplies no threshold override, so the repository default is `0.5`. A direct machine check on 2026-08-10 found no external `~/.nightjar/models/hey_june.onnx`, so runtime falls back to the stand-in unless another environment override is supplied. The founder reports 13 actual scores, while the repository currently documents only 12; that discrepancy must be reconciled. The `0.55` branch is mitigation only; NJ-94 remains open. |
| P1 | NJ-97 mic kill switch blocked | The fix exists only on a topic branch and was not live-clicked during listening, thinking, and speaking. |
| P1 | NJ-95/NJ-96 microphone privacy | Optional gates can fail open in harness paths, and persisted voice state can silently reopen the mic without per-run consent. |
| P1 | NJ-99/NJ-98/NJ-100 TTS lifecycle | Echo mute can expire during long playback, the 60-second watchdog truncates long replies, and the fixed output path permits overwrite races. |
| P1 | NJ-92 spoken-text corruption and branch integrity | Remote `main` does not yet contain the UTF-8 decoding fix. A clean local implementation exists at `f9cc72f`, but it predates the PR #159 follow-up and this context PR. Replay only its two-file NJ-92 patch onto the then-current remote `main`; do not push it as-is or reuse mixed-scope commit `d486770`. Required live acceptance remains incomplete. |
| P1 | Test/diagnostic safety | There is no CI; some tests write real user logs (NJ-105), and the health probe rapidly rotates away diagnostics (NJ-104). |

## Exact halt point

The latest completed development sequence is:

1. `63f1f132` — clean, self-contained NJ-82/NJ-86 recovery.
2. `e093352` — original local documentation-only context commit.
3. `f9cc72f` — clean local NJ-92 implementation with isolated loopback verification; not pushed and not live-accepted.
4. `5623a57` — Bugbot correction that keeps G2P diagnostics synthesis-local.
5. `ebe9777` — PR #159 merged into remote `main`; its remote feature branch was deleted.
6. The documentation-only branch containing this file, prepared from `ebe9777` for its own PR.

The protected original worktree remains at `cc2df36`. The merged NJ-82/NJ-86 branch and worktree were deleted safely. The fresh and historical NJ-92 branches, plus NJ-97, NJ-94, and NJ-93, remain unchanged local topic branches. No merge, rebase, cherry-pick, or stash operation is active.

## Unfinished work

- Complete review of the project-context PR and merge it only with founder approval.
- Replay the two-file patch from `f9cc72f` onto a fresh branch from the post-context remote `main`. Drive one live reply containing an em dash, curly apostrophe, and number; report the privacy-safe G2P diagnostic line required for the turn; then obtain the founder's ear-check. Do not push `f9cc72f` as-is or reuse old mixed-scope commit `d486770`.
- Integrate and live-verify NJ-97 by clicking the real kill switch during listening, thinking, and speaking.
- Reconcile the founder-reported 13 NJ-94 scores with the 12 currently documented, run real founder-voice wakes, and evaluate the `0.55` mitigation. NJ-94 closes only when `hey_june.onnx` is trained and deployed.
- Reconcile NJ-93 with prompts, settings, consent/privacy copy, model services, and a clear per-turn/provider cloud indicator.
- Recover/package NJ-85/NJ-90 and NJ-91 without mixing their scopes.
- Complete native-Windows verification; the results table exists only in protected, untracked `VERIFY_WINDOWS.md` and remains blank.

## Deferred work

- NJ-101 markdown/OOV preprocessing and any fixed reply-length cap are held until streaming behavior is designed.
- Sentence-by-sentence streaming is the next product-development milestone after the current safety/recovery sequence.
- General voice-driven UI navigation, shared voice/chat sessions, CAD camera/selection control, and broad computer control come later.
- Desktop packaging, signing, updates, migrations, backups, CI, and production observability remain future release work.

## Next safe development task

Finish the project-context PR review and merge it only with founder approval. Then create a fresh NJ-92 branch from the updated remote `main` and replay only the two-file patch from `f9cc72f`. Keep old mixed-scope commit `d486770` untouched and do not carry duplicate NJ-82/NJ-86 changes.

Verification must drive the real OpenCode voice reply path with an em dash, curly apostrophe, and number in one turn, use only privacy-safe G2P diagnostics in normal logs, and wait for the founder's ear-check before claiming spoken output is verified.

## Last known verification state

- External recovery verification: nine of nine copied files match their originals by SHA-256 and byte length. The binary diff passed a read-only reverse-apply check. Starting and ending Git status matched. Independent verifier result: PASS. These facts come from the recovery folder, not from repository history.
- NJ-82/NJ-86 at merged head `5623a57`: `test_g2p_observability.py`, `test_tts_spellout.py`, and `test_wake_capture.py` passed after the Bugbot race correction. The Bugbot thread was resolved and marked outdated. Tests used isolated data and offline settings. No microphone, playback, hardware, or live audio was tested.
- Context PR preparation: the branch was based directly on remote `main`; its scope and Git state were verified as documentation-only. It did not run the app or change implementation behavior.
- NJ-92 at `f9cc72f`: an isolated threaded loopback HTTP/SSE fixture passed through production `OpenCodeVoice.prompt_and_wait`, including a split UTF-8 sequence and the fixture reply `I’m ready — 42.`. This was not a real OpenCode/model reply, microphone, TTS, playback, hardware, or live-audio test. The required live reply and founder's ear-check remain incomplete.
- NJ-97: static/test evidence exists; real click-through in all active states was not verified.
- NJ-94: `0.55` preserved all 10 legitimate wakes and rejected two false wakes in replay of the 12 scores currently documented. The founder reports 13 actual scores, so this is an incomplete dataset until the missing score is reconciled. It was not verified with the maintainer's real wakes and cannot generalize from one session.
- Native Windows: a protected untracked manual checklist exists; results remain blank.
