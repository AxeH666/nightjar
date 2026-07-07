# Nightjar — License & Attribution

## License of the combined work: **AGPL-3.0-or-later**

Nightjar is a fully open-source, local-first AI coding + personal assistant. As
a result of integrating **Odysseus** (AGPL-3.0-or-later) as a capability tier,
**the combined Nightjar work is licensed under the GNU Affero General Public
License, version 3 or later (AGPL-3.0-or-later).**

Why this is the correct and clean result:
- **Odysseus** is AGPL-3.0-or-later — the strongest copyleft among the inputs, so
  it sets the license floor for the combined work.
- **OpenCode** (MIT) and **Row-Bot** (Apache-2.0) are permissive and are one-way
  compatible *into* AGPLv3 — their code may be included in an AGPL work; the
  combined work is AGPL, while those portions retain their original notices.
- Bridging is done over **MCP (JSON-RPC over stdio) between separate processes**,
  not by linking codebases into one binary. Even under the stricter "single
  combined work" reading this is compliant (all inputs are AGPL-compatible); under
  the "mere aggregation" reading the process boundary would not even propagate
  AGPL to the OpenCode/Row-Bot processes. Either way, releasing the whole under
  AGPL-3.0-or-later is safe.

### AGPL §13 (network use) — operational note
AGPL requires that users interacting with the software **over a network** be
offered its Complete Corresponding Source. Nightjar is local-first (offline), so
this rarely triggers — but any future hosted / remote-access / "share my Nightjar
over the LAN" mode MUST offer source to those remote users. Flagged for anyone
adding networked access.

## Upstream components and their licenses (all preserved)

| Component | Role | License | Attribution preserved at |
|---|---|---|---|
| OpenCode | native agent engine | MIT | `research/opencode/LICENSE`; also credited in Odysseus `licenses/opencode-MIT-LICENSE.txt` |
| Row-Bot | voice/vision/memory/browser bolt-on | Apache-2.0 | `phase2-mcp/NOTICE`, `phase2-mcp/LICENSE.row-bot` |
| Odysseus | email/RAG/research/PIM bolt-on | AGPL-3.0-or-later | `research/odysseus/LICENSE`, `research/odysseus/ACKNOWLEDGMENTS.md`, `research/odysseus/licenses/` |
| llmfit (© 2026 Alex Jones) | hardware model-fit (vendored) | MIT | `research/odysseus/licenses/llmfit-MIT-LICENSE.txt` + Odysseus ACKNOWLEDGMENTS |
| Tongyi DeepResearch | deep-research pipeline (via Odysseus) | Apache-2.0 | `research/odysseus/licenses/DeepResearch-Apache-2.0.txt` |
| orb-ui (© Alexander Chen) | voice-reactive UI orb (Phase 4) | MIT | `phase3-ui/node_modules/orb-ui/LICENSE`; forked circle theme credits upstream in `phase3-ui/src/renderer/src/components/orb/AmberCircleTheme.tsx` |
| Browser Use (© 2024 Gregor Zunic) | autonomous web tasks / form-filling (separate MCP) | MIT | `browser-use-mcp/THIRD-PARTY-LICENSES/browser-use-MIT-LICENSE.txt` (pip dep, isolated venv) |

Odysseus's own `ACKNOWLEDGMENTS.md` and `licenses/` directory (opencode-MIT,
llmfit-MIT, DeepResearch-Apache-2.0, OpenDyslexic-OFL) are carried forward
verbatim and must ship with any Nightjar distribution.

### Copyleft watch-items pulled in via Odysseus (document if shipped)
- **PyMuPDF** — AGPL-3.0, *optional* (PDF form-filling only). Ship only if that
  feature is needed; its terms then apply to it.
- **SearXNG** — AGPL, runs as a *separate composed service* (not linked). Nightjar
  does **not** require it (Deep Research is configured to use the DuckDuckGo
  provider instead — no extra service). If SearXNG is ever used, it's a separate
  AGPL service.
- **caldav** — dual GPL-3.0-or-later / Apache-2.0; used under Apache-2.0. Fine.

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
  licenses" below. TL;DR: the wired `odysseus-image` MCP is API-based (defaults to
  *cloud* OpenAI image models); no restrictive local checkpoint is on the shipped path.
  Recommended local default = **Z-Image-Turbo (Apache-2.0)**; **FLUX.1-dev**
  (non-commercial) and **SD 3.5** (Stability Community License) must never be defaults.
- **Step 4 — live-preview panel.** Reuses the OpenCode coding agent + gemma-chat's
  Canvas pattern (MIT). **Must NOT use bolt.diy's WebContainers** (commercial license) —
  recorded here so the constraint isn't lost.
- **Step 5 — Phase 5 (computer-use).** License-audit before vendoring: **OmniParser**,
  **nut.js**, and any local grounding models (Holo-1.5, UI-TARS). Add each here.
