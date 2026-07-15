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
from .usage import check_and_increment, refund_slot


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
    usage_lock: Optional[ContextManager] = None,
) -> str:
    """Turn a natural-language reminder into a scheduled job and return the reply to send back.

    Flow: daily-cap check → LLM parse → schedule (once or recurring, decided by intent.repeat) →
    confirmation string. Every failure returns a friendly reply rather than raising — a bot must
    ALWAYS answer: over-cap, an unparseable message, an LLM/network error, or a scheduling error.
    A slot is refunded when the failure wasn't the user's fault (LLM/network/scheduler error) so a
    transient blip doesn't cost them a reminder; an unparseable message keeps the slot (the paid
    LLM call did run).
    """
    now_utc = now_utc or datetime.utcnow()
    day = now_utc.strftime("%Y-%m-%d")  # UTC day — the cap window matches how we store times

    allowed, _count = check_and_increment(get_count, set_count, user_id, today=day,
                                          cap=daily_cap, lock=usage_lock)
    if not allowed:
        return f"You've hit today's limit of {daily_cap} reminders. Try again tomorrow."

    def _refund() -> None:
        refund_slot(get_count, set_count, user_id, today=day, lock=usage_lock)

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
