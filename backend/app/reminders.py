"""Routine-reminder helpers — TZ resolution, day-token parsing, and the
core compute_missed_reminders() routine. Extracted from
`app/routes/routine_routes.py` in PR-X4 (post-ship audit code-QA #2)
because that file had grown past 700 lines with ~30% of the bytes
dedicated to a single feature; mixing CRUD-shaped routes with
TZ-arithmetic discouraged review-by-section.

Public surface:

  - `_DAYS`, `_DAY_SET` — weekday tokens, in Mon..Sun order.
  - `_parse_reminder_days(csv)` — read-time parser that mirrors mobile
    `lib/reminders.ts`. Silently drops unknown tokens (legacy rows).
  - `_operator_tz()` — cached IANA-name → `ZoneInfo` resolver from the
    `TASKAPP_TZ` env var. Warns once on invalid; falls back to UTC.
  - `_TZ_CACHE` — module-level cache (test fixtures reset this).
  - `compute_missed_reminders(user_id)` — pure-ish computation that
    the route delegates to. Returns `list[MissedReminder]` sorted
    most-recent first. Tested both directly and through the route.

The module DOES NOT import FastAPI — keeps the helper testable
without spinning up the app + auth dependency tree."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.database import get_db
from app.models import MissedReminder

log = logging.getLogger(__name__)


_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_DAY_SET = frozenset(_DAYS)


def _parse_reminder_days(csv: str | None) -> frozenset[str]:
    """Parse the wire format `null | "daily" | "mon,wed,fri"`. Returns
    the empty frozenset for null/empty so the caller can do `today in
    parsed` without a None check. Mirrors `mobile/lib/reminders.ts`'s
    `parseDays` so the UI's understanding of a routine's reminder
    schedule round-trips through the API."""
    if not csv:
        return frozenset()
    norm = csv.lower().strip()
    if norm == "daily":
        return _DAY_SET
    return frozenset(d.strip() for d in norm.split(",") if d.strip() in _DAY_SET)


# Module-level cache: resolve TASKAPP_TZ exactly once. The /missed-
# reminders route is hot enough that re-parsing the env var per call
# shows up in profiles, and an invalid value used to fall back silently
# every call — now we log once on first miss. Tests reset this dict
# directly via `from app.reminders import _TZ_CACHE`.
_TZ_CACHE: dict[str, object] = {"name": None, "zone": None, "warned": False}


def _operator_tz() -> ZoneInfo:
    """Single-tenant TZ source: `TASKAPP_TZ` env var, default UTC. V1
    hack to avoid a `users.timezone` schema migration; revisit when
    this app goes multi-user. Fly secret:
    `fly secrets set TASKAPP_TZ=America/New_York`.

    Cached after first resolution. Invalid values fall back to UTC
    *with a logged warning* — the previous silent fallback meant
    operators only discovered the typo by noticing the banner had
    drifted hours off, with no breadcrumb in `fly logs`."""
    tz_name = os.environ.get("TASKAPP_TZ", "UTC").strip() or "UTC"
    if _TZ_CACHE["name"] == tz_name and _TZ_CACHE["zone"] is not None:
        return _TZ_CACHE["zone"]  # type: ignore[return-value]
    try:
        zone = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        if not _TZ_CACHE["warned"]:
            log.warning(
                "TASKAPP_TZ=%r is not a valid IANA zone; falling back to UTC. "
                "Set with: fly secrets set TASKAPP_TZ=America/New_York",
                tz_name,
            )
            _TZ_CACHE["warned"] = True
        zone = ZoneInfo("UTC")
        _TZ_CACHE["name"] = tz_name  # cache the bad name too so we don't re-warn
        _TZ_CACHE["zone"] = zone
        return zone
    _TZ_CACHE["name"] = tz_name
    _TZ_CACHE["zone"] = zone
    return zone


def compute_missed_reminders(user_id: int) -> list[MissedReminder]:
    """Routines whose `reminder_time` already passed today (in operator
    TZ), where today is in `reminder_days`, and no session has been
    started since the reminder time.

    Each candidate row is filtered in Python after a small SELECT — for
    ~50 routines the cost is trivial; if this ever scales we move to a
    SQL-side `(CURRENT_DATE + reminder_time) AT TIME ZONE :tz` filter
    that the route can switch to without callers caring. Validator on
    RoutineCreate/Update gates the create path against malformed
    reminder_time strings; the try/except below guards legacy rows
    and raw SQL inserts only."""
    tz = _operator_tz()
    now_local = datetime.now(tz)
    today_code = _DAYS[now_local.weekday()]

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, name, goal, reminder_time, reminder_days, target_minutes "
            "FROM routines WHERE user_id = ? "
            "AND reminder_time IS NOT NULL AND reminder_days IS NOT NULL",
            (user_id,),
        )
        candidates = cur.fetchall()

        out: list[MissedReminder] = []
        for r in candidates:
            days = _parse_reminder_days(r["reminder_days"])
            if today_code not in days:
                continue
            try:
                hh, mm = r["reminder_time"].split(":", 1)
                # Construct the local datetime explicitly rather than via
                # `now_local.replace(hour=...)`. On a DST-spring-forward
                # day the wall-clock time may not exist (US: 2:30 AM
                # → 3:30 AM); ZoneInfo's __init__ resolves the gap
                # forward via fold=0 — i.e. "if the reminder was set
                # for a non-existent hour, treat it as the moment the
                # clock jumped past it." On fall-back ambiguity ZoneInfo
                # picks the first occurrence, which is also the right
                # semantic for a missed reminder.
                expected_local = datetime(
                    now_local.year, now_local.month, now_local.day,
                    int(hh), int(mm), 0, 0,
                    tzinfo=tz,
                )
            except (ValueError, AttributeError):
                log.warning(
                    "missed-reminders: skipping malformed reminder_time=%r "
                    "for routine_id=%s user_id=%s",
                    r["reminder_time"], r["id"], user_id,
                )
                continue
            if expected_local > now_local:
                continue  # reminder still in the future
            expected_utc = expected_local.astimezone(timezone.utc)
            cur.execute(
                "SELECT 1 FROM workout_sessions "
                "WHERE user_id = ? AND routine_id = ? AND started_at >= ? LIMIT 1",
                (user_id, r["id"], expected_utc.isoformat(sep=" ")),
            )
            if cur.fetchone():
                continue
            out.append(MissedReminder(
                routine_id=r["id"],
                name=r["name"],
                goal=r["goal"],
                reminder_time=r["reminder_time"],
                expected_at=expected_utc,
                target_minutes=r["target_minutes"],
            ))

        # Most recent first — operator scanning the banner sees the
        # freshest miss at the top.
        out.sort(key=lambda m: m.expected_at, reverse=True)
        return out
