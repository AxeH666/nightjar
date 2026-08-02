#!/usr/bin/env python3
"""Odysseus -> Nightjar PIM migration test (Odysseus removal, PR D).

`~/.nightjar/odysseus/` exists on the dev box but is EMPTY (created by the old
_bootstrap's mkdir-on-import, never populated), so there was no real data to
migrate against. Other machines may well have notes/tasks/events, so the
migration is exercised here against a SYNTHESIZED legacy app.db built to
Odysseus's actual `core/database.py` shape — including the wide columns Nightjar
never used, to prove the narrowing works.

Covers what would actually bite a user: rows carried across intact, extra legacy
columns ignored, re-running not duplicating, a populated store never clobbered,
a missing legacy DB being a clean no-op, and an older legacy schema (missing
columns) degrading instead of raising.

Run: phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_pim_migration.py
"""
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

TMP = Path(tempfile.mkdtemp(prefix="pim-mig-"))
os.environ["NIGHTJAR_PIM_DB"] = str(TMP / "pim.db")
os.environ["ODYSSEUS_DATA_DIR"] = str(TMP / "odysseus")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAILS = []


def check(name, cond, got=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{'' if cond else f'  (got {got})'}")
    if not cond:
        FAILS.append(name)


def build_legacy(path: Path, *, narrow: bool = False) -> None:
    """A legacy app.db shaped like Odysseus's real tables (wide), or an older/narrower one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path)
    now = datetime.utcnow().isoformat(" ")
    soon = (datetime.utcnow() + timedelta(hours=2)).isoformat(" ")
    if narrow:
        # An older Odysseus: notes without `source`, tasks without `scheduled_date`.
        c.execute("CREATE TABLE notes (id TEXT PRIMARY KEY, owner TEXT, title TEXT, content TEXT, note_type TEXT, archived INT, created_at TIMESTAMP)")
        c.execute("INSERT INTO notes VALUES ('n-old','nightjar','older schema','body','note',0,?)", (now,))
    else:
        # Wide, like the real thing — extra columns Nightjar never read.
        c.execute("""CREATE TABLE notes (id TEXT PRIMARY KEY, owner TEXT, title TEXT, content TEXT,
                     items TEXT, note_type TEXT, color TEXT, label TEXT, pinned INT, archived INT,
                     due_date TEXT, source TEXT, session_id TEXT, sort_order INT, image_url TEXT,
                     repeat TEXT, ai_classification TEXT, ai_content_hash TEXT,
                     agent_session_id TEXT, created_at TIMESTAMP, updated_at TIMESTAMP)""")
        c.execute("INSERT INTO notes (id,owner,title,content,note_type,archived,source,created_at,pinned,sort_order) "
                  "VALUES ('n1','nightjar','buy milk','2 litres','note',0,'agent',?,1,3)", (now,))
        c.execute("INSERT INTO notes (id,owner,title,content,note_type,archived,source,created_at) "
                  "VALUES ('n2','nightjar','archived one','x','note',1,'user',?)", (now,))

        c.execute("""CREATE TABLE scheduled_tasks (id TEXT PRIMARY KEY, owner TEXT, name TEXT, prompt TEXT,
                     task_type TEXT, action TEXT, schedule TEXT, scheduled_time TEXT, scheduled_day INT,
                     scheduled_date TIMESTAMP, trigger_type TEXT, trigger_event TEXT, trigger_count INT,
                     trigger_counter INT, next_run TIMESTAMP, last_run TIMESTAMP, status TEXT,
                     output_target TEXT, session_id TEXT, model TEXT, endpoint_url TEXT, run_count INT,
                     cron_expression TEXT, then_task_id TEXT, webhook_token TEXT, crew_member_id TEXT,
                     character_id TEXT, max_steps INT, email_results INT, notifications_enabled INT,
                     created_at TIMESTAMP, updated_at TIMESTAMP)""")
        c.execute("INSERT INTO scheduled_tasks (id,owner,name,prompt,task_type,schedule,scheduled_time,"
                  "scheduled_day,next_run,status,created_at,run_count,webhook_token) "
                  "VALUES ('t1','nightjar','call Sara','ring her','llm','daily','08:30',NULL,?,'active',?,7,'tok')",
                  (soon, now))
        c.execute("INSERT INTO scheduled_tasks (id,owner,name,schedule,scheduled_time,scheduled_day,next_run,status,created_at) "
                  "VALUES ('t2','nightjar','weekly review','weekly','09:00',0,?,'active',?)", (soon, now))

        c.execute("CREATE TABLE calendars (id TEXT PRIMARY KEY, owner TEXT, name TEXT, color TEXT, source TEXT, account_id TEXT, caldav_base_url TEXT, created_at TIMESTAMP, updated_at TIMESTAMP)")
        c.execute("INSERT INTO calendars (id,owner,name,source,created_at) VALUES ('c1','nightjar','Nightjar','local',?)", (now,))
        c.execute("""CREATE TABLE calendar_events (uid TEXT PRIMARY KEY, calendar_id TEXT, summary TEXT,
                     description TEXT, location TEXT, dtstart TIMESTAMP, dtend TIMESTAMP, all_day INT,
                     is_utc INT, rrule TEXT, recurrence_exdates TEXT, color TEXT, status TEXT,
                     importance TEXT, event_type TEXT, last_pinged TIMESTAMP, origin TEXT,
                     remote_href TEXT, remote_etag TEXT, caldav_sync_pending TEXT,
                     created_at TIMESTAMP, updated_at TIMESTAMP)""")
        c.execute("INSERT INTO calendar_events (uid,calendar_id,summary,description,dtstart,dtend,origin,created_at) "
                  "VALUES ('e1','c1','dentist','check-up',?,?,'local',?)", (soon, soon, now))
    c.commit()
    c.close()


legacy = TMP / "odysseus" / "app.db"
build_legacy(legacy)

import pim_db  # noqa: E402

print("== 1. migration carries the subset across ==")
res = pim_db.init()
check("migration reported rows", bool(res.get("migrated")), res)
with pim_db.SessionLocal() as db:
    notes = db.query(pim_db.Note).all()
    tasks = db.query(pim_db.ScheduledTask).all()
    cals = db.query(pim_db.CalendarCal).all()
    evs = db.query(pim_db.CalendarEvent).all()
check("2 notes migrated", len(notes) == 2, len(notes))
check("2 tasks migrated", len(tasks) == 2, len(tasks))
check("1 calendar migrated", len(cals) == 1, len(cals))
check("1 event migrated", len(evs) == 1, len(evs))

n1 = next((n for n in notes if n.id == "n1"), None)
check("note content intact", n1 is not None and n1.title == "buy milk" and n1.content == "2 litres")
check("note source intact", n1 is not None and n1.source == "agent", getattr(n1, "source", None))
t1 = next((t for t in tasks if t.id == "t1"), None)
check("task fields intact", t1 is not None and t1.name == "call Sara" and t1.schedule == "daily")
check("task next_run is a datetime", isinstance(getattr(t1, "next_run", None), datetime), type(getattr(t1, "next_run", None)))
t2 = next((t for t in tasks if t.id == "t2"), None)
check("scheduled_day 0 (Monday) preserved, not lost", t2 is not None and t2.scheduled_day == 0, getattr(t2, "scheduled_day", None))
check("wide legacy columns ignored without error", True)

print("\n== 2. re-running does not duplicate ==")
again = pim_db.migrate_from_odysseus()
with pim_db.SessionLocal() as db:
    check("still 2 notes after re-run", db.query(pim_db.Note).count() == 2, db.query(pim_db.Note).count())
    check("still 2 tasks after re-run", db.query(pim_db.ScheduledTask).count() == 2)
check("re-run migrated nothing new", not again.get("migrated"), again.get("migrated"))

print("\n== 3. a populated store is never clobbered ==")
with pim_db.SessionLocal() as db:
    db.add(pim_db.Note(id="mine", owner="nightjar", title="written after migration", content=""))
    db.commit()
pim_db.migrate_from_odysseus()
with pim_db.SessionLocal() as db:
    check("post-migration row survives", db.query(pim_db.Note).filter(pim_db.Note.id == "mine").count() == 1)
    check("no duplicates introduced", db.query(pim_db.Note).count() == 3, db.query(pim_db.Note).count())

print("\n== 4. no legacy DB = clean no-op ==")
res2 = pim_db.migrate_from_odysseus(TMP / "nope" / "app.db")
check("skipped cleanly, no raise", res2.get("skipped") == "no legacy database", res2)

print("\n== 5. an OLDER legacy schema degrades instead of raising ==")
tmp2 = Path(tempfile.mkdtemp(prefix="pim-mig2-"))
narrow = tmp2 / "odysseus" / "app.db"
build_legacy(narrow, narrow=True)
import importlib  # noqa: E402

os.environ["NIGHTJAR_PIM_DB"] = str(tmp2 / "pim.db")
# BOTH must move: pim_db reads LEGACY_DB from ODYSSEUS_DATA_DIR at import time, so
# leaving it pointed at the wide fixture would re-migrate that one instead.
os.environ["ODYSSEUS_DATA_DIR"] = str(tmp2 / "odysseus")
importlib.reload(pim_db)
try:
    r3 = pim_db.init()
    with pim_db.SessionLocal() as db:
        got = db.query(pim_db.Note).count()
    check("narrow legacy migrated on the common columns", got == 1, got)
    check("missing legacy tables skipped, not fatal", "scheduled_tasks" not in r3.get("migrated", {}), r3)
except Exception as exc:  # noqa: BLE001
    check("narrow legacy does not raise", False, f"{type(exc).__name__}: {exc}")

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
