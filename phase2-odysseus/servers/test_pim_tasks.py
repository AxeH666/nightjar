#!/usr/bin/env python
# Offline test for the NJ-16 task-scheduling fix: the dead-row migration + the
# task_create/task_due/task_mark_fired lifecycle. Runs against a fresh temp SQLite DB
# (ODYSSEUS_DATA_DIR), no MCP host, no network.
#
# The load-bearing assertions are DEAD_ROW_HEALED (a row the old task_create wrote with no
# next_run gets a real one on migration) and RECURRING_ADVANCES (a fired daily task gets its
# next_run pushed forward, not left to re-fire the same slot).
# Run: ODYSSEUS_DATA_DIR=$(mktemp -d) python3 test_pim_tasks.py
import os
import sys
import tempfile
from datetime import datetime, timedelta

# Isolate the DB before importing the server (which opens it at import).
os.environ.setdefault("ODYSSEUS_DATA_DIR", tempfile.mkdtemp(prefix="pim-test-"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pim_server as p  # noqa: E402
from core.database import SessionLocal, ScheduledTask  # noqa: E402

fails = []


def check(name, cond, got=""):
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got})'}")
    if not cond:
        fails.append(name)


# ---------- task_create computes a real next_run ----------
r = p.task_create("call Sara", schedule="daily", scheduled_time="08:30")
check("task_create returns a next_run", r.get("next_run") is not None, r)
check("task_create rejects a bad schedule", "error" in p.task_create("x", schedule="hourly"))

# ---------- DEAD_ROW_HEALED: the old task_create wrote status='active' + next_run=None ----------
with SessionLocal() as db:
    dead = ScheduledTask(id="deadrow1", owner=p.OWNER, name="old reminder", prompt="",
                         task_type="llm", schedule="daily", scheduled_time="09:00",
                         next_run=None, status="active")
    db.add(dead)
    # a dead 'once' whose only info is a past scheduled_date → should complete, not linger
    past_once = ScheduledTask(id="deadonce", owner=p.OWNER, name="stale once", prompt="",
                              task_type="llm", schedule="once",
                              scheduled_date=datetime.utcnow() - timedelta(days=3),
                              next_run=None, status="active")
    db.add(past_once)
    db.commit()

healed = p._migrate_dead_task_rows()
check("DEAD_ROW_HEALED — migration touched the dead rows", healed >= 2, healed)
with SessionLocal() as db:
    d = db.query(ScheduledTask).filter(ScheduledTask.id == "deadrow1").first()
    o = db.query(ScheduledTask).filter(ScheduledTask.id == "deadonce").first()
    check("dead daily row got a real next_run", d.next_run is not None, d.next_run)
    check("dead past-once row marked completed (not left dangling)", o.status == "completed", o.status)
check("migration is idempotent (no active next_run=None rows remain)", p._migrate_dead_task_rows() == 0)

# ---------- task_due + task_mark_fired lifecycle ----------
due = p.task_due(now="2099-01-01T00:00:00Z")  # far future → all active future tasks are due
check("task_due returns due tasks", len(due) >= 1, len(due))
check("task_due carries the prompt (for the scheduler to deliver)", all("prompt" in d for d in due))

daily_id = r["id"]  # daily @ 08:30
before = p.task_list(limit=50)
before_nr = next((t["next_run"] for t in before if t["id"] == daily_id), None)
# Fire it at a time PAST the 08:30 slot (as the poller would, at/after next_run) so the daily
# task advances to the next day rather than re-scheduling the same-day slot.
fired = p.task_mark_fired(daily_id, now="2026-07-15T09:00:00Z")
check("RECURRING_ADVANCES — a fired daily task keeps status active", fired["status"] == "active", fired)
check("RECURRING_ADVANCES — its next_run moved forward", fired["next_run"] != before_nr, (before_nr, fired["next_run"]))
check("RECURRING_ADVANCES — next_run is a future slot, not the past", fired["next_run"] > "2026-07-15T09:00:00Z", fired["next_run"])

# a 'once' task completes on fire
once = p.task_create("one-off", schedule="once", scheduled_time="23:59")
fired_once = p.task_mark_fired(once["id"])
check("a fired 'once' task is completed", fired_once["status"] == "completed", fired_once)
check("a completed 'once' has no next_run", fired_once["next_run"] is None)

check("mark_fired on a missing task errors, doesn't raise", "error" in p.task_mark_fired("nope"))

print(f"\n{len(fails) == 0 and 'all passed' or f'{len(fails)} FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
