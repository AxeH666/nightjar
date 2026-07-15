"""Per-user daily cap (the shared-key abuse guard)."""
from app.usage import check_and_increment


def _store():
    data = {}
    return (lambda uid, day: data.get((uid, day), 0),
            lambda uid, day, n: data.__setitem__((uid, day), n))


def test_increments_until_cap_then_denies():
    get_c, set_c = _store()
    results = [check_and_increment(get_c, set_c, 1, today="2026-07-15", cap=3) for _ in range(4)]
    assert [r[0] for r in results] == [True, True, True, False]
    assert [r[1] for r in results] == [1, 2, 3, 3]  # denied call does NOT increment past cap


def test_new_day_resets():
    get_c, set_c = _store()
    for _ in range(3):
        check_and_increment(get_c, set_c, 1, today="2026-07-15", cap=3)
    assert check_and_increment(get_c, set_c, 1, today="2026-07-16", cap=3) == (True, 1)


def test_users_are_independent():
    get_c, set_c = _store()
    for _ in range(3):
        check_and_increment(get_c, set_c, 1, today="2026-07-15", cap=3)
    # user 2 is unaffected by user 1 hitting the cap
    assert check_and_increment(get_c, set_c, 2, today="2026-07-15", cap=3) == (True, 1)
