"""Stub of row_bot.tools.registry — tool registration is a no-op in Nightjar
(OpenCode/MCP is the tool host now)."""
def register(*args, **kwargs) -> None:
    return None
def get_langchain_tools(*args, **kwargs):
    return []
def resolve_workspace_root(*args, **kwargs):
    import os
    return os.getcwd()
