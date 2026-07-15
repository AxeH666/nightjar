"""Provider-agnostic LLM factory. `make_llm_call(config)` returns a `(system, user) -> str`
callable that nl_intent.parse_reminder drives. The server key isn't provisioned yet, so this
ships with three backends and defaults to the keyless mock:

  • "mock"      — a small deterministic heuristic parser (no key, no network). Good enough to run
                  and demo the whole pipeline offline; NOT a substitute for a real model.
  • "anthropic" — the official Anthropic SDK (Claude, default model claude-opus-4-8).
  • "openai"    — the official OpenAI SDK.

Each provider uses its OWN official SDK (never a cross-provider shim), imported lazily so mock
mode needs neither installed.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Callable

from .config import Config

LlmCall = Callable[[str, str], str]


def make_llm_call(config: Config) -> LlmCall:
    provider = (config.llm_provider or "mock").lower()
    if provider == "anthropic":
        return _anthropic_call(config)
    if provider == "openai":
        return _openai_call(config)
    if provider == "mock":
        return mock_llm_call
    raise ValueError(f"unknown LLM_PROVIDER '{config.llm_provider}' (use mock|anthropic|openai)")


# --------------------------------------------------------------------------- anthropic
def _anthropic_call(config: Config) -> LlmCall:
    if not config.anthropic_api_key:
        raise ValueError("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset")
    import anthropic  # lazy: only needed for this provider

    client = anthropic.Anthropic(api_key=config.anthropic_api_key)
    model = config.llm_model or "claude-opus-4-8"

    def call(system: str, user: str) -> str:
        msg = client.messages.create(
            model=model,
            max_tokens=512,  # a small JSON reminder object — no need for more
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(block.text for block in msg.content if getattr(block, "type", "") == "text")

    return call


# --------------------------------------------------------------------------- openai
def _openai_call(config: Config) -> LlmCall:
    if not config.openai_api_key:
        raise ValueError("LLM_PROVIDER=openai but OPENAI_API_KEY is unset")
    from openai import OpenAI  # lazy

    client = OpenAI(api_key=config.openai_api_key)
    model = config.llm_model or "gpt-4o-mini"

    def call(system: str, user: str) -> str:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return resp.choices[0].message.content or ""

    return call


# --------------------------------------------------------------------------- mock
_TIME_AT = re.compile(r"\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", re.IGNORECASE)
_TIME_IN = re.compile(r"\bin\s+(\d+)\s*(min|minute|minutes|hour|hours|hr|hrs)\b", re.IGNORECASE)
_REPEAT = re.compile(r"\b(every day|daily|every week|weekly|every month|monthly)\b", re.IGNORECASE)


def mock_llm_call(system: str, user: str) -> str:
    """Deterministic offline stand-in for a real model. Parses the MESSAGE / CURRENT LOCAL TIME
    that build_user_prompt embeds and emits the JSON the real model would. Handles "at 3pm",
    "in 30 min", and daily/weekly/monthly; otherwise defaults to 5 minutes out. Intentionally
    simple — real deployments set a real provider."""
    now_local = _extract_now(user)
    message = _extract_message(user)

    repeat = "once"
    rm = _REPEAT.search(message)
    if rm:
        word = rm.group(1).lower()
        repeat = ("daily" if "day" in word or word == "daily"
                  else "weekly" if "week" in word or word == "weekly"
                  else "monthly")

    when = _mock_when(message, now_local)
    title = _mock_title(message)
    # Emit the exact schema nl_intent expects (LOCAL wall-clock, no timezone suffix).
    return (f'{{"title": "{title}", "datetime_local": "{when:%Y-%m-%dT%H:%M}", '
            f'"repeat": "{repeat}"}}')


def _mock_when(message: str, now_local: datetime) -> datetime:
    m_in = _TIME_IN.search(message)
    if m_in:
        n = int(m_in.group(1))
        unit = m_in.group(2).lower()
        delta = timedelta(hours=n) if unit.startswith(("hour", "hr")) else timedelta(minutes=n)
        return now_local + delta
    m_at = _TIME_AT.search(message)
    if m_at:
        hour = int(m_at.group(1)) % 12
        minute = int(m_at.group(2)) if m_at.group(2) else 0
        ampm = (m_at.group(3) or "").lower()
        if ampm == "pm":
            hour += 12
        elif ampm == "" and hour < 8:
            hour += 12  # bare "at 3" almost always means the afternoon
        cand = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if cand <= now_local:
            cand += timedelta(days=1)  # time already passed today → tomorrow
        return cand
    return now_local + timedelta(minutes=5)


def _mock_title(message: str) -> str:
    m = re.search(r"\bto\s+(.*)", message, re.IGNORECASE)
    raw = m.group(1) if m else message
    # Strip trailing time phrases and cap/repeat words so the title reads cleanly.
    raw = _TIME_AT.sub("", raw)
    raw = _TIME_IN.sub("", raw)
    raw = _REPEAT.sub("", raw)
    raw = re.sub(r'["\\]', "", raw)  # never let a quote/backslash break the emitted JSON
    title = " ".join(raw.split()).strip(" .,") or "Reminder"
    return title[:80]


def _extract_now(user: str) -> datetime:
    m = re.search(r"CURRENT LOCAL TIME:\s*([0-9T:\-]{16})", user)
    if m:
        try:
            return datetime.fromisoformat(m.group(1))
        except ValueError:
            pass
    # Fallback if the prompt shape ever changes — a fixed epoch keeps the mock deterministic.
    return datetime(2026, 1, 1, 9, 0)


def _extract_message(user: str) -> str:
    m = re.search(r"MESSAGE:\s*(.*)", user, re.DOTALL)
    return (m.group(1) if m else user).strip()