- **Step 6 — Phase 6 (CAD).** License-audit the Text2CAD/Text-to-CadQuery checkpoint,
  **CadQuery** (Apache-2.0), and the 3D render libs; add here.
- **Step 7 — custom orb + JUNE rebrand.** The custom Three.js swirling-vortex orb
  **replaces orb-ui**, so the **orb-ui (MIT) row above is retired** (drop the dependency;
  keep the historical credit if any forked code remains). Three.js is MIT. This document
  and the rest of the docs are **renamed Nightjar → JUNE** at this step; the AGPL license
  of the combined work is unchanged by the rename.
- **Step 10 — Odysseus fork.** Attribution is **unchanged by re-hosting** — the fork keeps
  Odysseus's `LICENSE` / `ACKNOWLEDGMENTS.md` / `licenses/` intact; AGPL travels with the
  code regardless of host (see §10 fork subsection).
- **Step 12 — wake word ("Hey June").** local-wake (MIT) / openWakeWord (Apache-2.0) +
  verifier — add whichever ships.

## Image-generation model licenses (Step 3 audit — 2026-07-06)
**What's wired today.** Nightjar registers one image capability — the `odysseus-image`
MCP (`research/odysseus/mcp_servers/image_gen_server.py`). It is **API-based**: it POSTs to
an OpenAI-compatible `/images/generations` endpoint resolved from Odysseus settings,
auto-detecting `gpt-image-1.5` / `gpt-image-1` / `dall-e-3` when unconfigured. Nightjar's
`opencode.json` sets **no** `image_model` or local image endpoint, so out of the box image
generation would call **OpenAI's cloud** (needs a BYOK OpenAI key). There is currently **no
local image model wired**, and therefore **no restrictive local checkpoint on the
active/shipped path**. (Image generation is also **non-functional as shipped** for a second,
non-license reason — no agent mode is granted the `generate_image` tool; see NJ-6.)

**Latent local path.** `research/odysseus/scripts/diffusion_server.py` is a local,
`diffusers`-backed OpenAI-compatible image server, but it is **launched/referenced nowhere
in Nightjar** and takes an operator-supplied `--model` (no baked-in default). So the
restrictive-checkpoint risk is **latent** — it only arises if an operator both runs that
server *and* points it at a restricted model.

**License status of the candidate local models** (from llmfit's curated registry,
`phase2-odysseus/hwfit_vendor/services/hwfit/image_models.py`; the license field there is
*metadata* — confirm each model-card LICENSE at download per rule 5, since these are
downloaded, not vendored):

| Model | ~VRAM (q4 / fp8) | License | Default-safe? |
|---|---|---|---|
| **Z-Image-Turbo** (Tongyi) | 6 / 10 GB | **Apache-2.0** | ✅ **recommended default** |
| Z-Image (Tongyi) | 6 / 10 GB | Apache-2.0 | ✅ |
| Qwen-Image / -2512 / -Edit | 14 / 22 GB | Apache-2.0 | ✅ (larger card) |
| FLUX.1-schnell (BFL) | 10 / 17 GB | Apache-2.0 | ✅ |
| **FLUX.1-dev / FLUX.2-dev** (BFL) | 10 / 17 GB | **FLUX [dev] Non-Commercial** | ❌ never a default |
| **SD 3.5** medium/large/turbo | 7–12 GB | **Stability AI Community License** (free < $1M rev, else commercial) | ❌ never a default |
| SDXL / SD 1.5 | 6–8 GB | CreativeML OpenRAIL-M (use-restrictions) | ❌ not a default |
| HunyuanImage 3.0 (Tencent) | 9 / 16 GB | Tencent Hunyuan Community License (use-restrictions) | ❌ not a default |

**Recommendation.**
1. **Default local model → Z-Image-Turbo (Apache-2.0)** — already the top-ranked entry in
   llmfit's registry, ~6 GB at q4 (fits the 6–8 GB target), 8-step/fast; fully
   commercial-safe for an AGPL product and matches the roadmap's named target.
2. **Wire the local path** (follow-up implementation, not this audit): run
   `diffusion_server.py --model Tongyi-MAI/Z-Image-Turbo` as a managed sidecar and point
   `odysseus-image` at it, so image generation is genuinely **local-first/offline** rather
   than silently depending on a cloud OpenAI key (tracked as **NJ-6** in `KNOWN_ISSUES.md`).
3. **Guardrail:** **FLUX.1-dev / FLUX.2-dev / SD 3.5 / SDXL / SD 1.5 / Hunyuan must never be
   a shipped or auto-selected default** — non-commercial / community / RAIL restrictions are
   incompatible with a freely-distributable AGPL product's default. If ever offered, make it
   opt-in with an explicit per-model license notice.
4. **Wan2.2-TI2V-5B** (the roadmap's alternate, Apache-2.0) is a **text/image-to-VIDEO**
   model — relevant only if image_gen later expands to video; for still images
   Z-Image-Turbo is the pick. It is not currently in the registry.
