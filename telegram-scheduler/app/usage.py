"""Per-user usage counter + daily cap (Task 6, Option-3 server-side key abuse guard).

The server parses paid users' reminders with OUR shared LLM key, so a runaway user could burn
it. This caps parses per user per UTC day. Pure over an injected store dict/DB row so it's
unit-tested without a real DB.
"""
from __future__ import annotations

from datetime import date
from typing import Callable, Optional

DEFAULT_DAILY_CAP = 50


def check_and_increment(
    get_count: Callable[[int, str], int],
    set_count: Callable[[int, str, int], None],
    user_id: int,
    today: Optional[str] = None,
    cap: int = DEFAULT_DAILY_CAP,
) -> tuple[bool, int]:
    """Return (allowed, new_count). If the user is at/over `cap` for `today`, deny WITHOUT
    incrementing; otherwise increment and allow. `get_count`/`set_count` read/write the
    persisted per-(user, day) counter."""
    day = today or date.today().isoformat()
    current = get_count(user_id, day)
    if current >= cap:
        return False, current
    new = current + 1
    set_count(user_id, day, new)
    return True, new
