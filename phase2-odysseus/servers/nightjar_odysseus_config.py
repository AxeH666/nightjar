#!/usr/bin/env python
"""Headless account onboarding for the Odysseus sidecar (no web UI).

Odysseus normally configures email/CalDAV accounts through its own web UI. Since
Nightjar doesn't run that UI, this CLI writes the same encrypted rows into
Odysseus's app.db directly — driven by a JSON config file or CLI args. Mirrors
scripts/demo_email/demo_account.py (Fernet-encrypted via src.secret_storage).

Usage:
  python nightjar_odysseus_config.py add-email --config accounts.json
  python nightjar_odysseus_config.py add-email --name Work --imap-host ... \
      --imap-user u --imap-pass p --smtp-host ... --smtp-port 587 --from u@x
  python nightjar_odysseus_config.py list
  python nightjar_odysseus_config.py add-caldav --name Home --url https://... \
      --user u --pass p

Config JSON shape:
  {"email": [{"name","imap_host","imap_port","imap_user","imap_pass",
              "smtp_host","smtp_port","smtp_security","from","default"}],
   "caldav": [{"name","url","user","pass"}]}
"""
from __future__ import annotations

import argparse
import json
import uuid

import _bootstrap  # noqa: F401  sets odysseus path + env
from core.database import SessionLocal, Base, engine, EmailAccount, CalendarCal
from src.secret_storage import encrypt

OWNER = _bootstrap.OWNER


def _upsert_email(db, a: dict) -> str:
    acct = db.query(EmailAccount).filter(
        EmailAccount.name == a["name"], EmailAccount.owner == OWNER
    ).first()
    if acct is None:
        acct = EmailAccount(id=uuid.uuid4().hex, name=a["name"])
        db.add(acct)
    acct.owner = OWNER
    acct.is_default = bool(a.get("default", False))
    acct.enabled = True
    acct.imap_host = a.get("imap_host", "")
    acct.imap_port = int(a.get("imap_port", 993))
    acct.imap_user = a.get("imap_user", "")
    acct.imap_password = encrypt(a.get("imap_pass", ""))
    acct.imap_starttls = bool(a.get("imap_starttls", True))
    acct.smtp_host = a.get("smtp_host", "")
    acct.smtp_port = int(a.get("smtp_port", 465))
    acct.smtp_security = a.get("smtp_security", "ssl")
    acct.smtp_user = a.get("smtp_user", a.get("imap_user", ""))
    acct.smtp_password = encrypt(a.get("smtp_pass", a.get("imap_pass", "")))
    acct.from_address = a.get("from", a.get("imap_user", ""))
    return acct.id


def _add_caldav(db, c: dict) -> str:
    cal = CalendarCal(id=uuid.uuid4().hex, owner=OWNER, name=c["name"],
                      source="caldav", caldav_base_url=c.get("url"))
    db.add(cal)
    return cal.id


def main():
    Base.metadata.create_all(bind=engine)
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("add-email")
    e.add_argument("--config"); e.add_argument("--name"); e.add_argument("--imap-host")
    e.add_argument("--imap-port", type=int, default=993); e.add_argument("--imap-user")
    e.add_argument("--imap-pass"); e.add_argument("--smtp-host"); e.add_argument("--smtp-port", type=int, default=465)
    e.add_argument("--smtp-security", default="ssl"); e.add_argument("--from", dest="from_addr")
    e.add_argument("--default", action="store_true")
    cd = sub.add_parser("add-caldav")
    cd.add_argument("--name", required=True); cd.add_argument("--url", required=True)
    cd.add_argument("--user"); cd.add_argument("--pass", dest="password")
    sub.add_parser("list")
    args = p.parse_args()

    with SessionLocal() as db:
        if args.cmd == "add-email":
            if args.config:
                cfg = json.load(open(args.config))
                for a in cfg.get("email", []):
                    print("email:", args_name := a["name"], "->", _upsert_email(db, a))
                for c in cfg.get("caldav", []):
                    print("caldav:", c["name"], "->", _add_caldav(db, c))
            else:
                a = {"name": args.name, "imap_host": args.imap_host, "imap_port": args.imap_port,
                     "imap_user": args.imap_user, "imap_pass": args.imap_pass,
                     "smtp_host": args.smtp_host, "smtp_port": args.smtp_port,
                     "smtp_security": args.smtp_security, "from": args.from_addr, "default": args.default}
                print("email:", args.name, "->", _upsert_email(db, a))
            db.commit()
        elif args.cmd == "add-caldav":
            print("caldav:", args.name, "->", _add_caldav(db, {"name": args.name, "url": args.url}))
            db.commit()
        elif args.cmd == "list":
            for acct in db.query(EmailAccount).filter(EmailAccount.owner == OWNER).all():
                print(f"email  {acct.name}: imap={acct.imap_host}:{acct.imap_port} smtp={acct.smtp_host}:{acct.smtp_port} default={acct.is_default}")
            for cal in db.query(CalendarCal).filter(CalendarCal.owner == OWNER).all():
                print(f"cal    {cal.name}: source={cal.source} url={cal.caldav_base_url}")


if __name__ == "__main__":
    main()
