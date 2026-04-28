"""Tests for `GET /routines/missed-reminders` — the V1 in-app inbox
that surfaces routines whose `reminder_time` already passed today
and the user hasn't started yet.

V1 in lieu of full web push (Tier 3-V2, deferred). The single-tenant
TZ assumption (`TASKAPP_TZ` env, default UTC) means tests that pin
specific times stub `datetime.now` inside the route module.
"""
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.database import get_db


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _make_routine(c, tok, **overrides) -> int:
    body = {
        "name": "Morning Mobility",
        "goal": "mobility",
        "reminder_time": "07:00",
        "reminder_days": "daily",
        **overrides,
    }
    r = c.post("/routines", headers=_h(tok), json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture
def fixed_now():
    """Pin `datetime.now()` *inside the route module* to a deterministic
    instant so reminder-time comparisons are reproducible. Default is
    Tuesday 2026-04-28 09:30 UTC — well past a 7:00 AM reminder.

    The route uses naive-aware datetime arithmetic (`datetime.now(tz)`,
    `astimezone`), so we patch the module's bound `datetime` symbol
    rather than the global. Subclassing keeps `now()` overridable while
    preserving every other classmethod the code calls
    (`datetime.fromisoformat`, the `.replace`, `.astimezone`, etc.)."""
    pinned = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)

    class _PinnedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return pinned.replace(tzinfo=None)
            return pinned.astimezone(tz)

    with patch("app.routes.routine_routes.datetime", _PinnedDatetime):
        yield pinned


def test_passed_reminder_with_no_session_surfaces(auth_client, fixed_now):
    """Happy path: 7:00 AM reminder, now is 9:30 UTC, no session today
    → row appears."""
    c, tok, _ = auth_client
    rid = _make_routine(c, tok, reminder_time="07:00", reminder_days="daily")
    r = c.get("/routines/missed-reminders", headers=_h(tok))
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["routine_id"] == rid
    assert body[0]["reminder_time"] == "07:00"
    assert body[0]["name"] == "Morning Mobility"


def test_future_reminder_does_not_surface(auth_client, fixed_now):
    """Reminder set for later today (10:00 vs pinned now=09:30) →
    not yet missed."""
    c, tok, _ = auth_client
    _make_routine(c, tok, name="Evening Routine", reminder_time="22:00")
    r = c.get("/routines/missed-reminders", headers=_h(tok))
    assert r.json() == []


def test_routine_without_reminder_does_not_surface(auth_client, fixed_now):
    c, tok, _ = auth_client
    _make_routine(c, tok, reminder_time=None, reminder_days=None)
    r = c.get("/routines/missed-reminders", headers=_h(tok))
    assert r.json() == []


def test_session_started_after_reminder_hides_row(auth_client, fixed_now):
    """The whole point of the inbox: once you START the session, the
    debt is paid and the banner disappears."""
    c, tok, user_id = auth_client
    rid = _make_routine(c, tok, reminder_time="07:00")
    # Stamp a session whose started_at is *after* 07:00 UTC today.
    started = datetime(2026, 4, 28, 8, 15, tzinfo=timezone.utc)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO workout_sessions (user_id, routine_id, started_at) "
            "VALUES (?, ?, ?)",
            (user_id, rid, started.isoformat(sep=" ")),
        )
    r = c.get("/routines/missed-reminders", headers=_h(tok))
    assert r.json() == []


def test_session_started_BEFORE_reminder_still_shows_miss(auth_client, fixed_now):
    """If the session started yesterday or before today's reminder
    fired, today's reminder is still missed."""
    c, tok, user_id = auth_client
    rid = _make_routine(c, tok, reminder_time="07:00")
    yesterday_session = datetime(2026, 4, 27, 8, 0, tzinfo=timezone.utc)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO workout_sessions (user_id, routine_id, started_at) "
            "VALUES (?, ?, ?)",
            (user_id, rid, yesterday_session.isoformat(sep=" ")),
        )
    r = c.get("/routines/missed-reminders", headers=_h(tok))
    assert len(r.json()) == 1


def test_wrong_weekday_does_not_surface(auth_client, fixed_now):
    """Pinned now is Tuesday 2026-04-28. A routine scheduled mon,wed,fri
    shouldn't fire today even though the time has passed."""
    c, tok, _ = auth_client
    _make_routine(c, tok, reminder_time="07:00", reminder_days="mon,wed,fri")
    r = c.get("/routines/missed-reminders", headers=_h(tok))
    assert r.json() == []


