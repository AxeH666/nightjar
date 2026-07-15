"""Environment-driven configuration. Everything has a safe default so the server boots and is
testable with no secrets set (mock LLM + mock transport). Real deploys set BOT_TOKEN, an LLM
provider + key, and (optionally) a persistent DATA_DIR."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except (ValueError, TypeError):
        return default


@dataclass(frozen=True)
class Config:
    # Telegram: no token → MockTransport (the bot doesn't poll; delivery is recorded in memory).
    bot_token: str = ""
    # LLM: "mock" (canned parser, no key) | "anthropic" | "openai".
    llm_provider: str = "mock"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    llm_model: str = ""  # blank → provider default (see llm.py)
    # Where the SQLite DB (app tables + APScheduler jobstore) lives. Must be a persistent volume
    # in production so reminders survive a container restart.
    data_dir: str = ""
    daily_cap: int = 50           # max reminder parses per user per UTC day (shared-key guard)
    default_tz: str = "UTC"       # tz for users who haven't set one via /tz
    http_host: str = "0.0.0.0"    # noqa: S104 — bind-all is intended for a containerized service
    http_port: int = 8080
    # If set, the HTTP reminder endpoints require this bearer token. Unset = open (dev/mock only);
    # a real deploy MUST set it, or anyone could inject reminders for any Telegram id.
    api_token: str = ""

    @property
    def db_path(self) -> str:
        d = self.data_dir or os.path.join(os.path.expanduser("~"), ".nightjar", "telegram-scheduler")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "scheduler.db")

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"


def load_config() -> Config:
    return Config(
        bot_token=os.environ.get("BOT_TOKEN", "").strip(),
        llm_provider=(os.environ.get("LLM_PROVIDER", "mock").strip().lower() or "mock"),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
        openai_api_key=os.environ.get("OPENAI_API_KEY", "").strip(),
        llm_model=os.environ.get("LLM_MODEL", "").strip(),
        data_dir=os.environ.get("DATA_DIR", "").strip(),
        daily_cap=_int("DAILY_CAP", 50),
        default_tz=(os.environ.get("DEFAULT_TZ", "UTC").strip() or "UTC"),
        http_host=os.environ.get("HTTP_HOST", "0.0.0.0").strip() or "0.0.0.0",  # noqa: S104
        http_port=_int("HTTP_PORT", 8080),
        api_token=os.environ.get("API_TOKEN", "").strip(),
    )
