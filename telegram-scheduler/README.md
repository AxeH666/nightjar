# Nightjar Telegram Scheduler (Task 6)

An always-on companion server for Nightjar. A user messages a Telegram bot in plain language —
_"remind me next Friday at 1pm to call the dentist"_, _"every day at 8am take meds"_ — and the
server parses it, schedules it, and delivers the reminder back over Telegram when it fires.

It is deliberately runnable with **zero secrets**: with no `BOT_TOKEN` it uses an in-memory
mock transport, and with `LLM_PROVIDER=mock` it uses a small keyless heuristic parser, so the
whole pipeline can be smoke-tested offline. Set a bot token + a real LLM key to go live.

## Why a separate server?

The Nightjar desktop app isn't always running, but a reminder for 8am tomorrow needs something
that is. This is that thin, always-on piece. It is a **standalone deployable** (its own Docker
image / systemd unit) and shares no runtime with the desktop app — which is why the NL parser
(`app/nl_intent.py`) is vendored from `phase2-odysseus/servers/nl_intent.py` rather than
imported. Keep the two copies in sync.

## Architecture

```
Telegram user --> aiogram bot (inbound, async polling) --.
Nightjar app  --> POST /reminders (inbound, HTTP) --------+--> core.handle_reminder_text
                                                                |
                          daily-cap check (usage.py, per-user/day)
                          -> LLM parse (llm.py -> nl_intent.py)
                          -> schedule (scheduler.py: APScheduler + SQLite jobstore)
                                                                |
                          fires --> transport.py (sync httpx sendMessage) --> Telegram user
```

- **`core.py`** — the pure flow: cap → parse → schedule → confirm. All I/O injected; unit-tested
  with mocks.
- **`nl_intent.py`** — natural language → `{title, when_utc, repeat}` (provider-agnostic LLM).
- **`llm.py`** — `mock` | `anthropic` (official SDK, default `claude-opus-4-8`) | `openai`.
- **`scheduler.py`** — APScheduler over a SQLite jobstore. Reminders **survive a restart**; the
  fired job reconnects to the live transport via a module-level delivery hook (a transport can't
  be pickled into the store).
- **`transport.py`** — outbound delivery. Sync httpx to the Bot API (scheduled jobs run on
  worker threads); `MockTransport` records messages for tests.
- **`db.py`** — `User` (Telegram id → timezone) and the per-user daily `UsageCounter`.
- **`main.py`** — FastAPI app + aiogram bot, sharing one DB/scheduler/LLM.

## Run it (mock mode, no secrets)

```bash
python3.12 -m venv venv && venv/bin/pip install .
venv/bin/nightjar-telegram-scheduler      # HTTP on :8080, MockTransport
curl -s localhost:8080/health
curl -s localhost:8080/reminders -H 'content-type: application/json' \
     -d '{"telegram_id": 1, "text": "remind me in 1 minute to stretch"}'
```

In mock mode delivery is **recorded, not sent** (no Telegram). Wire a real bot to see messages.

## Go live

1. Create a bot with [@BotFather](https://t.me/BotFather); copy the token.
2. `cp .env.example .env` and set `BOT_TOKEN`, `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`,
   and a strong `API_TOKEN`.
3. Install the provider extra: `pip install .[anthropic]` (or `.[openai]`).
4. Deploy:
   - **Docker:** `docker build -t nightjar-telegram-scheduler . && docker run -d --env-file .env -p 8080:8080 -v nightjar_sched:/data nightjar-telegram-scheduler`
   - **systemd:** see `deploy/nightjar-telegram-scheduler.service`.
5. Message the bot: `/start`, then `/tz America/New_York`, then _"remind me at 3pm to call Sam"_.

`DATA_DIR` must be a **persistent volume** — it holds `scheduler.db` (the pending reminders).

## HTTP API

| Method | Path | Body / notes |
| --- | --- | --- |
| `GET` | `/health` | liveness + config summary |
| `POST` | `/reminders` | `{telegram_id, text, chat_id?, tz?}` → `{reply, pending}` |
| `GET` | `/reminders/{telegram_id}` | list a user's upcoming reminders |
| `DELETE` | `/reminders/{telegram_id}/{job_id}` | cancel one |

When `API_TOKEN` is set, all endpoints except `/health` require `Authorization: Bearer <token>`.

## Tests

```bash
venv/bin/pip install .[dev]
venv/bin/pytest -q      # usage cap, core flow, mock parser, scheduler (incl. restart survival), HTTP API
```

## Verified vs. not

**Verified offline (this repo's tests):** the cap, the parse→schedule→confirm flow, the mock
parser, once/recurring triggers, restart survival, and the HTTP API (via TestClient).

**NOT verified here** (needs your secrets/deploy, see the machine checklist):
- live Telegram send/receive (needs a real `BOT_TOKEN`),
- a live paid LLM parse (needs `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`),
- long-horizon restart survival on your actual host/volume.

## License

AGPL-3.0-or-later, as with the rest of Nightjar.
