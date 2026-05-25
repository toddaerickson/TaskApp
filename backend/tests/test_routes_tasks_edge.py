"""Deeper task-route coverage: pagination, filter flags, subtasks, batch
extras, and the recurring-task completion branch."""
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Pagination ----------

def test_pagination_page_per_page_total(auth_client):
    c, tok, _ = auth_client
    for i in range(7):
        c.post("/tasks", headers=_h(tok), json={"title": f"t{i}"})
    r = c.get("/tasks", headers=_h(tok), params={"page": 1, "per_page": 3}).json()
    assert r["total"] == 7
    assert r["page"] == 1
    assert r["per_page"] == 3
    assert len(r["tasks"]) == 3


def test_second_page_has_remainder(auth_client):
    c, tok, _ = auth_client
    for i in range(7):
        c.post("/tasks", headers=_h(tok), json={"title": f"t{i}"})
    page1 = c.get("/tasks", headers=_h(tok), params={"page": 1, "per_page": 3}).json()
    page3 = c.get("/tasks", headers=_h(tok), params={"page": 3, "per_page": 3}).json()
    assert len(page3["tasks"]) == 1
    assert not set(t["id"] for t in page1["tasks"]) & set(t["id"] for t in page3["tasks"])


def test_per_page_clamped_to_max(auth_client):
    c, tok, _ = auth_client
    # per_page > 200 should 422 (Query(le=200)).
    r = c.get("/tasks", headers=_h(tok), params={"per_page": 500})
    assert r.status_code == 422


# ---------- hide_future_start ----------

def test_hide_future_start_excludes_future_tasks(auth_client):
    c, tok, _ = auth_client
    today = date.today().isoformat()
    future = (date.today() + timedelta(days=7)).isoformat()
    c.post("/tasks", headers=_h(tok), json={"title": "today", "start_date": today})
    c.post("/tasks", headers=_h(tok), json={"title": "future", "start_date": future})
    c.post("/tasks", headers=_h(tok), json={"title": "no-start"})

    with_future = c.get("/tasks", headers=_h(tok)).json()["tasks"]
    assert {t["title"] for t in with_future} == {"today", "future", "no-start"}

    without = c.get("/tasks", headers=_h(tok), params={"hide_future_start": "true"}).json()["tasks"]
    assert {t["title"] for t in without} == {"today", "no-start"}


# ---------- Subtasks / parent_id / top_level_only ----------

def test_top_level_only_default_hides_subtasks(auth_client):
    c, tok, _ = auth_client
    parent = c.post("/tasks", headers=_h(tok), json={"title": "parent"}).json()
    c.post("/tasks", headers=_h(tok), json={"title": "child", "parent_id": parent["id"]})

    r = c.get("/tasks", headers=_h(tok)).json()
    titles = [t["title"] for t in r["tasks"]]
    assert "parent" in titles
    assert "child" not in titles  # hidden by default top_level_only=True


def test_top_level_only_false_includes_subtasks(auth_client):
    c, tok, _ = auth_client
    parent = c.post("/tasks", headers=_h(tok), json={"title": "parent"}).json()
    c.post("/tasks", headers=_h(tok), json={"title": "child", "parent_id": parent["id"]})
    r = c.get("/tasks", headers=_h(tok), params={"top_level_only": "false"}).json()
    titles = {t["title"] for t in r["tasks"]}
    assert "parent" in titles
    assert "child" in titles


def test_filter_by_parent_id_returns_only_subtasks(auth_client):
    c, tok, _ = auth_client
    parent = c.post("/tasks", headers=_h(tok), json={"title": "parent"}).json()
    c.post("/tasks", headers=_h(tok), json={"title": "child1", "parent_id": parent["id"]})
    c.post("/tasks", headers=_h(tok), json={"title": "child2", "parent_id": parent["id"]})
    c.post("/tasks", headers=_h(tok), json={"title": "other"})

    r = c.get("/tasks", headers=_h(tok), params={"parent_id": parent["id"]}).json()
    assert {t["title"] for t in r["tasks"]} == {"child1", "child2"}


def test_parent_task_embeds_subtasks_on_detail(auth_client):
    c, tok, _ = auth_client
    parent = c.post("/tasks", headers=_h(tok), json={"title": "parent"}).json()
    c.post("/tasks", headers=_h(tok), json={"title": "c1", "parent_id": parent["id"]})
    c.post("/tasks", headers=_h(tok), json={"title": "c2", "parent_id": parent["id"]})

    r = c.get(f"/tasks/{parent['id']}", headers=_h(tok)).json()
    assert len(r["subtasks"]) == 2
    assert {s["title"] for s in r["subtasks"]} == {"c1", "c2"}


def test_subtask_inherits_parent_folder(auth_client):
    c, tok, _ = auth_client
    f = c.post("/folders", headers=_h(tok), json={"name": "Bucket"}).json()
    parent = c.post("/tasks", headers=_h(tok),
                    json={"title": "parent", "folder_id": f["id"]}).json()
    child = c.post("/tasks", headers=_h(tok),
                   json={"title": "child", "parent_id": parent["id"]}).json()
    # Inherits: even if we send folder_id=None, it picks up parent's.
    assert child["folder_id"] == f["id"]


