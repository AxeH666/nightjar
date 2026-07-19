"""Drive the odysseus-email MCP server over stdio and call send_email; the local
SMTP catcher (:2525) should receive the message. Proves the email send path
works offline through MCP."""
import asyncio, os, json, sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Repo-relative (no hardcoded machine path): NIGHTJAR_ROOT if set, else derive
# the repo root from this file's location (…/phase2-odysseus/tests/).
NIGHTJAR_ROOT = Path(os.environ.get("NIGHTJAR_ROOT") or Path(__file__).resolve().parents[2])
DATA_DIR = os.environ.get("NIGHTJAR_DATA_DIR") or str(Path.home() / ".nightjar")
REPO = str(NIGHTJAR_ROOT / "research" / "odysseus")
# The venv interpreter running this test drives the server subprocess too — OS-agnostic
# (venv/bin/python on POSIX, venv/Scripts/python.exe on Windows), no hardcoded layout (P3-2).
PY = sys.executable

async def main():
    env = dict(os.environ)
    env.update({"PYTHONPATH": REPO, "ODYSSEUS_DATA_DIR": f"{DATA_DIR}/odysseus",
                "CHROMADB_PERSIST_DIR": f"{DATA_DIR}/odysseus/chroma",
                "ODYSSEUS_MCP_MEMORY_OWNER": "nightjar"})
    params = StdioServerParameters(command=PY, args=[f"{REPO}/mcp_servers/email_server.py"], env=env)
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            tools = await s.list_tools()
            print("email tools:", len(tools.tools))
            res = await s.call_tool("send_email", {
                "_odysseus_owner": "nightjar",
                "to": "boss@example.com",
                "subject": "Nightjar test summary",
                "body": "This is a Phase 2b end-to-end email send test.",
            })
            print("send result:", (res.content[0].text if res.content else "")[:300])

asyncio.run(main())
