"""The keyless mock LLM: it must emit JSON that nl_intent.parse_reminder actually consumes, and
resolve "at HH(pm)", "in N min", and daily/weekly/monthly deterministically."""
from datetime import datetime

from app.llm import mock_llm_call
from app.nl_intent import parse_reminder

NOW = datetime(2026, 7, 15, 12, 0, 0)  # a Wednesday, 12:00 UTC


def _parse(text):
    return parse_reminder(text, mock_llm_call, now_utc=NOW, tz_name="UTC")


def test_at_time_pm():
    i = _parse("remind me at 3pm to call Sam")
    assert i.when_utc == datetime(2026, 7, 15, 15, 0)
    assert i.repeat == "once"
    assert "Sam" in i.title


def test_in_minutes():
    i = _parse("ping me in 30 min to stretch")
    assert i.when_utc == datetime(2026, 7, 15, 12, 30)


def test_time_already_passed_rolls_to_tomorrow():
    i = _parse("at 9am standup")  # 09:00 already passed at 12:00
    assert i.when_utc == datetime(2026, 7, 16, 9, 0)


def test_daily_repeat_detected():
    i = _parse("every day at 8am take meds")
    assert i.repeat == "daily"
    assert i.when_utc.hour == 8


def test_weekly_repeat_detected():
    i = _parse("weekly at 10am team sync")
    assert i.repeat == "weekly"


def test_default_when_no_time():
    i = _parse("remind me to drink water")
    assert i.when_utc == datetime(2026, 7, 15, 12, 5)  # +5 min default
    assert i.title  # non-empty


def test_quotes_in_message_do_not_break_json():
    # a stray quote in the message must not produce invalid JSON / a raise
    i = _parse('at 2pm to review "the doc"')
    assert i.when_utc == datetime(2026, 7, 15, 14, 0)
