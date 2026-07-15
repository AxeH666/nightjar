"""Nightjar Telegram scheduling server (Task 6).

A thin, always-on companion to the Nightjar desktop app: a user messages a Telegram bot in
natural language ("remind me next Friday at 1pm to call the dentist"); the server parses it
(provider-agnostic LLM), schedules it (APScheduler over a SQLite jobstore so reminders survive
a restart), and delivers it back over Telegram when it fires.

Deliberately runnable with ZERO secrets: with no BOT_TOKEN it uses an in-memory MockTransport,
and with LLM_PROVIDER=mock it uses a canned parser — so the whole pipeline is unit-testable
offline. Set BOT_TOKEN + a real LLM key at deploy time to go live (see README).
"""