def test_create_subtask_with_bogus_parent_404s(auth_client):
    c, tok, _ = auth_client
    r = c.post("/tasks", headers=_h(tok), json={"title": "x", "parent_id": 99999})
    assert r.status_code == 404


# ---------- Batch (extra fields) ----------

def test_batch_set_priority_and_starred(auth_client):
    c, tok, _ = auth_client
    ids = [c.post("/tasks", headers=_h(tok), json={"title": f"t{i}"}).json()["id"] for i in range(3)]
    r = c.post("/tasks/batch", headers=_h(tok),
               json={"task_ids": ids, "priority": 3, "starred": True})
    assert r.status_code == 200
    for i in ids:
        t = c.get(f"/tasks/{i}", headers=_h(tok)).json()
        assert t["priority"] == 3
        assert t["starred"] is True


def test_batch_set_status(auth_client):
    c, tok, _ = auth_client
    ids = [c.post("/tasks", headers=_h(tok), json={"title": f"t{i}"}).json()["id"] for i in range(2)]
    r = c.post("/tasks/batch", headers=_h(tok),
               json={"task_ids": ids, "status": "waiting"})
    assert r.status_code == 200
    for i in ids:
        assert c.get(f"/tasks/{i}", headers=_h(tok)).json()["status"] == "waiting"


def test_batch_requires_at_least_one_field(auth_client):
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={"title": "a"}).json()
    r = c.post("/tasks/batch", headers=_h(tok), json={"task_ids": [t["id"]]})
    assert r.status_code == 400


# ---------- Recurring task completion ----------

def test_completing_recurring_task_rolls_due_date_forward(auth_client):
    """For a repeating task, /complete rolls due_date forward by the
    repeat interval and leaves completed=False (the task recurs)."""
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={
        "title": "Daily stretch",
        "due_date": "2026-04-10",
        "repeat_type": "daily",
    }).json()
    r = c.post(f"/tasks/{t['id']}/complete", headers=_h(tok))
    assert r.status_code == 200
    body = r.json()
    assert body["completed"] is False, "recurring task should stay open"
    assert body["due_date"] == "2026-04-11"


def test_weekly_recurring_task_advances_by_seven_days(auth_client):
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={
        "title": "Weekly review",
        "due_date": "2026-04-10",
        "repeat_type": "weekly",
    }).json()
    body = c.post(f"/tasks/{t['id']}/complete", headers=_h(tok)).json()
    assert body["due_date"] == "2026-04-17"


def test_non_recurring_complete_sets_completed(auth_client):
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={
        "title": "Once", "due_date": "2026-04-10", "repeat_type": "none",
    }).json()
    body = c.post(f"/tasks/{t['id']}/complete", headers=_h(tok)).json()
    assert body["completed"] is True
    assert body["due_date"] == "2026-04-10"  # unchanged
    assert body["completed_at"] is not None


def test_completion_date_recurring_uses_operator_tz(auth_client, monkeypatch):
    """Regression: a recurring task with `repeat_from='completion_date'`
    advances `due_date` relative to the *operator's* calendar day, not
    UTC's. A user in America/New_York who completes a daily task at
    23:30 ET (03:30 UTC next day) should see the new due_date land on
    the next ET calendar day, not the day after that.

    Bug shape: `base_date = now.date()` used `datetime.now(timezone.utc)`,
    so the user "lost" a day at every late-evening completion in any
    westward TZ. Fix reads TASKAPP_TZ via `_operator_tz()`."""
    c, tok, _ = auth_client

    monkeypatch.setenv("TASKAPP_TZ", "America/New_York")
    # Bust the cached zone in app.reminders.
    from app import reminders as _rem
    _rem._TZ_CACHE["name"] = None
    _rem._TZ_CACHE["zone"] = None
    _rem._TZ_CACHE["warned"] = False

    # 23:30 ET on 2026-04-10 = 03:30 UTC on 2026-04-11. The pre-fix
    # code would have read .date() as 2026-04-11 (UTC) and advanced
    # to 2026-04-12 — wrong by one day.
    pinned = datetime(2026, 4, 11, 3, 30, tzinfo=timezone.utc)

    class _PinnedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return pinned.replace(tzinfo=None)
            return pinned.astimezone(tz)

    t = c.post("/tasks", headers=_h(tok), json={
        "title": "Daily ET stretch",
        "due_date": "2026-04-10",
        "repeat_type": "daily",
        "repeat_from": "completion_date",
    }).json()

    with patch("app.routes.task_routes.datetime", _PinnedDatetime):
        body = c.post(f"/tasks/{t['id']}/complete", headers=_h(tok)).json()

    # Next ET day, not next UTC day.
    assert body["due_date"] == "2026-04-11", (
        f"expected next ET day 2026-04-11, got {body['due_date']} — "
        "looks like UTC date is being used for the completion-date base."
    )
