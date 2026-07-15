"""The refuse-to-boot guard: a real bot must not serve an unauthenticated (open) HTTP API."""
import pytest

from app.config import Config
from app.main import _require_safe_config


def test_refuses_real_bot_with_open_http():
    with pytest.raises(RuntimeError, match="OPEN"):
        _require_safe_config(Config(bot_token="botx", api_token=""))


def test_ok_when_api_token_set():
    _require_safe_config(Config(bot_token="botx", api_token="secret"))  # no raise


def test_ok_when_explicitly_opted_open():
    _require_safe_config(Config(bot_token="botx", api_token="", allow_open_http=True))  # no raise


def test_ok_in_mock_mode_without_bot_token():
    _require_safe_config(Config(bot_token="", api_token=""))  # HTTP-only mock mode is fine
