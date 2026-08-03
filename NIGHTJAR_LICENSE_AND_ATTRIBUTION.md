# Nightjar — License & Attribution

## License of the combined work: **AGPL-3.0-or-later**

Nightjar is a fully open-source, local-first AI coding + personal assistant,
licensed under the GNU Affero General Public License, version 3 or later
(AGPL-3.0-or-later) — see `COPYING`.

**History of that choice, and its current status (updated 2026-08-03, PR E):**
- The AGPL license was originally **forced** by integrating Odysseus
  (AGPL-3.0-or-later) as a capability tier. That constraint is **gone**: the
  Odysseus removal (PRs #140–#145 and this PR) deleted or rebuilt every Odysseus
  tier Nightjar used, and this PR removed the `research/odysseus` submodule
  itself. **No Odysseus code remains in the tree.**
- Correction for the record: earlier revisions of this document justified the
  integration as "bridging over MCP between separate processes, not linking
  codebases." That justification was **never actually available** — Nightjar's
  wrappers imported Odysseus's modules **in-process** (six direct imports via a
  `sys.path` bridge: the ORM in `pim_server`, `DeepResearcher` in
  `deep_research_server`, `DocsService` in `docs_query_server`, and so on). The
  combined work was AGPL because AGPL code was linked in, not because of a
  process boundary. The conclusion (AGPL combined work) was right; that
  argument for it was not.
- **Nightjar remains AGPL-3.0-or-later today** because its own code was released
  under that license. With the Odysseus constraint removed, RELICENSING IS NOW
  UNBLOCKED — but any license change is a separate, deliberate maintainer
  decision taken against a frozen dependency graph, not part of the removal
  PRs. Until that decision, nothing about the project's license has changed.
- The dependency-graph copyleft status is continuously enforced by
  `phase2-mcp/tests/test_no_copyleft_venv.py` (no GPL/AGPL; the accepted
  weak-copyleft items are allowlisted with recorded reasoning — see NJ-42,
  NJ-52, NJ-53 in `KNOWN_ISSUES.md`).

### AGPL §13 (network use) — operational note
AGPL requires that users interacting with the software **over a network** be
offered its Complete Corresponding Source. Nightjar is local-first (offline), so
this rarely triggers — but any future hosted / remote-access / "share my Nightjar
over the LAN" mode MUST offer source to those remote users. Flagged for anyone
adding networked access.

## Upstream components and their licenses (all preserved)

