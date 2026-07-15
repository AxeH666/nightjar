"""APScheduler wrapper: a 'once' reminder actually fires and delivers, recurring triggers land
on the right slot, and — the load-bearing property — reminders SURVIVE A RESTART via the SQLite
jobstore (a reminder set today must still fire after the server bounces)."""
import time
from datetime import datetime, timedelta

from app.nl_intent import ReminderIntent
from app.scheduler import ReminderScheduler, set_delivery
from app.transport import MockTransport


def _intent(title, when, repeat="once", scheduled_day=None):
    return ReminderIntent(title=title, when_utc=when, repeat=repeat,
                          scheduled_time=when.strftime("%H:%M"), scheduled_day=scheduled_day)


def _db_url(tmp_path):
    return f"sqlite:///{tmp_path}/sched.db"


def test_once_reminder_fires_and_delivers(tmp_path):
    transport = MockTransport()
    sched = ReminderScheduler(_db_url(tmp_path), delivery=transport.send)
    sched.start()
    try:
        soon = datetime.utcnow() + timedelta(seconds=1)
        sched.schedule(user_id=5, chat_id=99, intent=_intent("call Sara", soon))
        # wait for the fire (poll up to 5s so a slow CI box doesn't flake)
        for _ in range(50):
            if transport.sent:
                break
            time.sleep(0.1)
    finally:
        sched.shutdown()
    assert transport.sent == [(99, "⏰ Reminder: call Sara")]


def test_weekly_trigger_lands_on_the_right_weekday(tmp_path):
    sched = ReminderScheduler(_db_url(tmp_path), delivery=MockTransport().send)
    sched.start()
    try:
        friday = datetime(2026, 7, 17, 9, 0)  # a Friday → weekday()==4
        job_id = sched.schedule(user_id=1, chat_id=1, intent=_intent("sync", friday, repeat="weekly"))
        job = sched.scheduler.get_job(job_id)
        assert job.next_run_time.weekday() == 4  # NOT off-by-a-day from APScheduler's int convention
        assert job.next_run_time.hour == 9
    finally:
        sched.shutdown()


def test_list_and_cancel(tmp_path):
    sched = ReminderScheduler(_db_url(tmp_path), delivery=MockTransport().send)
    sched.start()
    try:
        future = datetime(2030, 1, 1, 9, 0)
        jid = sched.schedule(user_id=8, chat_id=8, intent=_intent("dentist", future))
        sched.schedule(user_id=99, chat_id=99, intent=_intent("other user", future))
        jobs = sched.list_jobs(8)
        assert len(jobs) == 1 and jobs[0]["title"] == "dentist"  # scoped to the user
        assert sched.cancel(jid) is True
        assert sched.list_jobs(8) == []
        assert sched.cancel("rem:8:doesnotexist") is False
    finally:
        sched.shutdown()


def test_reminder_survives_restart(tmp_path):
    """Schedule a future reminder, shut the scheduler down, bring a FRESH one up on the same DB —
    the reminder must still be there (this is the whole point of the SQLite jobstore)."""
    url = _db_url(tmp_path)
    far_future = datetime(2035, 6, 1, 8, 0)

    sched1 = ReminderScheduler(url, delivery=MockTransport().send)
    sched1.start()
    jid = sched1.schedule(user_id=7, chat_id=7, intent=_intent("take pills", far_future))
    sched1.shutdown()  # simulate the server stopping

    # A brand-new scheduler on the same DB = a restart. Re-register delivery (a live transport is
    # never persisted); the job itself comes back from SQLite.
    transport2 = MockTransport()
    sched2 = ReminderScheduler(url, delivery=transport2.send)
    sched2.start()
    try:
        jobs = sched2.list_jobs(7)
        assert len(jobs) == 1
        assert jobs[0]["id"] == jid
        assert jobs[0]["title"] == "take pills"
    finally:
        sched2.shutdown()
