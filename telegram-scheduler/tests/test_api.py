"""HTTP surface via FastAPI TestClient — a real DB + real scheduler on a temp file, the keyless
mock LLM + MockTransport. Covers /health, POST /reminders (incl. the daily cap), and the
optional API-token gate."""
import dataclasses

import pytest
from fastapi.testclient import TestClient

from app.config import load_config
from app.db import Database
from app.llm import make_llm_call
from app.main import create_app
from app.scheduler import ReminderScheduler
from app.transport import MockTransport


def _make_client(tmp_path, **overrides):
    config = dataclasses.replace(load_config(), llm_provider="mock",
                                 data_dir=str(tmp_path), **overrides)
    db = Database(config.db_url)
    transport = MockTransport()
    scheduler = ReminderScheduler(config.db_url, delivery=transport.send)
    scheduler.start()
    app = create_app(config, db, scheduler, make_llm_call(config))
    client = TestClient(app)
    client._scheduler = scheduler  # for teardown
    return client


@pytest.fixture
def client(tmp_path):
    c = _make_client(tmp_path)
    yield c
    c._scheduler.shutdown()


def test_health_is_minimal(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body == {"status": "ok"}          # liveness only — no config disclosure
    assert "llm_provider" not in body and "daily_cap" not in body


def test_post_reminder_schedules(client):
    r = client.post("/reminders", json={"telegram_id": 42, "text": "remind me at 3pm to call Sam"})
    assert r.status_code == 200
    body = r.json()
    assert "Reminder set" in body["reply"]
    assert len(body["pending"]) == 1
    assert "Sam" in body["pending"][0]["title"]


def test_list_reminders(client):
    client.post("/reminders", json={"telegram_id": 42, "text": "at 3pm to call Sam"})
    r = client.get("/reminders/42")
    assert r.status_code == 200
    assert len(r.json()["pending"]) == 1


def test_daily_cap_via_api(tmp_path):
    client = _make_client(tmp_path, daily_cap=2)
    try:
        for _ in range(2):
            ok = client.post("/reminders", json={"telegram_id": 1, "text": "in 10 min to stretch"})
            assert "Reminder set" in ok.json()["reply"]
        over = client.post("/reminders", json={"telegram_id": 1, "text": "in 10 min to stretch"})
        assert "limit" in over.json()["reply"].lower()
    finally:
        client._scheduler.shutdown()


def test_nonpositive_telegram_id_rejected(client):
    # 0/negatives are invalid ids; -1 specifically must not collide with the GLOBAL_BUCKET counter.
    assert client.post("/reminders", json={"telegram_id": -1, "text": "at 3pm x"}).status_code == 422
    assert client.post("/reminders", json={"telegram_id": 0, "text": "at 3pm x"}).status_code == 422


def test_invalid_timezone_rejected(client):
    r = client.post("/reminders", json={"telegram_id": 7, "text": "at 3pm ping", "tz": "Mars/Phobos"})
    assert r.status_code == 400
    # a valid tz is accepted
    ok = client.post("/reminders", json={"telegram_id": 7, "text": "at 3pm ping", "tz": "America/New_York"})
    assert ok.status_code == 200


def test_api_token_required_when_set(tmp_path):
    client = _make_client(tmp_path, api_token="s3cret")
    try:
        assert client.post("/reminders", json={"telegram_id": 1, "text": "at 3pm ping"}).status_code == 401
        ok = client.post("/reminders", json={"telegram_id": 1, "text": "at 3pm ping"},
                         headers={"Authorization": "Bearer s3cret"})
        assert ok.status_code == 200
    finally:
        client._scheduler.shutdown()
