"""Reminder request handling. Pure-ish: the LLM, the scheduler, and the per-user usage store are
all injected, so the daily-cap → parse → schedule → confirm flow is unit-tested with mocks (no
Telegram, no real LLM, no timing). The aiogram bot + FastAPI in main.py are thin adapters over
handle_reminder_text.
"""
from __future__ import annotations

from datetime import datetime
from typing import Callable, ContextManager, Optional
from zoneinfo import ZoneInfo

from .nl_intent import ReminderIntent, parse_reminder
from .usage import GLOBAL_BUCKET, check_and_increment, refund_slot


def handle_reminder_text(
    text: str,
    *,
    user_id: int,
    chat_id: int,
    tz_name: str,
    llm_call: Callable[[str, str], str],
    schedule: Callable[[int, int, ReminderIntent, str], object],
    get_count: Callable[[int, str], int],
    set_count: Callable[[int, str, int], None],
    now_utc: Optional[datetime] = None,
    daily_cap: int = 50,
    global_cap: int = 0,
    rate_check: Optional[Callable[[int], bool]] = None,
    usage_lock: Optional[ContextManager] = None,
) -> str:
    """Turn a natural-language reminder into a scheduled job and return the reply to send back.

    Flow: rate/flood check → per-user daily cap → global spend cap → LLM parse → schedule (once or
    recurring, decided by intent.repeat) → confirmation string. Every failure returns a friendly
    reply rather than raising — a bot must ALWAYS answer: throttled, over-cap, service-at-capacity,
    an unparseable message, an LLM/network error, or a scheduling error. Slots are refunded when
    the failure wasn't the user's fault (throttle/global-cap/LLM/network/scheduler error) so a
    transient blip doesn't cost them a reminder; an unparseable message keeps the slot (the paid
    LLM call did run).

    `global_cap` (0 = off) is the un-bypassable aggregate ceiling across all users; `rate_check`
    (None = off) is an injected per-user flood guard (see usage.RateLimiter).
    """
    now_utc = now_utc or datetime.utcnow()
    day = now_utc.strftime("%Y-%m-%d")  # UTC day — the cap window matches how we store times

    # Flood control first — throttle bursts BEFORE spending anything (no paid call, no counter
    # touched). Effective on the authenticated bot path; the global cap below is what protects the
    # shared key when an HTTP caller rotates ids past a per-user guard.
    if rate_check is not None and not rate_check(user_id):
        return "You're going a bit fast for me — give it a few seconds and try again."

    allowed, _count = check_and_increment(get_count, set_count, user_id, today=day,
                                          cap=daily_cap, lock=usage_lock)
    if not allowed:
        return f"You've hit today's limit of {daily_cap} reminders. Try again tomorrow."

    # Global daily spend ceiling across ALL users — the un-bypassable cost cap. If the service as a
    # whole is tapped out it isn't this user's fault, so refund the per-user slot we just took.
    if global_cap > 0:
        g_allowed, _g = check_and_increment(get_count, set_count, GLOBAL_BUCKET, today=day,
                                            cap=global_cap, lock=usage_lock)
        if not g_allowed:
            refund_slot(get_count, set_count, user_id, today=day, lock=usage_lock)
            return "The reminder service is at capacity for today. Please try again tomorrow."

    def _refund() -> None:
        # Refund BOTH counters together — they were taken together, and a failure that isn't the
        # user's fault shouldn't cost the user OR the global budget.
        refund_slot(get_count, set_count, user_id, today=day, lock=usage_lock)
        if global_cap > 0:
            refund_slot(get_count, set_count, GLOBAL_BUCKET, today=day, lock=usage_lock)

    try:
        intent = parse_reminder(text, llm_call, now_utc=now_utc, tz_name=tz_name)
    except ValueError as exc:
        # The model replied but we couldn't make a reminder of it — a real (paid) call happened,
        # so keep the slot; just tell the user how to phrase it.
        return (f"Sorry, I couldn't set that reminder — {exc}. "
                f'Try e.g. "remind me at 3pm to call Sam".')
    except Exception:  # noqa: BLE001 — LLM/SDK/network failure: refund and ask them to retry
        _refund()
        return "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment."

    try:
        schedule(user_id, chat_id, intent, tz_name)
    except Exception as exc:  # noqa: BLE001 — never crash the bot on a scheduling hiccup
        _refund()
        return f'I understood "{intent.title}" but couldn\'t schedule it ({exc}). Please try again.'

    return _confirmation(intent, tz_name)


def _confirmation(intent: ReminderIntent, tz_name: str) -> str:
    tz = ZoneInfo(tz_name) if _tz_ok(tz_name) else ZoneInfo("UTC")
    when_local = intent.when_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
    repeat_note = "" if intent.repeat == "once" else f" (repeats {intent.repeat})"
    return f'✓ Reminder set: "{intent.title}" for {when_local:%a %d %b %H:%M}{repeat_note}.'


def _tz_ok(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except Exception:  # noqa: BLE001
        return False
