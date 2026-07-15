"""Pure next-run computation for Nightjar scheduled tasks (Task 6, NJ-16 fix).

`pim_server.task_create` wrote rows with NO `next_run`, so nothing could ever fire them.
This is the pure math that fixes it — no ORM, no MCP — so every branch is unit-testable
offline. Times are UTC (the schema stores scheduled_time as 'HH:MM' UTC).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional


def _parse_hhmm(scheduled_time: str) -> tuple[int, int]:
    """'HH:MM' → (hour, minute). Defaults to 09:00 if missing/malformed."""
    try:
        h, m = scheduled_time.strip().split(":")
        hh, mm = int(h), int(m)
        if 0 <= hh < 24 and 0 <= mm < 60:
            return hh, mm
    except (ValueError, AttributeError):
        pass
    return 9, 0


def compute_next_run(
    schedule: str,
    scheduled_time: str = "",
    scheduled_day: Optional[int] = None,
    scheduled_date: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> Optional[datetime]:
    """The next UTC datetime this task should fire, or None if it can't recur.

    schedule: once | daily | weekly | monthly.
      • once     — scheduled_date if given (and future), else the next occurrence of
                   scheduled_time; a past explicit date → None (nothing to fire).
      • daily    — next occurrence of scheduled_time (today if still ahead, else tomorrow).
      • weekly   — scheduled_day = weekday (0=Mon … 6=Sun); next that weekday at the time.
      • monthly  — scheduled_day = day-of-month (1..28 safe); next that day at the time.
    """
    now = now or datetime.utcnow()
    sched = (schedule or "once").strip().lower()
    hh, mm = _parse_hhmm(scheduled_time)

    def at_time(d: datetime) -> datetime:
        return d.replace(hour=hh, minute=mm, second=0, microsecond=0)

    if sched == "once":
        if scheduled_date is not None:
            return scheduled_date if scheduled_date > now else None
        cand = at_time(now)
        return cand if cand > now else cand + timedelta(days=1)

    if sched == "daily":
        cand = at_time(now)
        return cand if cand > now else cand + timedelta(days=1)

    if sched == "weekly":
        target = (scheduled_day if scheduled_day is not None else now.weekday()) % 7
        days_ahead = (target - now.weekday()) % 7
        cand = at_time(now + timedelta(days=days_ahead))
        # If that lands today but the time already passed, jump a full week.
        return cand if cand > now else cand + timedelta(days=7)

    if sched == "monthly":
        dom = scheduled_day if scheduled_day is not None else now.day
        dom = max(1, min(28, dom))  # clamp to a day every month has, avoids Feb-30 gaps
        cand = at_time(now.replace(day=dom))
        if cand > now:
            return cand
        # Roll to the same day next month.
        year, month = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
        return at_time(datetime(year, month, dom))

    return None  # unknown schedule → not pollable (task_create rejects these)


if __name__ == "__main__":
    import sys

    fails = []

    def check(name, cond, got=""):
        print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got})'}")
        if not cond:
            fails.append(name)

    NOW = datetime(2026, 7, 15, 12, 0, 0)  # Wed 2026-07-15 12:00 UTC

    # daily
    r = compute_next_run("daily", "14:30", now=NOW)
    check("daily later today → today 14:30", r == datetime(2026, 7, 15, 14, 30), r)
    r = compute_next_run("daily", "09:00", now=NOW)
    check("daily already past → tomorrow 09:00", r == datetime(2026, 7, 16, 9, 0), r)

    # once (time only)
    r = compute_next_run("once", "18:00", now=NOW)
    check("once time-only → next occurrence today", r == datetime(2026, 7, 15, 18, 0), r)
    r = compute_next_run("once", "10:00", now=NOW)
    check("once time already past → tomorrow", r == datetime(2026, 7, 16, 10, 0), r)
    # once (explicit date)
    r = compute_next_run("once", scheduled_date=datetime(2026, 8, 1, 8, 0), now=NOW)
    check("once explicit future date → that date", r == datetime(2026, 8, 1, 8, 0), r)
    r = compute_next_run("once", scheduled_date=datetime(2020, 1, 1, 8, 0), now=NOW)
    check("once explicit PAST date → None", r is None, r)

    # weekly (Wed=2). Friday=4 is +2 days.
    r = compute_next_run("weekly", "10:00", scheduled_day=4, now=NOW)
    check("weekly Friday → this Friday 10:00", r == datetime(2026, 7, 17, 10, 0), r)
    # same weekday (Wed) but time passed → next week
    r = compute_next_run("weekly", "09:00", scheduled_day=2, now=NOW)
    check("weekly same weekday, time passed → +7 days", r == datetime(2026, 7, 22, 9, 0), r)
    # same weekday, time ahead → today
    r = compute_next_run("weekly", "15:00", scheduled_day=2, now=NOW)
    check("weekly same weekday, time ahead → today", r == datetime(2026, 7, 15, 15, 0), r)

    # monthly. day 20 is ahead this month.
    r = compute_next_run("monthly", "08:00", scheduled_day=20, now=NOW)
    check("monthly day-20 ahead → this month", r == datetime(2026, 7, 20, 8, 0), r)
    # day 10 already passed → next month
    r = compute_next_run("monthly", "08:00", scheduled_day=10, now=NOW)
    check("monthly day-10 passed → next month", r == datetime(2026, 8, 10, 8, 0), r)
    # December → January rollover
    r = compute_next_run("monthly", "08:00", scheduled_day=5, now=datetime(2026, 12, 20, 12, 0))
    check("monthly Dec→Jan rollover", r == datetime(2027, 1, 5, 8, 0), r)
    # day 31 clamps to 28
    r = compute_next_run("monthly", "08:00", scheduled_day=31, now=NOW)
    check("monthly day-31 clamps to 28", r == datetime(2026, 7, 28, 8, 0), r)

    # unknown schedule → None
    check("unknown schedule → None", compute_next_run("hourly", "10:00", now=NOW) is None)
    # malformed time → 09:00 default
    r = compute_next_run("daily", "notatime", now=datetime(2026, 7, 15, 6, 0))
    check("malformed time defaults 09:00", r == datetime(2026, 7, 15, 9, 0), r)

    print(f"\n{len(fails) == 0 and 'all passed' or f'{len(fails)} FAILED'}")
    sys.exit(1 if fails else 0)
