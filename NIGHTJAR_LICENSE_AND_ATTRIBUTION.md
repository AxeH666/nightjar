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
