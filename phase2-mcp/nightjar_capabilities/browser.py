"""Nightjar browser capability — clean wrapper over the vendored Row-Bot
Playwright browser tool, forced HEADLESS (no display) and stripped of the
LangChain adapter. Preserves Row-Bot's persistent-profile session and
accessibility-tree ref addressing (elements are addressed by integer refs from
snapshot()).

The session is a long-running, stateful singleton (one Chromium, per-thread
tabs) — this is exactly the kind of state the MCP request/response model doesn't
hold well, so in the daemon it lives behind the WebSocket side-channel; here the
functions drive it directly for discrete calls.
"""
from __future__ import annotations

import nightjar_capabilities  # noqa: F401 (bootstraps _vendor shim)
import row_bot.tools.browser_tool as _bt

_THREAD = "default"


def _session():
    return _bt.get_session_manager().get_session(_THREAD)


def navigate(url: str) -> str:
    return _session().navigate(url, thread_id=_THREAD)


def click(ref: int) -> str:
    return _session().click(int(ref), thread_id=_THREAD)


def type_text(ref: int, text: str, submit: bool = False) -> str:
    return _session().type_text(int(ref), text, submit=submit, thread_id=_THREAD)


def scroll(direction: str = "down", amount: int = 3) -> str:
    return _session().scroll(direction=direction, amount=amount, thread_id=_THREAD)


def snapshot() -> str:
    return _session().snapshot(thread_id=_THREAD)


def go_back() -> str:
    return _session().go_back(thread_id=_THREAD)


def tab_action(action: str = "list", tab_id: int | None = None, url: str | None = None) -> str:
    return _session().tab_action(action=action, tab_id=tab_id, url=url, thread_id=_THREAD)


def close() -> None:
    _bt.get_session_manager().kill_all()
