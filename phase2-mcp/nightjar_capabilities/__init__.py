"""Nightjar capabilities package.

Standalone extraction of Row-Bot's voice / vision / memory / browser
capabilities (Apache-2.0; see NOTICE and LICENSE.row-bot), with all
LangChain/LangGraph/NiceGUI removed and embeddings swapped to local Ollama.

Importing this package puts the vendored, faithfully-preserved Row-Bot modules
(under `_vendor/`) on sys.path as the `row_bot` package, satisfied by small
local stubs for the orchestration/config pieces we deliberately dropped.
"""
from __future__ import annotations

import os
import sys

_VENDOR = os.path.join(os.path.dirname(__file__), "_vendor")
if _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)
