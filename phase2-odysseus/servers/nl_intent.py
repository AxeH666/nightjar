"""Natural-language → structured reminder intent (Task 6, the core new component).

"meeting with xyz at 2, remind me at 1" → {title, when (UTC), repeat} that maps onto
task_create. Provider-AGNOSTIC: the LLM is an injected `llm_call(system, user) -> str`
callable, so the parser is built + fully unit-tested with a MOCKED LLM (no key, no network),
and the server (PR 17) injects a real Anthropic/OpenAI client at deploy time.

Timezone: the user speaks in their LOCAL time ("remind me at 1pm"); reminders are STORED in
UTC. The LLM is given the user's current local time and returns a LOCAL wall-clock; this
module converts local → UTC using the user's IANA tz. Pure and side-effect-free.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Optional
from zoneinfo import ZoneInfo

VALID_REPEATS = ("once", "daily", "weekly", "monthly")

SYSTEM_PROMPT = (
    "You extract a single reminder from the user's message and reply with ONLY a JSON object, "
    "no prose, no markdown fences. Fields:\n"
    '  "title": string — what to remind them about, concise, imperative (e.g. "Call Sara").\n'
    '  "datetime_local": string — the LOCAL wall-clock time to fire, ISO-8601 "YYYY-MM-DDTHH:MM" '
    "(24h). Resolve relative times (\"in 30 minutes\", \"tomorrow at 1pm\", \"next Friday\") "
    "against the CURRENT LOCAL TIME given below.\n"
    '  "repeat": one of "once" | "daily" | "weekly" | "monthly".\n'
    "If the message names two times (an event time and a reminder time), use the REMINDER time. "
    "If no time is given, pick a sensible near-future time and use \"once\"."
)


@dataclass(frozen=True)
class ReminderIntent:
    title: str
    when_utc: datetime  # naive UTC (matches the ScheduledTask schema)
    repeat: str  # once|daily|weekly|monthly
    scheduled_time: str  # "HH:MM" UTC — for task_create
    scheduled_day: Optional[int]  # weekday 0=Mon (weekly) / day-of-month (monthly), else None


def build_user_prompt(text: str, now_local: datetime, tz_name: str) -> str:
    return (
        f"CURRENT LOCAL TIME: {now_local.strftime('%Y-%m-%dT%H:%M')} ({tz_name}, "
        f"{now_local.strftime('%A')}).\n\nMESSAGE: {text}"
    )


def _extract_json(raw: str) -> dict:
    """Tolerantly pull the JSON object out of an LLM reply (strip ``` fences / stray prose)."""
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.IGNORECASE | re.MULTILINE).strip()
    # Fall back to the first {...} span if the model added text around it.
    if not s.startswith("{"):
        m = re.search(r"\{.*\}", s, flags=re.DOTALL)
        if not m:
            raise ValueError("no JSON object in the model reply")
        s = m.group(0)
    return json.loads(s)


def parse_reminder(
    text: str,
    llm_call: Callable[[str, str], str],
    now_utc: Optional[datetime] = None,
    tz_name: str = "UTC",
) -> ReminderIntent:
    """Parse a NL reminder into a structured, UTC-normalized intent. Raises ValueError on an
    unusable message or model reply (empty title, unparseable time) — the caller surfaces it."""
    now_utc = now_utc or datetime.utcnow()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:  # noqa: BLE001 — unknown tz → treat as UTC rather than fail the parse
        tz, tz_name = ZoneInfo("UTC"), "UTC"

    now_local = now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
    raw = llm_call(SYSTEM_PROMPT, build_user_prompt(text, now_local, tz_name))
    data = _extract_json(raw)

    title = str(data.get("title", "")).strip()
    if not title:
        raise ValueError("could not identify what to remind you about")

    repeat = str(data.get("repeat", "once")).strip().lower()
    if repeat not in VALID_REPEATS:
        repeat = "once"

    dt_local_str = str(data.get("datetime_local", "")).strip()
    try:
        # Accept trailing seconds / 'Z' defensively.
        dt_local_naive = datetime.fromisoformat(dt_local_str.replace("Z", "")[:16])
    except (ValueError, TypeError) as exc:
        raise ValueError(f"could not understand the time ('{dt_local_str}')") from exc

    # Interpret as local wall-clock → convert to naive UTC for storage.
    dt_local = dt_local_naive.replace(tzinfo=tz)
    when_utc = dt_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None, second=0, microsecond=0)

    scheduled_time = when_utc.strftime("%H:%M")
    if repeat == "weekly":
        scheduled_day: Optional[int] = when_utc.weekday()  # 0=Mon
    elif repeat == "monthly":
        scheduled_day = min(when_utc.day, 28)  # clamp so every month has it (matches task_create)
    else:
        scheduled_day = None

    return ReminderIntent(title=title, when_utc=when_utc, repeat=repeat,
                          scheduled_time=scheduled_time, scheduled_day=scheduled_day)


def intent_to_task_args(intent: ReminderIntent) -> dict:
    """Shape a ReminderIntent into task_create(...) kwargs."""
    return {
        "name": intent.title,
        "prompt": intent.title,
        "schedule": intent.repeat,
        "scheduled_time": intent.scheduled_time,
        "scheduled_day": intent.scheduled_day or 0,
    }