def test_malformed_reminder_time_does_not_500(auth_client, fixed_now):
    """A row with a corrupt `reminder_time` string (split error) should
    skip the row rather than break the response. Defensive guard."""
    c, tok, user_id = auth_client
    # Insert directly with a bad time so we hit the parse path. The
    # route's POST validates HH:MM but the route's GET tolerates legacy
    # rows.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO routines (user_id, name, goal, reminder_time, reminder_days, sort_order) "
            "VALUES (?, ?, 'mobility', 'not-a-time', 'daily', 0)",
            (user_id, "Broken"),
        )
    r = c.get("/routines/missed-reminders", headers=_h(tok))
    assert r.status_code == 200  # not 500
    assert r.json() == []


def test_multiple_misses_sorted_most_recent_first(auth_client, fixed_now):
    """The banner reads top-down; the freshest-missed reminder belongs
    at the top so the operator's eye lands on what they were just about
    to do."""
    c, tok, _ = auth_client
    early = _make_routine(c, tok, name="Early", reminder_time="06:00")
    late = _make_routine(c, tok, name="Late", reminder_time="09:00")
    r = c.get("/routines/missed-reminders", headers=_h(tok))
    body = r.json()
    assert [m["routine_id"] for m in body] == [late, early]


def test_response_includes_target_minutes(auth_client, fixed_now):
    """target_minutes flows through so the banner can render the
    duration pill (parity with the routine card)."""
    c, tok, _ = auth_client
    _make_routine(c, tok, reminder_time="07:00", target_minutes=5)
    body = c.get("/routines/missed-reminders", headers=_h(tok)).json()
    assert body[0]["target_minutes"] == 5


def test_other_user_routines_not_surfaced(auth_client, fixed_now, client):
    """Cross-tenant guard: missed reminders are scoped to the calling
    user. Belt and suspenders — the SQL already filters on user_id but
    the test pins it."""
    c, tok, _ = auth_client
    _make_routine(c, tok, reminder_time="07:00")  # user A
    # Register user B independently.
    rb = client.post("/auth/register", json={"email": "b@x.com", "password": "pw12345!"})
    tok_b = rb.json()["access_token"]
    # Note we used `client` (not auth_client) for B which doesn't conflict
    # with the existing tester user; the `auth_client` already wiped the
    # DB once and seeded user A.
    body_b = client.get("/routines/missed-reminders", headers=_h(tok_b)).json()
    assert body_b == []


# ---------- _parse_reminder_days unit tests ----------

def test_parse_reminder_days_daily():
    from app.routes.routine_routes import _parse_reminder_days, _DAYS
    assert _parse_reminder_days("daily") == frozenset(_DAYS)


def test_parse_reminder_days_csv():
    from app.routes.routine_routes import _parse_reminder_days
    assert _parse_reminder_days("mon,wed,fri") == frozenset({"mon", "wed", "fri"})


def test_parse_reminder_days_handles_whitespace():
    from app.routes.routine_routes import _parse_reminder_days
    assert _parse_reminder_days(" Mon , wed , fri ") == frozenset({"mon", "wed", "fri"})


def test_parse_reminder_days_drops_invalid_tokens():
    from app.routes.routine_routes import _parse_reminder_days
    # Mirror behavior of the mobile parser — silently drop unknown
    # codes rather than crash.
    assert _parse_reminder_days("mon,xyz,fri") == frozenset({"mon", "fri"})


def test_parse_reminder_days_null_returns_empty():
    from app.routes.routine_routes import _parse_reminder_days
    assert _parse_reminder_days(None) == frozenset()
    assert _parse_reminder_days("") == frozenset()


# ---------- PR-X3: reminder_time + reminder_days model validators ----------
# Silent-killer #4: an unvalidated client could store "0:5" or "garbage"
# in reminder_time. The route's try/except eats the parse error and
# silently skips that row from the missed-reminders banner, so the
# operator never sees a reminder that was never visible. Validators
# now catch this at write time with a 422.

def test_routine_create_rejects_malformed_reminder_time(auth_client):
    client, token, _ = auth_client
    bad_values = ["0:5", "7:00:00", "25:00", "07-00", "garbage", "07:60"]
    for v in bad_values:
        r = client.post(
            "/routines",
            headers=_h(token),
            json={"name": "X", "reminder_time": v, "reminder_days": "daily"},
        )
        assert r.status_code == 422, f"{v!r} should 422 but got {r.status_code}: {r.text}"


def test_routine_create_accepts_valid_reminder_time(auth_client):
    client, token, _ = auth_client
    for v in ["00:00", "07:30", "23:59", "12:05"]:
        r = client.post(
            "/routines",
            headers=_h(token),
            json={"name": f"X-{v}", "reminder_time": v, "reminder_days": "daily"},
        )
        assert r.status_code == 200, f"{v!r} should accept: {r.text}"


