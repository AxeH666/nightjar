"""Outbound delivery. Scheduled reminders fire on APScheduler worker THREADS (sync), so the
delivery path is a plain synchronous HTTPS POST to the Telegram Bot API — no async event-loop
bridge. (Inbound receiving uses aiogram's async polling in main.py; that's the only async part.)

MockTransport records messages in memory so the whole pipeline is testable with no bot token.
"""
from __future__ import annotations

from typing import List, Protocol, Tuple


class Transport(Protocol):
    def send(self, chat_id: int, text: str) -> bool:
        """Deliver `text` to `chat_id`. Returns True on success. Must never raise — a delivery
        failure is logged/returned, not propagated into the scheduler thread."""
        ...


class MockTransport:
    """In-memory transport for tests + keyless local runs. `sent` is the delivery log."""

    def __init__(self) -> None:
        self.sent: List[Tuple[int, str]] = []

    def send(self, chat_id: int, text: str) -> bool:
        self.sent.append((chat_id, text))
        return True


class TelegramTransport:
    """Delivers via the Telegram Bot API over sync httpx. Import-light: httpx only."""

    def __init__(self, bot_token: str, timeout: float = 10.0) -> None:
        if not bot_token:
            raise ValueError("TelegramTransport requires a bot token")
        self._token = bot_token
        self._url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        self._timeout = timeout

    def send(self, chat_id: int, text: str) -> bool:
        import httpx  # lazy so mock-mode installs don't need it at import time

        try:
            resp = httpx.post(self._url, json={"chat_id": chat_id, "text": text},
                              timeout=self._timeout)
            return resp.status_code == 200 and resp.json().get("ok", False)
        except Exception as exc:  # noqa: BLE001 — a failed send must not kill the scheduler thread
            # httpx exceptions can embed the request URL, which contains the bot token — scrub it
            # so the secret never lands in logs.
            detail = str(exc).replace(self._token, "***")
            print(f"[transport] delivery to {chat_id} failed ({type(exc).__name__}): {detail}")
            return False
