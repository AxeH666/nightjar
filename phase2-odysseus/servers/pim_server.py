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

# ensure tables exist (headless, no FastAPI startup)
Base.metadata.create_all(bind=engine)

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
                scheduled_time: str = "") -> dict:
    """Create a scheduled task. schedule: once|daily|weekly|monthly; scheduled_time 'HH:MM' (UTC)."""
    with SessionLocal() as db:
        t = ScheduledTask(id=_uid(), owner=OWNER, name=name, prompt=prompt,
                          task_type="llm", schedule=schedule,
                          scheduled_time=(scheduled_time or None), status="active")
        db.add(t); db.commit()
        return {"id": t.id, "name": t.name, "schedule": t.schedule}


@mcp.tool()
def task_list(limit: int = 20) -> list[dict]:
    """List scheduled tasks."""
    with SessionLocal() as db:
        rows = (db.query(ScheduledTask).filter(ScheduledTask.owner == OWNER)
                .order_by(ScheduledTask.created_at.desc()).limit(limit).all())
        return [{"id": r.id, "name": r.name, "schedule": r.schedule, "status": r.status} for r in rows]


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
