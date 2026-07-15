"""Persistence: the User registry (Telegram identity → timezone) and the per-user daily usage
counter. Shares the SQLite file with APScheduler's jobstore (separate tables), so a single
persistent volume holds both the pending reminders and the app state.

The usage counter is exposed as plain get/set callables so the pure `usage.check_and_increment`
(and its tests) never touch a real DB.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    telegram_id = Column(Integer, primary_key=True)  # the user's Telegram numeric id = identity
    chat_id = Column(Integer, nullable=False)         # where to deliver (usually == telegram_id)
    tz = Column(String, nullable=False, default="UTC")
    created_at = Column(DateTime, default=datetime.utcnow)


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    # composite key (user, UTC day) — one row per user per day.
    user_id = Column(Integer, primary_key=True)
    day = Column(String, primary_key=True)  # ISO date "YYYY-MM-DD"
    count = Column(Integer, nullable=False, default=0)


class Database:
    def __init__(self, url: str):
        # check_same_thread=False: APScheduler fires jobs on worker threads that also read users.
        self.engine = create_engine(url, connect_args={"check_same_thread": False}, future=True)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, future=True)

    # ---- users ----
    def upsert_user(self, telegram_id: int, chat_id: int, tz: Optional[str] = None) -> None:
        with self.Session() as s:
            u = s.get(User, telegram_id)
            if u is None:
                u = User(telegram_id=telegram_id, chat_id=chat_id, tz=tz or "UTC")
                s.add(u)
            else:
                u.chat_id = chat_id
                if tz:
                    u.tz = tz
            s.commit()

    def get_user_tz(self, telegram_id: int, default: str = "UTC") -> str:
        with self.Session() as s:
            u = s.get(User, telegram_id)
            return u.tz if u else default

    def set_user_tz(self, telegram_id: int, tz: str) -> bool:
        with self.Session() as s:
            u = s.get(User, telegram_id)
            if u is None:
                return False
            u.tz = tz
            s.commit()
            return True

    # ---- usage counter (get/set callables for usage.check_and_increment) ----
    def get_count(self, user_id: int, day: str) -> int:
        with self.Session() as s:
            row = s.get(UsageCounter, (user_id, day))
            return row.count if row else 0

    def set_count(self, user_id: int, day: str, n: int) -> None:
        with self.Session() as s:
            row = s.get(UsageCounter, (user_id, day))
            if row is None:
                s.add(UsageCounter(user_id=user_id, day=day, count=n))
            else:
                row.count = n
            s.commit()
