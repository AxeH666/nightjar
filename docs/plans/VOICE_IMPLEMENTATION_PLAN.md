# JUNE 0.1 Voice Implementation Plan

Status: Production/public-release roadmap. This is not the current internal MVP execution sequence. The PR count is a living forecast and may be re-baselined without weakening architecture or safety boundaries.<br>
Planning base: <code>babc54af87f6123fd5ad3383ad92c75b2fd2be46</code><br>
Architecture authority: JUNE Master Architecture Version 0.1<br>
Recommended portfolio: 41 bounded pull requests<br>
Legacy rule: keep the current local Voice path selectable until replacement evidence and rollback gates pass

## 1. Executive verdict

Confirmed:

- The founder-approved PRD and the four architecture documents are internally consistent after PR #172. No architecture clarification blocks implementation planning.
- The current Voice path is implemented as a transitional, sequential pipeline, but live hardware behavior was not verified here; it has no canonical JUNE turn identity, no unified cancellation, no trusted local event transport, no shared visible conversation, no true barge-in, and no generation-safe playback.
- The Master Architecture's global sequence controls delivery: Phase 1 foundations, then all Phase 2 deterministic-agency foundations, then integrated OpenAI Realtime Voice, then the Memory V1 program.
- OpenAI's current official documentation supports <code>gpt-realtime-2.1</code>, function calling, and browser/client WebRTC. Official guidance keeps the permanent API key on a trusted backend and gives the client only an ephemeral credential. Account/model availability is still Unknown until reverified for JUNE's real account immediately before provider integration.
- No test, microphone, audio device, GUI, provider session, service, scheduler, or Windows hardware path was run during this planning task.

Implementation can begin with the bounded safety repair in VOICE-01 after this plan is reviewed. The target Voice V1 is one provider-neutral JUNE conversation and VoiceTurn authority, one authenticated background/audio owner, generation-safe duplex media through OpenAI Realtime/WebRTC, deterministic delegation through JUNE, truthful privacy controls, and a retained legacy rollback path.

The implementation portfolio contains 41 reviewable PRs. Its critical path is VOICE-01 → 02 → 03 → 04 → 05 → 06 → 08 → 09 → 10 → 11 → Phase 1 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 24 → 25/26 → 27 → Phase 2 → 28 → 29 → 30 → 31 → 32 → 33 → 34 → 35 → 36 → 37 → 38 → 40 → 41. VOICE-07/12/23 join their phase gates, Quality can build fault fixtures alongside producer PRs, and VOICE-39's fake/no-op read-context port can proceed beside later media work; none may merge before its solid dependency.

The largest risks are invisible microphone ownership, unauthenticated legacy events gaining authority, cloud audio without explicit user consent, duplicate or stale audio/effects, credential or personal-context egress, active OpenCode/MCP/PIM effect bypasses, provider/API drift, and unsupported Windows/audio claims. OpenAI adapter integration first becomes safe at VOICE-28 after the complete Phase 2 gate; live microphone egress cannot begin before VOICE-29's explicit cloud-audio consent contract and the fresh VOICE-30 retention check. The narrow, fake-only <code>june_delegate</code> bridge first becomes safe at VOICE-32 after WebRTC and canonical Realtime projection; real Quick Search and Deep Research adapters remain Phase 5. Voice V1 includes only VOICE-39's Voice-owned read-context consumer port with deterministic fake/no-op behavior. The real MemoryBroker runtime, legacy adapter, storage, usage authority, and migration remain Phase 4 and are not Voice-acceptance prerequisites.

The first implementation PR is not instrumentation. Read-only source inspection found two current fail-closed defects that must precede measurement:

1. Explicit Quit calls generic <code>Supervisor.stop()</code>, which leaves an adopted <code>wake-daemon</code> alive.
2. Voice-off updates the renderer gate but does not immediately revoke an active or pending renderer microphone stream.

VOICE-01 is therefore a narrow microphone-shutdown safety fix. VOICE-02 is the required privacy-safe baseline instrumentation PR. This exception follows the repository rule that microphone safety fails closed.

The current pipeline remains the rollback path through shadow evaluation. No PR may remove the hidden OpenCode path, fixed-window local path, or legacy side channel merely because a replacement component exists. Authority moves only after its specific gate passes; legacy removal is later than default cut-over.

## 2. Source and architecture basis

### 2.1 Authority read

The plan inherits, in order:

1. [Founder working agreement](../../AGENTS.md)
2. [JUNE 0.1 PRD](../product/JUNE_0.1_PRD.md)
3. [JUNE Master Architecture](../architecture/JUNE_MASTER_ARCHITECTURE.md)
4. [Voice System Design](../architecture/VOICE_SYSTEM_DESIGN.md)
5. [Orchestrator System Design](../architecture/ORCHESTRATOR_SYSTEM_DESIGN.md)
6. [Memory System Design](../architecture/MEMORY_SYSTEM_DESIGN.md)
7. [Project context](../../PROJECT_CONTEXT.md)
8. [Volatile status snapshot](../../STATUS.md), checked against current source rather than treated as authority

The plan starts from merge history:

- PR #170 at <code>3153859fcac882aceb47600a33c137d1a1c3288e</code>
- PR #171 at <code>acfe075715dc8dcc8ca950859e6e4343e04c9207</code>
- PR #172 at <code>babc54af87f6123fd5ad3383ad92c75b2fd2be46</code>

PR #172 supplies the resolved contracts used below: separate <code>operation_kind</code> and <code>execution_mode</code>; JUNE-derived risk; <code>wall_time</code> plus process-local <code>monotonic_ns</code>; and distinct Voice transcript-final versus canonical conversation-turn-finalized events.

### 2.2 Current official provider evidence

