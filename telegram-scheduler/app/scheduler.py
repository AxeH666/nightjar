"""APScheduler wrapper backed by a SQLite jobstore, so scheduled reminders survive a process
restart (verified in tests/test_scheduler.py).

Restart-survival constraint: a persisted job can only hold PICKLABLE args and a reference to a
module-level function — it cannot capture the live transport (a bot/HTTP client isn't picklable
and wouldn't survive a restart anyway). So the fired job calls the module-level `_fire`, which
resolves the delivery callback from a module global set at startup. After a restart, jobs
reload from SQLite and reconnect to the freshly-registered delivery hook.
"""
from __future__ import annotations

import uuid
from typing import Callable, List, Optional

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

from .nl_intent import ReminderIntent

# datetime.weekday(): 0=Mon..6=Sun. Pass names to CronTrigger to avoid APScheduler's integer
# weekday convention (which is not the crontab 0=Sunday one), which is an easy off-by-a-day bug.
_WEEKDAY_NAMES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

# Module-global delivery hook, resolved at FIRE time (not capture time) so jobs restored from the
# store after a restart reconnect to the live transport. Set via set_delivery() at startup.
_DELIVERY: Optional[Callable[[int, str], bool]] = None


def set_delivery(deliver: Callable[[int, str], bool]) -> None:
    global _DELIVERY
    _DELIVERY = deliver


def _fire(chat_id: int, title: str) -> None:
    """The persisted job target. Must be module-level + picklable-by-reference."""
    deliver = _DELIVERY
    if deliver is None:
        print(f"[scheduler] no delivery hook registered; dropping reminder for {chat_id}: {title}")
        return
    try:
        deliver(chat_id, f"⏰ Reminder: {title}")
    except Exception as exc:  # noqa: BLE001 — a delivery error must not crash the scheduler thread
        print(f"[scheduler] delivery raised for {chat_id}: {exc}")


class ReminderScheduler:
    def __init__(self, db_url: str, delivery: Optional[Callable[[int, str], bool]] = None):
        if delivery is not None:
            set_delivery(delivery)
        self.scheduler = BackgroundScheduler(
            jobstores={"default": SQLAlchemyJobStore(url=db_url)},
            timezone="UTC",
            # coalesce + a grace window so a reminder that came due while the server was down
            # still fires once on restart, rather than being silently skipped.
            job_defaults={"coalesce": True, "misfire_grace_time": 3600},
        )

    def start(self) -> None:
        self.scheduler.start()

    def shutdown(self) -> None:
        self.scheduler.shutdown(wait=False)

    def schedule(self, user_id: int, chat_id: int, intent: ReminderIntent) -> str:
        """Schedule `intent` for `user_id`/`chat_id`; returns the job id. once → a one-shot at
        when_utc; daily/weekly/monthly → a recurring cron trigger at the same UTC clock time."""
        job_id = f"rem:{user_id}:{uuid.uuid4().hex[:12]}"
        self.scheduler.add_job(_fire, self._trigger(intent), args=[chat_id, intent.title],
                               id=job_id, replace_existing=False)
        return job_id

    def _trigger(self, intent: ReminderIntent):
        when = intent.when_utc  # naive UTC
        repeat = intent.repeat
        if repeat == "once":
            return DateTrigger(run_date=when, timezone="UTC")
        if repeat == "daily":
            return CronTrigger(hour=when.hour, minute=when.minute, timezone="UTC")
        if repeat == "weekly":
            return CronTrigger(day_of_week=_WEEKDAY_NAMES[when.weekday()],
                               hour=when.hour, minute=when.minute, timezone="UTC")
        if repeat == "monthly":
            day = intent.scheduled_day or min(when.day, 28)  # clamp so every month has the day
            return CronTrigger(day=day, hour=when.hour, minute=when.minute, timezone="UTC")
        raise ValueError(f"unknown repeat '{repeat}'")

    def list_jobs(self, user_id: int) -> List[dict]:
        prefix = f"rem:{user_id}:"
        out = []
        for job in self.scheduler.get_jobs():
            if job.id.startswith(prefix):
                nxt = job.next_run_time
                out.append({"id": job.id, "title": job.args[1],
                            "next_run": nxt.isoformat() if nxt else None})
        return out

    def cancel(self, job_id: str) -> bool:
        try:
            self.scheduler.remove_job(job_id)
            return True
        except Exception:  # noqa: BLE001 — removing an unknown/already-fired job is not an error
            return False
