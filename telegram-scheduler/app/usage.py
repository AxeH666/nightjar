"""Per-user usage counter + daily cap (Task 6, Option-3 server-side key abuse guard).

The server parses paid users' reminders with OUR shared LLM key, so a runaway user could burn
it. This caps parses per user per **UTC** day. Pure over an injected store (dict/DB row) so it's
unit-tested without a real DB.

Concurrency: the read-modify-write is only atomic if the caller passes a `lock` (the server runs
one process — a threading.Lock fully serializes it). Without a lock two concurrent requests could
both read the same count and overshoot the cap (Bugbot).
"""
from __future__ import annotations

from contextlib import nullcontext
from datetime import datetime, timezone
from typing import Callable, ContextManager, Optional

DEFAULT_DAILY_CAP = 50


def utc_today() -> str:
    """Today's date in UTC as 'YYYY-MM-DD' — the cap resets on the UTC day boundary, matching how
    reminders are stored/compared in UTC, not the host's local midnight (Bugbot)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def check_and_increment(
    get_count: Callable[[int, str], int],
    set_count: Callable[[int, str, int], None],
    user_id: int,
    today: Optional[str] = None,
    cap: int = DEFAULT_DAILY_CAP,
    lock: Optional[ContextManager] = None,
) -> tuple[bool, int]:
    """Return (allowed, new_count). If the user is at/over `cap` for `today`, deny WITHOUT
    incrementing; otherwise increment and allow. Held under `lock` (if given) so concurrent
    callers can't both slip under the cap."""
    day = today or utc_today()
    with (lock or nullcontext()):
        current = get_count(user_id, day)
        if current >= cap:
            return False, current
        new = current + 1
        set_count(user_id, day, new)
        return True, new


def refund_slot(
    get_count: Callable[[int, str], int],
    set_count: Callable[[int, str, int], None],
    user_id: int,
    today: Optional[str] = None,
    lock: Optional[ContextManager] = None,
) -> int:
    """Return one consumed slot to the user (e.g. the parse or scheduling failed AFTER we'd
    already counted it). Never drops below 0. Held under the same `lock` as the increment."""
    day = today or utc_today()
    with (lock or nullcontext()):
        current = get_count(user_id, day)
        new = max(0, current - 1)
        set_count(user_id, day, new)
        return new