- [GPT-Realtime-2.1 model documentation](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
- [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Data controls in the OpenAI platform](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)

The implementation rule derived from those sources is narrow: use WebRTC for the desktop client media path; create or exchange credentials only in a trusted JUNE host; expose no permanent OpenAI key to renderer-visible state; treat provider events and IDs as adapter data, never canonical JUNE authority; and reverify the current endpoint/account retention and data-control posture before the first live audio egress and every release gate. Documentation defaults are evidence, not proof of JUNE's account configuration.

### 2.3 Evidence labels

- Confirmed means inspected in the merged documents or repository source.
- Inferred means the smallest implementation seam consistent with that evidence.
- Unknown means it requires an isolated spike, provider/account check, or real Windows/audio validation.
- Proposed paths below are expected review boundaries, not claims that those files already exist or guarantees that discovery cannot narrow them.

### 2.4 Repository evidence summary

- **Full planning SHA:** <code>babc54af87f6123fd5ad3383ad92c75b2fd2be46</code>; local <code>main</code> and <code>origin/main</code> matched at preflight. The clean OpenCode gitlink was <code>7a8e7c88f495acf5af3e7584e8ec1dbab2fe04ec</code>.
- **Current source inspected:** Python wake/capture/STT/TTS/OpenCode bridge/side channel; Electron consent, Voice preference, Supervisor/services/scheduler/main/preload/BYOK; renderer connection/session/permission/orb/audio/chat paths; root OpenCode configuration; legacy Memory/PIM/search/research facades; and the upstream OpenCode session, event, cancel, permission, MCP, and auth seams. Exact paths/symbols appear in Section 3 and Section 16.
- **Tests inspected:** Python Voice/wake/TTS/G2P/log/MCP tests; Electron consent/status/Supervisor/service tests; renderer orb/audio/OpenCode/session tests; PIM/search/research/project-memory tests; and relevant upstream OpenCode session/prompt/SSE/HTTP/permission/auth tests. Section 3.4 records the concrete files and gaps.
- **Confirmed facts:** The active Voice path is sequential and split across Python, OpenCode, the unauthenticated side channel, and renderer playback; it has two current mic-shutdown defects, no canonical shared conversation/VoiceTurn, no secure control plane, no generation-safe cancellation/playback, no deterministic Orchestrator runtime, and no compliant MemoryBroker runtime.
- **Important inferences:** The least-disruptive seams are a trusted JUNE Conversation/VoiceTurn layer adjacent to current renderer contexts, an Electron-owned single background runtime, root-owned compatibility/provider adapters, an isolated WebRTC media host, and a Voice-owned read-context consumer port. These are proposed seams, not claims of implementation.
- **Unknowns:** Real Windows mic/output/AEC/VAD/network/latency quality; target-account model access and provider retention/data-control settings; exact approved ConversationStore and media-host placement; production Hey JUNE model; current task-poller failure cause; deployed OpenCode reconnect behavior; and Phase 4 MemoryBroker implementation timing.
- **PR #172 result:** No remaining material contract conflict was found. The Master remains Version 0.1 and its global Phase 1 → Phase 2 → Phase 3 Voice → Phase 4 Memory → Phase 5 capability order controls this plan.

## 3. Current Voice implementation map

### 3.1 End-to-end flow

~~~text
native Electron consent
  -> Supervisor starts phase2-mcp/wake_daemon.py
  -> MicStream continuously owns 16 kHz mono int16 capture
  -> WakeWordDetector scores 1,920-sample / 120 ms hops
  -> handle_wake captures 33 more frames, about 3.96 seconds
  -> nightjar_capabilities.voice.transcribe uses local faster-whisper
  -> OpenCodeVoice lazily creates a separate "Nightjar voice" session
  -> prompt_async plus global OpenCode SSE buffers one complete assistant reply
  -> nightjar_capabilities.voice.speak creates one complete Kokoro WAV
  -> fixed tts_out.wav path is published on the loopback side channel
  -> orbAdapter loads and plays the WAV in the renderer
~~~

### 3.2 Ownership and seams

| Concern | Confirmed current owner | Verified paths and symbols | Material gap / migration seam |
|---|---|---|---|
| Consent and enablement | Electron main | <code>phase3-ui/src/main/voiceConsent.ts</code>: <code>askForMicConsent</code>, <code>invalidatePendingConsent</code>; <code>voice.ts</code>; <code>voiceConsentCopy.ts</code>; <code>VoiceSettings.tsx</code>; <code>BYOKSettings.tsx</code> | Managed local enable is fail-closed, but Python has no authenticated parent lease and current copy does not grant informed consent to stream raw post-wake audio to OpenAI; BYOK/account approval is not cloud-audio consent |
| Service lifecycle | Electron main Supervisor | <code>phase3-ui/src/main/supervisor.ts</code>: <code>bring</code>, <code>startService</code>, <code>stopService</code>, <code>stop</code> | Generic quit preserves adopted services; no one-profile runtime lease or tray owner |
| Wake and microphone | Python wake daemon | <code>phase2-mcp/wake_daemon.py</code>: <code>MicStream</code>, <code>handle_wake</code>; <code>wakeword.py</code>: <code>WakeWordDetector</code> | Fixed capture, no production Hey JUNE model, no pre-roll handoff, no unified device lifecycle |
| STT | Local Python | <code>nightjar_capabilities/voice.py</code>: <code>transcribe</code> | No deterministic STT quality/framing suite; final transcript is not a canonical event |
| Agent conversation | Hidden OpenCode session | <code>wake_daemon.py</code>: <code>OpenCodeVoice</code> | Separate from visible chat; timeout does not abort; stale same-session SSE can cross turns |
| Typed/coding chat | Renderer plus OpenCode | <code>ConnectionContext.tsx</code>, <code>SessionsContext.tsx</code>, <code>opencode.ts</code> | OpenCode IDs are treated as UI session IDs; reconnect can preserve pixels but lose model context |
| Cancellation | OpenCode session abort for visible sessions | <code>PermissionContext.tsx</code>: <code>abortSession</code>; <code>OpenCodeClient.abort</code> | No Voice generation cancel; no provider media cancel; durable-task cancel is not defined |
| TTS | Local Kokoro | <code>voice.py</code>: <code>_KokoroSession</code>, <code>speak</code> | Shared non-atomic output file; timed-out worker keeps running; no generation ownership |
| Playback | Renderer | <code>orbAdapter.ts</code>: <code>playTts</code>, <code>teardownTts</code> | Arrival-order token is local only; no stale-generation rejection or heard-duration record |
| Renderer metering | Renderer second mic | <code>orbAdapter.ts</code>: <code>startMic</code> | A second <code>getUserMedia</code> handle exists only for visualization; Voice-off does not revoke it immediately |
| Local transport | Unauthenticated loopback WebSocket | <code>phase2-mcp/sidechannel.py</code>: <code>handler</code>, <code>LATEST</code>, <code>publish</code>, <code>Subscriber</code> | Any loopback peer can publish/read; no roles, schemas, IDs, sequence, replay defense, or origin/auth |
| App IPC | Electron preload bridge | <code>phase3-ui/src/preload/index.ts</code> | Typed but not a canonical Voice control protocol; renderer directly reaches OpenCode and side channel |
| Credentials | Electron <code>safeStorage</code> | <code>phase3-ui/src/main/byok.ts</code> | Natural trusted-key seam, but no ephemeral Realtime credential broker exists |
| Background behavior | Visible Electron app | <code>phase3-ui/src/main/index.ts</code>, <code>phase3-ui/src/shared/voiceConsentCopy.ts</code> | Windows window close quits and consent copy promises no background service; no tray, single-instance lock, or persistent Voice/task owner |
| Scheduler interaction | Electron main timer plus Python poller | <code>scheduler.ts</code>, <code>task_poller.py</code> | No cross-process lease; current poller failure cause is Unknown and out of Voice scope |
| Memory | Legacy KG facade and global auto-recall | <code>nightjar_capabilities/memory.py</code>, <code>recall.py</code>, <code>nightjar-auto-recall.ts</code> | Approved MemoryBroker design contract exists, but no compliant runtime broker, scoped usage authority, or egress ledger is implemented |
| Search/research | MCP operations under OpenCode | <code>websearch_server.py</code>, <code>research_server.py</code>, backend modules | Quick Search is bounded; Deep Research is synchronous and has no durable task/recovery state |
| Orchestration | Not implemented | No <code>Orchestrator</code>, <code>CapabilityRegistry</code>, <code>ActionGateway</code>, or <code>june_runtime.db</code> implementation found | All deterministic Phase 2 foundations are real prerequisites to <code>june_delegate</code> |

### 3.3 Current privacy and credential boundary

Confirmed:

- <code>wake_daemon.handle_wake</code> logs the full transcript and cleaned command.
- The side channel broadcasts transcript and complete assistant reply text and retains latest-per-kind payloads in memory.
- OpenCode is started on loopback without <code>OPENCODE_SERVER_PASSWORD</code>; the renderer creates <code>OpenCodeClient</code> without auth.
- Local MCP children inherit the OpenCode process environment through a broad environment spread. New JUNE workers must instead receive explicit allowlists.
- Current G2P diagnostics correctly record bounded counts/codepoints rather than assistant text.

### 3.4 Existing tests inspected

Python Voice tests inspected:

- <code>test_wake_capture.py</code>
- <code>test_wakeword_samples.py</code>
- <code>test_wake_mute.py</code>
- <code>test_wake_sse_utf8.py</code>
- <code>test_tts_no_gpl.py</code>
- <code>test_tts_spellout.py</code>
- <code>test_g2p_observability.py</code>
- <code>test_log_encoding.py</code>
- <code>test_mcp_client.py</code>

Electron/main and renderer tests inspected:

- <code>voice.consent.test.ts</code>, <code>voice.status.test.ts</code>
- <code>supervisor.voice-gate.test.ts</code>, Supervisor spawn/preflight/logging/decode tests
- <code>services.wakedaemon-env.test.ts</code>, service path/environment tests
- <code>orbAdapter.micGate.test.ts</code>, <code>orbAdapter.ttsAttach.test.ts</code>, <code>orbAdapter.ttsError.test.ts</code>
- <code>audioVolume.attachElement.test.ts</code>, <code>VortexOverlay.pointerEvents.test.ts</code>
- <code>opencode.timeouts.test.ts</code>, <code>sessionScope.test.ts</code>
- Read-only inspection of <code>test-orb.ts</code>, <code>test-integration.ts</code>, <code>test-supervisor.ts</code>, and <code>test-supervisor-restart.ts</code>

Orchestrator-adjacent tests inspected:

- PIM migration/task tests
- web search, research, and deep-research backend tests
- renderer project-memory/auto-memory tests
- relevant upstream OpenCode session, prompt/cancel, SSE, HTTP, permission, and auth tests

No tests cover the complete target VoiceTurn, canonical finality, secure local control, per-generation playback, renderer reload, provider reconnect, durable admission, or WebRTC path. Existing live scripts are evidence of current behavior, not deterministic release gates.

## 4. Target Voice V1 implementation boundary

| Target component | JUNE-owned responsibility | Initial migration boundary |
|---|---|---|
| Local JUNE audio edge | Local wake, bounded volatile pre-roll, device state, activity/interruption signal, hard mute, one mic lease | Wrap and then narrow the current Python daemon; do not rewrite the wake stack during contract work |
| VoiceTurn controller | Session/turn/generation state, legal transitions, cancellation, stale rejection, terminal truth | Provider-neutral trusted module; current OpenCode/Kokoro components become adapters |
| Canonical Conversation Bridge | Persist one accepted user turn, emit <code>conversation.turn.finalized</code>, project provider/OpenCode data | New JUNE authority adjacent to, not inside, <code>SessionsContext</code> |
| Secure local control channel | Authenticated roles, typed schemas, sequence/replay defense, bounded messages | Electron context bridge for renderer plus secured local worker transport; old WebSocket remains explicitly non-authoritative and loses each display/media consumer only when that consumer is migrated |
| Single-owner background runtime | One profile lease; VoiceTurn/conversation/task ownership; safe start, renderer reload, tray, shutdown | Modular trusted Electron/background host; do not create a second scheduler owner |
| OpenAI Realtime adapter | Provider session lifecycle, event translation, usage/error metadata, cancel/reconnect | Provider IDs remain metadata; permanent key never crosses trusted host |
| WebRTC media path | Low-latency bidirectional audio in a trusted desktop media host | Isolated media host using an ephemeral credential; visible UI is not the authority |
| Playback engine | Generation-keyed queue, immediate stop, progress/heard accounting, stale rejection | Trusted controller plus renderer/media adapter until a better host is proven |
| Privacy controller | Separate ordinary microphone and explicit cloud-audio consent, activation mode, upload truth, hard mute, follow-up expiry, visible window/tray indicators | Existing fail-closed preference is preserved; current local users do not inherit cloud consent and missing state means no cloud audio |
| Orchestrator delegation | Validate/recompute capability, execution, risk, permission, retry, verification; durable tasks/effects | Narrow <code>june_delegate</code> only after all deterministic Phase 2 gates |
| Memory integration seam | Voice-owned, read-only, bounded, purpose/scope/sensitivity-aware context-consumer port | Approved Memory design shapes plus deterministic fake/no-op only in Voice; real MemoryBroker runtime, usage authority, and legacy migration remain Phase 4 |

The least-disruptive target keeps OpenCode as a compatibility and coding adapter. It does not fork the <code>research/opencode</code> submodule. Visible chat can initially consume the existing <code>UiMessage</code> shape through a compatibility projector while canonical identity and finality live in trusted JUNE code.

## 5. Canonical contracts used by the plan

### 5.1 Runtime contract map

| Contract | Required meaning | First runtime PR | First authoritative use |
|---|---|---|---|
| <code>user_id</code> | Stable local user identity | VOICE-03 | Conversation and Orchestrator admission |
| <code>conversation_id</code> | JUNE-visible canonical conversation | VOICE-03 | VOICE-06 Conversation Bridge |
| <code>voice_session_id</code> | One activated/follow-up Voice session | VOICE-03 | VOICE-05 VoiceTurn controller |
| <code>turn_id</code> | One user contribution and associated response | VOICE-03 | VOICE-05/VOICE-06 |
| <code>generation_id</code> | One response attempt under a turn | VOICE-03 | VOICE-05 cancellation and VOICE-11 playback |
| <code>event_id</code> | Globally unique JUNE event identity | VOICE-03 | Every canonical producer |
| <code>provider_session_id</code>, <code>provider_response_id</code> | Non-authoritative adapter metadata | VOICE-03 | VOICE-28/VOICE-30 |
| <code>task_id</code>, <code>capability_call_id</code> | Durable task and bounded invocation identity | VOICE-13 | Phase 2 runtime |
| <code>june.event.v1</code> | Provider-neutral validated envelope | VOICE-03 | Trusted producers and authenticated control; raw legacy frames never become authoritative by translation alone |
| <code>wall_time</code> | ISO-8601 UTC diagnostic/persistence/correlation time | VOICE-02 observes it; VOICE-03 makes it canonical | All canonical events |
| <code>monotonic_ns</code> | Non-negative process-local monotonic nanoseconds | VOICE-02 observes it; VOICE-03 makes it canonical | Same-process durations/order only |
| Producer <code>sequence</code> | Monotonic only within one authenticated producer stream | VOICE-03 | VOICE-09 secure control |
| <code>voice.user.transcript.final</code> | Voice/STT final result, not durable authority | VOICE-03 defines; VOICE-05 emits only for trusted in-process/test inputs | VOICE-06 accepts trusted inputs; VOICE-09 first authenticates the live legacy edge |
| <code>conversation.turn.finalized</code> | Emitted only after Conversation Service persistence succeeds | VOICE-06 | VOICE-17 admission and later Memory candidates |
| <code>operation_kind</code> | Untrusted hint <code>read</code> or <code>write</code> | VOICE-13 | VOICE-16/VOICE-17/VOICE-18 recompute against Registry |
| <code>execution_mode</code> | Untrusted hint <code>turn_scoped</code> or <code>long_running</code> | VOICE-13 | VOICE-16/VOICE-17/VOICE-18 recompute against Registry |
| <code>risk_tier</code> | Trusted JUNE result <code>R0</code>-<code>R3</code> | VOICE-13 | VOICE-16 Registry plus VOICE-19 policy |
| Voice cancellation | Stop output/media for a <code>turn_id</code>/<code>generation_id</code> | VOICE-05 | VOICE-11 and VOICE-33 |
| Provider abort | Adapter-specific attempt to stop provider work | VOICE-28 | VOICE-30 and VOICE-33 |
| Durable-task cancellation | Policy-aware task transition; may outlive the Voice turn | VOICE-13 defines; VOICE-22 implements | VOICE-32 delegation |

### 5.2 Clock and finality invariants

- Never compare <code>monotonic_ns</code> values emitted by different processes.
- Cross-process staleness uses canonical IDs, authenticated producer sequence, causation/correlation IDs, explicit generation/state checks, and <code>wall_time</code> for diagnostics—not wall time alone.
- Partial speech can drive temporary UI or speculative read-only retrieval only.
- <code>voice.user.transcript.final</code> cannot create a task, effect, approval, action, or durable memory candidate.
- Conversation Service persists exactly one accepted user message before it emits <code>conversation.turn.finalized</code>.
- Only <code>conversation.turn.finalized</code> or a separately authorized scheduled/system trigger can originate durable/effect-bearing work. Scheduled triggers cannot bypass Memory source/write policy.
- Model/provider classifications are proposals. The trusted Registry and Orchestrator validate or recompute kind, execution mode, effects, risk, permission, retry, and verification.
- Memory is evidence, never authority, and cannot raise a permission ceiling or lower/author an authoritative risk decision.

## 6. Dependency graph

Solid arrows are merge dependencies. Dotted arrows mean preparation against mocks only and require a rebase after the solid dependency lands.

~~~mermaid
flowchart TD
    LEGACY["Legacy Voice remains selectable"]

    subgraph W0["Wave 0 - immediate fail-closed repair"]
      V01["VOICE-01 mic shutdown safety"]
    end

    subgraph W1["Wave 1 - evidence and contracts"]
      V02["VOICE-02 baseline telemetry"]
      V03["VOICE-03 canonical contracts"]
      V04["VOICE-04 fake Voice harness"]
    end

    subgraph W2["Wave 2 - canonical turn and conversation"]
      V05["VOICE-05 VoiceTurn core"]
      V06["VOICE-06 Conversation Bridge"]
      V07["VOICE-07 shared conversation UI"]
    end

    subgraph W3["Wave 3 - trusted platform and audio ownership"]
      V08["VOICE-08 background runtime"]
      V09["VOICE-09 secure local control"]
      V10["VOICE-10 single audio owner"]
      V11["VOICE-11 generation playback"]
      V12["VOICE-12 background privacy UI"]
      G1{"Phase 1 gate"}
    end

    subgraph W4["Waves 4-5 - deterministic agency"]
      V13["VOICE-13 Orchestrator contracts"]
      V14["VOICE-14 compatibility facade"]
      V15["VOICE-15 encrypted runtime DB"]
      V16["VOICE-16 trusted Registry"]
      V17["VOICE-17 deterministic admission"]
      V18["VOICE-18 model route + plan validation"]
      V19["VOICE-19 policy/consent"]
      V20["VOICE-20 Action Gateway/ledger"]
      V21["VOICE-21 recovery engine"]
      V22["VOICE-22 task control + budgets"]
      V23["VOICE-23 approval/progress UI"]
      V24["VOICE-24 default-deny invocation"]
      V25["VOICE-25 OpenCode/MCP mediation"]
      V26["VOICE-26 PIM/scheduled mediation"]
      V27["VOICE-27 fake-capability fault gate"]
      G2{"Phase 2 gate"}
    end

    subgraph W6["Wave 6 - OpenAI adapter and WebRTC"]
      PREP["Provider prep branch only"]
      V28["VOICE-28 credential + adapter"]
      V29["VOICE-29 cloud-audio consent"]
      V30["VOICE-30 WebRTC vertical slice"]
      V31["VOICE-31 realtime conversation UI"]
    end

    subgraph W7["Wave 7 - delegation then natural duplex Voice"]
      V32["VOICE-32 fake-only june_delegate"]
      V33["VOICE-33 interruption/barge-in"]
      V34["VOICE-34 audio-device lifecycle"]
      V35["VOICE-35 endpointing + echo control"]
      V36["VOICE-36 provider/session resilience"]
      V37["VOICE-37 follow-up/privacy controller"]
      V38["VOICE-38 privacy/follow-up UI"]
    end

    subgraph W8["Wave 8 - bounded read-context seam"]
      V39["VOICE-39 fake/no-op read-context port"]
    end

    subgraph W9["Waves 9-10 - proof and controlled cut-over"]
      V40["VOICE-40 shadow acceptance"]
      V41["VOICE-41 controlled default cut-over"]
      M4["Later Phase 4 real MemoryBroker"]
    end

    V01 --> V02 --> V03
    V03 --> V04
    V03 --> V05
    V04 --> V05 --> V06
    V03 --> V06
    V03 -. mock UI preparation .-> V07
    V06 --> V07

    V03 --> V08
    V05 --> V08 --> V09 --> V10 --> V11
    V05 --> V09
    V06 --> V09
    V05 --> V11
    V09 --> V11
    V03 -. mock status preparation .-> V12
    V08 --> V12
    V09 --> V12
    V05 --> G1
    V06 --> G1
    V07 --> G1
    V08 --> G1
    V09 --> G1
    V10 --> G1
    V11 --> G1
    V12 --> G1

    G1 --> V13 --> V14 --> V15 --> V16 --> V17 --> V18 --> V19 --> V20 --> V21 --> V22
    V13 --> V16
    V06 --> V17
    V16 --> V18
    V15 --> V19
    V16 --> V19
    V17 --> V19
    V15 --> V20
    V16 --> V20
    V17 --> V20
    V18 --> V20
    V15 --> V21
    V15 --> V22
    V19 -. mock approval preparation .-> V23
    V22 --> V23
    V14 --> V24
    V16 --> V24
    V19 --> V24
    V20 --> V24
    V21 --> V24
    V22 --> V24
    V24 --> V25
    V24 --> V26
    V20 --> V25
    V20 --> V26
    V22 --> V26
    V23 --> V27
    V25 --> V27
    V26 --> V27
    V04 --> V27
    V27 --> G2

    V03 -. interfaces and fakes only .-> PREP
    PREP -. mandatory rebase .-> V28
    G2 --> V28 --> V29 --> V30 --> V31
    V08 --> V29
    V12 --> V29
    V09 --> V30
    V10 --> V30
    V11 --> V30
    V06 --> V31

    V27 --> V32
    V30 --> V32
    V31 --> V32 --> V33
    V11 --> V33
    V30 --> V33
    V31 --> V33
    V33 --> V34 --> V35 --> V36 --> V37 --> V38
    V10 --> V34
    V30 --> V34
    V30 --> V35
    V33 --> V35
    V30 --> V36
    V30 --> V37
    V33 --> V37
    V34 --> V37
    V35 --> V37
    V12 --> V38
    V31 --> V38
    V06 --> V39
    V28 --> V39

    V31 --> V40
    V32 --> V40
    V33 --> V40
    V34 --> V40
    V35 --> V40
    V36 --> V40
    V37 --> V40
    V38 --> V40
    V39 --> V40
    V27 --> V40
    LEGACY --> V40
    V40 --> V41
    LEGACY --> V41
    V41 -. separate Phase 4 program .-> M4
~~~

OpenAI adapter integration begins only at VOICE-28 after the Phase 2 gate. Earlier provider branches are preparation-only and cannot carry live credentials, enable microphone upload, or merge active provider behavior. VOICE-29 adds explicit cloud-audio consent and truthful indication without sending media; VOICE-30 is the first PR allowed to send live audio, only after both consent and a fresh retention/data-control gate. Following the Master's global order, <code>june_delegate</code> lands at VOICE-32 after WebRTC and shared Realtime conversation projection, before interruption/privacy work; it supports deterministic fakes, rejection, and acknowledgement only. Real Quick Search and Deep Research adapters remain Phase 5. VOICE-39 implements only the Voice-owned consumer port from the already approved Memory design with a fake/no-op default; the real MemoryBroker runtime begins later in Phase 4 and is not a Voice acceptance dependency.

## 7. PR portfolio summary

Size means review surface, not a line quota: S is one isolated seam, M is a bounded multi-file behavior, and L is a cross-process/security/migration seam that must be split if reviewers cannot reason about it in one sitting.

The count is evidence-derived: one immediate privacy repair; eleven remaining Phase 1 PRs; fifteen separately reviewable deterministic-agency PRs; twelve provider, explicit cloud-consent, duplex, privacy, and context-seam PRs; and two acceptance/cut-over PRs. Recovery is separate from task control, default-deny enforcement is separate from OpenCode/MCP and PIM/scheduled-effect mediation, and cloud-audio consent is separate from first media egress because each has a different failure and rollback surface.

| Plan ID | Proposed PR title | Owner | Dependencies | Parallel lane | Risk | Expected size |
|---|---|---|---|---|---|---|
| VOICE-01 | <code>fix(voice): close microphones on disable and quit</code> | L | Base | Critical | High privacy | S |
| VOICE-02 | <code>chore(voice): add privacy-safe baseline telemetry</code> | Q | 01 | Quality | Medium privacy | M |
| VOICE-03 | <code>feat(core): add canonical voice event contracts</code> | L | 02 | Critical | High architecture | M |
| VOICE-04 | <code>test(voice): add deterministic event and provider harnesses</code> | Q | 03 | Quality | Low | M |
| VOICE-05 | <code>feat(voice): add canonical VoiceTurn control</code> | L | 03, 04 | Critical | High state/cancel | M |
| VOICE-06 | <code>feat(conversation): add canonical voice and text bridge</code> | L | 03, 05 | Critical | High data/finality | L |
| VOICE-07 | <code>feat(ui): show voice in the canonical conversation</code> | U | 06; may prepare after 03 | UI | Medium continuity | M |
| VOICE-08 | <code>feat(platform): add a single-owner background runtime</code> | L | 03, 05 | Critical | High lifecycle | L |
| VOICE-09 | <code>feat(platform): authenticate local voice control</code> | L | 06, 08 | Critical | Critical security | L |
| VOICE-10 | <code>feat(voice): enforce one microphone owner</code> | L | 09 | Critical | Critical audio/privacy | L |
| VOICE-11 | <code>feat(voice): make playback generation-safe</code> | L | 05, 09, 10 | Critical | High stale audio | L |
| VOICE-12 | <code>feat(ui): show background voice privacy state</code> | U | 08, 09; may prepare after 03 | UI | Medium privacy UX | M |
| VOICE-13 | <code>feat(orchestrator): add deterministic foundation contracts</code> | L | Phase 1 gate | Critical | High architecture | M |
| VOICE-14 | <code>feat(orchestrator): route current requests through the facade</code> | L | 13 | Critical | High migration | L |
| VOICE-15 | <code>feat(orchestrator): add the encrypted durable runtime store</code> | L | 14 | Critical | Critical data/migration | L |
| VOICE-16 | <code>feat(orchestrator): add the trusted Capability Registry</code> | L | 13, 15 | Critical | High authority | M |
| VOICE-17 | <code>feat(orchestrator): add deterministic routing and admission</code> | L | 06, 16 | Critical | High finality/routing | M |
| VOICE-18 | <code>feat(orchestrator): validate model routes and plans</code> | L | 16, 17 | Critical | High untrusted planning | M |
| VOICE-19 | <code>feat(orchestrator): enforce policy, consent, and approval binding</code> | L | 15-18 | Critical | Critical authorization | L |
| VOICE-20 | <code>feat(orchestrator): add the Action Gateway and ledger</code> | L | 15-19 | Critical | Critical effects | L |
| VOICE-21 | <code>feat(orchestrator): recover durable execution</code> | L | 15, 20 | Critical | Critical recovery | L |
| VOICE-22 | <code>feat(orchestrator): control task budgets and lifecycle</code> | L | 15, 21 | Critical | High task control | M |
| VOICE-23 | <code>feat(ui): present approvals and durable task progress</code> | U | 19, 22; may prepare after 13 | UI | High user safety | M |
| VOICE-24 | <code>feat(orchestrator): enforce default-deny capability invocation</code> | L | 14, 16, 19-22 | Critical | Critical authority/security | M |
| VOICE-25 | <code>fix(orchestrator): mediate OpenCode and MCP compatibility routes</code> | L | 20, 24 | Critical | Critical migration/security | L |
| VOICE-26 | <code>fix(orchestrator): mediate PIM and scheduled effects</code> | L | 20, 22, 24 | Critical | Critical effects/migration | M |
| VOICE-27 | <code>test(orchestrator): gate agency with fake-capability faults</code> | Q | 04, 23, 25, 26 | Quality | High proof | L |
| VOICE-28 | <code>feat(voice): add the OpenAI Realtime credential and adapter boundary</code> | L | Phase 2 gate | Critical | Critical credentials/provider | L |
| VOICE-29 | <code>feat(voice): require explicit cloud audio consent</code> | L | 08, 12, 28 | Critical | Critical consent/privacy | M |
| VOICE-30 | <code>feat(voice): add the OpenAI WebRTC vertical slice</code> | L | 29, Phase 1/2 gates | Critical | Critical media/privacy | L |
| VOICE-31 | <code>feat(ui): project Realtime turns into the canonical conversation</code> | U | 06, 30; may prepare after 03 | UI | High continuity | M |
| VOICE-32 | <code>feat(voice): add the fake-only june_delegate bridge</code> | L | 27, 30, 31 | Critical | Critical authority | M |
| VOICE-33 | <code>feat(voice): add true generation interruption and barge-in</code> | L | 11, 30-32 | Critical | Critical cancellation | L |
| VOICE-34 | <code>feat(voice): harden audio-device lifecycle</code> | L | 10, 30, 33 | Critical | High hardware/privacy | M |
| VOICE-35 | <code>feat(voice): add endpointing and echo control</code> | L | 30, 33, 34 | Critical | High acoustic quality | L |
| VOICE-36 | <code>feat(voice): recover provider media sessions</code> | L | 30, 35 | Critical | High network/recovery | L |
| VOICE-37 | <code>feat(voice): add follow-up and privacy-mode control</code> | L | 30, 33-36 | Critical | Critical privacy | M |
| VOICE-38 | <code>feat(ui): add accessible follow-up and privacy controls</code> | U | 12, 31, 37 | UI | High privacy UX | M |
| VOICE-39 | <code>feat(voice): add a read-only context consumer port</code> | L | 06, 28, approved Memory design | Integration | High privacy/egress | M |
| VOICE-40 | <code>test(voice): prove shadow acceptance and rollback</code> | Q | 27, 31-39 | Quality | Critical release proof | L |
| VOICE-41 | <code>feat(voice): enable controlled Realtime cut-over with rollback</code> | L | 40, founder approval | Critical | Critical migration | S |

## 8. Detailed PR specifications

### VOICE-01 — Current-path microphone shutdown safety

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q for lifecycle/failure tests; Engineer U checks the visible off-state.
- **Architecture approver when required:** Founder, because this changes fail-closed microphone shutdown behavior.
- **Proposed branch:** <code>voice/01-mic-shutdown-safety</code>.
- **Proposed PR title:** <code>fix(voice): close microphones on disable and quit</code>.
- **Objective:** Guarantee that Voice-off revokes active and pending renderer capture and that explicit Quit terminates an adopted wake daemon.
- **Why this PR exists now:** Source inspection proved two current privacy defects; collecting a baseline while explicit off/quit can leave a microphone alive would violate the working agreement.
- **Dependencies:** Clean main at the implementation-time merge base; no architectural dependency.
- **Likely files/components in scope:** <code>phase3-ui/src/main/supervisor.ts</code>, quit orchestration in <code>index.ts</code> only if needed, <code>NightjarOrb.tsx</code>, the adapter stop boundary, and narrowly focused Supervisor/orb tests.
- **Files/components explicitly out of scope:** Python capture/STT/TTS, event schemas, tray redesign, side-channel security, scheduler behavior, OpenAI, dependencies, and the OpenCode submodule.
- **Behavioral changes:** Explicit Quit treats an adopted wake daemon as privacy-sensitive and stops it; Voice-off calls a deterministic local teardown that invalidates pending <code>getUserMedia</code> and stops acquired tracks immediately.
- **Schema, identifier, or event changes:** None.
- **Migration and compatibility behavior:** Preserve all enable/consent, wake, chat, playback, service-adoption, and generic non-Voice adopted-service behavior.
- **Acceptance criteria:** After Voice-off or explicit Quit, no owned/adopted wake listener remains on its health port; every active/pending renderer track is stopped; failure to stop is surfaced honestly and never reported as off.
- **Automated tests:** Adopted-wake shutdown; owned-wake shutdown; non-Voice adopted service remains untouched by the narrow rule; a focused <code>NightjarOrb</code> component/controller regression proving <code>enabled: false</code> invokes teardown for active and pending capture; pending acquisition resolves after off and is immediately stopped; repeated off/quit is idempotent; and, if <code>index.ts</code> or generic shutdown is used, an orchestration regression exercises that exact Quit-to-<code>Supervisor.stop()</code> path.
- **Manual Windows validation:** With an isolated test profile, validate managed and deliberately adopted wake-daemon cases; verify the OS microphone indicator and port close on Voice-off and explicit Quit. This is the only PR-1 hardware claim permitted.
- **Privacy/security checks:** No transcript/audio/credential logging; no broader PID kill; re-resolve the sole listener before terminating an unmanaged process; fail closed on ambiguous ownership.
- **Performance/observability checks:** Shutdown remains bounded and does not add startup or steady-state work; existing status reports distinguish stopped from stuck.
- **Risks:** Killing the wrong process, changing generic adoption semantics, a late capture promise resurrecting the mic, or UI reporting off before teardown completes.
- **Stop conditions:** PID/listener identity cannot be proven; a fix requires broad Supervisor semantics; renderer teardown cannot be tested deterministically; or any second feature enters scope.
- **Merge gate:** Focused automated tests, two human reviews, real Windows off/quit evidence, clean diff, and no unrelated lifecycle change.
- **What later PRs may assume after merge:** Off and Quit are trustworthy current-path kill switches suitable for safe baseline measurement.

### VOICE-02 — Privacy-safe legacy baseline telemetry

- **Primary owner:** Engineer Q.
- **Human reviewer:** Engineer L and Engineer U.
- **Architecture approver when required:** Engineer L; Founder only if the proposed event taxonomy changes canonical contracts.
- **Proposed branch:** <code>voice/02-legacy-baseline-telemetry</code>.
- **Proposed PR title:** <code>chore(voice): add privacy-safe baseline telemetry</code>.
- **Objective:** Measure the current wake-to-playback phases and failure outcomes without recording speech, replies, audio, secrets, paths, or provider/session identifiers.
- **Why this PR exists now:** Migration and latency claims need an honest baseline; the current daemon logs the entire transcript/command and lacks content-free spans.
- **Dependencies:** VOICE-01.
- **Likely files/components in scope:** <code>wake_daemon.py</code>, <code>nightjar_capabilities/voice.py</code>, isolated Voice observability helpers/tests, and only the existing Supervisor metadata seam if required.
- **Files/components explicitly out of scope:** Pipeline control flow, capture duration, model choice, TTS output ownership, canonical IDs, side-channel schema, renderer state, provider work, and user data.
- **Behavioral changes:** Replace raw transcript/command logs with lengths/outcome classes; add content-free timestamps and durations for wake, capture, STT, OpenCode wait, TTS, publish, and playback acknowledgement where already observable.
- **Schema, identifier, or event changes:** Observability records use <code>wall_time</code> and same-process <code>monotonic_ns</code>, but are explicitly legacy telemetry rather than <code>june.event.v1</code>.
- **Migration and compatibility behavior:** Existing functional outputs and legacy side-channel frames remain byte/shape compatible; only ordinary log content becomes safer and more structured.
- **Acceptance criteria:** A mocked successful and failing turn yields bounded phase timing/outcome records; canary transcript/reply/secret/path strings appear nowhere in logs; telemetry failure cannot break Voice.
- **Automated tests:** Content canaries; timing with injected clock; timeout/error classification; no negative durations; TTS/STT failures; log size bounds; legacy behavior snapshot.
- **Manual Windows validation:** Run the current path under an isolated profile and collect timing records for several turns without copying speech text; record hardware/device as test metadata outside ordinary logs.
- **Privacy/security checks:** Allowlist every field; hash nothing that could be reversed or correlated unnecessarily; never record audio, transcript, reply, file path, key, provider token, OpenCode ID, or raw exception text.
- **Performance/observability checks:** Measure instrumentation overhead with fake clocks and confirm no extra model/audio call; target negligible steady-state cost and bounded record size.
- **Risks:** Accidental content leakage through exceptions or repr, changing timing-sensitive behavior, and confusing legacy telemetry with canonical events.
- **Stop conditions:** A proposed metric requires raw content, private user-data inspection, a new telemetry dependency, or live service changes beyond the isolated implementation test.
- **Merge gate:** Privacy canary suite, current Voice regression tests, Lead review, real Windows baseline artifact reviewed without content, and a documented baseline summary.
- **What later PRs may assume after merge:** The legacy path has privacy-safe phase/failure measurements and an evidence baseline for shadow comparison.

### VOICE-03 — Canonical identity and event contracts

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner architecture reviewer.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>voice/03-canonical-event-contracts</code>.
- **Proposed PR title:** <code>feat(core): add canonical voice event contracts</code>.
- **Objective:** Introduce provider-neutral identifiers, privacy classes, envelopes, event validation, and clock/sequence invariants without changing active Voice behavior.
- **Why this PR exists now:** Every later state, transport, conversation, provider, playback, and Orchestrator PR needs one runtime vocabulary.
- **Dependencies:** VOICE-02 and merged PR #172 contracts.
- **Likely files/components in scope:** New canonical JSON schemas/fixtures, TypeScript and Python contract adapters, shared ID/event factories, and conformance tests.
- **Files/components explicitly out of scope:** Conversation persistence, VoiceTurn transitions, transport replacement, provider fields beyond optional metadata, risk decisions, and all capability execution.
- **Behavioral changes:** None; factories and validators are dark infrastructure.
- **Schema, identifier, or event changes:** Add UUIDv7-style JUNE IDs, <code>june.event.v1</code>, <code>wall_time</code>, <code>monotonic_ns</code>, producer sequence, causation/correlation, privacy class, exact Voice event names, and optional provider metadata.
- **Migration and compatibility behavior:** Legacy <code>{kind,...}</code> frames stay active; a one-way adapter may translate them for tests/shadowing, but canonical consumers never trust raw legacy frames.
- **Acceptance criteria:** Both languages accept the same valid fixtures and reject missing, unknown, malformed, duplicate, negative-clock, bad-enum, and inconsistent-ID cases; no old canonical names exist.
- **Automated tests:** Cross-language golden fixtures; UUID uniqueness/order properties; same-process sequence tests; stale generation fixtures; clock semantics; transcript-final/finalized-turn distinction.
- **Manual Windows validation:** Build/typecheck and start the app with an isolated profile only if the implementation PR normally does so; no microphone/provider/hardware claim is required.
- **Privacy/security checks:** Payload schemas default deny; unknown event types/fields cannot acquire authority; IDs contain no content; provider IDs cannot substitute for JUNE IDs.
- **Performance/observability checks:** Validate envelope creation/validation cost with a bounded micro-benchmark; no wall-clock ordering assumption.
- **Risks:** Duplicated Python/TypeScript drift, overspecified provider schema, accidental persistence, or an event factory that trusts caller-supplied authority.
- **Stop conditions:** Active architecture documents conflict; cross-language fixtures cannot agree; a new schema/dependency would become a global workflow framework; or a provider-specific field is proposed as canonical.
- **Merge gate:** Founder contract approval, cross-language conformance tests, targeted stale-term search, and no runtime behavior change.
- **What later PRs may assume after merge:** One versioned source of truth exists for canonical IDs/events/clocks/privacy and exact finality names.

### VOICE-04 — Deterministic Voice contract and fake-provider harness

- **Primary owner:** Engineer Q.
- **Human reviewer:** Engineer L and Engineer U.
- **Architecture approver when required:** Engineer L.
- **Proposed branch:** <code>voice/04-fake-voice-harness</code>.
- **Proposed PR title:** <code>test(voice): add deterministic event and provider harnesses</code>.
- **Objective:** Provide reusable fake clocks, ID sources, provider streams, audio/playback sinks, transport peers, and fault scheduling for all later Voice tests.
- **Why this PR exists now:** State and provider PRs must prove races and failure ordering without real services, credentials, microphones, sleeps, or network.
- **Dependencies:** VOICE-03.
- **Likely files/components in scope:** Test-only fixtures under the TypeScript/Python test trees, canonical event builders, recorded synthetic sequences, and harness documentation.
- **Files/components explicitly out of scope:** Production provider clients, real audio samples containing speech, source behavior, global test frameworks, dependencies, and user/application data.
- **Behavioral changes:** None.
- **Schema, identifier, or event changes:** None; the harness consumes VOICE-03 exactly and must not create a competing test schema.
- **Migration and compatibility behavior:** Existing test scripts remain; deterministic fixtures become the preferred gate for new code.
- **Acceptance criteria:** Tests can drive success, duplicate, replay, out-of-order, disconnect, timeout, cancellation, late audio, renderer reload, process restart, and malformed-frame scenarios with zero wall-clock sleeps.
- **Automated tests:** Self-tests for determinism, seed reproducibility, fake-clock advancement, resource cleanup, fixture privacy, and failure injection.
- **Manual Windows validation:** Run only the isolated harness on Windows; confirm it creates data solely under its temporary directory and opens no device/socket/provider.
- **Privacy/security checks:** Synthetic canary content only; fixtures contain no real transcript, key, path, user ID, or recorded user audio.
- **Performance/observability checks:** The harness can assert latency budgets from synthetic timestamps and reports deterministic event traces on failure.
- **Risks:** A fake that differs materially from the provider/transport, hidden global state, flaky timers, or fixtures becoming production dependencies.
- **Stop conditions:** The harness requires network/hardware, mutates app data, adds a global framework, or weakens production types for test convenience.
- **Merge gate:** Repeated deterministic runs, temp-data isolation proof, Lead review, and no production bundle change.
- **What later PRs may assume after merge:** A standard fault/race harness is available, and new Voice PRs do not need bespoke live test machinery.

### VOICE-05 — VoiceTurn lifecycle and cancellation core

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner state-machine reviewer.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>voice/05-voice-turn-controller</code>.
- **Proposed PR title:** <code>feat(voice): add canonical VoiceTurn control</code>.
- **Objective:** Implement the legal Voice session/turn state machines, generation ownership, terminal invariants, cancellation commands, and stale-event rejection in provider-neutral code.
- **Why this PR exists now:** Conversation, playback, transport, and provider work cannot safely correlate or cancel without one authoritative controller.
- **Dependencies:** VOICE-03 and VOICE-04.
- **Likely files/components in scope:** New trusted Voice domain/controller modules, legacy-edge adapter, cancellation ports, state-machine tests, and minimal integration hooks.
- **Files/components explicitly out of scope:** Conversation persistence, durable tasks, provider API, actual media transport, UI restyling, Memory, and changing current default flow.
- **Behavioral changes:** Run the controller with trusted in-process/test inputs and a non-authoritative observation-only legacy shadow; every opened trusted turn terminates; timeout/error/cancel creates an explicit terminal result; current UI remains driven by legacy compatibility.
- **Schema, identifier, or event changes:** First runtime production/emission of canonical Voice session/turn/generation events, including <code>voice.user.transcript.final</code>, for trusted in-process/test producers only; no <code>conversation.turn.finalized</code> and no canonicalization of raw WebSocket frames.
- **Migration and compatibility behavior:** Correlate one legacy wake cycle to shadow IDs for comparison without granting producer authority; keep hidden OpenCode and legacy events; Voice cancel remains separate from OpenCode abort and future durable-task cancel. VOICE-09 is required before the live Python edge may emit authoritative events.
- **Acceptance criteria:** Legal transitions only; one active generation; terminal states reject late data; cancellation is idempotent; a new generation cannot inherit prior events; transcript-final never admits durable work.
- **Automated tests:** Full transition table; property/model tests; cancel in every nonterminal state; duplicate/out-of-order/stale events; timeout; session close; provider error; late SSE/audio; exactly one terminal event.
- **Manual Windows validation:** Observe shadow state alongside a current-path turn under an isolated profile; verify no user-visible regression and no claim of true barge-in.
- **Privacy/security checks:** State payloads contain IDs/outcomes only; inactive/closed sessions cannot upload; no untrusted caller can choose authoritative state.
- **Performance/observability checks:** State transition overhead is bounded; telemetry counts stale drops, terminal outcome, and cancel latency without content.
- **Risks:** Dual-state divergence, old SSE falsely ending a new turn, cancel ambiguity, and accidentally treating transcript-final as conversation authority.
- **Stop conditions:** Two components need to own active state; transition requirements conflict; cancellation cannot be separated from durable tasks; or compatibility requires changing provider behavior.
- **Merge gate:** Exhaustive deterministic state/fault tests, Founder approval, Lead-owned files serialized, legacy rollback smoke, and proof raw legacy frames cannot emit authoritative canonical events.
- **What later PRs may assume after merge:** Canonical Voice session/turn/generation identity, legal lifecycle, stale rejection, and Voice-output cancellation exist.

### VOICE-06 — Canonical Conversation Bridge

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q for idempotency/recovery; Engineer U for projection compatibility.
- **Architecture approver when required:** Founder, including approval of the trusted conversation-store placement.
- **Proposed branch:** <code>voice/06-conversation-bridge</code>.
- **Proposed PR title:** <code>feat(conversation): add canonical voice and text bridge</code>.
- **Objective:** Create the JUNE-owned Conversation Service/Store boundary, persist exactly one accepted user message, emit <code>conversation.turn.finalized</code> after commit, and map OpenCode sessions as adapter metadata.
- **Why this PR exists now:** Voice and typed chat are separate; OpenCode/localStorage cannot remain canonical; Orchestrator admission later requires authenticated persisted finality.
- **Dependencies:** VOICE-03 and VOICE-05.
- **Likely files/components in scope:** New trusted Conversation Service/Store and OpenCode adapter modules, canonical projectors near <code>ConnectionContext</code>/<code>SessionsContext</code>, persistence/recovery tests, and minimal preload contract.
- **Files/components explicitly out of scope:** Full UI presentation, Code/CAD rail redesign, Orchestrator execution, Memory writes, Telegram, full export/deletion, provider media, and OpenCode submodule edits.
- **Behavioral changes:** Trusted typed and deterministic fake inputs can shadow-write through one idempotent canonical commit. Real legacy Voice frames remain display-only and non-authoritative until VOICE-09 authenticates and binds the Python edge; the visible renderer may still use its compatibility projection until VOICE-07.
- **Schema, identifier, or event changes:** Add canonical conversation/message records and make this service the sole emitter of <code>conversation.turn.finalized</code>.
- **Migration and compatibility behavior:** Keep existing OpenCode session IDs as projection metadata; preserve current chat/code/cad rails; do not delete hidden Voice sessions until shared-path proof; use a separate trusted encrypted ConversationStore rather than Memory or <code>june_runtime.db</code>; and enable live Voice commits only after VOICE-09 proves authenticated producer binding.
- **Acceptance criteria:** Commit succeeds before event emission; duplicate transcript/final events create one message/event; crash between write and publish recovers safely; typed/Voice messages share one conversation ID; provider reconnect does not erase canonical history.
- **Automated tests:** Transaction/finality ordering; idempotency; crash/restart; duplicate/out-of-order events; authentication/privacy rejection; OpenCode mapping/reconciliation; renderer projection parity; no admission on partial or transcript-final alone.
- **Manual Windows validation:** Restart the app using an isolated encrypted test profile and verify the same canonical conversation reappears; do not inspect or migrate real conversations.
- **Privacy/security checks:** Trusted-process persistence only; encryption/key failure is fail-closed; renderer/provider cannot emit finalized events; content never enters ordinary logs; temporary/private modes honor retention policy.
- **Performance/observability checks:** Measure commit-to-event and projection latency with synthetic content; record only IDs, sizes, outcomes, and timings.
- **Risks:** Choosing an unapproved store, duplicating messages, visual/model-context divergence, migration loss, or making OpenCode canonical by accident.
- **Stop conditions:** A compliant encrypted store placement is not agreed; persistence cannot be atomic/idempotent; schema would alter Memory/runtime DB authority; existing rails require broad rewrite; or ConversationStore, OpenCode mapping, preload, and renderer projection cannot be reviewed as one bounded change—in that case split storage/finality from compatibility projection without weakening the trust gate.
- **Merge gate:** Founder storage/finality approval, restart/crash tests, two human reviews, encrypted temp-store proof, unchanged specialist rails, and proof that unauthenticated live legacy frames create no canonical row/event.
- **What later PRs may assume after merge:** JUNE owns canonical conversation finality and can project OpenCode/Voice without using provider IDs as truth.

### VOICE-07 — Shared Voice/text conversation UI

- **Primary owner:** Engineer U.
- **Human reviewer:** Engineer L; Engineer Q reviews state/error tests.
- **Architecture approver when required:** Engineer L; Founder only for user-facing privacy/finality semantics.
- **Proposed branch:** <code>voice/07-shared-conversation-ui</code>.
- **Proposed PR title:** <code>feat(ui): show voice in the canonical conversation</code>.
- **Objective:** Render provisional speech, accepted user messages, assistant output, interruption state, and compatibility tool activity in the existing visible conversation.
- **Why this PR exists now:** Canonical state is not useful if Voice remains hidden; this is a bounded UI consumer after the Conversation Bridge.
- **Dependencies:** VOICE-06; mock-only preparation may start after VOICE-03.
- **Likely files/components in scope:** New <code>ConversationContext</code>/projection consumer, <code>ChatSurface</code> and focused transcript/message components, renderer tests, and accessibility labels.
- **Files/components explicitly out of scope:** Trusted persistence, event authority, OpenCode HTTP behavior, permission decisions, audio capture/playback, CSS redesign, and provider integration.
- **Behavioral changes:** Stable partial transcript appears as provisional UI only; accepted final appears once as a normal user message; assistant text uses the same conversation; legacy Voice remains fallback. Before VOICE-09, Voice projection is fake/test-only and live legacy frames remain on the explicitly noncanonical compatibility display.
- **Schema, identifier, or event changes:** None; UI consumes VOICE-03/VOICE-06 contracts and cannot author canonical events.
- **Migration and compatibility behavior:** Reuse existing <code>UiMessage</code>/<code>ChatSurface</code> through a projector; preserve Code/CAD/project chats and old history display.
- **Acceptance criteria:** No duplicate final message; provisional text is visually distinct and never persisted by UI; mixed typed/Voice ordering is stable; interrupted/failed states are honest; reload recovers canonical display.
- **Automated tests:** Partial-to-final replacement; duplicate/reordered events; typed/Voice interleave; reload; error/cancel/interrupted rendering; keyboard/screen-reader behavior; existing chat snapshots.
- **Manual Windows validation:** Use the deterministic fake feed in the packaged/dev UI; validate scaling, keyboard navigation, screen reader names, and no real mic/provider requirement.
- **Privacy/security checks:** UI receives only authorized projection; no raw audio/key; private/temporary turns do not leak through localStorage; no content in console logs.
- **Performance/observability checks:** Long synthetic conversations remain responsive; rendering does not block media/control events; UI state timing is content-free.
- **Risks:** Duplicate visual messages, provisional text becoming durable, regressions in specialist rails, and beginner edits crossing into authority code.
- **Stop conditions:** Stable projection interface is unavailable; work requires edits to persistence/IPC/security; or a broad chat redesign is proposed.
- **Merge gate:** Lead confirms read-only consumer boundary, renderer tests and accessibility checks pass, and branch is rebased onto final VOICE-06.
- **What later PRs may assume after merge:** Voice and text can be presented in one canonical conversation without making renderer state authoritative.

### VOICE-08 — Single-owner background runtime

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and Engineer U.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>voice/08-background-runtime</code>.
- **Proposed PR title:** <code>feat(platform): add a single-owner background runtime</code>.
- **Objective:** Establish one profile-scoped trusted runtime owner that survives window close, owns Voice/conversation/task modules, and shuts down only through explicit Quit.
- **Why this PR exists now:** Realtime sessions, durable tasks, renderer reload, and scheduler coordination cannot rely on the visible window process lifecycle.
- **Dependencies:** VOICE-03 and VOICE-05; integrate with VOICE-06 before Phase 1 closes.
- **Likely files/components in scope:** <code>phase3-ui/src/main/index.ts</code>, new runtime/lease modules, <code>services.ts</code>, <code>supervisor.ts</code>, minimal Tray/Show/Quit wiring, <code>phase3-ui/src/shared/voiceConsentCopy.ts</code>, the minimum native/Settings/tray privacy projection and tests, and scheduler ownership tests without scheduler diagnosis.
- **Files/components explicitly out of scope:** Fixing current task-poller failures, changing PIM semantics, Orchestrator DB, OpenAI, autostart/update packaging, and new external daemons.
- **Behavioral changes:** Behind one atomic feature gate, window close hides to tray only after founder-approved consent copy and a persistent truthful tray indicator explain background microphone/cloud state; explicit Quit performs ordered Voice/media/state/service shutdown; a second profile owner is refused or activates the existing instance. If the copy/indicator is unavailable, close-to-tray remains disabled and close still quits.
- **Schema, identifier, or event changes:** Runtime-owner/lease status uses VOICE-03 envelopes where externally observed; no business event changes.
- **Migration and compatibility behavior:** Electron main is the initial JUNE 0.1 background host with modular service boundaries; current Supervisor and scheduler are adopted by exactly one owner, not duplicated.
- **Acceptance criteria:** One owner per profile; renderer can close/reopen without losing VoiceTurn/conversation truth; shared consent copy no longer promises "no background service" when the feature is active; tray always exposes actual local/cloud/stuck state and explicit Quit; explicit Quit drains and stops; crash leaves recoverable lease; scheduler never has two timers/pollers.
- **Automated tests:** Lease contention/stale lease; second-instance activation; close/reopen; ordered quit; process kill/restart; scheduler single-owner; adopted-service handling; temp-profile isolation.
- **Manual Windows validation:** Close/reopen through tray, invoke explicit Quit, validate one process owner and mic/cloud indicators, and confirm no task-poller diagnosis claim.
- **Privacy/security checks:** Lease/profile paths are trusted and ACL-scoped; new workers receive allowlisted environment only; close-to-tray has a persistent visible mic/cloud indicator.
- **Performance/observability checks:** Startup/reopen/quit timings and lease failures are content-free; background idle cost is measured; no duplicate polling.
- **Risks:** Invisible background microphone, duplicate scheduler, stale lease lockout, shutdown data loss, and broad <code>index.ts</code> conflicts.
- **Stop conditions:** One-owner proof fails; background activation, truthful consent copy, persistent privacy indication, and explicit Quit cannot land atomically; tray cannot surface active privacy state; implementation requires a second scheduler; or unrelated poller repair enters scope.
- **Merge gate:** Founder lifecycle and exact-copy approval, two human reviews, isolated process/lease/copy tests, real Windows tray/quit/privacy evidence, close-to-tray feature-gated atomically, and VOICE-01 kill guarantees retained.
- **What later PRs may assume after merge:** A single trusted runtime owner survives renderer/window churn and coordinates safe shutdown.

### VOICE-09 — Authenticated local Voice control

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner security reviewer.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>voice/09-secure-local-control</code>.
- **Proposed PR title:** <code>feat(platform): authenticate local voice control</code>.
- **Objective:** Create an authenticated local Voice control transport with typed roles/messages, sequencing, replay rejection, bounded payloads, and explicit lifecycle, and use it as the first trusted binding for live legacy transcript finality.
- **Why this PR exists now:** The loopback side channel accepts any local producer and cannot safely carry cancellation, privacy, provider, approval, or playback authority.
- **Dependencies:** VOICE-06 and VOICE-08, using VOICE-03 contracts.
- **Likely files/components in scope:** New trusted local-control server/client modules, Windows named-pipe or equivalent transport, Electron IPC/preload allowlist, Python edge client, role/handshake/sequence validators, and security tests.
- **Files/components explicitly out of scope:** OpenAI credentials/media, capability execution, general OpenCode auth migration, broad side-channel rewrite, and internet-facing APIs.
- **Behavioral changes:** Live canonical transcript/finality input and every new protected command use the secure channel. The legacy WebSocket remains non-authoritative compatibility transport for existing wake/orb and TTS display/playback consumers until VOICE-10/11 migrate them; it cannot persist a canonical turn, cancel, approve, start cloud audio, or change privacy.
- **Schema, identifier, or event changes:** Add versioned control request/ack/error frames that carry validated <code>june.event.v1</code> references, producer identity, sequence, and session lease.
- **Migration and compatibility behavior:** Dual-publish only non-secret compatibility display/media signals while consumers migrate in VOICE-10/11; label those consumers explicitly in the inventory. The secure channel is authoritative for canonical/control state at merge, and becomes the sole local Voice control transport only after those downstream migrations pass the Phase 1 gate.
- **Acceptance criteria:** Unauthenticated/wrong-role/replayed/out-of-order/oversized/malformed peers are rejected; raw or translated legacy frames create no canonical row/event; an authenticated Python transcript creates exactly one; disconnect revokes the lease; renderer sender/frame is validated; one command yields one idempotent result.
- **Automated tests:** Handshake/auth, ACL/role matrix, sequence wrap/replay, stale lease, reconnect, malformed schema, payload cap, rate limit, renderer sender validation, worker kill, and fallback telemetry.
- **Manual Windows validation:** Validate the selected local transport under a standard user account with an isolated profile; attempt a second untrusted local client and confirm denial without exposing secrets.
- **Privacy/security checks:** Per-run secret never enters args/logs/renderer; pipe/socket ACL is user-scoped; permanent credentials are prohibited; new workers receive explicit environment allowlists.
- **Performance/observability checks:** Measure local command/ack latency and reconnect time; log only role, outcome, byte count, sequence gap, and timing.
- **Risks:** False trust in loopback, token leakage, replay after restart, deadlock during shutdown, and side-channel authority accidentally surviving.
- **Stop conditions:** OS/user ACL cannot be verified; authentication secret would cross renderer or logs; protocol needs unbounded messages; or a consumer requires legacy WebSocket authority.
- **Merge gate:** Threat-model review, two human reviews, deterministic adversarial tests, Windows ACL evidence, live-finality authentication proof, and an explicit inventory/retirement owner for each remaining non-authoritative legacy wake/playback/display consumer.
- **What later PRs may assume after merge:** Canonical local Voice control/finality is authenticated, replay-resistant, and typed; legacy display/media behavior still exists but has no canonical or protected authority until VOICE-10/11 remove those consumers.

### VOICE-10 — Single-owner local audio edge

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U checks orb-level behavior.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>voice/10-audio-owner-handoff</code>.
- **Proposed PR title:** <code>feat(voice): enforce one microphone owner</code>.
- **Objective:** Make one trusted audio edge own the microphone at a time, eliminate the renderer's metering-only microphone, and define an authenticated lease/handoff for future WebRTC activation.
- **Why this PR exists now:** Current Python capture and renderer <code>getUserMedia</code> can own two streams, violating the approved single-owner invariant.
- **Dependencies:** VOICE-09.
- **Likely files/components in scope:** <code>wake_daemon.py</code>, a bounded AudioEdge/lease adapter, <code>orbAdapter.ts</code>, preload/control messages, device-level telemetry, and audio-ownership tests.
- **Files/components explicitly out of scope:** New wake model, final VAD/AEC choice, OpenAI/WebRTC, production tuning, TTS redesign, and unrelated audio dependencies.
- **Behavioral changes:** Python remains the sole current-path capture owner and sends privacy-safe level/activity metadata; renderer no longer opens a second mic; acquire/release/handoff is explicit and fail-closed.
- **Schema, identifier, or event changes:** Add authenticated audio-owner lease and aggregate level/device-state events correlated to <code>voice_session_id</code>; never carry raw pre-activation audio to the renderer.
- **Migration and compatibility behavior:** Current wake/STT path stays default; future media host can request the lease only after accepted activation and must return it before local arming resumes.
- **Acceptance criteria:** Instrumented tests and Windows evidence show no overlapping mic owners; off/quit revokes lease; owner crash returns to safe closed/recovery state; orb metering works without <code>getUserMedia</code>.
- **Automated tests:** Lease contention, pending acquire cancellation, owner death, stale release, disable/quit race, renderer reload, level bounds/rate, no raw frames, and legacy wake regression.
- **Manual Windows validation:** Observe OS mic handles during local arm, wake turn, renderer reload, Voice-off, sleep/resume, and a simulated future handoff; do not claim unsupported devices.
- **Privacy/security checks:** Pre-activation audio stays local; level events are aggregate and rate-limited; no silent device fallback; missing lease/auth/consent means no capture.
- **Performance/observability checks:** Measure handoff gap, level-update overhead, first-frame timing, and device recovery without content; establish a tuning baseline for VOICE-30.
- **Risks:** Clipped speech during handoff, audio-device contention, metering regression, worker crash loop, and accidental raw-audio IPC.
- **Stop conditions:** Two handles overlap; handoff requires an unapproved native dependency; pre-roll would need logging/persistence; or the UI cannot indicate the actual owner/state.
- **Merge gate:** Single-owner proof, real Windows device evidence, deterministic lease/race tests, Founder approval, and current wake path rollback.
- **What later PRs may assume after merge:** One authenticated audio lease controls capture and UI can visualize levels without opening another microphone.

### VOICE-11 — Generation-safe playback and heard accounting

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U reviews presentation callbacks.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>voice/11-generation-playback</code>.
- **Proposed PR title:** <code>feat(voice): make playback generation-safe</code>.
- **Objective:** Key synthesis/playback resources by <code>generation_id</code>, reject stale audio, stop immediately, and record trusted playback progress/heard duration.
- **Why this PR exists now:** The fixed WAV and uncancelled synthesis thread can overwrite/play stale output, while renderer arrival order cannot identify an old generation.
- **Dependencies:** VOICE-05, VOICE-09, and VOICE-10.
- **Likely files/components in scope:** <code>nightjar_capabilities/voice.py</code>, legacy synthesis adapter in <code>wake_daemon.py</code>, trusted PlaybackController, preload/media adapter, <code>orbAdapter.ts</code>, and playback fault tests.
- **Files/components explicitly out of scope:** Realtime provider audio, final AEC, visual redesign, durable task cancellation, voice selection/naturalness work, and wake model.
- **Behavioral changes:** Unique atomic temporary audio per generation; active controller authorizes play/stop; cancellation invalidates pending synthesis/load; acknowledgements report started/progress/ended/error.
- **Schema, identifier, or event changes:** Add generation-scoped playback commands/events and heard-duration/spoken-prefix metadata; local renderer token is no longer authority.
- **Migration and compatibility behavior:** Kokoro/full-WAV remains the legacy fallback, but uses unique resources and secure control; legacy <code>tts ready</code> can remain display-only until cut-over.
- **Acceptance criteria:** Timed-out old synthesis cannot overwrite, load, play, or end a newer generation; stop reaches silence within the test budget; cleanup is bounded; heard progress never exceeds played media.
- **Automated tests:** Concurrent synthesis, timeout, worker exception, atomic publish, stale/duplicate/out-of-order commands, stop races, renderer reload, progress monotonicity, cleanup, and current TTS regression.
- **Manual Windows validation:** Exercise rapid consecutive turns, stop during load/play, renderer reload, output-device change, and inspect temporary cleanup using isolated synthetic speech.
- **Privacy/security checks:** Audio resources are protected, bounded, and deleted; paths do not cross untrusted messages; captions/text are not logged; forged legacy frames cannot play audio.
- **Performance/observability checks:** Record synth latency, first-play latency, cancel-to-silence, underrun/error, cleanup, and heard duration with IDs/outcomes only.
- **Risks:** Early sample loss, inaccurate heard accounting, leaked files, double playback, and new latency through control acknowledgements.
- **Stop conditions:** Stale generation can produce sound; progress cannot be tied to actual playback; file permissions/cleanup fail; or change requires Realtime-specific assumptions.
- **Merge gate:** Race/fault suite, two reviews, real Windows playback/stop evidence, no stale-audio occurrence, and legacy rollback.
- **What later PRs may assume after merge:** Playback ownership and heard accounting are provider-neutral, generation-scoped, and immediately cancellable.

### VOICE-12 — Background Voice privacy UI

- **Primary owner:** Engineer U.
- **Human reviewer:** Engineer L; Engineer Q reviews failure-state tests.
- **Architecture approver when required:** Founder for consent/privacy copy.
- **Proposed branch:** <code>voice/12-background-privacy-ui</code>.
- **Proposed PR title:** <code>feat(ui): show background voice privacy state</code>.
- **Objective:** Make mic, cloud-upload, follow-up, background, failure, and explicit-Quit states visible and accessible without giving the renderer authority.
- **Why this PR exists now:** VOICE-08 already lands the minimum truthful consent copy, tray indication, and Quit behavior atomically; this PR enriches the renderer with the complete accessible state model after VOICE-09 supplies trusted detail.
- **Dependencies:** VOICE-08 and VOICE-09; mock-only preparation may start after VOICE-03.
- **Likely files/components in scope:** Settings/orb/status components, refinements to the founder-approved shared consent/privacy copy, tray-status projection consumption, accessibility tests, and renderer-only helpers.
- **Files/components explicitly out of scope:** Runtime lease, Tray command authority, main-process privacy decisions, audio ownership, provider credentials, and general visual redesign.
- **Behavioral changes:** UI distinguishes local armed, cloud active, muted, follow-up, background, failed, and stuck states; offers Show, mute/disable, and explicit Quit through trusted commands.
- **Schema, identifier, or event changes:** None; consume typed status snapshots/events and never create them.
- **Migration and compatibility behavior:** Preserve existing one-click off and Settings consent; update copy only when background behavior is live, not on a preparation branch.
- **Acceptance criteria:** Every privacy state has distinct text/icon/accessible name; no false "off"; window close messaging is clear; stale status cannot overwrite a newer sequence; controls handle denial/failure.
- **Automated tests:** State matrix, out-of-order snapshots, click/keyboard behavior, screen-reader labels, high-contrast/reduced-motion, close-to-tray copy, stuck-mic and cloud-failure presentation.
- **Manual Windows validation:** Validate tray/window transitions, keyboard-only operation, scaling, notifications, screen reader, and visible mic/cloud truth with an isolated profile.
- **Privacy/security checks:** Renderer cannot forge state or bypass consent; no key/transcript in UI logs; unknown state renders conservative/closed.
- **Performance/observability checks:** Status updates remain responsive under synthetic event bursts; no animation blocks control; UI records content-free interaction failures only.
- **Risks:** Misleading icons, accidental enable affordance, stale status, or U crossing into main/security files.
- **Stop conditions:** Trusted status API is unstable; implementation requires authority-file edits by U; consent meaning changes; or copy cannot state background behavior honestly.
- **Merge gate:** Lead boundary review, Founder copy approval, accessibility/state tests, rebase onto final VOICE-08/09, and Windows UI evidence.
- **What later PRs may assume after merge:** Users can see and control truthful background Voice privacy state through a read-only UI projection.

### VOICE-13 — Deterministic Orchestrator foundation contracts

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner architecture reviewer.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>orchestrator/01-foundation-contracts</code>.
- **Proposed PR title:** <code>feat(orchestrator): add deterministic foundation contracts</code>.
- **Objective:** Add JUNE-owned Task, ActionContract, ActionProposal, ActionResult, capability, approval, budget, checkpoint, and cancellation contracts without routing live requests yet.
- **Why this PR exists now:** OpenAI Voice cannot safely expose <code>june_delegate</code> to today's direct MCP/OpenCode tools.
- **Dependencies:** Complete Phase 1 gate.
- **Likely files/components in scope:** New trusted Orchestrator domain contracts and ports, canonical schemas/enums, fake ports, and transition/contract tests.
- **Files/components explicitly out of scope:** Database, live capability calls, policy decisions, provider integration, scheduler repair, Memory, and global workflow frameworks.
- **Behavioral changes:** None for users; existing search/research/PIM/OpenCode flows remain unchanged while contracts are dark.
- **Schema, identifier, or event changes:** Introduce task/action/capability IDs and exact <code>operation_kind</code>, <code>execution_mode</code>, <code>risk_tier</code>, retry, permission, verification, and cancellation domains.
- **Migration and compatibility behavior:** VOICE-14 will put current request handling behind the façade; this contract PR neither reroutes nor enables any MCP tool.
- **Acceptance criteria:** Invalid/unknown enum/schema/transition fails closed; Voice cancel, provider abort, and durable-task cancel are distinct; model hints cannot populate authoritative risk/permission.
- **Automated tests:** Schema goldens; transition tables; enum rejection; proposal/result identity; cancellation separation; immutable approval binding; no admission source yet.
- **Manual Windows validation:** Typecheck/build with an isolated profile; no service, microphone, database, or capability execution is required.
- **Privacy/security checks:** Contracts label privacy/actor/authority and prohibit secrets/raw prompts; external content is data, not authority.
- **Performance/observability checks:** Serialization/validation is bounded; task events use canonical clocks correctly.
- **Risks:** Recreating a workflow framework, ambiguous action/result semantics, or collapsing classification dimensions.
- **Stop conditions:** A third-party workflow engine becomes necessary; PR #172 terms are changed; or contracts cannot represent unknown outcomes/cancellation separately.
- **Merge gate:** Founder contract approval, two reviews, exhaustive schema/transition tests, and zero live behavior.
- **What later PRs may assume after merge:** One deterministic Orchestrator domain vocabulary and façade port exist for all Phase 2 work.

### VOICE-14 — Compatibility façade around current request behavior

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U reviews canonical-conversation continuity.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>orchestrator/02-compatibility-facade</code>.
- **Proposed PR title:** <code>feat(orchestrator): route current requests through the facade</code>.
- **Objective:** Put current typed and authenticated-Voice request initiation behind one provider-neutral Orchestrator façade while preserving current outcomes and rollback.
- **Why this PR exists now:** The Master requires the façade around current behavior before the runtime database; contracts alone do not create a migration choke point.
- **Dependencies:** VOICE-13 and the complete Phase 1 gate.
- **Likely files/components in scope:** Root-owned Orchestrator façade/application service, canonical Conversation consumer, compatibility <code>OpenCodeAdapter</code>, main/preload request routing, explicit legacy-capability inventory, and parity/rollback tests.
- **Files/components explicitly out of scope:** Runtime DB, trusted classification, policy decisions, Action Gateway, tool-permission changes, capability rewrites, provider Voice, Memory, and the OpenCode submodule.
- **Behavioral changes:** Feature-gated requests traverse the façade and then the same compatibility adapters; default user-visible behavior, specialist rails, and provider choice remain unchanged.
- **Schema, identifier, or event changes:** Add façade request/result ports using VOICE-13 contracts and canonical causation; no new authority or capability enum.
- **Migration and compatibility behavior:** The old direct entry remains an immediate rollback until parity passes. Direct effects inside compatibility OpenCode/MCP/PIM are inventoried as temporary bypasses and must be default-denied by VOICE-24, then mediated or disabled by VOICE-25/26 before Phase 2 can close.
- **Acceptance criteria:** Typed and authenticated Voice finalized turns reach one façade exactly once; partial/transcript-final cannot enter; OpenCode IDs remain metadata; compatibility results project once; rollback restores the prior route without conversation loss.
- **Automated tests:** Typed/Voice intake, duplicate/replay, specialist-rail routing, adapter timeout/error, renderer reload, OpenCode session remap/reconciliation, feature-flag rollback, and a machine-checked inventory of remaining direct capability/effect paths.
- **Manual Windows validation:** With an isolated profile and only current local services, compare typed and legacy Voice compatibility behavior through both routes; invoke no new capability or private data.
- **Privacy/security checks:** The façade adds no permission; unauthenticated legacy Voice cannot enter; raw prompts/results are absent from operational logs; compatibility adapter environment is recorded for later least-privilege closure.
- **Performance/observability checks:** Measure façade overhead, adapter result parity, duplicate suppression, and rollback latency with content-free metrics.
- **Risks:** Behavior divergence, double dispatch, accidental canonical authority in OpenCode, and presenting a routing wrapper as a security gateway.
- **Stop conditions:** Current request entry points cannot be enumerated; parity requires broad UI/provider rewrite; the façade would authorize effects; or rollback can duplicate a message/action.
- **Merge gate:** Two reviews, Founder migration approval, deterministic parity/finality/rollback tests, a complete signed bypass inventory, and no capability permission change.
- **What later PRs may assume after merge:** Every supported user request starts at one JUNE façade, while explicitly inventoried inner compatibility effects remain noncompliant until VOICE-24.

### VOICE-15 — Encrypted durable runtime store

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner data-security reviewer.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>orchestrator/03-runtime-store</code>.
- **Proposed PR title:** <code>feat(orchestrator): add the encrypted durable runtime store</code>.
- **Objective:** Implement encrypted <code>june_runtime.db</code>, versioned migrations, transactions, task/action/event/checkpoint state, inbox/outbox dedupe, and a single-owner lease.
- **Why this PR exists now:** Durable work, replay safety, recovery, and effect ledgers cannot be truthful in memory or legacy PIM tables.
- **Dependencies:** VOICE-14.
- **Likely files/components in scope:** New runtime repository/migration/key modules, approved SQLCipher/DPAPI integration, isolated test helpers, and dependency/lockfile changes limited to this store.
- **Files/components explicitly out of scope:** <code>june_memory.db</code>, legacy memory/PIM migration, conversation store, capability logic, provider work, backup/sync, and real user databases.
- **Behavioral changes:** Creates/opens the runtime store only when the new façade is exercised in test/dark mode; encryption/key failure disables durable agency.
- **Schema, identifier, or event changes:** Add versioned runtime tables and immutable task/action event records using VOICE-13 contracts.
- **Migration and compatibility behavior:** New store starts empty; no legacy task/PIM copy in this PR; migrations are forward, transactional, restartable, and tested from every version.
- **Acceptance criteria:** Plaintext inspection reveals no records; wrong/missing key fails closed; crash recovery preserves transaction truth; duplicate inbox/outbox events do not duplicate work; one lease owner.
- **Automated tests:** Migration matrix, wrong key, corruption, transaction crash points, WAL/journal settings, concurrent lease, dedupe, outbox replay, rollback, temp-data cleanup, and Windows path behavior.
- **Manual Windows validation:** Use a throwaway profile/database only; verify DPAPI user binding, restart, locked second owner, and no plaintext with approved inspection tools.
- **Privacy/security checks:** Key never logs or enters renderer/env/CLI; ACL restricts files; tests use random temp keys; no real profile/database access.
- **Performance/observability checks:** Measure open/migration/transaction/checkpoint latency and file growth with synthetic rows; log versions/outcomes only.
- **Risks:** Data loss, plaintext fallback, native dependency/packaging failure, lock deadlock, and coupling to Memory.
- **Stop conditions:** SQLCipher/DPAPI cannot be packaged safely; encryption silently falls back; migration is destructive/non-transactional; or scope touches existing user stores.
- **Merge gate:** Security review, two human reviews, isolated Windows packaging/migration evidence, crash/fault suite, and documented recovery/rollback.
- **What later PRs may assume after merge:** A secure, leased, transactional runtime store exists independently of Conversation and Memory stores.

### VOICE-16 — Trusted Capability Registry

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner authority/security reviewer.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>orchestrator/04-capability-registry</code>.
- **Proposed PR title:** <code>feat(orchestrator): add the trusted Capability Registry</code>.
- **Objective:** Define static trusted manifests, schemas, side effects, execution/risk/permission/retry/verification metadata, and deterministic fake capabilities.
- **Why this PR exists now:** Model/provider hints and current MCP names cannot be authoritative routing or safety metadata.
- **Dependencies:** VOICE-13 and VOICE-15.
- **Likely files/components in scope:** Registry/manifests/validators, deterministic fake capability adapters representing read/write and turn-scoped/long-running shapes, and registry tests.
- **Files/components explicitly out of scope:** Executing real effects, broad capability catalog migration, UI, provider tools, Memory, and automatic discovery from untrusted MCP metadata.
- **Behavioral changes:** None for existing tools; unknown/unregistered capability requests are rejected by the new dark façade.
- **Schema, identifier, or event changes:** Manifests authoritatively map <code>operation_kind</code>, <code>execution_mode</code>, side effects, <code>risk_tier</code>, permission, retry, and verification.
- **Migration and compatibility behavior:** Wrap current adapters later; manifest IDs are JUNE-owned and OpenCode/MCP tool names remain adapter metadata.
- **Acceptance criteria:** Registry is allowlist-only; invalid/duplicate/version-mismatched manifests fail startup; fake Quick-Search-shaped work is read/turn-scoped; fake Deep-Research-shaped work is read/long-running; writes derive R1-R3 from JUNE policy; no real Phase 5 adapter is registered.
- **Automated tests:** Manifest schema/version, duplicate IDs, unknown operations, input/output validation, hint mismatch/recompute, fake read/write/timeout/unknown-outcome capabilities, and least-privilege environment.
- **Manual Windows validation:** Load signed/bundled manifests from the packaged application with an isolated profile; no real capability is invoked.
- **Privacy/security checks:** No provider/MCP can self-register or lower risk; manifest exposure is least-privilege; fake workers receive allowlisted environment only.
- **Performance/observability checks:** Registry load/lookup and schema validation are bounded; health records contain IDs/versions/outcomes only.
- **Risks:** Treating descriptive MCP metadata as trust, misclassifying writes, registry drift, and exposing excessive capability context.
- **Stop conditions:** A manifest needs dynamic untrusted authority; risk mapping conflicts with PRD; or unknown capability would be allowed by fallback.
- **Merge gate:** Founder reviews initial manifests, adversarial validation passes, and no live capability behavior changes.
- **What later PRs may assume after merge:** Trusted capability identity and authoritative classification metadata exist independently of models/providers.

### VOICE-17 — Deterministic routing and finality admission

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner conversation/finality reviewer.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>orchestrator/05-routing-admission</code>.
- **Proposed PR title:** <code>feat(orchestrator): add deterministic routing and admission</code>.
- **Objective:** Admit only canonical finalized turns or separately authorized triggers, normalize requests, choose trusted capabilities, and reject unsupported/ambiguous proposals.
- **Why this PR exists now:** Durable agency must not originate from partial speech, transcript-final, provider tool calls, or external content.
- **Dependencies:** VOICE-16 and canonical Conversation Bridge VOICE-06.
- **Likely files/components in scope:** Orchestrator intake/router/admission modules, Conversation event consumer, deterministic rules/proposal validator, and finality tests.
- **Files/components explicitly out of scope:** Action execution, approvals UI, LLM planning, provider Voice, Memory writes, scheduler fixes, and broad natural-language routing quality.
- **Behavioral changes:** New façade can shadow-route canonical finalized synthetic turns; existing user paths remain unchanged.
- **Schema, identifier, or event changes:** Add admission decision/rejection events; model <code>operation_kind</code>/<code>execution_mode</code> remain untrusted proposals and are recomputed.
- **Migration and compatibility behavior:** Deterministic fake Quick-Search-shaped and Deep-Research-shaped requests can be classified in shadow mode; no real Phase 5 adapter, durable task, or effect starts.
- **Acceptance criteria:** Partial/transcript-final/external/assistant events admit nothing; finalized event is idempotent; authorized scheduled trigger is explicit; unknown/mismatched capability rejects; no wall-clock-only ordering.
- **Automated tests:** Every admission source; duplicates/replays; causation; wrong user/conversation; stale sequence; model hint disagreement; operation/execution combinations; unsupported request; scheduled trigger authorization.
- **Manual Windows validation:** Use synthetic canonical events in an isolated profile and inspect shadow decisions; invoke no real capability.
- **Privacy/security checks:** Prompt/external content cannot author authority fields; only trusted Registry metadata enters decisions; rejection logs contain no request text.
- **Performance/observability checks:** Measure deterministic route/admission latency, rejection reasons, and queue depth without content.
- **Risks:** Duplicate durable work, transcript-final confusion, overly permissive fallbacks, and hidden LLM authority.
- **Stop conditions:** Any path admits before persisted finality; model output is required to determine risk/permission; or scheduled triggers bypass authentication.
- **Merge gate:** Founder finality review, exhaustive source/replay tests, shadow-only behavior, and proof that no capability executes.
- **What later PRs may assume after merge:** Only authenticated canonical authority can enter deterministic Orchestrator admission.

### VOICE-18 — Typed model routing and constrained plan validation

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner planning/security reviewer.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>orchestrator/06-model-route-plan-validator</code>.
- **Proposed PR title:** <code>feat(orchestrator): validate model routes and plans</code>.
- **Objective:** Add the required hybrid route: deterministic rules first, then a typed model proposal and constrained plan that JUNE validates against trusted manifests and policy-independent invariants.
- **Why this PR exists now:** The Master requires hybrid routing and plan validation; deterministic routing alone cannot be called the complete Phase 2 foundation.
- **Dependencies:** VOICE-16 and VOICE-17.
- **Likely files/components in scope:** Provider-neutral <code>ModelRouter</code> port, typed proposal/plan schemas, Plan Validator, deterministic fake planner, optional shadow compatibility adapter, JUNE-OrchBench fixtures, and adversarial tests.
- **Files/components explicitly out of scope:** OpenAI Realtime, live capability execution, policy approval, Action Gateway, free-form autonomous planning, dynamic tool discovery, real Phase 5 adapters, and model training.
- **Behavioral changes:** In dark/shadow mode, deterministic routing may request a bounded typed proposal for ambiguous cases; invalid, low-confidence, unsupported, or unavailable model output rejects or asks for clarification and never executes.
- **Schema, identifier, or event changes:** Add untrusted route-proposal and constrained-plan schemas plus validation/rejection reasons; authoritative operation kind, execution mode, risk, permission, retry, and verification remain Registry/Orchestrator results.
- **Migration and compatibility behavior:** Deterministic rules remain the fallback and authority. The fake planner is the merge gate; any optional existing-model shadow adapter cannot alter user-visible routing or create durable work.
- **Acceptance criteria:** Unknown fields/steps/capabilities reject; plan references only allowed manifest IDs and bounded steps; model cannot lower or author authority fields; deterministic cases bypass the model; JUNE-OrchBench baseline and regression thresholds are recorded.
- **Automated tests:** Typed decode, prompt-injection output, hallucinated capability, enum/risk mutation, cyclic/oversized plan, dependency ordering, ambiguity/clarification, model timeout/error, deterministic fallback, fixed-seed fake, and benchmark goldens.
- **Manual Windows validation:** Run the deterministic/fake benchmark in an isolated profile; an optional approved shadow model check may inspect only synthetic objectives and performs no capability or network effect beyond that explicit test.
- **Privacy/security checks:** Minimal objective/context leaves JUNE; external content remains quoted data; secrets/personal memory are excluded; model output has no execution handle or authoritative fields.
- **Performance/observability checks:** Bound router deadline, token/context budget, plan size, validation latency, fallback rate, and benchmark accuracy with content-free reason codes.
- **Risks:** Model output becoming authority, hidden free-form agent behavior, prompt injection, nondeterministic tests, and routing latency.
- **Stop conditions:** Trusted classification depends on model prose; validator cannot fully enumerate accepted schema; benchmark requires private data; or the proposal can bypass deterministic admission.
- **Merge gate:** Founder architecture review, two human reviews, deterministic fake/adversarial suite, JUNE-OrchBench baseline, shadow-only rollout, and zero capability execution.
- **What later PRs may assume after merge:** Hybrid routing can accept only a typed, constrained, untrusted proposal that deterministic JUNE validation may reject or recompute.

### VOICE-19 — Policy, consent, and approval binding

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U reviews the consumer contract.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>orchestrator/07-policy-consent</code>.
- **Proposed PR title:** <code>feat(orchestrator): enforce policy, consent, and approval binding</code>.
- **Objective:** Derive R0-R3 policy decisions, apply feature/task/action consent, bind approvals to exact proposals, and invalidate them when material arguments change.
- **Why this PR exists now:** Registry classification alone does not authorize execution, and current OpenCode permission asks are not JUNE policy.
- **Dependencies:** VOICE-15 through VOICE-18.
- **Likely files/components in scope:** Policy/Consent/Approval services, grant repository, proposal fingerprinting, expiry/revocation, facade integration, and adversarial tests.
- **Files/components explicitly out of scope:** Action execution, UI presentation, provider prompts, credential brokering, Memory, and redesigning current mic consent.
- **Behavioral changes:** New dark Orchestrator returns allow/ask/deny with reasons; no current capability execution changes.
- **Schema, identifier, or event changes:** Add permission requirement, consent grant, approval request/decision/revocation, proposal binding, actor, expiry, and policy-decision events.
- **Migration and compatibility behavior:** Existing mic consent remains authoritative for capture; OpenCode permissions remain adapter-local and cannot substitute for JUNE approval.
- **Acceptance criteria:** R2/R3 cannot proceed without exact active approval; changed amount/recipient/path/body/scope invalidates approval; feature consent is required for R0 features where specified; Memory cannot grant authority.
- **Automated tests:** Risk matrix, consent absence/corruption, grant scope/expiry/revoke, proposal mutation, replay, wrong actor/task, once/always semantics, policy version change, and model-supplied risk attack.
- **Manual Windows validation:** Use an isolated profile and synthetic proposals to verify persistence/restart/revocation; execute no external effect.
- **Privacy/security checks:** Approval UI receives the minimum preview; secrets are redacted; deny/unknown fails closed; audit records IDs/decision metadata, not hidden content.
- **Performance/observability checks:** Policy decision latency and cache behavior are bounded; every decision has a content-free reason code/version.
- **Risks:** Stale approvals, ambiguous material-change rules, overbroad grants, and confusing OpenCode permission with JUNE consent.
- **Stop conditions:** Exact effect cannot be previewed/bound; unknown risk defaults below R3/deny; key material must enter proposal records; or current mic consent would be weakened.
- **Merge gate:** Security/founder review, mutation/replay tests, encrypted temp-store proof, and no Action Gateway call.
- **What later PRs may assume after merge:** Every admitted operation receives a trusted, auditable policy/consent/approval decision bound to exact effects.

### VOICE-20 — Action Gateway and ledger

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner effects/security reviewer.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>orchestrator/08-action-gateway</code>.
- **Proposed PR title:** <code>feat(orchestrator): add the Action Gateway and ledger</code>.
- **Objective:** Make one write-ahead gateway the sole path for effect-bearing operations, with attempts, idempotency, receipts, retry class, verification, reconciliation, and unknown outcomes.
- **Why this PR exists now:** <code>june_delegate</code> must never expose direct MCP/OpenCode side effects, and retries cannot guess whether an effect occurred.
- **Dependencies:** VOICE-15 through VOICE-19.
- **Likely files/components in scope:** ActionGateway, ledger/repository, adapter/verification ports, fake effect capabilities, reconciliation state, and fault tests.
- **Files/components explicitly out of scope:** Broad real capability migration, production external writes, UI, provider Voice, computer use, and scheduler delivery.
- **Behavioral changes:** Only fake/test operations pass through the new gateway initially; current tools remain compatibility paths and are not advertised to new delegation.
- **Schema, identifier, or event changes:** Add PREPARED/STARTED/SUCCEEDED/FAILED/UNKNOWN/VERIFIED/RECONCILED attempt records, receipts, idempotency key, and verification result.
- **Migration and compatibility behavior:** Capability adapters are wrapped one at a time later; no direct legacy path is claimed safe merely because the gateway exists.
- **Acceptance criteria:** Write-ahead record precedes call; duplicate/retry does not duplicate idempotent effect; unknown non-idempotent outcome is not blindly retried; receipt and verifier attach to exact action.
- **Automated tests:** Crash at every boundary; timeout before/after effect; duplicate delivery; lost response; adapter exception; idempotency collision; receipt mismatch; verification failure; reconciliation; cancellation race.
- **Manual Windows validation:** Run fake file/notification-style effects in a temporary sandbox only; kill the process at controlled points and inspect ledger recovery.
- **Privacy/security checks:** Least-privilege adapter input/env; no model/provider direct gateway handle; sensitive parameters encrypted/redacted; denied/unapproved action never reaches adapter.
- **Performance/observability checks:** Gateway overhead, attempt latency, retry/unknown counts, and verification timing are measured with IDs/outcomes only.
- **Risks:** Duplicate effects, false success, unsafe retry, ledger/effect split-brain, and adapter bypass.
- **Stop conditions:** An effect cannot provide idempotency or reconciliation policy; any path bypasses PREPARED; unknown outcome is treated as failure/success without proof; or a real external mutation enters scope.
- **Merge gate:** Two human reviews, Founder security approval, exhaustive process-kill/fault tests, fake-only rollout, and bypass search.
- **What later PRs may assume after merge:** Registered fake effects have one durable, verifiable, retry-aware gateway and ledger; VOICE-24 through VOICE-26 must still prove that no active compatibility effect can bypass it.

### VOICE-21 — Durable execution recovery engine

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner data/recovery reviewer.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>orchestrator/09-task-recovery</code>.
- **Proposed PR title:** <code>feat(orchestrator): recover durable execution</code>.
- **Objective:** Add durable worker/queue ownership, checkpoints, bounded retry/backoff, crash recovery, outbox recovery, and reconciliation for deterministic fake work.
- **Why this PR exists now:** A durable task ID is not truthful until execution survives owner death and uncertain outcomes without duplicating effects.
- **Dependencies:** VOICE-15 and VOICE-20.
- **Likely files/components in scope:** Recovery engine, worker lease/queue runner, checkpoint/reconciliation/outbox modules, runtime integration, fake long-running capability, and process-kill tests.
- **Files/components explicitly out of scope:** Pause/resume/user cancellation, task budgets/deadlines, progress/delivery UI, PIM poller repair, real Deep Research, Telegram, cloud workers, and provider Voice.
- **Behavioral changes:** Fake durable execution can resume or reconcile through the single background owner; existing scheduler/research behavior remains unchanged.
- **Schema, identifier, or event changes:** Add recovery attempt, worker lease, checkpoint, retry, reconciliation, and unknown-outcome records/events; no user task-control commands.
- **Migration and compatibility behavior:** Current synchronous Deep Research stays available; no reminder is copied; recovery owns only new fake tasks and coexists with the frozen scheduler.
- **Acceptance criteria:** Process kill resumes or reconciles exactly once; stale workers cannot commit; retry follows the trusted manifest class; outbox recovery is atomic; unknown non-idempotent outcomes are not blindly retried; terminal recovery truth is durable.
- **Automated tests:** Queue lease, crash before/after checkpoint and effect, stale worker, bounded backoff, duplicate wakeup, lost response, outbox recovery, unknown outcome, renderer absence, DB restart, and long fake run.
- **Manual Windows validation:** Execute only fake work in a temporary profile; kill/restart the owner at declared points and verify one reconciled outcome plus explicit Quit behavior.
- **Privacy/security checks:** Checkpoints contain minimum encrypted state; workers get allowlisted environment/capabilities; recovery cannot weaken Policy or Gateway; no real user task data.
- **Performance/observability checks:** Queue latency, recovery time, checkpoint/outbox cost, retry counts, and reconciliation time are bounded and content-free.
- **Risks:** Duplicate workers, split-brain recovery, lost checkpoint/outbox, unsafe retry, scheduler interference, and database contention.
- **Stop conditions:** Lease exclusivity fails; a process kill duplicates an effect; recovery needs user task-control semantics; scheduler diagnosis enters scope; or unknown outcome is guessed.
- **Merge gate:** Two non-owner reviews, Founder recovery approval, deterministic process-kill suite, Windows isolated recovery evidence, and fake capabilities only.
- **What later PRs may assume after merge:** JUNE can recover and reconcile deterministic fake durable execution without yet exposing pause, resume, cancel, budgets, or user-visible task control.

### VOICE-22 — Task control, budgets, and lifecycle

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner task-control reviewer.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>orchestrator/10-task-control</code>.
- **Proposed PR title:** <code>feat(orchestrator): control task budgets and lifecycle</code>.
- **Objective:** Add finite deadlines/budgets, pause/resume/cancel commands, durable progress/delivery state, and legal task lifecycle transitions on top of the proven recovery engine.
- **Why this PR exists now:** Delegation and approval UI need truthful user control, but task-control semantics are a separate review surface from crash recovery.
- **Dependencies:** VOICE-15 and VOICE-21.
- **Likely files/components in scope:** Task controller, transition validator, budget/deadline enforcement, progress/delivery state, authenticated command port, fake long-running tasks, and lifecycle tests.
- **Files/components explicitly out of scope:** Recovery/checkpoint algorithm changes except a separately justified defect, UI, real Deep Research, PIM/scheduler migration, provider Voice, cloud workers, and capability expansion.
- **Behavioral changes:** Authorized users can pause, resume, or request cancellation of fake tasks; time and resource budgets terminate safely; progress and delivery truth survive restart.
- **Schema, identifier, or event changes:** Add typed task-control commands and pause/resume/cancel/budget/deadline/progress/delivery events; durable-task cancellation stays separate from Voice output and provider abort.
- **Migration and compatibility behavior:** Only new fake tasks use these controls; current synchronous research and scheduler behavior remain unchanged and no current reminder is migrated.
- **Acceptance criteria:** Illegal/stale transitions fail closed; cancel is idempotent and reconciled; pause/resume survives restart; every task has finite enforced limits; terminal/progress/delivery state is durable and monotonic.
- **Automated tests:** Transition matrix, stale/replayed command, pause/restart/resume, cancel races, deadline and each budget exhaustion, progress ordering, delivery retry, renderer absence, and recovery handoff.
- **Manual Windows validation:** Control fake long tasks in a temporary profile across renderer close/reopen and owner restart; verify Voice stop never cancels a task and task cancel never claims immediate Voice silence.
- **Privacy/security checks:** Commands require authenticated user/task binding and current policy; budgets cannot be provider-raised; task payload stays encrypted/redacted; no real external effect.
- **Performance/observability checks:** Measure command acknowledgement, enforcement delay, progress cadence, and budget counters without task content.
- **Risks:** False cancellation, illegal transition, unbounded work, stale UI truth, delivery duplication, and conflation with Voice cancellation.
- **Stop conditions:** Recovery invariants regress; a control cannot be reconciled; finite limits cannot be enforced; a real capability/scheduler redesign enters scope; or cancellation layers are conflated.
- **Merge gate:** Two non-owner reviews, Founder lifecycle approval, exhaustive transition/budget/restart suite, Windows fake-task proof, and no real capability.
- **What later PRs may assume after merge:** JUNE has deterministic, durable, separately addressable task control and finite budgets suitable for fake-only delegation and read-only UI projection.

### VOICE-23 — Approval and durable task progress UI

- **Primary owner:** Engineer U.
- **Human reviewer:** Engineer L; Engineer Q reviews race/error coverage.
- **Architecture approver when required:** Founder for approval wording.
- **Proposed branch:** <code>voice/23-delegation-ui</code>.
- **Proposed PR title:** <code>feat(ui): present approvals and durable task progress</code>.
- **Objective:** Present exact effect previews, allow/deny controls, durable task identity/progress/cancel, receipts, unknown outcomes, and recovery state in the canonical conversation.
- **Why this PR exists now:** Voice delegation is unsafe and confusing without a visible trusted approval/progress surface separate from transient speech.
- **Dependencies:** VOICE-19 and VOICE-22; mock preparation may start after VOICE-13.
- **Likely files/components in scope:** Canonical conversation cards/components, approval/task view models, renderer context consumers, accessibility and race tests.
- **Files/components explicitly out of scope:** Policy decisions, task transitions, gateway calls, database, OpenCode PermissionContext replacement, and provider integration.
- **Behavioral changes:** Users can approve/deny exact proposals and control durable tasks through authenticated commands; UI marks offline/recovering/unknown honestly.
- **Schema, identifier, or event changes:** None; consume trusted proposal/task/result events and send typed commands.
- **Migration and compatibility behavior:** Existing OpenCode permission panel remains for compatibility sessions and is visually distinguished from JUNE action approval.
- **Acceptance criteria:** Changed proposal forces a new approval; stale click cannot approve; task cancel does not imply Voice silence and Voice stop does not imply task cancellation; receipts/results attach to correct turn/task.
- **Automated tests:** Approval mutation/replay, stale sequence, double-click, deny/error, task progress ordering, cancel/pause/resume, renderer reload, unknown outcome, accessible keyboard/screen-reader flow.
- **Manual Windows validation:** Drive fake proposals/tasks only; verify focus management, screen reader, scaling, tray/renderer reload, and status truth.
- **Privacy/security checks:** Minimal exact preview, sensitive-field masking/reveal policy, no approval from speech alone, no renderer-side risk calculation.
- **Performance/observability checks:** Long progress streams are coalesced/virtualized; command latency and UI errors are content-free.
- **Risks:** UI implying success before verification, stale approval, conflated cancellation controls, and beginner crossing authority boundaries.
- **Stop conditions:** Trusted API is unstable; exact effect cannot be shown; renderer would derive authority; or broad design-system work enters scope.
- **Merge gate:** Lead and Quality non-owner reviews, Founder copy review, accessibility/race suite, rebase onto final VOICE-19/22, and fake-only manual proof.
- **What later PRs may assume after merge:** Canonical conversations can safely present approvals and durable work without making UI state authoritative.

### VOICE-24 — Default-deny capability invocation enforcement

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner security reviewer.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>orchestrator/11-capability-enforcement</code>.
- **Proposed PR title:** <code>feat(orchestrator): enforce default-deny capability invocation</code>.
- **Objective:** Produce a machine-checked inventory of every active capability/effect entry and enforce one capability-scoped, authenticated, default-deny invocation contract before route-family migration.
- **Why this PR exists now:** Route migrations cannot be reviewed safely until the complete bypass surface and a uniform fail-closed binding are known.
- **Dependencies:** VOICE-14, VOICE-16, and VOICE-19 through VOICE-22.
- **Likely files/components in scope:** Signed route/config inventory, inventory scanner, invocation authorization/receipt binding, central default-deny enforcement, least-privilege environment builder, disable switches, and generic adversarial tests.
- **Files/components explicitly out of scope:** Route-specific OpenCode/MCP/PIM behavior migration, new capabilities, Quick Search/Deep Research productization, Memory runtime/store/plugin, scheduler repair, OpenCode submodule edits, provider Voice, and broad permission cleanup.
- **Behavioral changes:** Unbound capability invocation fails closed; active effect routes are inventoried and default disabled at the new JUNE boundary until VOICE-25 or VOICE-26 proves mediation.
- **Schema, identifier, or event changes:** Add capability-scoped invocation authorization and receipt bindings using existing trusted capability/task/action IDs; no new operation/risk enum.
- **Migration and compatibility behavior:** The whole legacy chat/Voice route remains selectable for rollback, but it is explicitly noncanonical; route-family enablement moves only in VOICE-25/26 after parity or explicit-disable proof.
- **Acceptance criteria:** Inventory covers every configured OpenCode agent/tool, MCP server/tool, PIM/scheduler effect, alternate HTTP/IPC entry, and worker launch; missing/wrong/expired bindings fail; environment is allowlisted; inventory drift fails CI/gate.
- **Automated tests:** Configuration/inventory completeness and drift, direct generic invocation bypass, missing/wrong/expired/replayed binding, receipt mismatch, environment secret canaries, disable switches, restart, and deny logging.
- **Manual Windows validation:** In a temporary profile, inspect the generated inventory and confirm synthetic unbound calls are denied without opening real accounts, stores, or user data.
- **Privacy/security checks:** No personal-memory read/write is newly authorized; credentials never enter invocation payload/events; worker environment is explicit; denials reveal no sensitive arguments.
- **Performance/observability checks:** Measure authorization/lookup overhead and deny counts by capability ID only; no objective, tool payload, memory, or secret is logged.
- **Risks:** Incomplete inventory, alternate endpoint, brittle configuration coupling, accidental compatibility outage, and authorization token reuse.
- **Stop conditions:** Inventory cannot be proven complete; a generic route cannot be denied; enforcement requires route-specific redesign; compatibility requires weakening Policy/Gateway; or legacy fallback would become canonical.
- **Merge gate:** Two non-owner reviews, Founder/security approval, machine-checked inventory, adversarial binding/env tests, and route families left disabled pending their owning migration PRs.
- **What later PRs may assume after merge:** Every known capability/effect entry has a stable inventory identity and default-deny JUNE invocation boundary; no route family is yet claimed mediated.

### VOICE-25 — OpenCode and MCP compatibility-route mediation

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner OpenCode/security reviewer.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>orchestrator/12-opencode-mcp-mediation</code>.
- **Proposed PR title:** <code>fix(orchestrator): mediate OpenCode and MCP compatibility routes</code>.
- **Objective:** Put every enabled OpenCode and MCP compatibility invocation behind the façade, trusted Registry, Policy, Action Gateway, and VOICE-24 invocation binding—or disable it.
- **Why this PR exists now:** OpenCode sessions, tools, and MCP children are one distinct authority and credential boundary; they should not be mixed with PIM/scheduler migration.
- **Dependencies:** VOICE-20 and VOICE-24.
- **Likely files/components in scope:** Root OpenCode compatibility adapter, OpenCode auth/permission/session binding, <code>engine-workspace/opencode.json</code>, MCP launch/invocation adapters, least-privilege environment maps, route flags, parity/denial tests, and no submodule edit.
- **Files/components explicitly out of scope:** PIM/scheduler entry points, new OpenCode features, Quick Search/Deep Research production adapters, Memory runtime/store/plugin, OpenCode submodule changes, provider Voice, and unrelated config cleanup.
- **Behavioral changes:** Each currently supported OpenCode/MCP route is mediated with behavior parity where safe or explicitly disabled; direct loopback HTTP/tool/MCP invocation cannot perform a JUNE effect.
- **Schema, identifier, or event changes:** Bind OpenCode provider/session/tool IDs as non-authoritative metadata to existing capability/action/invocation IDs; no canonical identity or risk change.
- **Migration and compatibility behavior:** Migrate one inventoried route at a time behind flags; preserve the whole legacy route for rollback, but Phase 2 cannot exit while an enabled OpenCode/MCP effect bypass remains reachable.
- **Acceptance criteria:** Every inventoried OpenCode agent/tool and MCP entry has mediated-or-disabled evidence; writes have exact policy and PREPARED ledger state; permission mismatch fails closed; child environments are allowlisted; unsupported routes are visibly unavailable.
- **Automated tests:** Direct OpenCode HTTP/SSE/tool/MCP bypass, auth/replay/expiry, permission mismatch, missing Registry entry, Gateway receipt linkage, env-secret canaries, adapter restart/reconciliation, per-route parity, disable, and rollback.
- **Manual Windows validation:** Exercise synthetic, isolated compatibility cases for every inventoried OpenCode/MCP family; confirm mediated or explicit-disabled status without a real external account or personal data.
- **Privacy/security checks:** No direct personal-memory write is newly authorized; broad inherited MCP environment is removed; credentials never enter tool arguments/events; denial is conservative and visible.
- **Performance/observability checks:** Measure façade/policy/gateway and adapter overhead plus parity/deny rates by capability ID only; no prompt/tool content is logged.
- **Risks:** Breaking compatibility, hidden OpenCode endpoint, permission semantic mismatch, secret inheritance, rollback re-enabling bypass, and confusing mediation with Phase 5 readiness.
- **Stop conditions:** Any enabled OpenCode/MCP effect cannot be mediated or disabled; submodule edit is required; parity needs weaker policy; real capability productization enters scope; or rollback would restore a reachable canonical bypass.
- **Merge gate:** Two non-owner reviews, Founder/security and OpenCode-boundary approval, complete per-route evidence, adversarial auth/env tests, and zero enabled unmediated OpenCode/MCP effect path.
- **What later PRs may assume after merge:** Enabled OpenCode/MCP compatibility effects are mediated through JUNE or explicitly unavailable; this does not activate any real Phase 5 delegation capability.

### VOICE-26 — PIM and scheduled-effect compatibility mediation

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner PIM/scheduling reviewer.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>orchestrator/13-pim-scheduled-mediation</code>.
- **Proposed PR title:** <code>fix(orchestrator): mediate PIM and scheduled effects</code>.
- **Objective:** Put every enabled PIM write and authorized scheduled/system effect behind canonical admission, Policy, Action Gateway, task/action lineage, and VOICE-24 invocation binding—or disable it.
- **Why this PR exists now:** PIM and scheduled triggers have persistence/delivery semantics distinct from OpenCode/MCP and need a separately reviewable migration boundary.
- **Dependencies:** VOICE-20, VOICE-22, and VOICE-24.
- **Likely files/components in scope:** PIM compatibility adapter, authorized scheduled/system-trigger admission adapter, task/action/receipt binding, route flags, bounded task-poller boundary changes only if necessary for authorization, parity/denial tests, and isolated temporary PIM data.
- **Files/components explicitly out of scope:** Diagnosing/fixing the known poller failure, recurrence/delivery redesign, new reminder/calendar features, Memory, Telegram scheduler, OpenCode/MCP routes, real Phase 5 adapters, provider Voice, and user data.
- **Behavioral changes:** Existing supported PIM writes and scheduled effects are mediated with parity where safe or explicitly disabled; scheduled triggers cannot bypass policy, source rules, task/action lineage, or the Gateway.
- **Schema, identifier, or event changes:** Bind authenticated scheduled-trigger and legacy PIM metadata to existing canonical task/action/capability/invocation IDs; no competing event/enumeration or scheduler schema redesign.
- **Migration and compatibility behavior:** Route-by-route flags preserve reversible compatibility; current poll cadence and recurrence semantics remain frozen; the reported poller failure stays Unknown and is not repaired here.
- **Acceptance criteria:** Every inventoried PIM/scheduled effect is mediated or disabled; forged/replayed trigger fails; writes have exact approval where required and PREPARED ledger record; delivery/unknown outcomes reconcile; no second scheduler/runtime owner starts.
- **Automated tests:** Direct PIM-tool bypass, forged/replayed/expired trigger, wrong user/task/capability, policy/approval mismatch, Gateway receipt, duplicate due delivery, unknown outcome, owner lease, parity/disable, rollback, and isolated DB assertions.
- **Manual Windows validation:** Use a temporary profile/database and synthetic reminder/event only; verify one owner, mediated-or-disabled outcomes, restart behavior, and no inspection of real PIM/user data.
- **Privacy/security checks:** Scheduled triggers are authenticated and least privilege; no trigger grants Memory authority; sensitive PIM fields stay encrypted/redacted; denial/telemetry contains no content.
- **Performance/observability checks:** Measure admission/Gateway overhead, due-to-attempt time, duplicate/unknown counts, and lease state without PIM content.
- **Risks:** Duplicate delivery, scheduler interference, accidental poller redesign, forged trigger, stale approval, data migration, and rollback bypass.
- **Stop conditions:** Mediation requires fixing/redesigning scheduler recurrence; real data is needed; a second owner appears; an effect cannot be reconciled; or any enabled PIM/scheduled effect cannot be mediated or disabled.
- **Merge gate:** Two non-owner reviews, Founder/security and PIM-boundary approval, isolated route matrix, duplicate/forgery/restart tests, and zero enabled unmediated PIM/scheduled effect path.
- **What later PRs may assume after merge:** Enabled PIM and scheduled effects enter JUNE's trusted task/action path or are unavailable; scheduler reliability beyond this authorization boundary remains separate work.

### VOICE-27 — Deterministic agency fault gate

- **Primary owner:** Engineer Q.
- **Human reviewer:** Engineer L and Engineer U.
- **Architecture approver when required:** Founder signs the Phase 2 exit report.
- **Proposed branch:** <code>orchestrator/14-fake-capability-gate</code>.
- **Proposed PR title:** <code>test(orchestrator): gate agency with fake-capability faults</code>.
- **Objective:** Prove all deterministic Phase 2 invariants under replay, crash, timeout, cancellation, corruption, stale events, and unknown outcomes before provider integration.
- **Why this PR exists now:** Passing happy-path unit tests is insufficient authority to expose <code>june_delegate</code> or live Realtime tools.
- **Dependencies:** VOICE-04, VOICE-23, VOICE-25, and VOICE-26.
- **Likely files/components in scope:** Test/fault campaign, fake capability workers, process-kill harness, invariant report template, and only production seams needed for testability.
- **Files/components explicitly out of scope:** Real external capability, OpenAI, hardware, user data, scheduler repair, Memory, and source refactors not required by a failing invariant.
- **Behavioral changes:** None; this is the mandatory Phase 2 gate.
- **Schema, identifier, or event changes:** None unless a discovered ambiguity is separately approved and fixed in its owning PR.
- **Migration and compatibility behavior:** Test legacy compatibility and rollback alongside new façade; do not remove any current path.
- **Acceptance criteria:** All admission, hybrid-plan validation, policy, ledger, recovery, lease, cancellation-separation, replay, stale-event, compatibility-bypass, privacy, and least-privilege invariants pass with deterministic seeds.
- **Automated tests:** Matrix across fake read/write, turn-scoped/long-running, R0-R3, deterministic/model-proposed routes, valid/invalid plans, idempotent/non-idempotent, success/failure/unknown, process kills, DB restart, duplicate events, direct-tool bypasses, and env-secret canaries.
- **Manual Windows validation:** Run the isolated fault campaign/package smoke under a standard Windows user; no real effect, network, mic, credential, or user database.
- **Privacy/security checks:** Canary secrets never reach worker/provider/log/event; forbidden admission sources create zero durable rows/effects; ACL/key failure is closed.
- **Performance/observability checks:** Produce bounded baseline for admission, transaction, gateway, recovery, and task control; flag regression thresholds rather than hide variance.
- **Risks:** Harness false confidence, nondeterminism, test-only bypasses, incomplete kill points, and pressure to waive a failing invariant.
- **Stop conditions:** Any critical invariant fails or flakes; a fake cannot represent unknown outcome; tests need real credentials/data; or a waiver is proposed without founder decision.
- **Merge gate:** Engineer L reviews every invariant, Founder signs Phase 2 gate, repeated clean Windows runs, and no unresolved P0/P1 fault.
- **What later PRs may assume after merge:** Minimum deterministic agency is safe enough for a provider adapter to propose bounded delegation, not to bypass policy.

### VOICE-28 — OpenAI Realtime credential and adapter boundary

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner provider-security reviewer.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>voice/28-openai-adapter</code>.
- **Proposed PR title:** <code>feat(voice): add the OpenAI Realtime credential and adapter boundary</code>.
- **Objective:** Add a provider-neutral Realtime port, an OpenAI adapter skeleton, and a trusted ephemeral credential broker with no live microphone rollout.
- **Why this PR exists now:** Phase 2 has passed, so provider integration can begin without giving the model direct authority or exposing permanent credentials.
- **Dependencies:** VOICE-27 Phase 2 gate; preparation against VOICE-03 fakes may exist but must be rebased and re-reviewed.
- **Likely files/components in scope:** Trusted provider/credential modules, <code>byok.ts</code> seam, minimal IPC for ephemeral session material, OpenAI adapter translator, account data-control/retention review record, fake HTTP/provider server, and security tests.
- **Files/components explicitly out of scope:** WebRTC media, UI, <code>june_delegate</code>, raw audio, alternate providers, permanent key migration, and OpenCode submodule changes.
- **Behavioral changes:** None by default; a developer/test-only fake adapter can create a non-media session after consent checks.
- **Schema, identifier, or event changes:** Add provider-neutral session/callback/error/cancel interfaces and OpenAI metadata mapping; provider event names never escape as canonical authority.
- **Migration and compatibility behavior:** Legacy local Voice remains default; adapter is feature-gated/off; existing BYOK storage remains and standard key stays in trusted main only.
- **Acceptance criteria:** Permanent key never reaches renderer, logs, args, env of child workers, or provider prompts; ephemeral credential is scoped/short-lived/single-purpose; missing consent/key/config fails closed.
- **Automated tests:** Key absence/corruption, safeStorage unavailable, token endpoint request/response validation, expiry, reuse, wrong session/user, redaction, fake provider translation, cancellation, timeout, and rate/error mapping.
- **Manual Windows validation:** Reverify current official model/account/API availability and the JUNE account's provider-side data-control/retention settings first; use a dedicated test key only under approved secret handling, or remain on the fake if unavailable; inspect renderer/devtools/process args for no permanent key.
- **Privacy/security checks:** Trusted broker validates active user/session/privacy before minting; safety identifier originates in trusted host where applicable; least-privilege context only; approved provider retention/training/data-control settings and residual Unknowns are recorded without exposing account secrets.
- **Performance/observability checks:** Measure token-mint/session-init latency and categorized provider failures without key/body/transcript content.
- **Risks:** Credential leakage, API drift, accidental live enablement, provider schema becoming canonical, and account/model unavailable.
- **Stop conditions:** Official API/model or provider data-control/retention behavior differs materially; required retention setting cannot be verified/accepted; ephemeral flow unavailable; permanent key must enter renderer; account lacks access; or Phase 2 gate regresses.
- **Merge gate:** Fresh official-doc and provider-retention/data-control verification, security review, fake contract tests, controlled account check if authorized, recorded Unknowns/owner, and feature remains off/no media.
- **What later PRs may assume after merge:** A trusted JUNE boundary can obtain ephemeral OpenAI session material and translate provider lifecycle events.

### VOICE-29 — Explicit cloud-audio egress consent

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and Engineer U.
- **Architecture approver when required:** Founder for privacy meaning, copy, and default.
- **Proposed branch:** <code>voice/29-cloud-audio-consent</code>.
- **Proposed PR title:** <code>feat(voice): require explicit cloud audio consent</code>.
- **Objective:** Add a separate, informed, versioned opt-in for streaming live microphone audio to OpenAI, enforced and revocable in trusted Electron main with truthful window/tray cloud indication before any media path can open.
- **Why this PR exists now:** Current consent covers local wake/STT and sending text to the active model; BYOK/provider-retention approval does not authorize raw microphone streaming, and the first WebRTC packet must not precede explicit user consent.
- **Dependencies:** VOICE-08, VOICE-12, and VOICE-28.
- **Likely files/components in scope:** <code>phase3-ui/src/main/voiceConsent.ts</code>, <code>phase3-ui/src/shared/voiceConsentCopy.ts</code>, <code>VoiceSettings.tsx</code>, <code>BYOKSettings.tsx</code>, trusted Voice preference/consent storage and preload commands, the VOICE-08 tray/window status seam, a provider-neutral <code>CloudAudioConsentGate</code>, and focused tests.
- **Files/components explicitly out of scope:** Opening a provider or microphone track, WebRTC, raw audio, provider event handling, changing provider retention policy, general privacy-mode behavior, broad Settings redesign, dependencies, Memory, Orchestrator, and default cut-over.
- **Behavioral changes:** Existing Voice users remain local-only; BYOK, account availability, internal flags, and ordinary microphone consent cannot enable cloud audio. The user must accept the founder-approved disclosure; revocation immediately closes the trusted authorization gate and reports local-only/off truth.
- **Schema, identifier, or event changes:** Add a separate trusted cloud-audio consent record/version and typed grant/revoke/status commands bound to the local user and provider purpose; no canonical conversation, VoiceTurn, or provider schema changes.
- **Migration and compatibility behavior:** Existing enabled preferences migrate to <code>cloud audio = not granted</code>; no silent opt-in. Legacy local wake/STT/chat remains available, and unsupported builds/accounts show the disclosure as unavailable rather than granted.
- **Acceptance criteria:** Missing/corrupt/stale/revoked consent denies; account approval, key presence, feature flag, renderer state, or provider callback alone cannot authorize egress; consent copy distinguishes local STT/text submission from live audio; trusted status drives consistent Settings/window/tray indication; grant/revoke is idempotent and auditable without content.
- **Automated tests:** Existing-user migration, first grant, denial, cancel, revoke, corrupt/version-mismatch state, renderer reload, tray/window projection, stale/replayed command, wrong user/provider/purpose, key/flag/account-without-consent, consent-without-key, Quit/restart, and no-media/network canaries.
- **Manual Windows validation:** In an isolated profile with no live provider session, review the exact disclosure, grant/revoke from Settings, window/tray/local-versus-cloud states, restart/update migration, keyboard/screen-reader flow, and OS mic indicator remaining inactive.
- **Privacy/security checks:** Consent is explicit, purpose/provider scoped, least privilege, fail-closed, and separate from retention acceptance and capability permission; renderer cannot self-authorize; no audio, transcript, key, account secret, or personal data is logged or transmitted.
- **Performance/observability checks:** Measure consent-state load/propagation/revocation acknowledgement and stale-command denials without identity, copy, or user content; no media latency claim.
- **Risks:** Consent bundling, misleading local/cloud copy, stale tray state, renderer authority, accidental auto-migration, and treating provider data controls as user permission.
- **Stop conditions:** Founder has not approved meaning/copy/default; local and cloud consent cannot be represented separately; any flag/key/account state can bypass consent; revocation cannot close the trusted gate atomically; implementation needs live media; or background indication cannot stay truthful.
- **Merge gate:** Two non-owner reviews, Founder privacy/copy approval, complete migration/deny/revoke/accessibility matrix, proof of zero media/network egress, trusted-main enforcement, and cloud audio remains off for every existing profile.
- **What later PRs may assume after merge:** A trusted, explicit cloud-audio authorization gate and truthful user indication exist; VOICE-30 must still revalidate current provider retention/data controls and consent immediately before opening the first track/packet.

### VOICE-30 — OpenAI WebRTC vertical slice

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U reviews visible failure states.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>voice/30-openai-webrtc</code>.
- **Proposed PR title:** <code>feat(voice): add the OpenAI WebRTC vertical slice</code>.
- **Objective:** Establish a gated end-to-end WebRTC session through the trusted desktop media host, translate transcript/audio events, and preserve canonical VoiceTurn/Conversation ownership.
- **Why this PR exists now:** Credentials, explicit cloud-audio consent, control, audio lease, playback, conversation, and deterministic agency are finally available.
- **Dependencies:** VOICE-29 plus the complete Phase 1/2 gates, especially VOICE-09 through VOICE-11, and a same-session fresh official/account retention and data-control check accepted before any live audio egress.
- **Likely files/components in scope:** Isolated trusted media host, WebRTC peer/session adapter, secure control/preload hooks, audio-lease handoff, provider event translator, fake peer/provider tests, and feature flag.
- **Files/components explicitly out of scope:** <code>june_delegate</code>, device selection/unplug/sleep recovery (VOICE-34), endpointing/VAD/AEC/noise tuning (VOICE-35), reconnect/network/media-host crash/soak recovery (VOICE-36), follow-up modes, alternate providers, production wake model, default cut-over, and Memory.
- **Behavioral changes:** With an explicit internal flag and consent, one test Voice session can use OpenAI WebRTC; legacy remains default/fallback; canonical state and conversation persist independently of provider.
- **Schema, identifier, or event changes:** Map provider transcript/audio/response/session metadata into canonical events with JUNE IDs/sequences; provider IDs remain optional metadata.
- **Migration and compatibility behavior:** Shadow/opt-in only; on setup failure release audio lease, close ephemeral session, return to local armed/fallback state, and never delete canonical history.
- **Acceptance criteria:** No pre-activation cloud audio; current VOICE-29 consent and current retention/data-control evidence are both checked in trusted main immediately before the first track/packet; flag/key/account/renderer state alone cannot authorize; revocation closes the track; one mic owner; first transcript/audio maps to the active generation; one disconnect/setup-failure path closes safely without claiming recovery; late audio drops; permanent key is absent.
- **Automated tests:** Fake RTCPeerConnection/data channel/media track, SDP/token/setup errors, event translation, sequence/replay, one disconnect teardown, stale generation, missing/stale/revoked/wrong-purpose cloud consent, key/flag/account-without-consent, revoke-during-setup/stream, track/session cleanup, and fallback. Sleep/device recovery belongs to VOICE-34; reconnect, packet loss, media-host crash, and soak belong to VOICE-36.
- **Manual Windows validation:** On one explicitly named supported default-device/test-account path, validate the happy path, cloud indicator, one explicit disconnect/failure teardown, close, and legacy fallback; do not claim device, sleep, packet-loss, reconnect, media-host-recovery, or soak support.
- **Privacy/security checks:** Ephemeral credential only; trusted main rechecks explicit cloud-audio consent plus fresh official endpoint/account retention and data-control posture immediately before live egress; no raw pre-wake upload; media host sandboxed/no Node authority; secure sideband; consent/privacy revocation immediately closes/mutes tracks.
- **Performance/observability checks:** Establish only wake/session setup, turn-end-to-first-audio, provider-error, consent-to-track gate, cleanup, and egress-state baselines against VOICE-02; device and network resilience distributions wait for VOICE-34/36.
- **Risks:** Audio ownership gaps, key exposure, unacceptable or unverified retention, Electron media permissions, API drift, provider disconnect, latency regression, and hidden renderer dependency.
- **Stop conditions:** VOICE-29 consent is absent/stale/revoked/bypassable; provider retention/data-control posture is Unknown or unacceptable; permanent key is visible; two mic owners; pre-activation packets occur; canonical state depends on provider; API/account is unsupported; teardown leaks; or rollback cannot restore legacy.
- **Merge gate:** Two non-owner reviews plus Founder approval, final VOICE-29 consent rebase, fresh official/account retention and data-control evidence, fake and authorized live evidence, privacy egress trace, one named Windows path, feature off by default, and rollback proof. No live-audio test starts before both consent and retention gates pass.
- **What later PRs may assume after merge:** A gated provider-neutral VoiceTurn can carry OpenAI WebRTC media while JUNE remains canonical.

### VOICE-31 — Realtime canonical conversation UI

- **Primary owner:** Engineer U.
- **Human reviewer:** Engineer L; Engineer Q reviews event-order tests.
- **Architecture approver when required:** Engineer L.
- **Proposed branch:** <code>voice/31-realtime-conversation-ui</code>.
- **Proposed PR title:** <code>feat(ui): project Realtime turns into the canonical conversation</code>.
- **Objective:** Present streaming partial/final user speech, assistant text/audio state, provider errors, and tool/delegation placeholders through the canonical conversation projection.
- **Why this PR exists now:** The WebRTC slice must be visible and debuggable without turning provider callbacks into UI truth.
- **Dependencies:** VOICE-06 and VOICE-30; mock preparation may start after VOICE-03/07.
- **Likely files/components in scope:** Conversation projection/view models, transcript/assistant streaming components, orb/status adapters, accessibility tests, and fake-event stories/harnesses.
- **Files/components explicitly out of scope:** Provider client, Conversation Service, VoiceTurn authority, playback control, policy, and broad chat redesign.
- **Behavioral changes:** Internal-gated Realtime sessions display provisional/final/interrupted/failed state in the same chat; legacy UI remains available.
- **Schema, identifier, or event changes:** None; provider callbacks must first become canonical events.
- **Migration and compatibility behavior:** Existing typed/OpenCode/project chat continues; one projector handles legacy and Realtime canonical records without duplicate messages.
- **Acceptance criteria:** Partials never persist; final canonical message appears once; assistant text aligns with active generation; stale/late audio cannot resurrect speaking UI; provider failure preserves history.
- **Automated tests:** High-rate deltas, partial revisions, duplicate final, reordered events, reconnect, cancellation, renderer reload, interrupted prefix, error/fallback, long transcript, accessibility.
- **Manual Windows validation:** Drive fake and, only when authorized, live Realtime UI; validate focus, screen reader, resizing, reduced motion, and no false speaking/listening state.
- **Privacy/security checks:** No provider credential/raw audio; private-mode retention respected; console/log redaction; untrusted provider text rendered safely as data.
- **Performance/observability checks:** Coalesce high-frequency updates, keep control responsive, measure render lag and dropped UI updates without content.
- **Risks:** UI/provider coupling, duplicate messages, high-frequency render stalls, and misleading state.
- **Stop conditions:** UI must consume raw provider events; canonical projector is unstable; performance blocks control; or U must edit authority-critical provider/main code.
- **Merge gate:** Lead boundary review, event-order/accessibility tests, rebase onto final VOICE-30, and feature remains gated.
- **What later PRs may assume after merge:** Realtime turns are visibly projected through canonical conversation state, not provider session state.

### VOICE-32 — Fake-only <code>june_delegate</code> bridge

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U reviews acknowledgement/progress presentation.
- **Architecture approver when required:** Founder/security owner.
- **Proposed branch:** <code>voice/32-june-delegate-fake</code>.
- **Proposed PR title:** <code>feat(voice): add the fake-only june_delegate bridge</code>.
- **Objective:** Expose one narrow provider tool that submits an untrusted routing proposal to JUNE and returns a fast accepted/clarification/confirmation/rejected/already-running acknowledgement, using deterministic fake/no-effect capabilities only.
- **Why this PR exists now:** The Master's global order places the narrow bridge after provider/WebRTC and shared conversation, but before interruption/privacy; the full Phase 2 authority gate is already complete.
- **Dependencies:** VOICE-27 Phase 2 gate, VOICE-30, and VOICE-31.
- **Likely files/components in scope:** Realtime tool declaration/adapter, Orchestrator façade binding, canonical causation, deterministic fake capability bindings, acknowledgement/progress projection, and contract/security tests.
- **Files/components explicitly out of scope:** Real Quick Search, Deep Research, PIM, Memory, OpenCode coding, direct MCP exposure, any external effect, Phase 5 capability adapters, computer use, agent teams, and alternate providers.
- **Behavioral changes:** Gated Realtime sessions can exercise delegation semantics against fakes; any real/unsupported capability returns a typed unavailable/rejected acknowledgement and performs no work.
- **Schema, identifier, or event changes:** Exact conceptual inputs are objective, capability hint, <code>operation_kind</code>, <code>execution_mode</code>, and desired result; JUNE attaches canonical IDs/user/policy and derives risk, permission, retry, and verification.
- **Migration and compatibility behavior:** Existing OpenCode/MCP/search/research/PIM behavior is unchanged and is never advertised through this bridge. Real adapter activation waits for the Master's Phase 5 and a separate reviewed PR.
- **Acceptance criteria:** Transcript-final alone cannot call; finalized-turn causation is required; hint mismatch is recomputed/rejected; R2/R3 fake confirmation binds exact action; a fake long task returns a task ID quickly; Voice stop leaves that fake durable task running; every real capability ID rejects.
- **Automated tests:** Tool schema, malformed/unknown hint, finality gate, duplicate/replay, wrong conversation, risk-lowering attempt, exact fake approval, fake long task, unsupported real capability, cancellation separation, provider disconnect, and zero external adapter calls.
- **Manual Windows validation:** Use the deterministic fake provider/capabilities; an authorized live Realtime tool-call check may target only the fake/no-effect bridge and must prove no MCP, web, PIM, Memory, filesystem, or external-account call.
- **Privacy/security checks:** Provider receives least-privilege schema/context; no risk-tier input, capability token, or secret; external content cannot invoke as authority; fake objective content is absent from ordinary logs.
- **Performance/observability checks:** Measure acknowledgement, admission/policy, fake-task acceptance, provider round-trip, and rejection reasons without objective text.
- **Risks:** Model treated as authority, accidental real adapter reachability, duplicate fake tasks, slow acknowledgement, and Voice/task cancellation confusion.
- **Stop conditions:** Phase 2 invariant regresses; any real capability/adapter is reachable; provider supplies authoritative risk; no canonical finalized causation exists; or the bridge requires Phase 5 work.
- **Merge gate:** Founder/security review, two human reviews, full deterministic fake campaign, explicit deny-all-real inventory, feature gated, and no authorized live capability proof beyond the no-effect fake.
- **What later PRs may assume after merge:** Realtime Voice can exercise the trusted delegation contract, acknowledgements, and cancellation separation; it cannot assume any real capability is integrated.

### VOICE-33 — True generation interruption and barge-in

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U reviews visible interruption truth.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>voice/33-interruption</code>.
- **Proposed PR title:** <code>feat(voice): add true generation interruption and barge-in</code>.
- **Objective:** Detect authenticated user floor-taking, stop audible output immediately, cancel the active generation/provider response, open the next turn, and preserve any independent durable task.
- **Why this PR exists now:** Current playback mutes wake scoring and cannot barge in; provider/audio/canonical UI foundations now exist.
- **Dependencies:** VOICE-11, VOICE-30 through VOICE-32.
- **Likely files/components in scope:** VoiceTurn interruption transitions, AudioEdge activity signal, PlaybackController stop, provider cancel adapter, canonical conversation heard-prefix update, UI control hooks, and race tests.
- **Files/components explicitly out of scope:** Durable-task cancellation, final AEC/endpointing tuning, device-lifecycle hardening, network recovery, follow-up policy, wake model, alternate providers, and broad UX redesign.
- **Behavioral changes:** Spoken interruption or explicit Stop ends the active audible generation, marks it interrupted with actual heard progress, and permits a new user turn; long tasks continue unless separately canceled.
- **Schema, identifier, or event changes:** Emit generation-scoped interruption requested/acknowledged/cancelled and heard-prefix/final playback events under existing contracts.
- **Migration and compatibility behavior:** Legacy path still uses current mute/no-barge behavior when selected; no false claim that Kokoro fallback supports full duplex.
- **Acceptance criteria:** Active audio becomes silent at or below 120 ms p95 on supported Windows test hardware; interruption-to-silence p50/p95/p99 and sample count are reported; cancelled generation never resumes; one next turn opens; provider late deltas drop; durable task state is unchanged.
- **Automated tests:** Interrupt in THINKING/SPEAKING/load; explicit stop vs speech onset; simultaneous provider delta/end; duplicate interrupt; stale generation; provider cancel failure; playback ack loss; durable-task separation.
- **Manual Windows validation:** Use supported headset/speaker paths to measure interrupt-to-silence, false interrupts, user takeover, provider late audio, and UI/heard marking; record exact hardware.
- **Privacy/security checks:** Only authenticated local activity/control can interrupt; untrusted transcript/provider cannot cancel another turn; no audio content retained for proof.
- **Performance/observability checks:** Measure onset-to-request and request-to-silence as p50/p95/p99 distributions, plus provider-cancel acknowledgement, stale-drop count, false/true interrupts, and heard duration.
- **Risks:** False barge-in from echo, audible tail, provider audio resurrection, wrong heard prefix, or accidental durable-task cancellation.
- **Stop conditions:** Stale audio can resume; silence target cannot be measured; task cancellation couples to Voice; or interruption requires always-uploading pre-activation audio.
- **Merge gate:** Two reviews, deterministic race suite, supported Windows latency evidence, explicit fallback behavior, and feature remains gated.
- **What later PRs may assume after merge:** A Voice generation can be interrupted safely and independently from durable work.

### VOICE-34 — Audio-device lifecycle and privacy-safe recovery

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U reviews device-state presentation.
- **Architecture approver when required:** Founder for device fallback/privacy policy.
- **Proposed branch:** <code>voice/34-audio-device-lifecycle</code>.
- **Proposed PR title:** <code>feat(voice): harden audio-device lifecycle</code>.
- **Objective:** Make the single audio owner handle explicit device choice, permission loss, unplug/default change, sleep/resume, and renderer reload without silent microphone substitution or overlapping capture.
- **Why this PR exists now:** The WebRTC slice and interruption path need a stable local device lifecycle before acoustic or network tuning can be measured honestly.
- **Dependencies:** VOICE-10, VOICE-30, and VOICE-33.
- **Likely files/components in scope:** AudioEdge/media-host device manager, authenticated lease handoff, selected-device persistence/status, OS permission transitions, focused fake-device harness, and Windows device tests.
- **Files/components explicitly out of scope:** Endpointing/VAD, AEC/noise tuning, WebRTC jitter/reconnect, long-session soak, wake-model training, alternate provider, and broad Settings redesign.
- **Behavioral changes:** Device removal or permission loss closes upload and reports a recoverable/blocked state; resume revalidates consent and selected device; an unexpected default never opens silently.
- **Schema, identifier, or event changes:** Add typed selected-device, permission, removal, handoff, suspended, recovery, and blocked outcomes under existing event envelopes.
- **Migration and compatibility behavior:** Preserve the legacy device path as explicit fallback; migrate selected devices one owner at a time and require release before reacquire.
- **Acceptance criteria:** No overlapping handles; explicit selection persists safely; unplug/off/sleep closes the track; resume asks or reopens only under approved policy; stale owner/device callbacks cannot reactivate capture.
- **Automated tests:** Fake enumerate/select/default change, pending acquire then off, unplug during speech/playback, permission revoke, sleep/resume, renderer reload, stale lease, repeated device recovery, and no-silent-fallback assertions. Media-host crash belongs to VOICE-36.
- **Manual Windows validation:** Publish a bounded microphone/output/driver matrix and test select, unplug/replug, default change, permission revoke, sleep/resume, renderer reload, off, and Quit with an isolated profile.
- **Privacy/security checks:** Missing device/permission/lease/consent means no capture; device labels are not logged; no raw audio crosses diagnostics; recovery cannot broaden privacy mode.
- **Performance/observability checks:** Measure acquire/release/handoff/recovery time, dropped first frames, handle overlap, and device failures with identifiers redacted.
- **Risks:** Platform-specific enumeration, unexpected fallback, clipped activation, stuck OS handle, and false UI recovery.
- **Stop conditions:** Any unexpected mic opens; two handles overlap; resume bypasses consent; device truth cannot be projected; or a native dependency is required without separate approval.
- **Merge gate:** Two reviews, deterministic device/lease suite, Founder device policy approval, named Windows evidence, and legacy rollback.
- **What later PRs may assume after merge:** Supported Windows device changes have one privacy-safe owner and deterministic recovery semantics.

### VOICE-35 — Endpointing, VAD, echo, and acoustic control

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner audio/acoustics reviewer.
- **Architecture approver when required:** Founder for endpointing/AEC policy and supported acoustic claims.
- **Proposed branch:** <code>voice/35-endpointing-echo-control</code>.
- **Proposed PR title:** <code>feat(voice): add endpointing and echo control</code>.
- **Objective:** Tune and gate speech endpointing, local/provider VAD interaction, AEC/reference handling, noise behavior, and interruption discrimination on the stable device path.
- **Why this PR exists now:** Fixed-window capture, early commits, and playback echo prevent natural duplex Voice even when transport and device ownership work.
- **Dependencies:** VOICE-30, VOICE-33, and VOICE-34.
- **Likely files/components in scope:** Audio activity/endpoint controller, media constraints/processing policy, provider turn-detection adapter, AEC reference plumbing, acoustic fixtures, metrics, and focused tests.
- **Files/components explicitly out of scope:** Device enumeration/lifecycle, ICE/reconnect, media-host crash recovery, long-session soak, wake-model training, alternate provider, and production audio recording collection.
- **Behavioral changes:** Speech ends on measured endpoint policy rather than a fixed four-second window; hesitation is tolerated; playback echo is distinguished from user floor-taking; failures fall back visibly/conservatively.
- **Schema, identifier, or event changes:** Add typed endpoint candidate/commit/cancel and acoustic-degradation reason metadata; no raw audio or new authority event.
- **Migration and compatibility behavior:** Keep the fixed-window local pipeline as selectable fallback; provider VAD is advisory and cannot commit canonical finality without VoiceTurn/Conversation validation.
- **Acceptance criteria:** Critical utterance set has zero premature commits; early/late rates are reported; false interruption and missed interruption meet founder-approved supported-matrix limits; names/numbers and latency gates remain achievable; no stale audio resumes.
- **Automated tests:** Speech/silence/hesitation/overlap/long utterance, near/far speech, playback reference present/lost, background noise, false/true interruption, provider/local VAD disagreement, late packet callback, and fallback.
- **Manual Windows validation:** Run the named headset/speaker/room/noise/accent matrix with consented/synthetic evaluation audio; record exact hardware and label unsupported conditions Unknown.
- **Privacy/security checks:** Diagnostic audio is volatile and not logged/retained by default; provider cannot override local mute/consent; acoustic classification cannot create durable authority.
- **Performance/observability checks:** Measure early/late commit, end-of-turn latency, false/missed interruption, AEC/reference failure, WER, first audio, CPU, and thermal impact with aggregate data only.
- **Risks:** Overfitting the test room, echo-triggered barge-in, clipping hesitations, platform AEC variance, and excess CPU.
- **Stop conditions:** Critical premature commit occurs; echo causes unsafe false interrupts; privacy requires retaining audio; no declared configuration meets latency/quality; or device/network work leaks into scope.
- **Merge gate:** Founder approves endpoint/AEC policy, Q signs the acoustic dataset/matrix, deterministic and supported Windows evidence passes, and fallback remains selectable.
- **What later PRs may assume after merge:** The supported acoustic matrix has measured endpointing and echo/interruption behavior on a stable device owner.

### VOICE-36 — Provider media-session, network, and soak recovery

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner provider-resilience reviewer.
- **Architecture approver when required:** Founder/security owner for reconnect and fallback policy.
- **Proposed branch:** <code>voice/36-provider-session-recovery</code>.
- **Proposed PR title:** <code>feat(voice): recover provider media sessions</code>.
- **Objective:** Handle jitter, packet loss/reordering, ICE/data-channel failure, token/session expiry, provider disconnect, media-host crash, and long-session resource growth without duplicate turns or stale audio.
- **Why this PR exists now:** Network and process recovery have a distinct rollback/security surface from local devices and acoustic tuning.
- **Dependencies:** VOICE-30 and VOICE-35.
- **Likely files/components in scope:** Provider/WebRTC recovery controller, session/generation reconciliation, ephemeral-credential refresh boundary, media-host supervision, network fault harness, soak diagnostics, and cleanup tests.
- **Files/components explicitly out of scope:** Device selection, VAD/AEC tuning, follow-up/privacy-mode policy, alternate provider, public availability/SLA claims, Orchestrator, and Memory.
- **Behavioral changes:** Degradation pauses/stops media visibly; bounded reconnect creates new provider metadata and, when needed, a new generation while preserving one canonical conversation; unsafe failure returns to the declared fallback.
- **Schema, identifier, or event changes:** Add provider/network degraded, reconnecting, recovered, abandoned, and resource-pressure outcomes correlated to existing JUNE IDs.
- **Migration and compatibility behavior:** Legacy remains selectable; reconnect never reuses an expired credential or treats provider replay as canonical history; fallback cannot run two audio owners.
- **Acceptance criteria:** Loss/reorder/jitter/ICE/data failure recovery is bounded; late media drops; reconnect cannot duplicate message/task/audio; consent/privacy and account retention policy are revalidated; media-host kill cleans up; soak growth stays within declared limits.
- **Automated tests:** Jitter/loss/reorder, ICE restart/failure, data-channel close, token expiry, provider replay, reconnect races, media-host kill, background/renderer restart, stale generation, fallback, and long fake-session CPU/memory/file/queue cleanup.
- **Manual Windows validation:** Run a declared network/offline/VPN/provider-outage matrix, media-host kill/restart cases, and bounded soak on named hardware/account; device and sleep/resume recovery remain VOICE-34 evidence. Record duration, build, and Unknowns without claiming production availability.
- **Privacy/security checks:** Every reconnect uses a fresh scoped credential and current consent/privacy; permanent key remains trusted; abandoned media closes immediately; diagnostics retain no content.
- **Performance/observability checks:** Measure jitter/loss, underrun, reconnect/first-audio time, abandoned sessions, stale drops, CPU/memory/file/queue growth, and cleanup latency.
- **Risks:** Reconnect duplication, stale media resurrection, credential reuse, fallback loop, leak/thermal growth, and misleading recovery UI.
- **Stop conditions:** Privacy state is lost; old credential/session is reused unsafely; duplicate canonical state/audio appears; resource growth is unbounded; or rollback activates two owners.
- **Merge gate:** Security/founder review, deterministic network/process/soak suite, Q-signed Windows evidence, retention/data-control recheck, no P0/P1 leak/race, and rollback proof.
- **What later PRs may assume after merge:** Supported provider sessions have bounded, generation-safe network/process recovery and documented soak limits.

### VOICE-37 — Follow-up and privacy-mode controller

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q; Engineer U reviews the UI-facing state contract.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>voice/37-follow-up-privacy</code>.
- **Proposed PR title:** <code>feat(voice): add follow-up and privacy-mode control</code>.
- **Objective:** Implement Natural Conversation and Privacy-Enhanced modes, adaptive/configurable follow-up, local upload gating, hard mute, and legal session exits.
- **Why this PR exists now:** Natural Voice requires follow-up without repeated wake while preserving clear, technically enforced cloud boundaries.
- **Dependencies:** VOICE-30 and VOICE-33 through VOICE-36.
- **Likely files/components in scope:** PrivacyController, Voice session transitions, local speech/pre-roll gating, consent/preferences, media adapter control, trusted status, and policy tests.
- **Files/components explicitly out of scope:** UI presentation, new pricing/provider modes, production wake model, durable-task policy, Memory writes, and default cut-over.
- **Behavioral changes:** After speaking, an explicitly indicated FOLLOW_UP window can accept the next turn; Natural mode may keep active media per consent; Privacy-Enhanced mode uploads only gated speech plus bounded local pre-roll.
- **Schema, identifier, or event changes:** Add privacy-mode/session activation/expiry/mute reason fields and events within VOICE-03 contracts.
- **Migration and compatibility behavior:** Defaults remain conservative and feature-gated; mode change requiring restart closes old provider/audio state before reopening; legacy local armed mode remains fallback.
- **Acceptance criteria:** Missing/corrupt consent/config means no cloud upload; follow-up expires/ends on every approved condition; mode switch is legal/visible; mute stops upload immediately; partials create no durable authority.
- **Automated tests:** Mode matrix, timeout with fake clock, goodbye/dismiss/quit, mute/unmute, consent revoke, switch during speech/playback, pre-roll bounds, reconnect, no-upload assertions, stale session.
- **Manual Windows validation:** Verify cloud network indicator/track state for both modes, follow-up expiry, hard mute, background/tray, and mode change using an isolated test account/profile.
- **Privacy/security checks:** Pre-roll volatile/bounded/local; no pre-activation upload; clear active indicator; provider/session cannot override privacy; preferences do not grant capability permission.
- **Performance/observability checks:** Measure follow-up activation, gated onset clipping, mute-to-no-upload, session reuse benefit, and false activation without retaining speech.
- **Risks:** Hidden cloud-open window, clipped first syllable, stuck follow-up, mode confusion, and privacy state race.
- **Stop conditions:** Network trace shows pre-activation/muted upload; indicator can disagree with media; timeout cannot be bounded; or mode semantics require architecture change.
- **Merge gate:** Founder privacy approval, two reviews, deterministic egress tests, authorized Windows network evidence, and default remains conservative.
- **What later PRs may assume after merge:** Follow-up and both approved privacy modes are enforced by trusted state, not UI/provider convention.

### VOICE-38 — Accessible follow-up and privacy controls

- **Primary owner:** Engineer U.
- **Human reviewer:** Engineer L; Engineer Q reviews state/race coverage.
- **Architecture approver when required:** Founder for copy/defaults.
- **Proposed branch:** <code>voice/38-privacy-controls-ui</code>.
- **Proposed PR title:** <code>feat(ui): add accessible follow-up and privacy controls</code>.
- **Objective:** Expose privacy mode, local/cloud state, follow-up countdown/availability, mute/end, interruption, and failure recovery accessibly across window and tray surfaces.
- **Why this PR exists now:** VOICE-37 has trusted behavior; users need unmistakable control and feedback before broader testing.
- **Dependencies:** VOICE-12, VOICE-31, and VOICE-37.
- **Likely files/components in scope:** Voice settings, orb/overlay/status components, follow-up/privacy controls, shared copy, accessibility and visual-state tests.
- **Files/components explicitly out of scope:** Privacy decisions, media control implementation, credentials, main-process authority, broad theme redesign, and unrelated Settings.
- **Behavioral changes:** Users can choose approved modes, see local versus cloud truth, mute/end instantly, and understand follow-up/interrupt/recovery state.
- **Schema, identifier, or event changes:** None; typed commands and state projections only.
- **Migration and compatibility behavior:** Existing Voice enable/consent remains; unsupported/legacy path labels its limitations honestly; settings migration defaults fail closed.
- **Acceptance criteria:** No state relies on color alone; cloud-active and muted are unmistakable; countdown/expiry is not misleading; keyboard/screen-reader/reduced-motion/high-contrast paths work; stale state rejected.
- **Automated tests:** Full state/mode/control matrix, sequence races, command failure, countdown fake clock, focus, ARIA live regions, localization-safe copy bounds, legacy fallback.
- **Manual Windows validation:** Screen reader, keyboard-only, 100-200% scaling, high contrast, reduced motion, tray/window transitions, and actual media indicators on approved hardware.
- **Privacy/security checks:** Unknown state is conservative; renderer never assumes command success; no transcript/key in telemetry; enable still requires trusted consent.
- **Performance/observability checks:** High-frequency audio/state updates do not starve controls; countdown is efficient; interaction errors are content-free.
- **Risks:** UI/privacy divergence, accidental continuous-mode default, inaccessible urgent control, and merge conflict in orb/Settings.
- **Stop conditions:** Trusted state lacks required distinctions; U must change authority code; UI cannot represent failure honestly; or default privacy policy changes without founder approval.
- **Merge gate:** Lead boundary review, Founder copy/default approval, accessibility matrix, rebase onto VOICE-37, and Windows evidence.
- **What later PRs may assume after merge:** Users can understand and control active Voice privacy/follow-up behavior on supported Windows paths.

### VOICE-39 — Voice-owned read-only context consumer port

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and a designated non-owner Memory/privacy reviewer.
- **Architecture approver when required:** Founder/Memory architecture owner.
- **Proposed branch:** <code>voice/39-read-context-port</code>.
- **Proposed PR title:** <code>feat(voice): add a read-only context consumer port</code>.
- **Objective:** Add a Voice-owned, provider-neutral, bounded, scoped, cancellation-aware read-context consumer port, with deterministic fake/no-op implementations only and no Memory runtime authority.
- **Why this PR exists now:** The approved Memory design already defines the consumer contract; Voice needs its side of that seam without waiting on or pulling the Phase 4 MemoryBroker implementation into Phase 3 acceptance.
- **Dependencies:** VOICE-06, VOICE-28, and the already approved Memory System Design contract; no external runtime implementation.
- **Likely files/components in scope:** Voice-facing <code>ReadContextPort</code>, fake/no-op, session-start/per-turn packager hook, provider-context adapter, non-persistent test/observability sink, and privacy tests.
- **Files/components explicitly out of scope:** Legacy DB migration, <code>save_memory</code>, automatic memory-candidate extraction, Memory schemas/storage/encryption/indexes, auto-recall plugin rewrite, and project-memory merger.
- **Behavioral changes:** New Realtime path receives empty or synthetic structured context only; no real personal/project memory retrieval and no durable write or usage authority is introduced.
- **Schema, identifier, or event changes:** Add the consumer-side request/result shapes required by the approved contract—purpose, scope, sensitivity, token budget, provenance IDs, cancellation, and egress decision—without creating a competing canonical Memory schema or persisted <code>memory_usage</code> record.
- **Migration and compatibility behavior:** Preserve global OpenCode auto-recall only on compatibility paths; isolate new Voice provider context from raw recall injection; real LegacyMemoryAdapter waits for Phase 4.
- **Acceptance criteria:** Partial speech can request speculative fake read only; transcript-final cannot write; canonical finality keys any turn-bound fake request; bounded 4-8 items/roughly 600-1,200 tokens in fixtures; denied, absent, or unimplemented broker yields empty context safely; no real store/plugin is opened.
- **Automated tests:** No-op/fake, cancellation, partial/final distinction, scope/sensitivity/egress denial, token cap, provenance, injection-as-data, duplicate usage, provider disconnect, no write method.
- **Manual Windows validation:** Use synthetic context fixtures in a temp profile; inspect the provider packager without real personal memory, databases, plugins, or a MemoryBroker process.
- **Privacy/security checks:** No unrestricted legacy rows; no assistant/external/partial direct write; Memory cannot alter risk/permission; minimal structured evidence only; content-free operational logs.
- **Performance/observability checks:** The fake establishes cancellation, timeout, token-cap, packaging-latency, and non-persistent use-observation hooks; real retrieval performance remains a Phase 4 gate.
- **Risks:** Hidden Memory redesign, leaking legacy personal context, auto-recall duplication, and using memory as authority.
- **Stop conditions:** Scope requires a real MemoryBroker/LegacyMemoryAdapter, persisted usage authority, legacy read/write/migration/plugin edits, sensitive real evidence, or an unbounded provider prompt dump.
- **Merge gate:** Memory owner review, privacy/egress tests, proof no legacy store/plugin opens or mutates, fake/no-op only, and an explicit non-blocking Phase 4 adapter follow-up.
- **What later PRs may assume after merge:** Voice can consume a future approved broker through a bounded read-only port; it may not assume a MemoryBroker runtime, Memory V1, real retrieval, persisted usage ledger, or durable write exists.

### VOICE-40 — Shadow acceptance and rollback proof

- **Primary owner:** Engineer Q.
- **Human reviewer:** Engineer L; Engineer U signs the user-visible matrix.
- **Architecture approver when required:** Founder signs the Voice V1 internal cut-over gate.
- **Proposed branch:** <code>voice/40-shadow-acceptance</code>.
- **Proposed PR title:** <code>test(voice): prove shadow acceptance and rollback</code>.
- **Objective:** Compare legacy and gated Realtime paths, run the complete fault/privacy/Windows matrix, prove rollback, and publish an evidence report without switching the default.
- **Why this PR exists now:** Component completion is not release evidence; cut-over must be driven by measured behavior and zero critical safety failures.
- **Dependencies:** VOICE-27 and VOICE-31 through VOICE-39.
- **Likely files/components in scope:** Acceptance harnesses, synthetic datasets, feature-flag/shadow telemetry readers, Windows/audio/network scripts, rollback tests, and evidence documentation.
- **Files/components explicitly out of scope:** Default switch, legacy removal, provider redesign, production wake-model training, Memory V1, unrelated fixes, and real user data.
- **Behavioral changes:** None for default users; authorized internal sessions can shadow/compare under explicit consent without duplicate audible output or duplicate canonical work.
- **Schema, identifier, or event changes:** None; acceptance consumes existing content-free metrics/events.
- **Migration and compatibility behavior:** Validate both directions: legacy-to-Realtime and immediate Realtime-to-legacy after failure/restart; canonical history remains single.
- **Acceptance criteria:** Wake visual at or below 150 ms p95; first meaningful audio at or below 700 ms p50/1.2 s p95, with p99 reported; interrupt-to-silence at or below 120 ms p95, with p50/p95/p99 reported; transcript median around/under 350 ms; endpointing has no premature commit in the critical utterance set and reports early/late rates; names/numbers at least 97%; quiet/noisy WER at most 6%/10%; naturalness at least 4.2/5; zero stale audio; all privacy/finality/agency invariants pass.
- **Automated tests:** Full unit/contract/state/fake-provider/fake-capability/cancel/replay/stale/playback/reload/process-kill/reconnect/device/network/privacy/long-session/rollback suite.
- **Manual Windows validation:** Reverify official API/model and the authorized account's provider retention/data-control settings, then execute the declared hardware, acoustic, network, tray, accessibility, long-session, and rollback matrix; record exact environment and Unknown/unsupported cases.
- **Privacy/security checks:** No real conversation content in reports; network egress proves no pre-activation/mute upload; credentials absent; provider retention/training/data-control evidence is current and accepted; forbidden events create zero durable effects/memory candidates.
- **Performance/observability checks:** Report sample sizes and p50/p95/p99 for first-audio and interruption latency, plus appropriate distributions for other latency metrics—not best cases; compare to VOICE-02 baseline; flag missing measurement as Unknown.
- **Risks:** Cherry-picked hardware, small samples, shadow duplication, hidden regressions, test data leakage, and pressure to waive a P0/P1.
- **Stop conditions:** Any P0/P1 safety/privacy/finality/stale-audio failure; target lacks sufficient samples; rollback fails; account/model or retention/data-control behavior changes; required provider setting is unacceptable/Unknown; or an unsupported hardware claim is proposed.
- **Merge gate:** Q and U sign evidence, L reviews technical proof, Founder explicitly accepts provider data-control/retention evidence and approves internal cut-over, and all unresolved exceptions are visible.
- **What later PRs may assume after merge:** The gated Realtime path has auditable acceptance and rollback evidence on the explicitly tested matrix.

### VOICE-41 — Controlled Realtime default cut-over

- **Primary owner:** Engineer L.
- **Human reviewer:** Engineer Q and Engineer U.
- **Architecture approver when required:** Founder.
- **Proposed branch:** <code>voice/41-controlled-cutover</code>.
- **Proposed PR title:** <code>feat(voice): enable controlled Realtime cut-over with rollback</code>.
- **Objective:** Switch the approved cohort/default to Realtime through a reversible flag while retaining the legacy path and automatic/manual rollback.
- **Why this PR exists now:** VOICE-40 is the first point at which replacement quality and safety are proven rather than assumed.
- **Dependencies:** VOICE-40 and explicit founder approval.
- **Likely files/components in scope:** Central Voice route/feature flag, startup/config migration, health/fallback selection, user-visible route status, rollback tests, and release notes.
- **Files/components explicitly out of scope:** Deleting legacy Python/Kokoro/OpenCode/side-channel code, changing architecture, production wake-model work, alternate providers, Memory V1, and unrelated cleanup.
- **Behavioral changes:** Approved users start on Realtime when consent/credentials/health allow; otherwise fail closed or use explicitly defined legacy fallback; one control restores legacy immediately.
- **Schema, identifier, or event changes:** Add route-selection/rollback outcome metadata only; canonical contracts remain unchanged.
- **Migration and compatibility behavior:** Flag rollout is staged and reversible; canonical history is independent of route; old side channel remains non-authoritative; legacy removal requires a separate later plan/PR.
- **Acceptance criteria:** Fresh/upgrade/credential-missing/offline/provider-down cases choose the documented safe route; current provider retention/data-control settings still match the approved VOICE-40 evidence; rollback works without restart/data loss; no duplicate mic/session/message/task; legacy remains tested.
- **Automated tests:** Route matrix, config migration/corruption, health race, fallback, rollback during each VoiceTurn state, renderer/background restart, duplicate-owner prevention, canonical history continuity.
- **Manual Windows validation:** Staged cohort on approved matrix; exercise provider outage, key removal, offline mode, explicit rollback, app update/restart, tray and accessibility.
- **Privacy/security checks:** No cloud route without current consent/credential/privacy and accepted provider data-control/retention state; fallback never broadens permission; route state visible; permanent key remains trusted.
- **Performance/observability checks:** Compare post-switch latency/error/cancel/stale/rollback metrics to VOICE-40 thresholds; automatic rollback trigger is bounded and visible.
- **Risks:** Bad default migration, fallback loop, two active routes, hidden cloud egress, and premature legacy deletion.
- **Stop conditions:** Founder has not signed; VOICE-40 evidence expires/regresses; provider availability or retention/data-control state changed; rollback fails; or route can activate two owners.
- **Merge gate:** Three human reviews, Founder approval, staged rollout/rollback runbook, clean full matrix, and legacy path retained.
- **What later PRs may assume after merge:** Realtime may be the controlled default for the approved cohort, but legacy remains a supported rollback until a separately approved retirement gate.

## 9. Three-engineer assignment plan

### 9.1 Engineer L — Lead/Core lane

- **Initial assignments:** VOICE-01, VOICE-03, VOICE-05, VOICE-06, VOICE-08 through VOICE-11, and all authority-bearing Phase 2/provider/delegation work.
- **Likely file ownership:** Electron main/runtime/preload authority, canonical schemas, VoiceTurn, Conversation Service/Store, secure control, audio/playback control, Orchestrator, credential/provider adapters, and route cut-over.
- **Files and systems to avoid:** Full Memory V1 internals, production wake-model training, unrelated scheduler diagnosis, broad renderer styling, and modifications inside <code>research/opencode</code>.
- **Required reviewers:** Q plus a second named or designated non-owner reviewer on every L PR; U covers user-visible projection where applicable; Founder approval is additional on canonical contract, storage, lifecycle, security, policy, provider, privacy, delegation, and cut-over gates.
- **Skills developed through the sequence:** Cross-process state ownership, fail-closed local security, encrypted transactional state, deterministic agency, provider adapters, WebRTC, audio concurrency, migration.
- **Safe larger bounded capability:** L may own the WebRTC vertical slice only after personally integrating Phase 1 and reviewing the full Phase 2 gate.
- **May prepare before dependencies merge:** Provider interfaces and fake translations after VOICE-03; never live credentials/media. The read-context consumer may be sketched from the already approved Memory design but cannot merge before VOICE-28's adapter boundary.
- **May not merge until dependencies finalize:** Any stacked authority PR, all provider work before VOICE-27, <code>june_delegate</code> before VOICE-27/30/31, the context seam before its Voice dependencies, or cut-over before VOICE-40.

L is the temporary sole editor for authority-critical files in Section 16. L does not approve or merge L's own PR; a designated non-owner maintainer merges only after required reviews and any separate Founder approval.

### 9.2 Engineer Q — Quality/Observability lane

- **Initial assignments:** VOICE-02, VOICE-04, VOICE-27, and VOICE-40.
- **Likely file ownership:** Isolated test fixtures, fake clocks/providers/capabilities, privacy canaries, fault/process-kill harnesses, acceptance matrices, benchmark/report code, and test-only synthetic assets.
- **Files and systems to avoid:** Production credentials, consent/policy authority, runtime migrations, main-process lifecycle source, production provider client, real user profiles/databases, and direct submodule edits.
- **Required reviewers:** L and U on every Q PR, with U limited to test usability, failure visibility, and evidence presentation rather than production authority; Founder signs only Phase 2 and Voice cut-over reports.
- **Skills developed through the sequence:** Privacy-safe telemetry, deterministic concurrency, contract testing, process fault injection, audio/network measurement, Windows evidence, release-gate reasoning.
- **Safe larger bounded capability:** After VOICE-04 and one fault campaign are reviewed, Q may own VOICE-27 and later VOICE-40, but not production authority code.
- **May prepare before dependencies merge:** Fakes, fixtures, test matrices, canaries, and report templates against published contracts/mocks.
- **May not merge until dependencies finalize:** A harness that encodes provisional schema; the Phase 2 campaign before VOICE-23, VOICE-25, and VOICE-26 are final; acceptance report before all target components; any test requiring private data/live key without explicit authority.

Q can suggest small production seams needed for testability, but L owns those changes in the relevant production PR or explicitly reviews a minimal paired diff.

### 9.3 Engineer U — UI/Bounded Integration lane

- **Initial assignments:** VOICE-07, VOICE-12, VOICE-23, VOICE-31, and VOICE-38.
- **Likely file ownership:** Canonical conversation consumers, transcript/message/progress/approval components, orb/status presentation, Settings privacy controls, accessibility, and renderer mock adapters.
- **Files and systems to avoid:** <code>main/index.ts</code>, <code>services.ts</code>, <code>supervisor.ts</code>, <code>voice.ts</code>, <code>voiceConsent.ts</code>, <code>byok.ts</code>, <code>scheduler.ts</code>, persistent stores, secure IPC implementation, provider client, Orchestrator policy/gateway, and Python audio.
- **Required reviewers:** L for boundary/state correctness; Q for race/error/accessibility coverage; Founder for consent, approval, cloud, follow-up, and background copy.
- **Skills developed through the sequence:** Provider-neutral projections, provisional/final UI, asynchronous error truth, accessible urgent controls, stale-state handling, mock-driven integration.
- **Safe larger bounded capability:** After VOICE-07 and VOICE-12 merge cleanly, U may own the approval/progress and Realtime projection PRs; privacy-mode UI waits for successful review of both.
- **May prepare before dependencies merge:** Components and tests against VOICE-03 fixtures and read-only mock contexts; no edits to provisional producer code.
- **May not merge until dependencies finalize:** VOICE-07 before VOICE-06, VOICE-12 before VOICE-08/09, VOICE-23 before VOICE-19/22, VOICE-31 before VOICE-30, or VOICE-38 before VOICE-37.

U's preparation branch must be rebased onto the final producer contract. Mock compatibility is not evidence that the production boundary matches.

## 10. Parallel execution waves

### Wave 0 — Fail-closed current-path repair

- **Critical-path PR:** VOICE-01.
- **Parallel-safe PRs:** None may merge in parallel.
- **Preparation-only work:** Q inventories VOICE-02 metrics/canaries; U designs a fake adapter teardown test without editing production.
- **Shared-file risks:** <code>supervisor.ts</code>, <code>index.ts</code>, <code>NightjarOrb.tsx</code>, <code>orbAdapter.ts</code>.
- **Required merge order:** VOICE-01 alone.
- **Required rebase order:** Q/U preparation rebases after VOICE-01 if it touched test seams.
- **Integration owner:** L.
- **Exit gate:** Adopted wake and active/pending renderer microphones close on off/quit with Windows evidence.

### Wave 1 — Baseline and canonical contracts

- **Critical-path PR:** VOICE-02 then VOICE-03.
- **Parallel-safe PRs:** Q can implement VOICE-04 after VOICE-03's contract commit exists.
- **Preparation-only work:** U builds read-only conversation-state mocks; L may sketch provider-neutral interfaces with no provider imports.
- **Shared-file risks:** <code>wake_daemon.py</code>, Voice test helpers, cross-language contract fixtures.
- **Required merge order:** 02 → 03 → 04.
- **Required rebase order:** VOICE-03 rebases onto 02; VOICE-04 rebases onto final 03.
- **Integration owner:** L.
- **Exit gate:** Privacy-safe baseline exists and Python/TypeScript agree on one canonical contract.

### Wave 2 — Canonical VoiceTurn and conversation

- **Critical-path PR:** VOICE-05 → VOICE-06.
- **Parallel-safe PRs:** U may prepare VOICE-07 entirely against VOICE-03 mocks while L works; Q extends fault fixtures in separate files.
- **Preparation-only work:** U may not wire <code>SessionsContext</code> until VOICE-06 finalizes; provider prep stays type-only.
- **Shared-file risks:** <code>ConnectionContext.tsx</code>, <code>SessionsContext.tsx</code>, <code>opencode.ts</code>, <code>wake_daemon.py</code>.
- **Required merge order:** 05 → 06 → 07.
- **Required rebase order:** VOICE-06 onto 05; U discards/rebuilds mock adapters and rebases 07 onto 06.
- **Integration owner:** L, with U owning only final renderer presentation.
- **Exit gate:** Trusted typed/fake input produces one canonical final user message/event and one visible voice/text conversation with no provider/OpenCode ID authority; live legacy Voice remains noncanonical until VOICE-09.

### Wave 3 — Background, secure control, and audio ownership

- **Critical-path PR:** VOICE-08 → VOICE-09 → VOICE-10 → VOICE-11.
- **Parallel-safe PRs:** U may prepare VOICE-12 against state fixtures; Q may write lease/IPC/audio race tests in separate files after each interface freezes.
- **Preparation-only work:** WebRTC media-host fake can be sketched but not merged or given credentials/audio.
- **Shared-file risks:** <code>index.ts</code>, <code>services.ts</code>, <code>supervisor.ts</code>, <code>voiceConsentCopy.ts</code>, <code>scheduler.ts</code>, <code>preload/index.ts</code>, <code>NightjarOrb.tsx</code>, <code>orbAdapter.ts</code>, and <code>wake_daemon.py</code>.
- **Required merge order:** 08 → 09 → 10 → 11; 12 merges after 09 and before the Phase 1 gate.
- **Required rebase order:** Every Lead branch rebases after the preceding merge; U rebases 12 after final 08/09 and resolves no authority files.
- **Integration owner:** L.
- **Exit gate:** Single runtime; atomic background consent/tray/Quit truth; authenticated live transcript binding; one mic owner; generation-safe playback; every legacy wake/playback/display consumer either migrated or explicitly non-authoritative; truthful background privacy UI.

### Wave 4 — Orchestrator contracts, compatibility façade, store, and Registry

- **Critical-path PR:** VOICE-13 → VOICE-14 → VOICE-15 → VOICE-16.
- **Parallel-safe PRs:** Q builds fake capability matrices after 13; U prepares approval/task components against mocks.
- **Preparation-only work:** Router/policy drafts may be reviewed but not merged before Registry/store contracts.
- **Shared-file risks:** New Orchestrator domain/store modules, lockfile/native packaging, background runtime lease.
- **Required merge order:** 13 → 14 → 15 → 16.
- **Required rebase order:** Each PR rebases on the immediately prior merged contract/migration; never merge a stacked migration out of order.
- **Integration owner:** L.
- **Exit gate:** Current request initiation traverses the compatibility façade, its remaining inner bypasses are inventoried, and the encrypted leased runtime plus trusted allowlist Registry pass isolated Windows/security tests.

### Wave 5 — Routing, policy, effects, compatibility closure, and agency proof

- **Critical-path PR:** VOICE-17 → VOICE-18 → VOICE-19 → VOICE-20 → VOICE-21 → VOICE-22 → VOICE-24 → VOICE-25/26 → VOICE-27.
- **Parallel-safe PRs:** U prepares VOICE-23 after VOICE-19's stable mock contract and may merge it after VOICE-22 while L prepares VOICE-24; VOICE-25 and VOICE-26 may merge in either order after VOICE-24 if their final files remain disjoint; Q prepares the VOICE-27 campaign throughout.
- **Preparation-only work:** OpenAI adapter branch may compile against fakes only; no live token/media or merge.
- **Shared-file risks:** Orchestrator façade/events/store, Registry/router/validator/policy/gateway/recovery/task control, OpenCode/MCP and PIM/scheduled choke points, preload task/approval bridge, and canonical conversation consumer.
- **Required merge order:** 17 → 18 → 19 → 20 → 21 → 22; 23 after 22; 24 after 22; then 25 and 26; 27 only after 23, 25, and 26.
- **Required rebase order:** Every L authority PR rebases serially through 24; U rebases 23 after final 19/22; 25/26 each rebase onto 24 and then current main before merge; Q rebases 27 after every production/UI input and removes duplicated provisional fixtures.
- **Integration owner:** L; Q owns the independent exit report.
- **Exit gate:** Founder signs the complete deterministic/hybrid Phase 2 fault gate; recovery and finite task control are independently proven; every current request enters the façade; every enabled OpenCode/MCP/PIM/scheduled effect is mediated or disabled; and no P0/P1 invariant remains.

### Wave 6 — Credential boundary, explicit cloud consent, and WebRTC vertical slice

- **Critical-path PR:** VOICE-28 → VOICE-29 → VOICE-30.
- **Parallel-safe PRs:** U prepares VOICE-31 with the fake provider after VOICE-28; Q prepares network/media fault scenarios.
- **Preparation-only work:** Any pre-Phase-2 provider branch is rebased/recreated; no inherited live secrets or stale API assumptions. Consent UI may use fakes, but no provider/microphone media is permitted in VOICE-29.
- **Shared-file risks:** <code>byok.ts</code>, <code>voiceConsent.ts</code>, <code>voiceConsentCopy.ts</code>, <code>VoiceSettings.tsx</code>, <code>BYOKSettings.tsx</code>, tray/window status, <code>index.ts</code>, preload, secure control, audio lease, playback, and provider adapter.
- **Required merge order:** 28 → 29 → 30.
- **Required rebase order:** 28 starts from Phase 2 gate main and re-verifies official docs plus account retention/data controls; 29 rebases onto 28 and lands founder-approved consent with zero media; 30 rebases onto 29 and repeats consent plus retention checks before first live audio; U rebases 31 onto 30.
- **Integration owner:** L.
- **Exit gate:** Explicit cloud-audio consent is enforced and visible; gated WebRTC then works on one declared Windows path/account with ephemeral credentials, current data-control evidence, canonical projection, and legacy fallback.

### Wave 7 — Delegation contract, full-duplex resilience, and privacy modes

- **Critical-path PR:** VOICE-32 → VOICE-33 → VOICE-34 → VOICE-35 → VOICE-36 → VOICE-37.
- **Parallel-safe PRs:** U prepares VOICE-38 against final state fixtures; Q runs growing device/acoustic/network/latency matrices; L may implement VOICE-39 in a disjoint context-port module after VOICE-28.
- **Preparation-only work:** Real Quick Search/Deep Research/capability adapters remain Phase 5. The context port uses fake/no-op only; a real MemoryBroker remains Phase 4.
- **Shared-file risks:** AudioEdge, VoiceTurn, PlaybackController, media host, orb/status, Voice settings.
- **Required merge order:** 32 after 27/30/31; then 33 → 34 → 35 → 36 → 37 → 38. VOICE-39 may merge any time after 28 if its files stay disjoint, but it joins before acceptance.
- **Required rebase order:** Each authority/audio PR rebases serially; U rebases 38 onto final 37 and must not resolve authority files independently; VOICE-39 rebases after any provider-context conflict.
- **Integration owner:** L.
- **Exit gate:** Fake-only delegation cannot reach real capabilities; interruption, device lifecycle, acoustics, and provider recovery are measured separately; follow-up/privacy is enforced and accessibly visible.

### Wave 8 — Read-context seam and acceptance-candidate lock

- **Critical-path PR:** VOICE-39 if it did not merge during Wave 7; otherwise no new production PR.
- **Parallel-safe PRs:** Q prepares cross-system acceptance; U freezes the user-visible matrix; L performs read-only integration inspection.
- **Preparation-only work:** Real MemoryBroker/LegacyMemoryAdapter/runtime/storage/migration remains Phase 4; broader real capabilities remain Phase 5.
- **Shared-file risks:** Provider-context packaging and canonical conversation only; no Memory or legacy plugin file may enter the diff.
- **Required merge order:** All VOICE-32 through VOICE-39 inputs must be on main before the candidate SHA is locked.
- **Required rebase order:** VOICE-39 rebases onto current main and reruns context/privacy/finality tests; candidate evidence starts only after its merge.
- **Integration owner:** L; Memory owner co-approves VOICE-39's consumer boundary.
- **Exit gate:** The Voice context seam is fake/no-op, bounded, read-only, and non-authoritative; no real Memory runtime is required or implied.

### Wave 9 — Shadow acceptance

- **Critical-path PR:** VOICE-40.
- **Parallel-safe PRs:** None may alter target behavior while the acceptance baseline is collected; fixes receive their own owning PR and reset affected evidence.
- **Preparation-only work:** VOICE-41 runbook/flag review only.
- **Shared-file risks:** Test harnesses, feature flags, telemetry schemas, test assets.
- **Required merge order:** All target PRs → 40.
- **Required rebase order:** Q rebases onto the exact candidate SHA and records it; any merged fix invalidates and reruns affected matrices.
- **Integration owner:** Q for evidence, L for technical review, Founder for gate.
- **Exit gate:** All safety, privacy, finality, latency, quality, Windows, and rollback requirements have sufficient evidence or remain an explicit blocker.

### Wave 10 — Controlled cut-over

- **Critical-path PR:** VOICE-41.
- **Parallel-safe PRs:** None touching Voice routing.
- **Preparation-only work:** Post-cutover monitoring and separate legacy-retirement proposal.
- **Shared-file risks:** Central route flag, lifecycle, service/config migration, status UI.
- **Required merge order:** 40 → explicit founder approval → 41.
- **Required rebase order:** 41 rebases onto the exact approved candidate; new provider/API/security/retention changes require reapproval.
- **Integration owner:** L; a non-owner maintainer merges.
- **Exit gate:** Controlled default is live for the approved cohort, rollback is exercised, legacy remains selectable, and monitoring has no critical regression.

## 11. Worktree and branch strategy

Keep <code>C:\dev\june</code> as protected, clean <code>main</code>. Do not develop in it. Do not create worktrees as part of this planning PR.

Recommended future layout:

~~~text
C:\dev\june                         protected main / integration inspection only
C:\dev\june-worktrees\lead         one active Engineer L PR
C:\dev\june-worktrees\quality      one active Engineer Q PR
C:\dev\june-worktrees\ui           one active Engineer U PR
~~~

Rules:

1. One branch and one bounded PR per worktree/session. Use the exact proposed branch where practical.
2. Create each branch from the latest reviewed <code>origin/main</code> merge SHA; record that full SHA in the status update and PR body.
3. Do not stack authority PRs for merge. A preparation branch may temporarily depend on an open PR, but after that dependency merges it must rebase onto main, drop duplicated commits, rerun all gates, and update its base SHA.
4. Recreate rather than mechanically rescue a preparation branch when canonical schema, migration, security boundary, or file ownership changed materially.
5. Open Draft PRs early after the first coherent diff. The branch owner answers review findings but never merges their own PR.
6. Only one Codex session edits an authority-critical file at a time. Reserve files in the shared status message before the first diff.
7. Q and U use mock/test/component files during preparation. They do not resolve conflicts in L-owned authority files; L exposes or adjusts a stable interface in the owning PR.
8. After merge, verify main/remote/working tree, remove the worktree through normal Git worktree commands, and delete the merged local branch only when authorized. Never use reset/clean to handle another engineer's work.
9. Keep <code>research/opencode</code> detached, clean, and at the parent gitlink. Do not fetch, checkout, update, patch, or commit inside it for Voice. Root adapters consume its stable HTTP/SSE contracts.
10. Before every PR starts and after every rebase, verify root status, submodule status, no Git operation/lock, applicable instructions, and dependency SHAs.

## 12. Communication protocol

Every engineer posts this exact compact status:

~~~text
PR:
Owner:
Base SHA:
Current commit:
Status:
Changed files:
Tests:
Manual validation:
Dependencies:
Blockers:
Architecture questions:
Next action:
~~~

Required updates:

- At assignment.
- After initial source/test/instruction inspection.
- After the first meaningful diff.
- Before any scope/file/dependency change.
- When tests first pass.
- When a Draft PR opens.
- After each automated-review finding and response.
- After rebase.
- After merge.
- After worktree/branch cleanup.

Use Confirmed, Inferred, and Unknown where they matter. Post architecture/security/privacy decisions to the shared team channel and PR, not a private Codex thread. A disagreement about finality, authority, storage, clocks, credentials, risk, cancellation, or process ownership pauses the affected PR until L and the Founder resolve it visibly.

## 13. Review responsibilities

### 13.1 Lead review

L reviews:

- Architecture ownership and scope.
- Canonical state and identifier/event use.
- Security, credentials, privacy, and least privilege.
- Persistence, migrations, recovery, and rollback.
- Provider and OpenCode boundaries.
- Orchestrator admission/policy/effect authority.
- Acceptance evidence and unsupported claims.

L does not self-approve L-owned PRs; Q or U supplies the human review and the Founder supplies architecture approval where listed.

### 13.2 Quality review

Q reviews:

- Unit/contract/fault coverage.
- Failure paths, races, timeouts, replay, and out-of-order events.
- Voice/provider/task cancellation separation.
- Privacy-safe observability and canary leakage.
- Windows, audio, device, network, long-session, and rollback evidence.
- Reproducibility, temp-data isolation, and honest performance statistics.

### 13.3 UI review

U reviews:

- Visible continuity across typed/Voice/reload/reconnect.
- Provisional/final/interrupted transcript truth.
- Listening/thinking/speaking/follow-up/mute/error truth.
- Approvals, confirmations, progress, results, and unknown outcomes.
- Accessibility, urgent controls, privacy visibility, and error recovery.

### 13.4 Two-review rule

Every VOICE-01 through VOICE-41 PR requires two non-owner human reviewers before merge. Each detailed <strong>Human reviewer</strong> field names both people or names one person plus a designated non-owner domain role that must be assigned before the PR leaves Draft. One reviewer covers architecture/security/authority or the relevant domain boundary; the other covers tests and user-visible failure behavior.

Founder architecture, privacy, copy, security, or release approval is additional and never substitutes for an independent review on a Founder-owned PR. In particular, Engineer L cannot review or merge an L-owned PR merely by acting in the Founder role.

## 14. Integration and release gates

| Gate | Required merged inputs | Exit evidence | Blocks |
|---|---|---|---|
| Current-path mic safety | VOICE-01 | Adopted/owned wake and active/pending renderer capture close on off/quit | All measurement/work |
| Legacy baseline measured | VOICE-02 | Content-free latency/failure baseline and leakage canaries | Architecture migration claims |
| Canonical identifiers established | VOICE-03 | Cross-language fixture agreement and provider-ID non-authority | VoiceTurn/conversation/control |
| Canonical events established | VOICE-03 | Validated envelope, clocks, sequence, privacy, finality names | All canonical producers |
| VoiceTurn ownership established | VOICE-05 | Legal/terminal/cancel/stale invariant suite | Provider and playback integration |
| Shared Voice/text conversation | VOICE-06/07 | One persisted canonical typed/fake message/event and one visible projection; live legacy Voice remains blocked until authenticated | Orchestrator admission and Realtime UI |
| Single-owner background runtime | VOICE-08/12 | Profile lease, renderer reload, atomic consent/tray/Quit truth, close-to-tray, explicit quit, visible privacy | Durable owner/provider lifecycle |
| Secure local control | VOICE-09 through VOICE-11 | Auth/role/schema/sequence/replay/ACL and authenticated live-finality proof; legacy display/media consumers migrated or non-authoritative | Any protected Voice command/credential |
| One audio owner | VOICE-10 | No overlapping mic handles and safe handoff | WebRTC mic rollout |
| Per-generation playback safe | VOICE-11 | Unique/atomic resources, stale rejection, heard progress, immediate stop | Full duplex |
| Minimum Orchestrator foundation | VOICE-13 through VOICE-27 | Contracts, current-behavior façade, encrypted store, Registry, deterministic/hybrid route and Plan Validator, Policy, Gateway, recovery, finite task control, approval UI, default-deny invocation, mediated-or-disabled OpenCode/MCP/PIM/scheduled effects, and founder-signed fault campaign | OpenAI integration and delegation |
| OpenAI credential/adapter ready | VOICE-28 | Fresh official-doc/account/data-control/retention check; permanent key absent; fake contract passes | Cloud-audio consent and WebRTC |
| Explicit cloud-audio consent | VOICE-29 | Separate versioned opt-in, trusted-main enforcement/revocation, truthful window/tray indication, existing profiles local-only, zero media egress | WebRTC |
| WebRTC vertical slice | VOICE-30/31 | Gated named Windows end-to-end path, current consent and first-egress retention checks, safe teardown, and canonical projection | Delegation/full duplex |
| <code>june_delegate</code> contract | VOICE-32 | Finalized-turn admission, trusted recompute, task/cancel separation, fake/no-effect only, all real capability IDs rejected | Capability contract only; real adapters remain Phase 5 |
| True interruption/full duplex | VOICE-33 through VOICE-36 | At most 120 ms p95 silence, no stale resume, separate device/acoustic/network evidence | Natural Voice |
| Follow-up/privacy modes | VOICE-37/38 | Egress/mute/follow-up state and accessible control proof | Broad acceptance |
| Read-context consumer seam | VOICE-39 | Approved consumer shape, fake/no-op only, no broker runtime/usage authority/legacy write/migration | Future Phase 4 adapter; not Voice acceptance through a real broker |
| Windows acceptance | VOICE-40 | Full named matrix, latency/quality/privacy/fault/rollback report | Default cut-over |
| Controlled cut-over | VOICE-41 | Founder approval, staged switch, exercised rollback, legacy retained | Realtime default |
| Public JUNE 0.1 release | Separate release gate | Production Hey JUNE/licensing, broader hardware/installer/update support, full required product gates | Public claims |

No gate may be passed by prose alone. Missing evidence is Unknown and blocks the dependent merge. A provider/account/API or provider retention/data-control change after VOICE-40 invalidates affected evidence and requires revalidation.

## 15. Test strategy

### 15.1 General rules

- Use existing repository test runners and small local helpers; add no global workflow/test framework.
- Use temporary profiles, databases, logs, ports, keys, files, and synthetic audio/text. Never touch real application or user data.
- Inject clock, ID, network, provider, audio, store, and process boundaries so unit/fault tests do not sleep or require hardware.
- Separate deterministic automated proof from explicitly labeled manual Windows evidence.
- A live provider test is opt-in, credential-safe, bounded, and never the only gate.
- Every critical bug receives a focused regression test in its owning PR.
- Tests must assert both positive behavior and absence: no upload, no log content, no durable row, no effect, no stale playback, no second owner.

### 15.2 Coverage map

| Test class | Current evidence inspected | Required target proof | Owner / landing |
|---|---|---|---|
| Unit | Wake threshold/backend, mute, TTS/G2P, consent/status/orb pieces | Every new pure factory, transition, policy, validator, controller, projector | Owning engineer in every PR |
| Contract/schema | OpenCode client/timeouts and upstream schemas only | Cross-language JUNE envelopes, provider adapters, IPC, cloud consent, hybrid plans, invocation/delegation, and read-context contracts | L/Q, VOICE-03/04/09/18/24/28/29/32/39 |
| State machine | PlaybackMute/orb watchdog only | VoiceSession, VoiceTurn, playback, cloud consent/privacy, task/action legal and terminal transitions | L/Q, VOICE-05/11/13/22/29/33/37 |
| Fake provider | No root deterministic Realtime fake | Token/session, WebRTC callbacks, deltas, cancel, disconnect, translation | Q then L, VOICE-04/28/30 |
| Fake capability | Pure backend injection exists but no canonical Registry fake | Read/write, turn/long, R0-R3, idempotent/non-idempotent, unknown outcome, fake-only delegation | L/Q, VOICE-16/18/20/27/32 |
| Cancellation | Visible OpenCode abort script; no Voice generation contract | Consent revoke, Voice stop, provider abort, playback stop, durable-task cancel independently and in races | L/Q, VOICE-05/11/22/29/30/33 |
| Out-of-order/duplicate | Local TTS supersession only | Envelope sequence, finality, provider deltas, task events, IPC replay, UI projection | Q, VOICE-04 and every consumer |
| Stale events | Snapshot replay avoided; no canonical generation | Old turn/generation/provider/renderer events cannot mutate current truth or play sound | L/Q, VOICE-05/09/11/30/33/36 |
| Playback ownership | Attach/play/error tests | Unique resources, atomic publish, cancel-to-silence, heard progress, cleanup | L/Q, VOICE-11/33 |
| Renderer reload | No canonical Voice coverage | Reload during consent/listening/thinking/speaking/follow-up/approval/task; authority persists | L/U/Q, VOICE-07/08/23/29/31/38 |
| Process kill/restart | Supervisor restart tests | Runtime lease, DB transaction, outbox, gateway unknown, task recovery, media-host cleanup | L/Q, VOICE-08/15/20/21/27/36/40 |
| Provider disconnect/reconnect | Current SSE reconnect is session-only | WebRTC/sideband reconnect, new generation where required, reconciliation, no history loss | L/Q, VOICE-30 baseline teardown and VOICE-36 recovery |
| Audio-device changes | None | Unplug/switch/sleep/resume/no silent unexpected mic/no overlap | L/Q, VOICE-10/34/40 |
| Endpointing/VAD | Fixed four-second capture; Whisper VAD does not end capture | Hesitation/overlap/silence/long-utterance suite, measured early/late commits and turn latency | L/Q, VOICE-30 baseline and VOICE-35/40 |
| Echo/background noise | Wake mute only | False interruption, AEC reference, near/far speech, supported speaker/headset matrix | L/Q, VOICE-33/35/40 |
| Network loss/jitter | None | Loss/reorder/jitter/ICE/data-channel failure, bounded recovery/fallback | L/Q, VOICE-30 safe teardown and VOICE-36/40 recovery |
| Privacy egress | Consent tests and G2P reply-log canary | No upload without explicit cloud consent, no pre-activation/muted upload, permanent key absence, scoped fake/no-op context, no forbidden writes/effects | Q/L, VOICE-02/09/24-26/28-30/37/39/40 |
| Provider data controls | No target-account release evidence inspected | Current official/account retention, training, data-control settings and accepted residual Unknowns | L/Q, VOICE-28/29/30/36/40/41 |
| Long sessions | None | CPU/memory/file/queue growth, sequence stability, token expiry, reconnect and cleanup | Q/L, VOICE-36/40 |
| Windows manual | Transitional hardware incidents, no target proof | Named OS/build/device/driver/network/accessibility/tray matrix with exact results | Q coordinates, U/L execute |
| Latency/quality targets | No end-to-end distributions | Wake, transcript, first audio, interruption, WER, names/numbers, naturalness, stale audio | Q, VOICE-02 baseline and VOICE-40 gate |
| Rollback | Current path exists but no route matrix | Every new gate/route state returns to one safe legacy owner with canonical continuity | L/Q, each migration PR and VOICE-40/41 |

### 15.3 Acceptance datasets and statistics

- Synthetic and consented evaluation audio is versioned/licensed, contains no private user material, and is separated into quiet/noisy, accent, names/numbers, interruption, echo, and device cases.
- Report sample count, p50/median, p95, p99, failures, hardware, OS/build, provider/model/date, network conditions, and excluded samples. First-audio and interruption latency must always include p50/p95/p99; no new p99 pass threshold is implied by this reporting requirement.
- WER/naturalness benchmarks never replace privacy, cancellation, finality, stale-audio, or rollback gates.
- No public hardware or quality claim extends beyond the tested matrix.

## 16. File-conflict map

| File/component | Temporary owner | PRs that may edit it | Serialization and interface extraction |
|---|---|---|---|
| <code>phase2-mcp/wake_daemon.py</code> | L; Q only in VOICE-02 with L review | 02, 03/05 legacy adapter, 09/10, 11, 14/25 compatibility, 30/41 migration if necessary | Strict serial order; extract AudioEdge, legacy OpenCode, telemetry, and canonical-event ports before parallel tests |
| <code>phase2-mcp/nightjar_capabilities/voice.py</code> | Q for 02, then L | 02 and 11; 33 only for bounded legacy diagnostics | Serialize telemetry then generation resource ownership; do not mix provider work |
| <code>phase2-mcp/nightjar_capabilities/wakeword.py</code> | L | 10/34 only if a bounded ownership/device seam is necessary; production model later | Freeze by default; expose an interface rather than rewrite classifier |
| <code>phase2-mcp/sidechannel.py</code> | L | 09 and 41; Q adds separate adversarial tests | One security migration owner; retain only explicitly non-authoritative compatibility; never let U edit |
| <code>phase3-ui/src/main/index.ts</code> | L | 01 if necessary, 08/09, 14, 25/26, 28-30, 34/36/37, 41 | Highest conflict; one PR at a time; move runtime, consent, provider, quit, and IPC handlers into focused modules |
| <code>phase3-ui/src/main/services.ts</code> | L | 08-10, 14/25, 28/30, 36, 41 | Serialize runtime/env/provider changes; introduce explicit environment allowlist builder |
| <code>phase3-ui/src/main/supervisor.ts</code> | L | 01, 08, 10, 34/36, 41 | Keep safety patch separate; extract lease/lifecycle interfaces; Q changes tests only |
| <code>phase3-ui/src/main/voice.ts</code> | L | 08/09, 28/29, 34/37, 41 | Separate preference from trusted runtime/privacy controller before provider work |
| <code>phase3-ui/src/main/voiceConsent.ts</code> | L | 28/29/37/41 only when consent semantics require | VOICE-29 owns explicit cloud-audio consent; preserve fail-closed tests and require Founder privacy review |
| <code>phase3-ui/src/shared/voiceConsentCopy.ts</code> | L in 08/29; U only after approved copy | 08, 12, 29, 38 | Background truth lands atomically in 08; explicit cloud-audio disclosure/indication lands atomically in 29; later UI only refines approved wording |
| <code>phase3-ui/src/renderer/src/components/VoiceSettings.tsx</code> / <code>phase3-ui/src/renderer/src/components/BYOKSettings.tsx</code> | L for consent binding in 29, then U | 29 and 38 | VOICE-29 owns disclosure/consent truth without media; VOICE-38 may consume trusted privacy state but not redefine consent |
| <code>phase3-ui/src/main/byok.ts</code> | L | 28 only, later security fixes in separate PR | Expose a narrow main-only credential broker port; never return permanent key |
| <code>phase3-ui/src/main/scheduler.ts</code> | L | 08 ownership/lease; 26 authorization boundary only if required | Freeze poll/recurrence behavior; no Q/U source edit and no current failure diagnosis in Voice |
| <code>phase3-ui/src/preload/index.ts</code> | L | 06, 09, 11, 14, 19/22/23, 25/26, 28-30, 33/36/37 | Serialize; extract a minimal versioned bridge. U consumes types and does not add authority |
| <code>phase3-ui/src/renderer/src/components/NightjarOrb.tsx</code> | L for teardown/authority, then U | 01, 07/12, 10/11, 29/31/33/38, 41 | VOICE-01 owns teardown; VOICE-29 may add trusted cloud indication; later PRs consume stable view models |
| <code>phase3-ui/src/renderer/src/lib/orbAdapter.ts</code> | L for behavior, U after stable ports | 01, 09-11, 30/31/33, 38, 41 | Serialize stop/mic/playback and legacy-consumer migration before presentation; extract read-only Voice status/playback view model |
| <code>phase3-ui/src/renderer/src/context/ConnectionContext.tsx</code> | L | 06, 14/25, possibly 41 compatibility routing | Extract <code>OpenCodeAdapter</code>/<code>ConversationContext</code>; U does not make OpenCode canonical |
| <code>phase3-ui/src/renderer/src/context/SessionsContext.tsx</code> | L for extraction, then U for consumers | 06 then 07/14/23/31 | Merge 06 first; move canonical projection/reducer to focused modules to keep UI PRs disjoint |
| <code>phase3-ui/src/renderer/src/lib/opencode.ts</code> | L | 06, 14/25, 41 fallback | Keep a root-owned compatibility/coding adapter; no provider/canonical authority |
| New VoiceTurn/Conversation/runtime modules | L | 03, 05, 06, 08-11, 28-39 | Publish stable ports and fakes; Q/U work outside production owner files |
| New Orchestrator modules/store | L; Q test-only | 13-26; Q in 27 | Contracts → façade → store → Registry → admission → model/plan → policy → gateway → recovery → task control → invocation enforcement → route-family mediation is mandatory |
| <code>engine-workspace/opencode.json</code> | L with OpenCode/Memory review | 25; 41 only for declared fallback routing | Serialize authority changes; never touch submodule; no Phase 5 capability activation |
| Existing OpenCode/MCP capability entry points | L with OpenCode/MCP owner | 25 authorization/mediation only | Mediate or disable current effects without feature productization; real adapters remain Phase 5 |
| Existing PIM/scheduled-effect entry points | L with PIM/scheduling owner | 26 authorization/mediation only | Mediate or disable effects without scheduler repair, recurrence redesign, or real-data access |
| Auto-recall plugin and legacy Memory/PIM stores | Memory/PIM owner; frozen except declared mediation edge | No Voice PR; VOICE-24 may inventory and VOICE-25/26 must stop if store/plugin edits are required | VOICE-39 must not edit/open them; a required authority change gets its own approved cross-system scope |

No PR may casually add a second helper with the same ownership. If two planned PRs need one high-risk file, the earlier PR extracts the smallest stable interface and the later PR rebases onto it.

## 17. Risks and stop conditions

| Risk | Guardrail | Stop condition |
|---|---|---|
| Breaking current Voice | Shadow/feature flag, compatibility adapters, regression tests, rollback at every migration | Legacy path cannot complete a known-good turn or rollback |
| Provider lock-in | Provider-neutral VoiceTurn/events/media/delegation ports; provider IDs metadata only | OpenAI event/model shape leaks into canonical domain |
| Credential exposure | Trusted broker, ephemeral client credential, main-only permanent key, canary scans | Permanent key reaches renderer, worker env/args, logs, prompt, or test artifact |
| Cloud-audio consent bypass | VOICE-29 separate versioned opt-in, trusted-main enforcement/revocation, local/cloud copy and window/tray truth | Key, flag, account, ordinary mic consent, renderer, or provider state can open/send audio without current explicit cloud consent |
| IPC forgery/replay | User ACL, roles, per-run auth, schema, sequence, rate/payload limits | Untrusted/replayed peer can change canonical/control state |
| Conversation duplication | Idempotent persisted commit before finalized event; projection dedupe | One spoken turn creates multiple canonical messages/admissions |
| Old/stale audio | <code>generation_id</code>, controller authorization, stale drop, atomic unique resources | Cancelled/old generation produces sound or state |
| Incorrect interruption | Local authenticated onset, immediate stop, provider cancel, heard progress, task separation | False task cancel, stale resume, or silence target unmeasurable |
| Cross-PR file conflict | Reservations, one owner, serial rebases, extracted ports | Two sessions edit authority-critical file or resolve provisional contract privately |
| Beginner overreach | Q test-only seams; U read-only UI consumers; L owns authority | Q/U needs credential, policy, migration, main lifecycle, audio authority, or provider source |
| Scope creep | Exact PR exclusions/stop conditions; separate follow-up PR | Scheduler, Memory V1, wake training, broad capability, redesign, or cleanup enters a Voice PR |
| Hidden Memory redesign | Voice-owned consumer port with fake/no-op only; Phase 4 owner/gate for real runtime | Broker implementation, persisted usage authority, legacy store/plugin/write/migration, or real personal context appears in VOICE-39 |
| Hidden Orchestrator redesign | Master's local SQLite design; no global framework; nine foundation categories split into bounded PRs | New workflow platform, omitted hybrid Plan Validator, or direct capability shortcut is proposed |
| Active capability bypass | VOICE-14 initial inventory, VOICE-24 complete default-deny inventory/enforcement, VOICE-25/26 route-family mediation, VOICE-27 adversarial proof | Any enabled OpenCode/MCP/PIM/scheduled effect bypasses Registry, Policy, or Gateway at Phase 2 exit |
| API/model/account/data-control change | Fresh official docs/account/retention checks at VOICE-28, before first live egress in VOICE-30, and at VOICE-36/40/41 release evidence | Model/API/credential/retention flow differs materially, required data control is unacceptable, or account access is absent |
| Scheduler/background interference | One runtime lease; scheduler source frozen except ownership | Second poller/owner starts or current poller bug is folded into Voice |
| Unsupported hardware claim | Named Windows matrix and Unknown labels | Claim exceeds tested OS/device/driver/acoustic conditions |
| Transcript-final misuse | Only Conversation Service emits finalized after persistence | Partial or <code>voice.user.transcript.final</code> creates durable/effect/memory work |
| Model-proposed classification trusted | Registry recompute and policy decision; no risk input in delegate | Model/provider lowers/authors authoritative risk/permission/retry/verification |
| Cross-process monotonic misuse | Compare <code>monotonic_ns</code> only within producer; IDs/sequence/state across processes | Ordering/duration relies on comparing different process clock origins |
| OpenCode compatibility confusion | Root adapter, canonical mapping, reconciliation after SSE loss | OpenCode session/SSE/localStorage becomes system of record |
| Privacy mode mismatch | Trusted egress state and visible indicator; fail closed | UI says muted/off while media uploads or an unexpected mic is open |

## 18. Deferred work

### 18.1 Required Voice V1 in this portfolio

- Current microphone shutdown safety and privacy-safe baseline.
- Canonical IDs/events, VoiceTurn, conversation, secure control, one runtime/mic/playback owner.
- Minimum deterministic/hybrid Orchestrator foundations, closed compatibility bypasses, and a fake-only narrow delegation bridge.
- OpenAI Realtime/WebRTC behind separate explicit cloud-audio consent and current provider data-control approval, true interruption, separately gated device/acoustic/network resilience, and follow-up/privacy modes.
- Voice-owned read-context consumer port with fake/no-op default and no Memory runtime dependency.
- Windows acceptance, reversible controlled cut-over, and retained legacy fallback.

### 18.2 Required public-release hardening after/beside internal Voice cut-over

- Licensed, validated production <code>Hey JUNE</code> wake model and false-accept/false-reject campaign.
- Broader supported Windows hardware/driver/acoustic matrix and installer/update/autostart recovery.
- Extended soak, accessibility/localization, provider quota/cost/abuse monitoring, operational support/runbooks.
- Full product-level export/deletion/backup/recovery gates and all non-Voice JUNE 0.1 requirements.
- A separately reviewed legacy-retirement PR only after sustained production evidence; VOICE-41 does not delete it.

### 18.3 Full Memory V1 implementation

- Inventory and conservative classification of legacy KG, project memory, recall plugin, OpenCode/conversation sources.
- Real MemoryBroker, encrypted <code>june_memory.db</code>, DPAPI-wrapped key, typed temporal provenance/sensitivity, retrieval/indexes.
- Candidate extraction only from <code>conversation.turn.finalized</code> or separately authorized eligible trigger; review/correction/deletion, usage/egress ledger, migration and rebuild.
- Real <code>LegacyMemoryAdapter</code> and retirement of raw auto-recall only in the Memory program.

### 18.4 Production wake and alternative provider work

- Wake-model training/licensing/deployment is separate from Voice provider integration.
- Alternative provider benchmarks, Qwen or other modular STT/LLM/TTS adapters, phrase-safe streaming, and provider selection changes require new evidence and architecture approval.
- This plan selects no new provider beyond the already approved OpenAI Voice V1 path.

### 18.5 Broader capabilities and future platform

- Phase 5 real capability adapters: first durable Deep Research, then Quick Search and other reviewed adapters; VOICE-32 does not activate them.
- Email/external calendar/commerce/devices/general browser/files/CAD production expansion.
- Agent teams, Personal App Builder, computer use, credential/session brokering for workers, human takeover, independent verifier expansion.
- Always-on cloud JUNE, cloud computers/workers, mobile session handoff, cross-device sync, and operation while the PC is off.

## 19. Recommended immediate first PR

### VOICE-01 — <code>fix(voice): close microphones on disable and quit</code>

- **Owner:** Engineer L.
- **Reviewer:** Engineer Q plus Engineer U for the visible off-state; Founder approves the privacy behavior.
- **Branch:** <code>voice/01-mic-shutdown-safety</code>, created from the then-current clean main.
- **Title:** <code>fix(voice): close microphones on disable and quit</code>.
- **Objective:** Repair the two confirmed current-path fail-closed gaps before any instrumentation or architecture migration.
- **Exact scope:** Make generic application shutdown stop an adopted <code>wake-daemon</code> without changing non-Voice adopted-service behavior; make a Voice-off status invoke the renderer adapter's immediate stop so acquired and pending mic tracks cannot remain/reappear; add focused deterministic regressions at the actual <code>NightjarOrb</code> status-application boundary and the exact Quit orchestration boundary. Expected files are <code>supervisor.ts</code>, <code>index.ts</code> only if required to exercise the real shutdown path, <code>supervisor.voice-gate.test.ts</code>, <code>NightjarOrb.tsx</code>, <code>orbAdapter.ts</code> only if its stop contract needs hardening, and focused orb/component tests. If a new focused test helper/file is required, declare it before editing.
- **Exact exclusions:** No telemetry, transcript-log change, event/ID schema, side-channel security, tray/background redesign, scheduler work, Python pipeline change, consent redesign, dependency, provider, database, Memory, Orchestrator, or OpenCode change.
- **Acceptance criteria:** Voice-off and explicit Quit close every current Voice mic owner; pending <code>getUserMedia</code> resolves into an immediately stopped track; adopted wake health port closes; ambiguous/unresolved listener reports stuck rather than off; operations are idempotent.
- **Tests:** Extend Supervisor voice-gate tests and, if <code>index.ts</code> participates, a Quit-orchestration regression for the exact generic shutdown path; add a focused <code>NightjarOrb</code> component/controller test proving <code>enabled: false</code> calls teardown for active and pending capture; retain adapter active/pending/repeated-off/stale-wake cases; run focused tests, the full existing Electron unit suite, typecheck, and build in the implementation session.
- **Manual validation:** On Windows with an isolated profile, validate managed and adopted wake cases, active/pending renderer capture, Settings/orb off, window/app explicit Quit, OS mic indicator, port 8766, and restart. Record exact OS/build/device and do not inspect private data.
- **Privacy constraints:** No transcript/audio/key/path logging; no broad PID kill; re-resolve the sole listener; missing/ambiguous proof fails closed and stays visibly stuck.
- **Stop conditions:** Fix needs broad Supervisor adoption semantics, a dependency, Python rewrite, untestable PID targeting, new consent meaning, or any file/behavior outside the declared safety boundary.
- **Expected clean final state:** One focused commit on its branch, only declared files changed, tests/Windows evidence reported, root and submodule clean, no generated/user data, Draft PR open, owner stopped before merge.
- **Parallel work for Engineer Q:** Prepare VOICE-02's field allowlist, fake clock, content canaries, and baseline test plan in a separate worktree; do not merge before VOICE-01 and do not touch PR-1 files.
- **Parallel work for Engineer U:** Prepare mock-only off/background state and accessibility test cases; do not edit <code>NightjarOrb.tsx</code>, <code>orbAdapter.ts</code>, preload, or main until VOICE-01 merges and interfaces settle.

## 20. Implementation-plan capsule

BEGIN JUNE VOICE IMPLEMENTATION PLAN CAPSULE

- **Full base SHA:** <code>babc54af87f6123fd5ad3383ad92c75b2fd2be46</code>.
- **Total planned PRs:** 41 bounded PRs.
- **Critical path:** VOICE-01 → 02 → 03 → 04 → 05 → 06 → 08 → 09 → 10 → 11 → Phase 1 gate → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22 → 24 → 25/26 → 27 → Phase 2 gate → 28 → 29 → 30 → 31 → 32 → 33 → 34 → 35 → 36 → 37 → 38 → 40 → 41. VOICE-07/12/23 join their phase gates and VOICE-39 joins before acceptance.
- **Parallel lanes:** L owns authority/security/storage/provider; Q owns telemetry/fakes/faults/acceptance; U owns read-only canonical UI/accessibility against mocks and rebases after producers merge.
- **First PR:** VOICE-01, <code>fix(voice): close microphones on disable and quit</code>, because current off/quit can leave microphone ownership alive.
- **Earliest safe OpenAI integration point:** VOICE-28 after VOICE-27 closes every Phase 1 and Phase 2 gate. Earlier work is interface/fake preparation only and must rebase/reverify; live microphone egress waits for explicit VOICE-29 consent and VOICE-30's fresh retention gate.
- **Earliest safe <code>june_delegate</code> point:** VOICE-32 after VOICE-27/30/31, with fake/no-effect capabilities and deny-all-real behavior only; real adapters wait for Phase 5.
- **Orchestrator prerequisite:** Canonical finalized admission, contracts, current-behavior façade, encrypted runtime DB, trusted Registry, deterministic routing, typed model proposals and Plan Validator, Policy/Consent, Action Gateway/ledger, recovery, finite task control, approval/progress UI, default-deny capability invocation, separately mediated-or-disabled OpenCode/MCP and PIM/scheduled effects, and the fake-capability fault gate.
- **Memory prerequisite:** VOICE-39 may merge the approved consumer shape with fake/no-op only; real MemoryBroker/LegacyMemoryAdapter/runtime/storage/usage authority/migration is Phase 4 and is neither an OpenAI nor Voice-acceptance prerequisite.
- **Highest-risk files:** <code>wake_daemon.py</code>, <code>sidechannel.py</code>, Electron <code>main/index.ts</code>/<code>services.ts</code>/<code>supervisor.ts</code>/<code>preload/index.ts</code>, <code>voiceConsent.ts</code>, <code>voiceConsentCopy.ts</code>, <code>VoiceSettings.tsx</code>, <code>BYOKSettings.tsx</code>, <code>NightjarOrb.tsx</code>, <code>orbAdapter.ts</code>, <code>ConnectionContext.tsx</code>, <code>SessionsContext.tsx</code>, <code>opencode.ts</code>, and <code>engine-workspace/opencode.json</code>.
- **Team rules:** One PR/session/worktree; protected clean main; one temporary owner per authority file; Draft PRs; owners do not merge; visible architecture decisions; mandatory rebases; no submodule mutation; current Voice retained until proof and rollback.
- **Known unknowns:** Exact compliant ConversationStore backend/module placement; final background/media-host process placement; audio handoff/pre-roll/AEC/VAD tuning; real Windows device/latency/quality matrix; JUNE account/model and provider retention/data-control state at integration; production Hey JUNE model; current scheduler poller failure cause; deployed OpenCode reconnect details; and Phase 4 MemoryBroker implementation timing, which does not block Voice acceptance.

END JUNE VOICE IMPLEMENTATION PLAN CAPSULE
