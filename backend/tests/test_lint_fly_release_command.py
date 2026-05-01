"""Unit tests for the fly.toml release_command linter.

Pure-function tests on `lint(release_command_str)` so the CI lint
behavior is locked. The linter shipped because of a real production
bug (April 2026, 6 silent deploy failures) — the test cases cover
both the offending shape and the canonical fix shape.
"""

import sys
from pathlib import Path

# scripts/ isn't on the import path by default.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from lint_fly_release_command import lint  # noqa: E402


def test_passes_when_no_release_command():
    code, _ = lint(None)
    assert code == 0
    code, _ = lint("")
    assert code == 0


def test_passes_single_command_no_metachars():
    code, _ = lint("python scripts/migrate.py")
    assert code == 0


def test_fails_unwrapped_double_ampersand():
    """The exact shape of the April 2026 regression."""
    code, msg = lint("python scripts/migrate.py && python seed_workouts.py")
    assert code == 1
    assert "&&" in msg
    assert "sh -c" in msg


def test_fails_unwrapped_pipe():
    code, msg = lint("python migrate.py | tee migrate.log")
    assert code == 1
    assert "|" in msg


def test_fails_unwrapped_semicolon():
    code, msg = lint("python migrate.py; python seed.py")
    assert code == 1
    assert ";" in msg


def test_fails_unwrapped_or_chain():
    code, msg = lint("python migrate.py || echo failed")
    assert code == 1
    assert "||" in msg


def test_passes_sh_dash_c_wrapper():
    """The canonical fix shape from PR #132."""
    code, _ = lint("sh -c 'python scripts/migrate.py && python seed_workouts.py'")
    assert code == 0


def test_passes_bash_dash_c_wrapper():
    code, _ = lint("bash -c 'python migrate.py && python seed.py'")
    assert code == 0


def test_passes_absolute_path_shell_wrapper():
    code, _ = lint("/bin/sh -c 'a && b'")
    assert code == 0
    code, _ = lint("/bin/bash -c 'a && b'")
    assert code == 0


def test_passes_leading_whitespace_doesnt_confuse_wrapper_detection():
    code, _ = lint("  sh -c 'a && b'")
    assert code == 0


def test_does_not_flag_safe_chars():
    """Asterisks (globs), dollar signs (env vars), etc. are commonly
    safe in program args. Don't false-positive on them."""
    code, _ = lint("python script.py --pattern *.py")
    assert code == 0
    code, _ = lint("python script.py --env $HOME")
    assert code == 0
