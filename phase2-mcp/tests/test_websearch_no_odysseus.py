#!/usr/bin/env python3
"""Import-trace guard: the web-search MCP server must pull ZERO Odysseus modules.

Why (Odysseus removal, PR B): `web_search` never used Odysseus — it is ddgs (MIT)
plus two Nightjar-authored pure modules. But it lived in
`phase2-odysseus/servers/deep_research_server.py`, whose module-scope
`from src.deep_research import DeepResearcher` (AGPL) means importing the module at
all drags Odysseus in, and kills the whole file when Odysseus is absent. This test
proves the split actually severed that: it imports the new server with a clean
sys.modules and asserts nothing Odysseus-shaped appeared.

Deliberately checks the IMPORT GRAPH, not the source text — a transitive import
three levels down would pass a grep and fail here.

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_websearch_no_odysseus.py
"""
import importlib
import os
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

REPO = os.environ.get("NIGHTJAR_ROOT") or str(Path(__file__).resolve().parents[2])
PHASE2_MCP = os.path.join(REPO, "phase2-mcp")
sys.path.insert(0, PHASE2_MCP)

# Modules that only exist inside the Odysseus repo (research/odysseus/). `src.*` is
# Odysseus's own package root — its deep-research import was `from src.deep_research`,
# which the "src" root catches. Do NOT add "deep_research" here: Nightjar's own
# `deep_research_backend` (PR F) would false-positive on a substring match.
ODYSSEUS_ROOTS = ("src", "services", "routes", "mcp_servers", "core")
ODYSSEUS_NAMES = ("odysseus", "chromadb", "_bootstrap")

FAILS = []


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        FAILS.append(label)


def odysseus_modules(mods):
    hits = set()
    for name in mods:
        root = name.split(".")[0]
        if root in ODYSSEUS_ROOTS or any(t in name.lower() for t in ODYSSEUS_NAMES):
            hits.add(name)
    return hits


print("== 1. the Odysseus repo is NOT on sys.path ==")
on_path = [p for p in sys.path if "odysseus" in p.lower()]
check("no odysseus path entry", not on_path, str(on_path))

print("\n== 2. import the web-search server and trace what it pulls in ==")
before = set(sys.modules)
server = importlib.import_module("websearch_server")
new = set(sys.modules) - before
check("websearch_server imported", server is not None, f"{len(new)} new modules")

hits = odysseus_modules(new)
check("zero Odysseus modules in the import graph", not hits, str(sorted(hits)))

print("\n== 3. the tool and its pure backends are present ==")
check("web_search tool defined", hasattr(server, "web_search"))
check("FastMCP server name is nightjar-websearch", server.mcp.name == "nightjar-websearch", server.mcp.name)
for mod in ("research_backend", "web_search_backend"):
    check(f"{mod} imported from phase2-mcp", mod in sys.modules,
          getattr(sys.modules.get(mod), "__file__", "?"))
    f = getattr(sys.modules.get(mod), "__file__", "") or ""
    check(f"{mod} resolves inside phase2-mcp/", "phase2-mcp" in f.replace("\\", "/"), f)

print("\n== 4. the backends themselves are Odysseus-free ==")
for mod in ("research_backend", "web_search_backend"):
    b = set(sys.modules)
    importlib.reload(sys.modules[mod])
    check(f"{mod} reload pulls no Odysseus", not odysseus_modules(set(sys.modules) - b))

print("\n== 5. it still works with the Odysseus repo physically absent ==")
# Regression guard (PR G landed — research/odysseus is gone for real): nothing
# may resolve through an odysseus path even if one reappears on sys.path.
sys.path[:] = [p for p in sys.path if "odysseus" not in p.lower()]
for name in list(sys.modules):
    if name.split(".")[0] in ODYSSEUS_ROOTS:
        del sys.modules[name]
del sys.modules["websearch_server"]
try:
    reimported = importlib.import_module("websearch_server")
    check("re-imports cleanly with no Odysseus on sys.path", hasattr(reimported, "web_search"))
except Exception as exc:  # noqa: BLE001
    check("re-imports cleanly with no Odysseus on sys.path", False, f"{type(exc).__name__}: {exc}")

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
