#!/usr/bin/env python
"""Nightjar MCP wrapper: Odysseus PIM (calendar + notes + tasks) — ONE server.

These live only as FastAPI route closures over SQLAlchemy models in Odysseus
(no service layer), so this wrapper drives the ORM models directly via
SessionLocal. Consolidated into a single MCP server (not three) per the plan.
All rows are owner-scoped to the single Nightjar user.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import _bootstrap  # sets sys.path + env (must be first)
from mcp.server.fastmcp import FastMCP

from core.database import (
    SessionLocal, Base, engine,
    Note, ScheduledTask, CalendarCal, CalendarEvent,
)
from schedule_backend import compute_next_run  # pure next_run math (NJ-16)

# ensure tables exist (headless, no FastAPI startup)
Base.metadata.create_all(bind=engine)

VALID_SCHEDULES = ("once", "daily", "weekly", "monthly")


def _migrate_dead_task_rows() -> int:
    """NJ-16: heal rows written by the old task_create — status='active' with no next_run, which
    nothing could ever fire. Backfill a real next_run from each row's schedule + time; a row
    that can no longer produce one (a past 'once') is marked completed rather than left dangling.
    Returns how many rows were touched. Runs once at import; safe to re-run (only touches
    active rows with next_run IS NULL)."""
    from schedule_backend import compute_next_run as _cnr

    healed = 0
    now = datetime.utcnow()
    with SessionLocal() as db:
        rows = (db.query(ScheduledTask)
                .filter(ScheduledTask.status == "active", ScheduledTask.next_run.is_(None)).all())
        for r in rows:
            sched = (r.schedule or "once").lower()
            if sched == "once":
                # A legacy one-off carries no day info (only a time), so we can't know WHICH day
                # it was meant for — resurrecting it to fire at the next occurrence could deliver
                # a weeks-stale reminder (Bugbot). Keep it ONLY if it has a still-future explicit
                # date; otherwise complete the corpse.
                if r.scheduled_date and r.scheduled_date > now:
                    r.next_run = r.scheduled_date
                else:
                    r.status = "completed"
            else:
                nr = _cnr(sched, r.scheduled_time or "", scheduled_day=r.scheduled_day, now=now)
                if nr is None:
                    r.status = "completed"  # unschedulable recurring → don't leave it dangling
                else:
                    r.next_run = nr
            healed += 1
        if healed:
            db.commit()
    return healed


_migrate_dead_task_rows()

mcp = FastMCP("odysseus-pim")
OWNER = _bootstrap.OWNER


def _uid() -> str:
    return uuid.uuid4().hex


# ---------------- notes ----------------
@mcp.tool()
def note_create(title: str, content: str = "") -> dict:
    """Create a note."""
    with SessionLocal() as db:
        n = Note(id=_uid(), owner=OWNER, title=title, content=content, note_type="note", source="agent")
        db.add(n); db.commit()
        return {"id": n.id, "title": n.title}


@mcp.tool()
def note_list(limit: int = 20) -> list[dict]:
    """List notes (most recent first)."""
    with SessionLocal() as db:
        rows = (db.query(Note).filter(Note.owner == OWNER, Note.archived == False)  # noqa: E712
                .order_by(Note.created_at.desc()).limit(limit).all())
        return [{"id": r.id, "title": r.title, "content": r.content} for r in rows]


# ---------------- tasks ----------------
@mcp.tool()
def task_create(name: str, prompt: str = "", schedule: str = "once",
                scheduled_time: str = "", scheduled_day: int = -1) -> dict:
    """Create a scheduled reminder/task. schedule: once|daily|weekly|monthly; scheduled_time
    'HH:MM' (UTC); scheduled_day = weekday 0=Mon..6=Sun (weekly) or day-of-month 1..28 (monthly).
    Pass -1 (the default) to leave scheduled_day unset.

    NJ-16 fix: this now computes a real `next_run` so a poller can actually fire the task —
    before, rows were written with no next_run and nothing could ever run them.
    """
    sched = (schedule or "once").strip().lower()
    if sched not in VALID_SCHEDULES:
        return {"error": f"invalid schedule '{schedule}'; must be one of {', '.join(VALID_SCHEDULES)}"}

    # -1 = unset. Check `>= 0` explicitly so scheduled_day=0 (Monday) is NOT swallowed by a
    # truthiness test (Bugbot: `and scheduled_day` treated Monday as unset).
    day = scheduled_day if sched in ("weekly", "monthly") and scheduled_day >= 0 else None
    next_run = compute_next_run(sched, scheduled_time or "", scheduled_day=day, now=datetime.utcnow())
    if next_run is None:
        return {"error": "could not compute a fire time for that schedule (a 'once' time in the past?)."}

    with SessionLocal() as db:
        t = ScheduledTask(id=_uid(), owner=OWNER, name=name, prompt=prompt,
                          task_type="llm", schedule=sched,
                          scheduled_time=(scheduled_time or None),
                          scheduled_day=day, next_run=next_run, status="active")
        db.add(t); db.commit()
        return {"id": t.id, "name": t.name, "schedule": t.schedule,
                "next_run": next_run.isoformat() + "Z"}


@mcp.tool()
def task_list(limit: int = 20) -> list[dict]:
    """List scheduled tasks (with their next fire time)."""
    with SessionLocal() as db:
        rows = (db.query(ScheduledTask).filter(ScheduledTask.owner == OWNER)
                .order_by(ScheduledTask.created_at.desc()).limit(limit).all())
        return [{"id": r.id, "name": r.name, "schedule": r.schedule, "status": r.status,
                 "next_run": (r.next_run.isoformat() + "Z") if r.next_run else None} for r in rows]


@mcp.tool()
def task_due(now: str = "") -> list[dict]:
    """Return active tasks whose next_run is at or before `now` (ISO-8601 UTC; default = utcnow).

    This is what a scheduler polls to know what to fire. Uses the ix_scheduled_tasks_due index
    (status, next_run). Fire them, then call task_mark_fired for each.
    """
    when = (_parse_iso(now) or datetime.utcnow()) if now else datetime.utcnow()
    with SessionLocal() as db:
        rows = (db.query(ScheduledTask)
                .filter(ScheduledTask.owner == OWNER, ScheduledTask.status == "active",
                        ScheduledTask.next_run.isnot(None), ScheduledTask.next_run <= when)
                .order_by(ScheduledTask.next_run.asc()).all())
        return [{"id": r.id, "name": r.name, "prompt": r.prompt, "schedule": r.schedule,
                 "next_run": r.next_run.isoformat() + "Z"} for r in rows]


@mcp.tool()
def task_mark_fired(task_id: str, now: str = "") -> dict:
    """Record that a task fired: set last_run, and either advance next_run (recurring) or mark
    it completed (once). `now` (ISO-8601 UTC, default utcnow) is the fire time — pass the time
    the task was DUE so a recurring task advances from its slot, not from wall-clock. A
    missing/foreign task returns an error, not a raise."""
    if now:
        fired_at = _parse_iso(now)
        if fired_at is None:
            return {"error": f"bad 'now' timestamp: '{now}'"}
    else:
        fired_at = datetime.utcnow()
    with SessionLocal() as db:
        t = db.query(ScheduledTask).filter(ScheduledTask.id == task_id,
                                            ScheduledTask.owner == OWNER).first()
        if t is None:
            return {"error": f"no task {task_id}"}
        t.last_run = fired_at
        if (t.schedule or "once").lower() == "once":
            t.status = "completed"
            t.next_run = None
        else:
            # Advance past the LATER of the fire time and the current slot, so we never return
            # the same slot and re-fire it (Bugbot: a fired_at earlier than next_run could).
            base = max(fired_at, t.next_run) if t.next_run else fired_at
            nr = compute_next_run(t.schedule, t.scheduled_time or "", scheduled_day=t.scheduled_day, now=base)
            if nr is None:
                # A recurring task we can no longer schedule → complete it, never a zombie that's
                # active with next_run=None and thus never due again (Bugbot).
                t.status = "completed"
                t.next_run = None
            else:
                t.next_run = nr
        db.commit()
        return {"id": t.id, "status": t.status,
                "next_run": (t.next_run.isoformat() + "Z") if t.next_run else None}


def _parse_iso(s: str):
    """Parse an ISO-8601 UTC string (tolerating a trailing 'Z') to a naive-UTC datetime, or
    None if it can't be parsed — so a malformed `now` degrades instead of raising out of the
    MCP tool (Bugbot)."""
    try:
        return datetime.fromisoformat(s.strip().replace("Z", "").replace("z", ""))
    except (ValueError, TypeError, AttributeError):
        return None


# ---------------- calendar ----------------
def _default_calendar(db) -> str:
    cal = db.query(CalendarCal).filter(CalendarCal.owner == OWNER, CalendarCal.source == "local").first()
    if cal is None:
        cal = CalendarCal(id=_uid(), owner=OWNER, name="Nightjar", source="local")
        db.add(cal); db.commit()
    return cal.id


@mcp.tool()
def calendar_create_event(summary: str, dtstart: str, dtend: str, description: str = "") -> dict:
    """Create a calendar event. dtstart/dtend are ISO 8601 (e.g. 2026-07-10T15:00:00)."""
    with SessionLocal() as db:
        cal_id = _default_calendar(db)
        ev = CalendarEvent(uid=_uid(), calendar_id=cal_id, summary=summary, description=description,
                           dtstart=datetime.fromisoformat(dtstart), dtend=datetime.fromisoformat(dtend),
                           origin="local")
        db.add(ev); db.commit()
        return {"uid": ev.uid, "summary": ev.summary, "dtstart": dtstart}


@mcp.tool()
def calendar_list_events(limit: int = 20) -> list[dict]:
    """List upcoming calendar events (by start time)."""
    with SessionLocal() as db:
        rows = (db.query(CalendarEvent).join(CalendarCal, CalendarEvent.calendar_id == CalendarCal.id)
                .filter(CalendarCal.owner == OWNER).order_by(CalendarEvent.dtstart.asc()).limit(limit).all())
        return [{"uid": r.uid, "summary": r.summary, "dtstart": r.dtstart.isoformat(),
                 "dtend": r.dtend.isoformat()} for r in rows]


if __name__ == "__main__":
    mcp.run()
