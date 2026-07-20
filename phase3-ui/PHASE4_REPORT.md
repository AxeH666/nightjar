# Nightjar Phase 4 Report — voice-reactive orb (orb-ui)

Integrate **orb-ui** (github.com/alexanderqchen/orb-ui, MIT) as Nightjar's
voice-reactive orb, replacing the static amber placeholder disc in the header.
The orb now reflects the real voice-pipeline lifecycle (idle → listening →
thinking → speaking) off the Phase-2 side-channel and pulses with live audio via
the Web Audio API.

## Result: typechecks clean, builds clean, **34/34 orb checks pass** — incl. live end-to-end against the real :8765 hub

- `tsc --noEmit` (node + web) ✅ zero errors.
- `electron-vite build` ✅ — all three processes bundle; orb-ui + amber theme land
  in the renderer (verified in the emitted bundle, below).
- `bun test-orb.ts` ✅ **34/34** — pure RMS math, the AnalyserNode monitor loop,
  the full adapter state machine (mocked audio/WS), **and the adapter's real
  WebSocket path driven by real publish frames on the live side-channel hub**.

### Honest limits (same hardware constraint Phase 3 documented)
This box has **no functional display** (`xset q` fails) and **no audio card**
(ALSA exposes only `timer`; no capture/playback). So there is still **no visual
GUI screenshot and no live-mic/speaker QA** — those need real hardware. What is
proven here is the **data + state + audio-reduction layer end-to-end** (against
the real hub) plus build/typecheck, exactly the evidence bar Phase 3 set. The
live "say 'Hey Nightjar' and watch the orb glow" test is wired and unit/integration-
green, but its *visible/audible* confirmation is deferred to a machine with a
screen, mic, and speakers.

## What was built (`phase3-ui/`)

