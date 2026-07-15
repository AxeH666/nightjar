"""The reminder flow: cap → parse → schedule → confirm, with the LLM, scheduler, and usage
store all mocked (no Telegram, no real LLM, no timing)."""
from datetime import datetime

from app.core import handle_reminder_text
from app.usage import GLOBAL_BUCKET

NOW = datetime(2026, 7, 15, 12, 0, 0)


def _store():
    data = {}
    return (lambda uid, day: data.get((uid, day), 0),
            lambda uid, day, n: data.__setitem__((uid, day), n),
            data)


def _llm(reply):
    return lambda system, user: reply


def test_happy_path_schedules_and_confirms():
    scheduled = []
    get_c, set_c, _ = _store()
    reply = handle_reminder_text(
        "remind me at 1pm to call Sara", user_id=7, chat_id=7, tz_name="UTC",
        llm_call=_llm('{"title":"Call Sara","datetime_local":"2026-07-15T13:00","repeat":"once"}'),
        schedule=lambda uid, cid, intent, tz: scheduled.append((uid, cid, intent.title, intent.when_utc, tz)),
        get_count=get_c, set_count=set_c, now_utc=NOW)
    assert "Call Sara" in reply
    assert scheduled == [(7, 7, "Call Sara", datetime(2026, 7, 15, 13, 0), "UTC")]


def test_timezone_converts_to_utc_and_is_passed_to_scheduler():
    scheduled = []
    get_c, set_c, _ = _store()
    handle_reminder_text(
        "call at 1pm", user_id=1, chat_id=1, tz_name="America/New_York",
        llm_call=_llm('{"title":"Call","datetime_local":"2026-07-15T13:00","repeat":"once"}'),
        schedule=lambda uid, cid, intent, tz: scheduled.append((intent.when_utc, tz)),
        get_count=get_c, set_count=set_c, now_utc=NOW)
    # 13:00 EDT → 17:00 UTC, and the scheduler is told the tz so recurring stays DST-correct.
    assert scheduled == [(datetime(2026, 7, 15, 17, 0), "America/New_York")]


def test_recurring_intent_passed_through_and_noted():
    scheduled = []
    get_c, set_c, _ = _store()
    reply = handle_reminder_text(
        "every day at 8 take meds", user_id=2, chat_id=2, tz_name="UTC",
        llm_call=_llm('{"title":"Take meds","datetime_local":"2026-07-16T08:00","repeat":"daily"}'),
        schedule=lambda uid, cid, intent, tz: scheduled.append(intent.repeat),
        get_count=get_c, set_count=set_c, now_utc=NOW)
    assert scheduled == ["daily"]  # the scheduler adapter sees the repeat, not just a datetime
    assert "repeats daily" in reply


def test_unparseable_message_is_friendly_keeps_slot_schedules_nothing():
    scheduled = []
    get_c, set_c, data = _store()
    reply = handle_reminder_text(
        "hello", user_id=3, chat_id=3, tz_name="UTC",
        llm_call=_llm("the model gave no json"),
        schedule=lambda *a: scheduled.append(a),
        get_count=get_c, set_count=set_c, now_utc=NOW)
    assert "couldn't set that reminder" in reply
    assert scheduled == []
    # the model DID reply (a real paid call) — the slot is consumed, not refunded
    assert data[(3, "2026-07-15")] == 1


def test_llm_network_error_is_friendly_and_refunds_slot():
    scheduled = []
    get_c, set_c, data = _store()
    def broken_llm(system, user):
        raise ConnectionError("provider unreachable")  # not a ValueError
    reply = handle_reminder_text(
        "at 3pm ping", user_id=8, chat_id=8, tz_name="UTC",
        llm_call=broken_llm, schedule=lambda *a: scheduled.append(a),
        get_count=get_c, set_count=set_c, now_utc=NOW)
    assert "trouble reaching the assistant" in reply
    assert scheduled == []
    assert data[(8, "2026-07-15")] == 0  # refunded — a network blip shouldn't cost a slot


