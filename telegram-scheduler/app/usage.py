"""Per-user usage counter + daily cap (Task 6, Option-3 server-side key abuse guard).

The server parses paid users' reminders with OUR shared LLM key, so a runaway user could burn
it. This caps parses per user per **UTC** day. Pure over an injected store (dict/DB row) so it's
unit-tested without a real DB.

Concurrency: the read-modify-write is only atomic if the caller passes a `lock` (the server runs
one process — a threading.Lock fully serializes it). Without a lock two concurrent requests could
both read the same count and overshoot the cap (Bugbot).
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from contextlib import nullcontext
from datetime import datetime, timezone
from typing import Callable, ContextManager, Deque, Dict, Optional

DEFAULT_DAILY_CAP = 50

# Sentinel "user id" for the all-users aggregate counter. Real Telegram user ids are positive, so
# -1 can't collide with a real user; this lets the GLOBAL daily cap reuse the same usage-counter
# store (get_count/set_count) with NO schema/migration change.
GLOBAL_BUCKET = -1


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


class RateLimiter:
    """In-memory per-user sliding-window flood guard.

    The GLOBAL daily cap (see GLOBAL_BUCKET) is the un-bypassable *cost* ceiling; this is
    *fairness / flood* control on the authenticated bot path — a human can't out-type it, a script
    gets throttled. It is NOT persisted (a restart resets the windows, fine for a ~minute window)
    and is process-local: correct for the single-process server (uvicorn + aiogram share one
    process); a multi-worker deploy would need a shared store instead.

    `per_minute <= 0` disables the guard (always allow). `clock` is injectable for tests; the
    default is `time.monotonic` so a wall-clock jump can't skew the window.
    """

    def __init__(self, per_minute: int, window_s: float = 60.0,
                 clock: Callable[[], float] = time.monotonic,
                 lock: Optional[ContextManager] = None, sweep_every: int = 1000) -> None:
        self.per_minute = per_minute
        self.window_s = window_s
        self._clock = clock
        self._hits: Dict[int, Deque[float]] = defaultdict(deque)
        self._lock = lock or threading.Lock()
        self._sweep_every = sweep_every
        self._calls = 0

    def allow(self, user_id: int) -> bool:
        """Return True if the user is under the per-minute limit (and record the hit); False to
        throttle. Ages out hits older than the window before deciding."""
        if self.per_minute <= 0:
            return True
        now = self._clock()
        cutoff = now - self.window_s
        with self._lock:
            # Periodically drop users idle beyond the window so _hits can't grow without bound on a
            # public bot (or under the HTTP id-rotation the global cap is meant to contain) — this
            # dict is the only unbounded structure here.
            self._calls += 1
            if self._calls >= self._sweep_every:
                self._calls = 0
                for uid in [u for u, d in self._hits.items() if not d or d[-1] < cutoff]:
                    del self._hits[uid]
            dq = self._hits[user_id]
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= self.per_minute:
                return False
            dq.append(now)
            return True
