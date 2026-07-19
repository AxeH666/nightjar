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
                          flood + per-user + global cap (usage.py)
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
# POSIX
python3.12 -m venv venv && venv/bin/pip install .
venv/bin/nightjar-telegram-scheduler      # HTTP on :8080, MockTransport
# Windows: py -3.12 -m venv venv && venv\Scripts\pip install .
#          venv\Scripts\nightjar-telegram-scheduler
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

## Abuse & cost controls (public deployments)

The server parses reminders with **your** paid LLM key, so a public bot needs guarding. Three
knobs (all in `.env.example`):

- **`GLOBAL_DAILY_CAP`** (default `1000`, `0` = unlimited) — the **un-bypassable** ceiling on paid
  parses across *all* users per UTC day. The per-user `DAILY_CAP` is dodgeable on the HTTP path
  (the caller supplies the `telegram_id`); this aggregate cap is not. Set it to your daily budget.
- **`USER_RATE_PER_MIN`** (default `15`, `0` = off) — per-user sliding-window flood limit.
- **`LLM_TIMEOUT_S`** (default `30`) — hard wall-clock timeout per LLM call.

Note: the **bot** is open to anyone who finds it — Telegram authenticates each user's id and the
caps bound cost, but there is no allowlist (possible future work). The **HTTP API** is a
*trusted-backend* surface: its single `API_TOKEN` acts as a superuser (the caller names the
`telegram_id`), so keep it secret and don't publish the port to untrusted networks. The server
**refuses to start** if `BOT_TOKEN` is set without an `API_TOKEN` (set `ALLOW_OPEN_HTTP=1` to run
open on purpose); token checks are constant-time; and the bot token is scrubbed from
delivery-error logs.

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
