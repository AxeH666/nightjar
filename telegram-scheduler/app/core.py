"""Reminder request handling. Pure-ish: the LLM, the scheduler, and the per-user usage store are
all injected, so the daily-cap → parse → schedule → confirm flow is unit-tested with mocks (no
Telegram, no real LLM, no timing). The aiogram bot + FastAPI in main.py are thin adapters over
handle_reminder_text.
"""
from __future__ import annotations

from datetime import datetime
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from .nl_intent import ReminderIntent, parse_reminder
from .usage import check_and_increment


def handle_reminder_text(
    text: str,
    *,
    user_id: int,
    chat_id: int,
    tz_name: str,
    llm_call: Callable[[str, str], str],
    schedule: Callable[[int, int, ReminderIntent], object],
    get_count: Callable[[int, str], int],
    set_count: Callable[[int, str, int], None],
    now_utc: Optional[datetime] = None,
    daily_cap: int = 50,
) -> str:
    """Turn a natural-language reminder into a scheduled job and return the reply to send back.

    Flow: daily-cap check → LLM parse → schedule (once or recurring, decided by intent.repeat) →
    confirmation string. Every failure returns a friendly reply rather than raising — a bot must
    always answer: over-cap, an unparseable message, or a scheduling error.
    """
    now_utc = now_utc or datetime.utcnow()

    allowed, _count = check_and_increment(get_count, set_count, user_id, cap=daily_cap)
    if not allowed:
        return f"You've hit today's limit of {daily_cap} reminders. Try again tomorrow."

    try:
        intent = parse_reminder(text, llm_call, now_utc=now_utc, tz_name=tz_name)
    except ValueError as exc:
        return (f"Sorry, I couldn't set that reminder — {exc}. "
                f'Try e.g. "remind me at 3pm to call Sam".')

    try:
        schedule(user_id, chat_id, intent)
    except Exception as exc:  # noqa: BLE001 — never crash the bot on a scheduling hiccup
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