Dependency: **`orb-ui` pinned to exactly `0.2.4`** (no caret — it's pre-1.0, API
may break on minor bumps). Peer deps (react/react-dom ≥18) already satisfied by
Phase 3. License MIT (permissive → fine inside Nightjar's AGPL combined work).

- **`lib/audioVolume.ts`** — the audio-reduction core. `rmsFromByteFrequency()`
  reduces an `AnalyserNode`'s `getByteFrequencyData` to one RMS scalar/frame;
  `normalizeVolume()` is orb-ui's mic curve (`pow(min(v/0.5,1),1.3)`);
  `AudioLevelMonitor` wraps one `AudioContext`+`AnalyserNode`, attaches either a
  **mic MediaStream** (listening) or an **`<audio>` element** (speaking, split to
  analyser *and* speakers), and runs a per-frame EMA loop. AudioContext + frame
  scheduler are injectable, so it runs in the renderer (real Web Audio) and
  headless in tests (mock nodes + manual clock).
- **`lib/orbAdapter.ts`** — **`createNightjarOrbAdapter()`**, a real orb-ui
  `OrbAdapter` (same `subscribe({onStateChange,onVolumeChange})` + start/stop
  contract as orb-ui's Vapi/ElevenLabs adapters; structurally verified against
  orb-ui's own `OrbAdapter` type at compile time). It:
  - connects to the **side-channel WS (`ws://127.0.0.1:8765`)** and maps events →
    state (table below), with auto-reconnect + backoff;
  - owns the **mic monitor** (listening volume) and the **Kokoro-TTS playback
    monitor** (speaking volume);
  - plays the TTS WAV the pipeline produced and drives speaking → idle off the
    `<audio>` `ended` event; optionally publishes `tts playing/ended` back so the
    side-channel reflects real playback (ignoring its own echoes, so no loop).
  - Every browser dependency (WebSocket, AudioContext, getUserMedia, `<audio>`,
    the local-file→URL step) is injectable → fully headless-testable.
- **`components/orb/AmberCircleTheme.tsx`** — a **fork of orb-ui's `circle`
  theme** with only the palette swapped to Nightjar amber (`#C9852E` accent /
  `#A13D2B` alert). orb-ui hard-codes the circle colors and does **not** expose
  them as a prop, so — as Phase 4 scoped — forking the theme file is the path.
  The volume→scale/glow mapping, 60fps interpolation, settle-to-idle, and
  keyframes are copied verbatim from `orb-ui@0.2.4` so the motion matches upstream.
- **`components/orb/NightjarOrb.tsx`** + **`lib/useOrbAdapter.ts`** — the hook
  bridges the adapter's callbacks into React state; the component renders the
  amber theme in **controlled mode** (`state` + `volume` props), the render shape
  the phase specified. Replaces `OrbPlaceholder` (deleted) in the header.
- **Electron TTS bridge** — `main/index.ts` adds a path-guarded
  `nightjar:readAudio` IPC (reads the Kokoro WAV bytes; restricted to the Nightjar
  data dir / tmp + audio extensions), `preload` exposes `readAudio()`, and the
  config IPC now also carries `sideChannelUrl`. The renderer can't fetch an
  arbitrary local file, so it wraps the returned bytes in a blob URL for playback.

## State mapping (side-channel → orb)

| Side-channel event (`kind`)                | Orb state    | Volume source                         |
|--------------------------------------------|--------------|---------------------------------------|
| — (resting, WS up)                         | `idle`       | — (gentle idle pulse; armed for wake) |
| `wake` (`detected≠false`)                  | `listening`  | mic AnalyserNode → RMS                 |
| `transcription` (`final`)                  | `connecting` | — (agent thinking; pulses)            |
| `tts` (`state:"ready"`, `path`)            | `speaking`   | TTS `<audio>` AnalyserNode → RMS       |
| TTS `<audio>` `ended`                       | `idle`       | —                                     |
| WS dropped after being open                | `error`      | — (auto-reconnects → `idle`)          |

Safety timeouts: `listening`→`idle` if no transcript (15s), `connecting`→`idle`
if a reply produces no TTS (text-only, 30s). Both configurable.

## Wake-word test — wired and green at the state/data layer

The scoped acceptance flow — **"Hey Nightjar" → idle→listening (live voice
reactivity) → transcription → speaking during TTS → back to idle** — is:
- **Proven headlessly, end-to-end, against the REAL running side-channel hub**
  (`test-orb.ts` §3): an independent producer publishes real `wake` →
  `transcription` → `tts` frames to `:8765`; the adapter's real WebSocket receives
  them and transitions `idle→listening→connecting→speaking→idle`. Full lifecycle
  observed.
- **Volume reactivity proven** (§2a/§2b) via the AnalyserNode monitor: louder
  input → higher normalized volume, mic gated to listening, output gated to
  speaking, both released on state exit.
- **NOT yet confirmed visually/audibly** — no display/mic/speakers here (see
  limits above). The one missing piece for a *live* mic demo is Phase 2's
  explicitly-deferred **live-mic wake daemon** (openWakeWord over a real mic feed);
  the side-channel + orb consume its `wake`/`transcription` events, which this
  phase drives with real published frames instead.

## Verification evidence

```
# 1. RMS + normalize (pure)                     8/8
# 2a. AudioLevelMonitor (mock ctx + clock)      3/3
# 2b. Adapter state machine (mock WS + audio)  17/17
# 3. Live integration vs REAL :8765             6/6
34/34 checks passed
```
Bundle spot-check (`out/renderer/assets/*.js`): all five amber state colors,
`orb-amber-*` keyframes, `data-orb-state`, `getByteFrequencyData`, and
`ws://127.0.0.1:8765` are present — the orb is wired, not tree-shaken.

## orb-ui version pin
> **Superseded (Step 7):** `orb-ui` was later **dropped** for a custom three.js vortex orb and is no
> longer in `package.json`/`package-lock.json`. The pin note below is historical — see
> `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` Step 7.

`orb-ui@0.2.4` (exact, in `package.json` + `package-lock.json`). Pre-1.0 → pinned
without a caret so a `0.3.x` doesn't silently change the adapter/theme contract.
If bumping: re-check `OrbAdapter`/`OrbState` shapes and re-sync `AmberCircleTheme`
against upstream's `circle` theme.

## Known issue logged for the next pass (NOT fixed here, by direction)
**Agent self-identifies as "Odysseus" instead of "Nightjar."** Identity leak from
the Odysseus capability tier (its companion API advertises `"name":"odysseus"` +
Odysseus persona prompts reaching the agent). Recorded in
[`../KNOWN_ISSUES.md`](../KNOWN_ISSUES.md) as **NJ-1** for the upcoming UI/bug-fix
pass; likely fix is in the Nightjar system prompt / `opencode.json` agent
definitions.

## Not done (as scoped / environment-limited) — SUPERSEDED, see UPDATE below
- Visual GUI screenshot + live mic/speaker QA — needs real hardware.
- Live-mic wake daemon (Phase 2 deferral) — the orb is ready to consume it.
- Odysseus identity fix — deferred (NJ-1).

---

# UPDATE — post-Phase-4 follow-ups (2026-07-05)

Everything in the three "Not done" bullets above (and the "Honest limits" /
"NOT yet confirmed visually/audibly" caveats) has since been **done**. The
Phase-4 narrative above is the accurate record of where Phase 4 itself stopped;
this section supersedes its forward-looking caveats.

### 1. The box is NOT headless — real visual + audio QA achieved ✅
The "no functional display / no audio card" conclusion was **wrong**. This
machine runs **WSLg**, which provides a working X display *and* working
PulseAudio (capture + playback) — the earlier `xset q` failure was a missing
binary, not a missing display. So the Phase-3/Phase-4 "headless, can't verify
visually" caveat no longer holds:
- **The real Electron UI was launched and screenshotted** against the live
  stack — the amber orb rendered in all states (idle / listening / connecting /
  speaking) and a real chat round-trip rendered correctly.
- **A real audio wake→reply→TTS loop ran** end-to-end through PulseAudio (see §2).

### 2. Live-mic wake daemon BUILT + tested end-to-end ✅ (`phase2-mcp/wake_daemon.py`)
The Phase-2-deferred always-on voice loop now exists as running code: captures
the live mic via `parec` (PulseAudio, no new heavy audio dep), scores every 80 ms
frame with openWakeWord, records a follow-up window, transcribes with
faster-whisper, POSTs the command to a persistent OpenCode session, collects the
reply off the real SSE stream, synthesizes it with Kokoro, and publishes
`wake`/`transcription`/`tts` to the side-channel — the exact event shapes
`mcp_server.py` already emits, so the orb animates identically. Every long call
has a hard wall-clock timeout (per CLAUDE.md rule 3). **Verified end-to-end on
real audio** (synthesized "Hey Jarvis" + a question played into a PulseAudio
loopback → wake fired → transcribed → real agent reply → spoken back). Wired into
the Electron supervisor as a managed service (`src/main/services.ts`, health port
8766). Still using the STOCK wake model — a trained `hey_nightjar.onnx` remains
the one open item (`wakeword_training/README.md`).

### 3. Siri-style orb overlay BUILT ✅ (`src/renderer/src/components/orb/OrbOverlay.tsx`)
When the pipeline is active (state ≠ idle) the orb scales up, floats centered
over the app, and the background dims; it shrinks back on idle. Shares the one
adapter subscription with the header orb. Verified in the screenshots above.

### 4. Real bug fixed while wiring playback: CSP blocked TTS audio ✅
The renderer CSP had no `media-src` directive, so `blob:` audio URLs (how the orb
loads the Kokoro WAV) were silently refused — **TTS playback had never actually
worked in the built app**. Fixed in `src/renderer/index.html`
(`media-src 'self' blob:`).

### 5. NJ-1 / NJ-2 / NJ-3 all FIXED ✅ (see `../KNOWN_ISSUES.md`)
- **NJ-1** (identity): the "companion API advertises name:odysseus" hypothesis in
  the section above was **not** the real cause. Live probing showed the actual
  cause: the `research`/`coding` prompts had no identity anchor while the system
  prompt is saturated with `odysseus-*` (tool-name prefixes + `<server
  name="odysseus-…">` MCP-instruction tags). Fixed by adding a shared Nightjar
  identity rule to all three agent prompts (`phase2-odysseus/workspace/opencode.json`);
  verified all three modes now answer "I am Nightjar," even after invoking a real
  Odysseus tool.
- **NJ-2** (mode selector showed build/plan): fixed with a `native !== true`
  filter in `lib/opencode.ts`; verified the selector shows exactly
  Assistant/Coding/Research.
- **NJ-3** (user message rendered twice): optimistic add + server echo under a
  different id; fixed in `App.tsx` by dropping the server's user-message echo;
  verified a real send renders `you:1, nightjar:1`.

Still genuinely open: a trained "Hey Nightjar" wake model, and QA on real
(non-WSL) hardware.
