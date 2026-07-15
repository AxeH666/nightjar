"""Entry point: the FastAPI HTTP app + the aiogram Telegram bot, wired to a shared DB,
scheduler, and LLM. `create_app` is a DI factory so the HTTP surface is testable with mocks
(no token, no key, no network). The bot only starts when BOT_TOKEN is set.

Login = Telegram identity: a user's numeric Telegram id IS their account. /start registers it
(and their chat_id for delivery); there is no password.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import Config, load_config
from .core import handle_reminder_text
from .db import Database
from .llm import LlmCall, make_llm_call
from .scheduler import ReminderScheduler
from .transport import MockTransport, TelegramTransport, Transport
from .usage import RateLimiter


class ReminderRequest(BaseModel):
    # Must be a real (positive) Telegram id: rejects 0/negatives, and specifically the -1
    # GLOBAL_BUCKET sentinel so an HTTP caller can't collide with / poison the global cost counter.
    telegram_id: int = Field(gt=0)
    text: str
    chat_id: Optional[int] = None  # defaults to telegram_id
    tz: Optional[str] = None       # set/override the user's timezone


def create_app(config: Config, db: Database, scheduler: ReminderScheduler,
               llm_call: LlmCall, transport: Transport,
               rate_limiter: Optional[RateLimiter] = None) -> FastAPI:
    app = FastAPI(title="Nightjar Telegram Scheduler", version="1.0")

    def require_token(authorization: str = Header(default="")) -> None:
        """If config.api_token is set, require `Authorization: Bearer <token>`. Unset → open."""
        if not config.api_token:
            return
        expected = f"Bearer {config.api_token}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="invalid or missing API token")

    @app.get("/health")
    def health() -> dict:
        return {
            "status": "ok",
            "llm_provider": config.llm_provider,
            "transport": type(transport).__name__,
            "daily_cap": config.daily_cap,
        }

    @app.post("/reminders")
    def create_reminder(req: ReminderRequest, _: None = Depends(require_token)) -> dict:
        chat_id = req.chat_id or req.telegram_id
        # Reject an invalid tz up front (like the bot's /tz) so we never persist garbage that
        # would silently make every future reminder parse in UTC (Bugbot).
        if req.tz is not None and not _valid_tz(req.tz):
            raise HTTPException(status_code=400, detail=f"'{req.tz}' is not a valid IANA timezone")
        db.upsert_user(req.telegram_id, chat_id, req.tz)
        tz = db.get_user_tz(req.telegram_id, config.default_tz)
        reply = handle_reminder_text(
            req.text, user_id=req.telegram_id, chat_id=chat_id, tz_name=tz,
            llm_call=llm_call, schedule=scheduler.schedule,
            get_count=db.get_count, set_count=db.set_count, daily_cap=config.daily_cap,
            global_cap=config.global_daily_cap,
            rate_check=(rate_limiter.allow if rate_limiter else None),
            usage_lock=db.usage_lock,
        )
        return {"reply": reply, "pending": scheduler.list_jobs(req.telegram_id)}

    @app.get("/reminders/{telegram_id}")
    def list_reminders(telegram_id: int, _: None = Depends(require_token)) -> dict:
        return {"pending": scheduler.list_jobs(telegram_id)}

    @app.delete("/reminders/{telegram_id}/{job_id}")
    def cancel_reminder(telegram_id: int, job_id: str, _: None = Depends(require_token)) -> dict:
        # Scope the cancel to the caller's own reminders (job ids are "rem:<user>:<rand>").
        if not job_id.startswith(f"rem:{telegram_id}:"):
            raise HTTPException(status_code=404, detail="no such reminder for this user")
        return {"cancelled": scheduler.cancel(job_id)}

    return app


# --------------------------------------------------------------------------- aiogram bot
def build_dispatcher(config: Config, db: Database, scheduler: ReminderScheduler, llm_call: LlmCall,
                     rate_limiter: Optional[RateLimiter] = None):
    """Build the aiogram Dispatcher. Imported lazily so HTTP-only/test use doesn't need aiogram."""
    from aiogram import Dispatcher, F
    from aiogram.filters import Command
    from aiogram.types import Message

    dp = Dispatcher()

    @dp.message(Command("start"))
    async def on_start(message: Message) -> None:
        db.upsert_user(message.from_user.id, message.chat.id)
        await message.answer(
            "👋 I'm your Nightjar reminder bot. Tell me things like:\n"
            "• remind me at 3pm to call Sam\n"
            "• every day at 8am take meds\n"
            "• next Friday at 1pm dentist\n\n"
            "Set your timezone with /tz Area/City (e.g. /tz America/New_York)."
        )

    @dp.message(Command("tz"))
    async def on_tz(message: Message) -> None:
        parts = (message.text or "").split(maxsplit=1)
        if len(parts) < 2:
            await message.answer("Usage: /tz Area/City  (e.g. /tz Europe/London)")
            return
        tz = parts[1].strip()
        db.upsert_user(message.from_user.id, message.chat.id)
        if _valid_tz(tz) and db.set_user_tz(message.from_user.id, tz):
            await message.answer(f"✓ Timezone set to {tz}.")
        else:
            await message.answer(f"'{tz}' isn't a valid IANA timezone. Try e.g. America/New_York.")

    @dp.message(Command("list"))
    async def on_list(message: Message) -> None:
        jobs = scheduler.list_jobs(message.from_user.id)
        if not jobs:
            await message.answer("You have no upcoming reminders.")
            return
        lines = [f"• {j['title']} — {j['next_run'] or 'pending'}" for j in jobs]
        await message.answer("Upcoming reminders:\n" + "\n".join(lines))

    @dp.message(F.text)
    async def on_text(message: Message) -> None:
        db.upsert_user(message.from_user.id, message.chat.id)
        tz = db.get_user_tz(message.from_user.id, config.default_tz)
        # The LLM call blocks; run it off the event loop so the bot stays responsive.
        reply = await asyncio.to_thread(
            handle_reminder_text, message.text or "",
            user_id=message.from_user.id, chat_id=message.chat.id, tz_name=tz,
            llm_call=llm_call, schedule=scheduler.schedule,
            get_count=db.get_count, set_count=db.set_count, daily_cap=config.daily_cap,
            global_cap=config.global_daily_cap,
            rate_check=(rate_limiter.allow if rate_limiter else None),
            usage_lock=db.usage_lock,
        )
        await message.answer(reply)

    return dp


