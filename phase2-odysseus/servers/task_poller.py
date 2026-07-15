#!/usr/bin/env python
"""Local-scheduler poll (Task 6, free tier). One-shot: claim the tasks due now and print them.

The Electron main spawns this on an interval; for each task it prints, main shows a desktop
notification (only while the app is open — the free tier's guarantee). Reuses pim_server's
task_due + task_mark_fired so the next_run math and the schema stay in one place.

CLAIM semantics: this marks each due task fired BEFORE printing it (advancing a recurring
task's next_run, completing a 'once'). So a task is claimed exactly once even if two polls
overlap, and a crash after claiming loses at most one local notification — acceptable for the
best-effort local tier (the always-on server, PR 17, is the reliable delivery path).

Prints one JSON line: {"due": [{"id","name","prompt","schedule"}, ...]}. Exit 0 always (a poll
finding nothing is normal); DB/import errors print {"due": [], "error": "..."} and exit 1.
"""
import json
import sys
from datetime import datetime


def main() -> int:
    try:
        import _bootstrap  # noqa: F401 — sets sys.path/env; must import before pim_server
        import pim_server as pim
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"due": [], "error": f"import failed: {exc.__class__.__name__}: {exc}"}))
        return 1

    now_iso = datetime.utcnow().isoformat() + "Z"
    try:
        due = pim.task_due(now=now_iso)
        claimed = []
        for t in due:
            # Mark fired at the task's due time (its next_run), not wall-clock, so a recurring
            # task advances from its slot. task_due returned next_run in each row.
            pim.task_mark_fired(t["id"], now=t.get("next_run", now_iso))
            claimed.append({"id": t["id"], "name": t["name"], "prompt": t.get("prompt", ""),
                            "schedule": t["schedule"]})
        print(json.dumps({"due": claimed}))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"due": [], "error": f"poll failed: {exc.__class__.__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
