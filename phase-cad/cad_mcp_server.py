#!/usr/bin/env python
"""stdio launcher for the build123d-mcp CAD server, for opencode.json.

build123d-mcp is a package, not a script (`python -m build123d_mcp` fails — no
__main__.py), and its console-script shebang bakes an absolute venv path at install
time. So Nightjar launches it the same way the other MCP servers are launched: the
phase-cad venv's python running this tiny wrapper.

The server MUST run in-process. Its default worker-subprocess mode fails to start under
stdio/sandboxed MCP hosts (upstream issue #143). opencode.json sets BUILD123D_IN_PROCESS=1
in this server's environment; we also default it here as belt-and-suspenders so a manual
launch behaves.
"""
import os
import sys

os.environ.setdefault("BUILD123D_IN_PROCESS", "1")

from build123d_mcp.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