def _valid_tz(name: str) -> bool:
    from zoneinfo import ZoneInfo
    try:
        ZoneInfo(name)
        return True
    except Exception:  # noqa: BLE001
        return False


async def _serve() -> None:
    import uvicorn

    config = load_config()
    db = Database(config.db_url)
    transport: Transport = TelegramTransport(config.bot_token) if config.bot_token else MockTransport()
    scheduler = ReminderScheduler(config.db_url, delivery=transport.send)
    scheduler.start()
    llm_call = make_llm_call(config)
    rate_limiter = RateLimiter(config.user_rate_per_min)
    app = create_app(config, db, scheduler, llm_call, transport, rate_limiter=rate_limiter)

    server = uvicorn.Server(uvicorn.Config(app, host=config.http_host, port=config.http_port,
                                           log_level="info"))
    coros = [server.serve()]
    if config.bot_token:
        from aiogram import Bot

        bot = Bot(token=config.bot_token)
        dp = build_dispatcher(config, db, scheduler, llm_call, rate_limiter=rate_limiter)
        coros.append(dp.start_polling(bot))
        print(f"[main] Telegram bot polling; HTTP on {config.http_host}:{config.http_port}")
    else:
        print(f"[main] no BOT_TOKEN — HTTP-only on {config.http_host}:{config.http_port} "
              f"(MockTransport; delivery is recorded, not sent)")

    try:
        await asyncio.gather(*coros)
    finally:
        scheduler.shutdown()


def main() -> None:
    asyncio.run(_serve())


if __name__ == "__main__":
    main()
