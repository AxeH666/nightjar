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
from zoneinfo import ZoneInfo

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

from .nl_intent import ReminderIntent

# datetime.weekday(): 0=Mon..6=Sun. Pass names to CronTrigger to avoid APScheduler's integer
# weekday convention (which is not the crontab 0=Sunday one), which is an easy off-by-a-day bug.
_WEEKDAY_NAMES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _tz_ok(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except Exception:  # noqa: BLE001
        return False

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

    def schedule(self, user_id: int, chat_id: int, intent: ReminderIntent,
                 tz_name: str = "UTC") -> str:
        """Schedule `intent` for `user_id`/`chat_id`; returns the job id. once → a one-shot at the
        exact when_utc instant; daily/weekly/monthly → a recurring cron in the USER'S timezone so
        it keeps firing at the intended LOCAL wall-clock time (DST-correct) and on the intended
        local weekday/day — not drifting an hour at DST or landing on the UTC weekday (Bugbot)."""
        job_id = f"rem:{user_id}:{uuid.uuid4().hex[:12]}"
        self.scheduler.add_job(_fire, self._trigger(intent, tz_name), args=[chat_id, intent.title],
                               id=job_id, replace_existing=False)
        return job_id

    def _trigger(self, intent: ReminderIntent, tz_name: str = "UTC"):
        repeat = intent.repeat
        if repeat == "once":
            # A one-off is a fixed instant; UTC is exactly right and has no DST ambiguity.
            return DateTrigger(run_date=intent.when_utc, timezone="UTC")

        # Recurring: express the trigger in the user's LOCAL wall-clock so APScheduler re-derives
        # the UTC fire time each occurrence (handling DST) instead of freezing one UTC clock time.
        tz = tz_name if _tz_ok(tz_name) else "UTC"
        local = intent.when_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(tz))
        if repeat == "daily":
            return CronTrigger(hour=local.hour, minute=local.minute, timezone=tz)
        if repeat == "weekly":
            return CronTrigger(day_of_week=_WEEKDAY_NAMES[local.weekday()],
                               hour=local.hour, minute=local.minute, timezone=tz)
        if repeat == "monthly":
            day = min(local.day, 28)  # clamp so every month has the day
            return CronTrigger(day=day, hour=local.hour, minute=local.minute, timezone=tz)
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
