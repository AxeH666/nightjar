"""Per-user sliding-window flood guard (usage.RateLimiter). Uses an injected fake clock so the
window behaviour is deterministic without real sleeping."""
from app.usage import RateLimiter


class FakeClock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def test_allows_up_to_limit_then_throttles():
    clk = FakeClock()
    rl = RateLimiter(per_minute=3, window_s=60.0, clock=clk)
    assert [rl.allow(1) for _ in range(4)] == [True, True, True, False]


def test_window_slides_and_frees_up():
    clk = FakeClock()
    rl = RateLimiter(per_minute=2, window_s=60.0, clock=clk)
    assert rl.allow(1) is True
    assert rl.allow(1) is True
    assert rl.allow(1) is False          # burst of 2 exhausted
    clk.advance(61)                       # both hits age out of the window
    assert rl.allow(1) is True


def test_disabled_when_non_positive():
    rl = RateLimiter(per_minute=0)
    assert all(rl.allow(1) for _ in range(100))


def test_users_have_independent_windows():
    clk = FakeClock()
    rl = RateLimiter(per_minute=1, window_s=60.0, clock=clk)
    assert rl.allow(1) is True
    assert rl.allow(1) is False           # user 1 throttled
    assert rl.allow(2) is True            # user 2 unaffected


def test_idle_users_are_swept_so_memory_is_bounded():
    clk = FakeClock()
    rl = RateLimiter(per_minute=5, window_s=60.0, clock=clk, sweep_every=3)
    rl.allow(1)                # user 1 active at t0
    clk.advance(61)            # user 1 now idle (its hit aged past the window)
    rl.allow(2)                # calls=2
    rl.allow(2)                # calls=3 → triggers a sweep that drops idle user 1
    assert 1 not in rl._hits
    assert 2 in rl._hits
