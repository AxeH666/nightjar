"""Guard against drift between the two hand-duplicated nl_intent.py copies (P3-17).

`telegram-scheduler/app/nl_intent.py` is a VENDORED verbatim copy of the authoritative
`phase2-odysseus/servers/nl_intent.py` (the telegram server deploys as a standalone Docker
image and can't import from the odysseus tree). The two carried a "keep in sync" comment but
no automated check — so a change to one could silently diverge. This asserts they stay
code-identical.

Compared via AST, so ONLY real code drift fails: comments and formatting are ignored, and the
module docstrings (which differ on purpose — the vendored copy carries the "VENDORED COPY" note)
are dropped before comparison. Any divergence in actual logic, function docstrings, or constants
trips it. Skips when the authoritative copy isn't checked out (a standalone telegram deploy),
so this is a full-repo guard only.
"""
import ast
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENDORED = HERE.parent / "app" / "nl_intent.py"                                  # this repo's telegram copy
AUTHORITATIVE = HERE.parents[1] / "phase2-odysseus" / "servers" / "nl_intent.py"  # source of truth


def _code_ast_dump(path: Path) -> str:
    """AST of the module with its docstring removed → a formatting/comment-insensitive
    fingerprint of the actual code."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    body = tree.body
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        tree.body = body[1:]  # drop the module docstring (intentionally differs between copies)
    return ast.dump(tree)


def test_nl_intent_vendored_copy_in_sync():
    if not AUTHORITATIVE.exists():
        import pytest  # lazy: keeps this file runnable standalone (`python …`) without pytest installed

        pytest.skip(
            f"authoritative {AUTHORITATIVE} not present (standalone telegram deploy) — "
            "the nl_intent sync check is a full-repo guard only"
        )
    assert _code_ast_dump(AUTHORITATIVE) == _code_ast_dump(VENDORED), (
        "nl_intent.py copies have DRIFTED — code differs beyond the module docstring.\n"
        f"  authoritative: {AUTHORITATIVE}\n"
        f"  vendored copy: {VENDORED}\n"
        "Re-sync the vendored copy from the authoritative source (keep the docstrings as-is)."
    )


if __name__ == "__main__":  # runnable without pytest: `python tests/test_nl_intent_sync.py`
    if not AUTHORITATIVE.exists():
        print(f"SKIP: authoritative copy not present at {AUTHORITATIVE}")
    elif _code_ast_dump(AUTHORITATIVE) == _code_ast_dump(VENDORED):
        print("PASS: nl_intent.py copies are in sync")
    else:
        raise SystemExit("FAIL: nl_intent.py copies have drifted")
