#!/usr/bin/env python
"""Memory auto-recall helper for the OpenCode plugin.

Given a user query (argv[1]), print a compact block of HIGH-CONFIDENCE recalled
memories (or nothing). This is Row-Bot's "when to auto-recall" decision moved to
Nightjar: only inject memories the plugin can trust (score >= threshold), capped,
so we don't pollute the prompt on every turn. The OpenCode plugin injects the
printed block into the user message via the chat.message hook.
"""
import os
import sys

THRESHOLD = float(os.environ.get("NIGHTJAR_RECALL_THRESHOLD", "0.6"))
MAX_HITS = int(os.environ.get("NIGHTJAR_RECALL_MAX", "3"))

query = sys.argv[1] if len(sys.argv) > 1 else ""
if len(query.strip()) < 4:
    sys.exit(0)

try:
    from nightjar_capabilities import memory
    hits = memory.search_memory(query, limit=5)
except Exception:
    sys.exit(0)

strong = [h for h in hits if (h.get("score") or 0) >= THRESHOLD][:MAX_HITS]
for h in strong:
    print(f"- {h.get('content')}")