| Component | Role | License | Attribution preserved at |
|---|---|---|---|
| OpenCode | native agent engine | MIT | `research/opencode/LICENSE` (git submodule, `AxeH666/opencode` fork — fetched on clone) |
| Row-Bot | voice/vision/memory/browser bolt-on | Apache-2.0 | `phase2-mcp/NOTICE`, `phase2-mcp/LICENSE.row-bot` |
| Odysseus | **REMOVED (PR E, 2026-08-03)** — was the email/RAG/research/PIM bolt-on; every tier was deleted or rebuilt Nightjar-side (PRs #140–#145), and the submodule is gone. No Odysseus code remains | AGPL-3.0-or-later (historical) | upstream https://github.com/pewdiepie-archdaemon/odysseus |
| llmfit (© 2026 Alex Jones) | hardware model-fit (vendored at `phase1-engine/hwfit_vendor/`) | MIT | `phase1-engine/hwfit_vendor/LICENSE.llmfit-MIT` (travels with the vendored copy) |
| Tongyi DeepResearch (Alibaba-NLP / Tongyi Lab) | deep-research **pattern reference only** — Nightjar's `phase2-mcp/deep_research_backend.py` is an original implementation of the search→fetch→extract→synthesize shape; **no code copied** (the AGPL Odysseus adaptation was removed in PR F) | Apache-2.0 | pattern credited here; upstream https://github.com/Alibaba-NLP/DeepResearch |
| three.js (© three.js authors) | custom voice-reactive vortex orb (WebGL, redesign Step 7) | MIT | `phase3-ui/node_modules/three/LICENSE` |
| orb-ui (© Alexander Chen) | **derived math only** — the RMS reduction + EMA smoothing + normalization curve in `phase3-ui/src/renderer/src/lib/audioVolume.ts` mirror orb-ui's mic monitor (`normalizeMicVolume`); the `orb-ui` npm dependency and the forked `AmberCircleTheme` were removed in redesign Step 7 | MIT | source-header attribution in `audioVolume.ts` |
| react (© Meta Platforms / Facebook, Inc.) | UI framework for the Electron renderer | MIT | `phase3-ui/node_modules/react/LICENSE` (npm dep) |
| react-dom (© Meta Platforms / Facebook, Inc.) | React DOM renderer (renderer root) | MIT | `phase3-ui/node_modules/react-dom/LICENSE` (npm dep) |
| Browser Use (© 2024 Gregor Zunic) | autonomous web tasks / form-filling (separate MCP) | MIT | `browser-use-mcp/THIRD-PARTY-LICENSES/browser-use-MIT-LICENSE.txt` (pip dep, isolated venv) |
| marked | markdown→HTML in the live-preview panel | MIT | `phase3-ui/node_modules/marked/LICENSE` (npm dep) |
| gemma-chat (© 2026 ammaar) | live-preview "Canvas" **pattern reference only** — reimplemented, **no code copied** (`phase3-ui/src/main/preview-server.ts` + `components/ArtifactPanel.tsx` are original AGPL) | MIT | pattern documented in `research/AUDIT_REPORT.md` §5; no gemma-chat files vendored |
| Kokoro-82M (© 2024 hexgrad) | TTS model weights (downloaded to the user's model cache, not vendored); since voice-phase PR 5 also the wake-word **training-positive generator** (the Apache-2.0 replacement for the NJ-59-tainted Piper voice) | Apache-2.0 | `phase2-mcp/NOTICE` |
| misaki (© 2025 hexgrad) | TTS grapheme-to-phoneme — the reference G2P Kokoro was trained with | Apache-2.0 | `phase2-mcp/NOTICE` (pip dep) |
| kokoro-onnx (© 2024 thewh1teagle) | **data only** — the 114-entry phoneme→id table, vendored to `phase2-mcp/nightjar_capabilities/kokoro_vocab.json`; the package itself is **no longer a dependency** | MIT | `phase2-mcp/NOTICE` |
| en_core_web_sm (© 2016 ExplosionAI GmbH) | spaCy English pipeline misaki uses for POS tagging | MIT | `phase2-mcp/NOTICE` (pip dep, install-time) |
| openWakeWord (© dscripka) | **REMOVED (voice-phase PR 5)** — was the wake-word engine; replaced by hey-buddy because its bundled pretrained models are CC-BY-NC-SA (non-commercial, NJ-58 — resolved by the removal). Purged from requirements + venv + both setup scripts; `tests/test_model_licenses.py` fails if it returns | split: code Apache-2.0; models CC-BY-NC-SA 4.0 (historical) | package LICENSE + README license section (was read from the installed wheel, rule 5) |
| hey-buddy (© benjamin-paine) | wake-word engine: training pipeline + JS reference implementation (vendored at `phase2-mcp/wakeword_training/heybuddy_vendor/`, pinned `6e78d26`, fork `AxeH666/hey-buddy`); runtime is a Nightjar-authored onnxruntime port of its JS path | Apache-2.0 (LICENSE read, full text, rule 5). ⚠ its GitHub README says the **pretrained models** are Apache-2.0 while its HF repo card says CC-BY-4.0 — conflict recorded as **NJ-60**; we comply with the stricter. Its shipped models also carry the NJ-59 Piper lineage — see the `hey-buddy.onnx` manifest entry | `heybuddy_vendor/LICENSE` + `heybuddy_vendor/VENDOR.md`; `phase2-mcp/NOTICE` |
| speech_embedding (© Google LLC) | the frozen wake-word backbone: `speech-embedding.onnx` (96-d embeddings), vendored + sha256-pinned at `phase2-mcp/nightjar_capabilities/models/wakeword/` | Apache-2.0 — **primary-source verified 2026-08-03** at https://www.kaggle.com/models/google/speech-embedding (model card: LICENSE Apache 2.0), and weight-identity-proven against openWakeWord's copy by running both (NJ-58 resolution) | `phase2-mcp/model_licenses.json` (checksummed entry) |
| mel-spectrogram.onnx (torchlibrosa lineage, © Qiuqiang Kong; ONNX export by benjamin-paine) | wake-word mel front end, vendored + sha256-pinned; **byte-identical** to the copy openWakeWord shipped | Apache-2.0 per hey-buddy's licence statement | `phase2-mcp/model_licenses.json` |
| sounddevice (© 2015-2025 Matthias Geier) | cross-platform mic capture for the wake daemon (voice-phase PR 3) | MIT | `venv/.../sounddevice-*.dist-info/licenses/LICENSE` (pip dep) |
| PortAudio (© Ross Bencina, Phil Burk) | audio I/O library the sounddevice wheel bundles as DLLs | MIT (per the wheel's `portaudio-binaries` README). ASIO-enabled variant embeds the proprietary Steinberg ASIO SDK — **never loaded** (`SD_ENABLE_ASIO` unset); wheel fetched by the user's pip at setup, not vendored | `venv/.../_sounddevice_data/portaudio-binaries/README.md` |

(Historical note: while the Odysseus submodule was in-tree, its
`ACKNOWLEDGMENTS.md` and `licenses/` directory had to ship with any Nightjar
distribution. That obligation ended when the submodule was removed in PR E —
no Odysseus code ships. The one Odysseus-transited component Nightjar keeps,
llmfit, carries its own MIT license file at `phase1-engine/hwfit_vendor/`.)

### Copyleft watch-items pulled in via Odysseus — RETIRED (PR E)
PyMuPDF / SearXNG / caldav were watch-items of the Odysseus dependency tree,
which is no longer part of Nightjar. None of them is a Nightjar dependency:
deep research uses **pypdf (BSD)** and the ddgs DuckDuckGo provider, and PIM is
Nightjar's own SQLAlchemy store. `test_no_copyleft_venv.py` fails the build if
any of them (or any other GPL/AGPL package) enters the phase2-mcp venv.

### Copyleft watch-items in the TTS path
- **phonemizer-fork (GPL-3.0-or-later) + espeakng-loader (compiled espeak-ng,
  notices stripped)** — **REMOVED.** They arrived transitively via `kokoro-onnx`,
  whose `Tokenizer` is constructed unconditionally by `Kokoro.__init__` and
  `ctypes.cdll.LoadLibrary()`s the espeak DLL in-process. GPL-3.0 is compatible
  *into* AGPL-3.0, so this was never a license violation — it was removed
  because it would block a future relicense. Replaced by misaki (Apache-2.0).
  `phase2-mcp/tests/test_tts_no_gpl.py` fails the build if either returns.
- **num2words — LGPL-2.1** (verified from its `COPYING`, not metadata; CLAUDE.md
  rule 5). A *mandatory* misaki dependency, used only to expand numbers to words.
  Weak copyleft and pure Python (relinkable, so §5-conformant in practice), and
  fine under today's AGPL combined work — but it is **not** "zero copyleft". If
  the relicense target is strict, this is the one remaining item to replace; it
  is small and self-contained. Tracked as **NJ-42**.
- **en_core_web_sm** — the distributed model is MIT, but its `LICENSES_SOURCES`
  records that OntoNotes 5 training data is "commercial (licensed by Explosion)".
  The shipped artifact is MIT; noted for completeness. Tracked as **NJ-43**.

## Nightjar's own additions
Nightjar's integration code (MCP wrappers, side-channel, safety plugins, the
embedded-ChromaDB patch, the llmfit CLI, config tooling) is original work,
released under AGPL-3.0-or-later as part of the combined project.

## Forward roadmap — pending license touchpoints (per `research/AUDIT_REPORT.md` §10)
Each remaining roadmap step that adds, swaps, or removes a component must **read the
actual LICENSE** (CLAUDE.md rule 5) and update the table above. Known upcoming touchpoints:
- **Step 2 — OpenRouter (rate-limit switch).** BYOK cloud provider used via the user's
  own key over a network API — **no bundled-code license obligation** (nothing new
  vendored). Same posture as the other BYOK providers already shipped.
- **Step 3 — image_gen license audit.** ✅ **Done** — see "Image-generation model
  licenses" below. TL;DR: the wired image MCP (now `nightjar-image`, PR E) is API-based
  (*cloud* OpenAI-compatible image models); no restrictive local checkpoint is on the shipped path.
  Recommended local default = **Z-Image-Turbo (Apache-2.0)**; **FLUX.1-dev**
  (non-commercial) and **SD 3.5** (Stability Community License) must never be defaults.
- **Step 4 — live-preview panel. ✅ Implemented.** Reuses the OpenCode coding agent +
  a **reimplementation** of gemma-chat's Canvas pattern (MIT; no code copied — see the table
  above). Uses a loopback static server + sandboxed `<iframe>`; **does NOT use bolt.diy's
  WebContainers** (commercial license — constraint honored). Added `marked` (MIT) for
  markdown→HTML preview.
- **Step 5 — Phase 5 (computer-use).** License-audit before vendoring: **OmniParser**,
  **nut.js**, and any local grounding models (Holo-1.5, UI-TARS). Add each here.
- **Step 6 — Phase 6 (CAD).** License-audit the Text2CAD/Text-to-CadQuery checkpoint,
  **CadQuery** (Apache-2.0), and the 3D render libs; add here.
- **Step 7 — custom orb + JUNE rebrand. ✅ Implemented (2026-07-08).** The custom Three.js
  swirling-vortex orb **replaced orb-ui**: the `orb-ui` dependency was dropped and the forked
  `AmberCircleTheme` deleted. One derivation survives — the mic-monitor volume math in
  `audioVolume.ts` — so the orb-ui row above is **narrowed to that** (not fully retired),
  alongside the **three.js (MIT — LICENSE read per rule 5)** row. **User-facing** strings are
  renamed Nightjar → JUNE; internal identifiers stay (`NIGHTJAR_*` env, `window.nightjar` IPC,
  the `nightjar.*` Tailwind class namespace). The AGPL license of the combined work is unchanged
  by the rename. (Runtime verification of the redesign branches is pending a live-stack run.)
- **Step 10 — Odysseus fork. RETIRED (PR E)** — the submodule was removed instead of
  re-hosted; there is no Odysseus code left to attribute.
- **Step 12 — wake word ("Hey June").** ✅ **Engine decided and licence-closed (voice-phase
  PR 5, 2026-08-03): hey-buddy replaces openWakeWord.** History: openWakeWord shipped first,
  then its bundled pretrained models — including the `hey_jarvis_v0.1.onnx` stand-in Nightjar
  fell back to — turned out to be **CC-BY-NC-SA 4.0 (NON-commercial)** per its own
  README/METADATA (NJ-58), and upstream never answered the backbone question (issues
  #313/#338). PR 5 removed openWakeWord entirely (requirements + venv + setup-script purge,
  guard-tested) and moved to **hey-buddy** (Apache-2.0; vendored fork, pinned). The
  rule-5 verifications that entry demanded are now done and recorded in
  `phase2-mcp/model_licenses.json`: the **embedding backbone is Google's speech_embedding,
  Apache-2.0 at the primary source** (kaggle.com/models/google/speech-embedding,
  maintainer-verified in a browser 2026-08-03, screenshot archived) **and**
  weight-identity-proven by running both ONNX files side by side; the **negative datasets**
  are CC-BY-4.0 over CC0/CC-BY/MIT/CDLA/Apache sources; and **piper-sample-generator's
  voice is REJECTED** — its default checkpoint is lessac/Blizzard-2013-derived, whose
  licence forbids commercial speech products (NJ-59), so training positives come from
  **Kokoro-82M** instead. Interim runtime stand-in: hey-buddy's own `hey-buddy.onnx`
  (phrase "hey buddy"), flagged non-shippable-in-paid-builds until the Kokoro-trained
  `hey_june.onnx` lands. Open licence residuals live in **NJ-60**.
  **PR 3 additions (LICENSE files read from the installed wheels):** `sounddevice` 0.5.5 —
  MIT (© Matthias Geier); bundled **PortAudio** DLLs — MIT per the wheel's binaries README
  (© Ross Bencina / Phil Burk). The wheel also carries an ASIO-enabled DLL embedding the
  proprietary **Steinberg ASIO SDK** — it loads ONLY when `SD_ENABLE_ASIO` is set, which
  Nightjar never sets, and the wheel arrives via the user's own pip at setup time (not
  vendored in this repo).

