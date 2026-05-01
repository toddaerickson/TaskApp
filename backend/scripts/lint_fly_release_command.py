"""Lint backend/fly.toml's release_command for the bug class that broke 6
deploys in late April 2026.

Background: Fly tokenizes `release_command` with shlex and execs the
result directly — there's NO implicit shell. So a string like

    "python scripts/migrate.py && python seed_workouts.py"

becomes argv `["python", "scripts/migrate.py", "&&", "python",
"seed_workouts.py"]`. argparse on migrate.py rejects the unknown args,
exit 2, deploy aborts, traffic stays on the prior machine. Symptom:
silently failing auto-deploys for days.

The canonical fix is to wrap multi-command release_commands in
`sh -c '...'`. This linter fails the CI build whenever it spots an
unwrapped shell metacharacter — preventing the regression from sneaking
back in.

Run locally:

    venv/bin/python backend/scripts/lint_fly_release_command.py

Or from CI: see `.github/workflows/ci.yml` `lint-fly` job.

Exit codes:
  0  release_command is safe (or missing — Fly app doesn't require one)
  1  release_command contains shell metachars without sh -c wrapper
  2  fly.toml not found / unparseable
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

# Metacharacters that REQUIRE an explicit shell. `|` (pipe), `&&`/`||`
# (logical AND/OR), `;` (sequential), `>`/`<` (redirects), `&` (background).
# `*` and `$` are intentionally NOT flagged — they're commonly safe in
# program args (e.g. literal asterisk in a regex, $VAR via Fly's own
# template substitution) and would create false positives.
_SHELL_METACHARS = ("&&", "||", "|", ";", ">", "<", " & ", "&\n")


def lint(release_command: str | None) -> tuple[int, str]:
    """Return (exit_code, message). Pure function for testability."""
    if not release_command:
        return 0, "no release_command set — nothing to lint"

    # Strip leading whitespace to detect a shell wrapper at the start.
    cmd = release_command.lstrip()

    # If the command already starts with sh/bash -c, the metachars are
    # the shell's job to interpret. Safe.
    wrapper_prefixes = ("sh -c ", "bash -c ", "/bin/sh -c ", "/bin/bash -c ")
    if any(cmd.startswith(p) for p in wrapper_prefixes):
        return 0, f"release_command is wrapped in a shell: {cmd[:40]!r}…"

    # Look for any shell metacharacter that needs interpretation.
    found = [m for m in _SHELL_METACHARS if m in cmd]
    if not found:
        return 0, "release_command has no shell metacharacters"

    msg = (
        f"\n  fly.toml release_command contains shell metacharacters {found!r}\n"
        f"  but is NOT wrapped in `sh -c '...'`.\n\n"
        f"  Got:\n    release_command = {release_command!r}\n\n"
        f"  Fix: wrap in `sh -c`, e.g.\n"
        f"    release_command = \"sh -c 'python scripts/migrate.py "
        f"&& python seed_workouts.py'\"\n\n"
        f"  Why: Fly tokenizes release_command with shlex and execs\n"
        f"  directly without an implicit shell. Unwrapped `&&`, `|`, etc.\n"
        f"  become literal argv tokens to the first program. This bug\n"
        f"  silently failed every Fly deploy from April 27–30, 2026 until\n"
        f"  PR #132 fixed it. Don't reintroduce."
    )
    return 1, msg


def main(fly_toml_path: Path) -> int:
    if not fly_toml_path.exists():
        print(f"[lint-fly] {fly_toml_path}: not found", file=sys.stderr)
        return 2
    try:
        with fly_toml_path.open("rb") as f:
            data = tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        print(f"[lint-fly] {fly_toml_path}: TOML parse error: {e}", file=sys.stderr)
        return 2

    rc = data.get("deploy", {}).get("release_command")
    code, msg = lint(rc)
    prefix = "[lint-fly] PASS" if code == 0 else "[lint-fly] FAIL"
    print(f"{prefix} ({fly_toml_path}): {msg}")
    return code


if __name__ == "__main__":
    # Default path: the repo's backend/fly.toml relative to repo root.
    # Allow override for tests / future multi-app setups.
    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
    else:
        path = Path(__file__).resolve().parent.parent / "fly.toml"
    sys.exit(main(path))
