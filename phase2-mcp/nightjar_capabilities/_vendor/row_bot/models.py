"""Stub of row_bot.models — provides the tiny bits the kept modules use:
a local Ollama client, and snapshot-sizing constants for the browser tool.
The LangChain LLM factory (get_llm_for) is intentionally a no-op (cloud path dropped)."""
import os
import ollama

def _ollama_base_url() -> str:
    return os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")

def _ollama_client():
    try:
        return ollama.Client(host=_ollama_base_url())
    except Exception:
        return None

def get_tool_budget(*args, **kwargs) -> int:
    return 6000

def get_context_size(*args, **kwargs) -> int:
    return 8192

def get_llm_for(*args, **kwargs):
    raise RuntimeError("Cloud LLM path is disabled in Nightjar (local-only).")
