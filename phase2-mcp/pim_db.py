"""Nightjar's own PIM store — notes, scheduled tasks, calendar. No Odysseus.

Replaces `from core.database import ...` (Odysseus, AGPL) with our own SQLAlchemy
(MIT) models. Odysseus's tables are enormous — `ScheduledTask` alone has ~30
columns plus foreign keys to `sessions`, `crew_members` and itself — and Nightjar
only ever read or wrote a small subset. This declares exactly that subset and
nothing else.

Store: `~/.nightjar/pim.db` (override with NIGHTJAR_PIM_DB). Deliberately NOT
under `~/.nightjar/odysseus/`, so the new store is not entangled with the
directory PR G removes.

MIGRATION: on first use, if Odysseus's old `app.db` exists and our tables are
empty, the subset is copied across with raw sqlite3 — no Odysseus import, no ORM,
so it works even after the submodule is gone. Idempotent and non-destructive: the
old file is only read, never modified or deleted.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()


def _data_dir() -> Path:
    d = Path(os.environ.get("NIGHTJAR_DATA_DIR") or (Path.home() / ".nightjar"))
    d.mkdir(parents=True, exist_ok=True)
    return d


DB_PATH = Path(os.environ.get("NIGHTJAR_PIM_DB") or (_data_dir() / "pim.db"))
# The pre-removal Odysseus store, read once for migration. Same default
# _bootstrap.py used (ODYSSEUS_DATA_DIR), so an existing install is found.
LEGACY_DB = Path(
    os.environ.get("ODYSSEUS_DATA_DIR") or (Path.home() / ".nightjar" / "odysseus")
) / "app.db"

engine = create_engine(f"sqlite:///{DB_PATH.as_posix()}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Note(Base):
    __tablename__ = "notes"
    id = Column(String, primary_key=True, index=True)
    owner = Column(String, nullable=True, index=True)
    title = Column(String, default="")
    content = Column(Text, nullable=True)
    note_type = Column(String, default="note")
    source = Column(String, default="user")  # "user" | "agent"
    archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class ScheduledTask(Base):
    __tablename__ = "scheduled_tasks"
    id = Column(String, primary_key=True, index=True)
    owner = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False, default="Untitled Task")
    prompt = Column(Text, nullable=True)
    task_type = Column(String, default="llm")
    schedule = Column(String, nullable=True)          # once | daily | weekly | monthly
    scheduled_time = Column(String, nullable=True)    # "HH:MM" (UTC)
    scheduled_day = Column(Integer, nullable=True)    # 0=Mon weekly, 1..28 monthly
    scheduled_date = Column(DateTime, nullable=True)  # exact datetime for "once"
    next_run = Column(DateTime, nullable=True, index=True)
    last_run = Column(DateTime, nullable=True)
    status = Column(String, default="active")         # active | paused | completed
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # The poller's hot query is (status, next_run) — same index Odysseus had.
    __table_args__ = (Index("ix_scheduled_tasks_due", "status", "next_run"),)


class CalendarCal(Base):
    __tablename__ = "calendars"
    id = Column(String, primary_key=True, index=True)
    owner = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    source = Column(String, default="local")
    created_at = Column(DateTime, default=datetime.utcnow)


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    uid = Column(String, primary_key=True, index=True)
    calendar_id = Column(String, ForeignKey("calendars.id"), nullable=False, index=True)
    summary = Column(String, nullable=False, default="")
    description = Column(Text, default="")
    dtstart = Column(DateTime, nullable=False, index=True)
    dtend = Column(DateTime, nullable=False)
    origin = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------- migration

# (our table, legacy table, columns to carry across)
_MIGRATE = [
    ("notes", "notes",
     ["id", "owner", "title", "content", "note_type", "source", "archived", "created_at"]),
    ("scheduled_tasks", "scheduled_tasks",
     ["id", "owner", "name", "prompt", "task_type", "schedule", "scheduled_time",
      "scheduled_day", "scheduled_date", "next_run", "last_run", "status", "created_at"]),
    ("calendars", "calendars", ["id", "owner", "name", "source", "created_at"]),
    ("calendar_events", "calendar_events",
     ["uid", "calendar_id", "summary", "description", "dtstart", "dtend", "origin", "created_at"]),
]


def _legacy_columns(cur, table: str) -> set[str]:
    try:
        return {r[1] for r in cur.execute(f"PRAGMA table_info({table})")}
    except sqlite3.Error:
        return set()


def migrate_from_odysseus(legacy: Path | None = None) -> dict:
    """Copy the PIM subset out of Odysseus's app.db, once. Returns per-table counts.

    Only runs into EMPTY tables, so re-running never duplicates rows and never
    overwrites anything created since. Reads the legacy file with raw sqlite3 —
    no Odysseus import — so it still works after the submodule is deleted.
    Intersects our columns with whatever the legacy table actually has, so an
    older/newer Odysseus schema degrades to the common subset instead of raising.
    """
    src = Path(legacy) if legacy else LEGACY_DB
    result: dict = {"legacy_db": str(src), "migrated": {}, "skipped": None}
    if not src.exists():
        result["skipped"] = "no legacy database"
        return result

    Base.metadata.create_all(bind=engine)
    with sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True) as sconn, \
            sqlite3.connect(DB_PATH.as_posix()) as dconn:
        scur, dcur = sconn.cursor(), dconn.cursor()
        for table, legacy_table, cols in _MIGRATE:
            if dcur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]:
                continue  # already has data — never clobber
            have = _legacy_columns(scur, legacy_table)
            if not have:
                continue  # legacy table absent
            use = [c for c in cols if c in have]
            if not use:
                continue
            rows = scur.execute(f"SELECT {', '.join(use)} FROM {legacy_table}").fetchall()
            if not rows:
                continue
            dcur.executemany(
                f"INSERT OR IGNORE INTO {table} ({', '.join(use)}) "
                f"VALUES ({', '.join('?' * len(use))})",
                rows,
            )
            result["migrated"][table] = len(rows)
        dconn.commit()
    return result


def init() -> dict:
    """Create tables and run the one-time legacy migration. Safe to call repeatedly."""
    Base.metadata.create_all(bind=engine)
    return migrate_from_odysseus()
