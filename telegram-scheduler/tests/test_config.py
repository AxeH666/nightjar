"""Config defaults + env parsing for the abuse/cost-guard knobs."""
from app.config import Config, load_config


def test_abuse_guard_defaults():
    c = Config()
    assert c.global_daily_cap == 1000   # fail-safe cost ceiling on by default
    assert c.user_rate_per_min == 15
    assert c.llm_timeout_s == 30


def test_load_config_reads_abuse_env(monkeypatch):
    monkeypatch.setenv("GLOBAL_DAILY_CAP", "5")
    monkeypatch.setenv("USER_RATE_PER_MIN", "3")
    monkeypatch.setenv("LLM_TIMEOUT_S", "12")
    c = load_config()
    assert (c.global_daily_cap, c.user_rate_per_min, c.llm_timeout_s) == (5, 3, 12)


def test_global_cap_zero_means_unlimited(monkeypatch):
    monkeypatch.setenv("GLOBAL_DAILY_CAP", "0")
    assert load_config().global_daily_cap == 0