## Image generation — current state (PR E, 2026-08-03) and the Step-3 audit history

**What's wired today.** Image generation is `phase2-mcp/imagegen_server.py`
(Nightjar-authored, AGPL like the rest of the project): a BYOK call to an
OpenAI-compatible `/images/generations` endpoint. The backend is the user's
EXPLICIT image-capability choice (OpenAI or OpenRouter) plus that provider's
key — a stored key alone never routes, and Offline mode reports plainly that
image generation needs an Online provider. **No model checkpoint is bundled or
downloaded; no local diffusion path ships.** The only license surface is the
user's own provider account.

**Corrections to the 2026-07-06 audit text this section replaces** (both claims
had gone stale and are preserved here for the record):
- *"Image generation is non-functional as shipped — no agent mode is granted
  generate_image (NJ-6)"* — later fixed: the assistant agent was granted
  `generate_image` at `ask`, so the tool WAS reachable from PR #3x onward,
  and again is (as `nightjar-image_generate_image: ask`) since PR E.
- *"diffusion_server.py is launched/referenced nowhere in Nightjar"* — became
  false when NJ-6's fix wired `services.ts` to launch
  `research/odysseus/scripts/diffusion_server.py` as a managed sidecar. That
  launch (and the whole local path) was removed in PR E along with the
  submodule.

**If a local image backend returns** (as an additive provider behind the same
MCP tool), the Step-3 model-license audit's guardrails still apply and are kept
below: **Z-Image-Turbo (Apache-2.0)** was the recommended default;
**FLUX.1-dev / SD 3.5 / SDXL / SD 1.5 / Hunyuan must never be shipped or
auto-selected defaults** (non-commercial / community / RAIL restrictions).
Re-run the per-model license check at that point (rule 5 — model cards change).