def test_routine_create_rejects_unknown_day_token(auth_client):
    client, token, _ = auth_client
    r = client.post(
        "/routines",
        headers=_h(token),
        json={"name": "X", "reminder_time": "07:00", "reminder_days": "mon,xyz,fri"},
    )
    assert r.status_code == 422
    assert "xyz" in r.text


def test_routine_update_rejects_malformed_reminder_time(auth_client):
    client, token, _ = auth_client
    rid = _make_routine(client, token)
    r = client.put(
        f"/routines/{rid}",
        headers=_h(token),
        json={"reminder_time": "29:99"},
    )
    assert r.status_code == 422


def test_routine_create_accepts_null_reminder_fields(auth_client):
    """Null/empty opts the routine out of reminders entirely; the
    validator must accept that, not require HH:MM."""
    client, token, _ = auth_client
    r = client.post(
        "/routines",
        headers=_h(token),
        json={"name": "Quiet", "reminder_time": None, "reminder_days": None},
    )
    assert r.status_code == 200


# ---------- PR-X3: DST-safe expected_local construction ----------
# Adversarial finding: `now_local.replace(hour=hh, minute=mm)` is not
# DST-safe. On US spring-forward (2026-03-08 02:00 → 03:00) a 02:30
# reminder doesn't exist as wall-clock time. The new code uses
# `datetime(..., tzinfo=tz)` which resolves the gap forward via fold=0.

def test_dst_spring_forward_does_not_explode(auth_client, monkeypatch):
    """Pin `now_local` to 2026-03-08 04:00 America/New_York (after the
    DST jump). A routine with reminder_time=02:30 on Sunday should be
    findable: the wall-clock 02:30 didn't exist, but ZoneInfo collapses
    it to 03:30 UTC-equivalent and the route should treat it as
    "passed earlier today". The previous .replace(hour=...) path
    produced a datetime whose UTC offset was wrong by an hour."""
    client, token, _ = auth_client
    from zoneinfo import ZoneInfo
    monkeypatch.setenv("TASKAPP_TZ", "America/New_York")
    # Bust the module-level cache.
    from app.routes import routine_routes as rr
    rr._TZ_CACHE["name"] = None
    rr._TZ_CACHE["zone"] = None
    rr._TZ_CACHE["warned"] = False

    # Sunday 2026-03-08, 04:00 local = 08:00 UTC (post-DST)
    pinned_local = datetime(2026, 3, 8, 4, 0, 0, tzinfo=ZoneInfo("America/New_York"))

    rid = _make_routine(
        client, token,
        name="Sunday DST Test",
        reminder_time="02:30",
        reminder_days="sun",
    )

    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return pinned_local.astimezone(tz) if tz else pinned_local
    with patch("app.routes.routine_routes.datetime", _DT):
        r = client.get("/routines/missed-reminders", headers=_h(token))
    assert r.status_code == 200, r.text
    ids = [m["routine_id"] for m in r.json()]
    assert rid in ids


# ---------- PR-X3: _operator_tz cache + warn-on-invalid ----------

def test_operator_tz_warns_once_on_invalid(monkeypatch, caplog):
    """Invalid TASKAPP_TZ should fall back to UTC AND log a warning
    exactly once across multiple calls — the previous silent fallback
    meant operators only noticed when banner times drifted."""
    from app.routes import routine_routes as rr
    monkeypatch.setenv("TASKAPP_TZ", "Mars/Olympus_Mons")
    rr._TZ_CACHE["name"] = None
    rr._TZ_CACHE["zone"] = None
    rr._TZ_CACHE["warned"] = False
    with caplog.at_level("WARNING", logger="app.routes.routine_routes"):
        z1 = rr._operator_tz()
        z2 = rr._operator_tz()
        z3 = rr._operator_tz()
    assert str(z1) == "UTC"
    assert z1 is z2 is z3  # cached
    warns = [r for r in caplog.records if "Mars/Olympus_Mons" in r.message]
    assert len(warns) == 1, f"expected exactly one warning, got {len(warns)}"


def test_operator_tz_caches_valid_zone(monkeypatch):
    from app.routes import routine_routes as rr
    monkeypatch.setenv("TASKAPP_TZ", "America/New_York")
    rr._TZ_CACHE["name"] = None
    rr._TZ_CACHE["zone"] = None
    z1 = rr._operator_tz()
    z2 = rr._operator_tz()
    assert z1 is z2
    assert str(z1) == "America/New_York"
