#!/usr/bin/env python
# Offline unit test for the NL-intent reminder parser (nl_intent). Pure logic — the LLM is
# INJECTED as a mock returning canned structured replies, so no key, no network, and every
# branch (timezone conversion, relative-time mapping, repeat kinds, fence-stripping, the
# two-times case, error paths) is exercised deterministically.
# Run: python3 test_nl_intent.py
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from datetime import datetime  # noqa: E402
from nl_intent import parse_reminder, intent_to_task_args  # noqa: E402

import sys

fails = []

def check(name, cond, got=""):
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got})'}")
    if not cond:
        fails.append(name)

# A mock LLM: returns a canned structured reply per test, ignoring the actual prompt.
def mock(reply: str):
    return lambda system, user: reply

NOW = datetime(2026, 7, 15, 12, 0, 0)  # Wed 2026-07-15 12:00 UTC

# 1. simple local time in UTC tz → straight through
i = parse_reminder("remind me at 1pm to call Sara",
                   mock('{"title":"Call Sara","datetime_local":"2026-07-15T13:00","repeat":"once"}'),
                   now_utc=NOW, tz_name="UTC")
check("title extracted", i.title == "Call Sara", i.title)
check("UTC time correct", i.when_utc == datetime(2026, 7, 15, 13, 0), i.when_utc)
check("scheduled_time HH:MM", i.scheduled_time == "13:00", i.scheduled_time)
check("once has no scheduled_day", i.scheduled_day is None)

# 2. timezone conversion: 1pm New York (EDT, UTC-4) → 17:00 UTC
i = parse_reminder("call at 1pm",
                   mock('{"title":"Call","datetime_local":"2026-07-15T13:00","repeat":"once"}'),
                   now_utc=NOW, tz_name="America/New_York")
check("local→UTC (NY 13:00 EDT → 17:00 UTC)", i.when_utc == datetime(2026, 7, 15, 17, 0), i.when_utc)

# 3. daily repeat
i = parse_reminder("every day at 8am take meds",
                   mock('{"title":"Take meds","datetime_local":"2026-07-16T08:00","repeat":"daily"}'),
                   now_utc=NOW, tz_name="UTC")
check("daily repeat", i.repeat == "daily")
check("daily has no scheduled_day", i.scheduled_day is None)

# 4. weekly → scheduled_day = weekday (2026-07-17 is a Friday = 4)
i = parse_reminder("every friday at 9",
                   mock('{"title":"Standup","datetime_local":"2026-07-17T09:00","repeat":"weekly"}'),
                   now_utc=NOW, tz_name="UTC")
check("weekly scheduled_day = Friday(4)", i.scheduled_day == 4, i.scheduled_day)

# 5. monthly → scheduled_day = day-of-month, clamped
i = parse_reminder("on the 31st pay rent",
                   mock('{"title":"Pay rent","datetime_local":"2026-07-31T10:00","repeat":"monthly"}'),
                   now_utc=NOW, tz_name="UTC")
check("monthly scheduled_day clamps 31→28", i.scheduled_day == 28, i.scheduled_day)

# 6. tolerates ```json fences + prose
i = parse_reminder("x", mock('Sure!\n```json\n{"title":"T","datetime_local":"2026-07-15T15:00","repeat":"once"}\n```'),
                   now_utc=NOW, tz_name="UTC")
check("strips fences/prose", i.title == "T" and i.when_utc == datetime(2026, 7, 15, 15, 0))

# 7. two times → the reminder time (LLM's job; we just carry its choice)
i = parse_reminder("meeting at 2, remind me at 1",
                   mock('{"title":"Meeting","datetime_local":"2026-07-15T13:00","repeat":"once"}'),
                   now_utc=NOW, tz_name="UTC")
check("uses the reminder time (13:00), not the event (14:00)", i.scheduled_time == "13:00", i.scheduled_time)

# 8. errors surface, don't silently pass
try:
    parse_reminder("x", mock('{"title":"","datetime_local":"2026-07-15T13:00","repeat":"once"}'), now_utc=NOW)
    check("empty title raises", False)
except ValueError:
    check("empty title raises", True)
try:
    parse_reminder("x", mock('{"title":"T","datetime_local":"notatime","repeat":"once"}'), now_utc=NOW)
    check("bad time raises", False)
except ValueError:
    check("bad time raises", True)
try:
    parse_reminder("x", mock("the model rambled with no json"), now_utc=NOW)
    check("no-JSON reply raises", False)
except ValueError:
    check("no-JSON reply raises", True)

# 9. maps to task_create args
args = intent_to_task_args(parse_reminder(
    "friday 9am standup",
    mock('{"title":"Standup","datetime_local":"2026-07-17T09:00","repeat":"weekly"}'),
    now_utc=NOW, tz_name="UTC"))
check("intent_to_task_args shape", args == {"name": "Standup", "prompt": "Standup",
      "schedule": "weekly", "scheduled_time": "09:00", "scheduled_day": 4}, args)

print(f"\n{len(fails) == 0 and 'all passed' or f'{len(fails)} FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