def test_schedule_error_is_friendly_and_refunds_slot():
    get_c, set_c, data = _store()
    def boom(*a):
        raise RuntimeError("store down")
    reply = handle_reminder_text(
        "at 3pm ping", user_id=4, chat_id=4, tz_name="UTC",
        llm_call=_llm('{"title":"Ping","datetime_local":"2026-07-15T15:00","repeat":"once"}'),
        schedule=boom, get_count=get_c, set_count=set_c, now_utc=NOW)
    assert "couldn't schedule" in reply
    assert data[(4, "2026-07-15")] == 0  # refunded — a transient scheduler error shouldn't cost a slot


def test_cap_day_is_utc_from_now_utc():
    get_c, set_c, data = _store()
    handle_reminder_text(
        "at 3pm ping", user_id=5, chat_id=5, tz_name="UTC",
        llm_call=_llm('{"title":"P","datetime_local":"2026-07-15T15:00","repeat":"once"}'),
        schedule=lambda *a: None, get_count=get_c, set_count=set_c,
        now_utc=datetime(2026, 3, 9, 23, 30))
    assert data[(5, "2026-03-09")] == 1  # keyed by the UTC date of now_utc


def test_daily_cap_denies_without_scheduling():
    scheduled = []
    get_c, set_c, _ = _store()
    kw = dict(user_id=9, chat_id=9, tz_name="UTC",
              llm_call=_llm('{"title":"R","datetime_local":"2026-07-15T15:00","repeat":"once"}'),
              schedule=lambda uid, cid, intent, tz: scheduled.append(intent.title),
              get_count=get_c, set_count=set_c, now_utc=NOW, daily_cap=3)
    [handle_reminder_text(x, **kw) for x in ("a", "b", "c")]
    over = handle_reminder_text("d", **kw)
    assert scheduled == ["R", "R", "R"]
    assert "limit" in over.lower()
    assert scheduled.count("R") == 3  # the denied 4th did not schedule


_OK = '{"title":"X","datetime_local":"2026-07-15T15:00","repeat":"once"}'


def test_global_cap_denies_across_users_and_refunds_the_user_slot():
    get_c, set_c, data = _store()
    kw = dict(tz_name="UTC", llm_call=_llm(_OK), schedule=lambda *a: None,
              get_count=get_c, set_count=set_c, now_utc=NOW, global_cap=2)
    handle_reminder_text("at 3pm a", user_id=1, chat_id=1, **kw)   # global 1/2
    handle_reminder_text("at 3pm b", user_id=2, chat_id=2, **kw)   # global 2/2
    over = handle_reminder_text("at 3pm c", user_id=3, chat_id=3, **kw)  # global full → deny
    assert "capacity" in over.lower()
    assert data.get((3, "2026-07-15"), 0) == 0            # user 3 refunded — not their fault
    assert data[(GLOBAL_BUCKET, "2026-07-15")] == 2        # global bucket sits at its cap


def test_rate_check_throttles_without_any_cost():
    scheduled = []
    get_c, set_c, data = _store()
    reply = handle_reminder_text(
        "at 3pm ping", user_id=1, chat_id=1, tz_name="UTC",
        llm_call=_llm(_OK), schedule=lambda *a: scheduled.append(a),
        get_count=get_c, set_count=set_c, now_utc=NOW,
        rate_check=lambda uid: False)          # throttled
    assert "fast" in reply.lower()
    assert scheduled == []
    assert data.get((1, "2026-07-15"), 0) == 0  # no slot consumed, no paid call


def test_network_error_refunds_both_user_and_global():
    get_c, set_c, data = _store()

    def broken(system, user):
        raise ConnectionError("provider down")

    handle_reminder_text("at 3pm ping", user_id=1, chat_id=1, tz_name="UTC",
                         llm_call=broken, schedule=lambda *a: None,
                         get_count=get_c, set_count=set_c, now_utc=NOW, global_cap=5)
    assert data.get((1, "2026-07-15"), 0) == 0             # user refunded
    assert data.get((GLOBAL_BUCKET, "2026-07-15"), 0) == 0  # global refunded too


def test_unparseable_keeps_both_slots():
    get_c, set_c, data = _store()
    handle_reminder_text("hello", user_id=1, chat_id=1, tz_name="UTC",
                         llm_call=_llm("no json here"), schedule=lambda *a: None,
                         get_count=get_c, set_count=set_c, now_utc=NOW, global_cap=5)
    # a real (paid) call happened → both the user and the global budget stay charged
    assert data[(1, "2026-07-15")] == 1
    assert data[(GLOBAL_BUCKET, "2026-07-15")] == 1
