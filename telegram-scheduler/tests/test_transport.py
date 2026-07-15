"""Outbound transport: mock delivery log + the bot-token log-leak guard."""
import httpx

from app.transport import MockTransport, TelegramTransport


def test_mock_transport_records_delivery():
    t = MockTransport()
    assert t.send(7, "hi") is True
    assert t.sent == [(7, "hi")]


def test_delivery_error_redacts_bot_token(capsys, monkeypatch):
    t = TelegramTransport("SECRET_TOKEN_123")

    def boom(*args, **kwargs):
        # a realistic httpx error string carries the request URL, which embeds the token
        raise httpx.ConnectError(
            "connection failed to https://api.telegram.org/botSECRET_TOKEN_123/sendMessage")

    monkeypatch.setattr(httpx, "post", boom)
    assert t.send(42, "hello") is False
    out = capsys.readouterr().out
    assert "SECRET_TOKEN_123" not in out   # the token must never reach the log
    assert "***" in out                    # redaction marker present
