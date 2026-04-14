#!/usr/bin/env python3
"""
Import TickTick backup CSV into TaskApp via the REST API.

Usage:
    python import_ticktick.py [path_to_csv]

Default CSV path: /home/teric/TaskApp/TickTick-backup-2026-03-27.csv
"""

import csv
import re
import sys
from datetime import datetime

csv.field_size_limit(10 * 1024 * 1024)  # 10MB field limit for large email content

import requests

BASE_URL = "http://localhost:8000"
EMAIL = "import@test.com"
PASSWORD = "import123"
DEFAULT_CSV = "/home/teric/TaskApp/TickTick-backup-2026-03-27.csv"

# TickTick priority → TaskApp priority
PRIORITY_MAP = {
    "0": 0,   # None/Low
    "1": 1,   # Medium
    "3": 2,   # High
    "5": 3,   # Top
}

# RRULE FREQ → TaskApp repeat_type
FREQ_MAP = {
    "DAILY": "daily",
    "WEEKLY": "weekly",
    "MONTHLY": "monthly",
    "YEARLY": "yearly",
}


def parse_date(val: str) -> str | None:
    """Convert TickTick date like '2026-03-05T14:16:19+0000' → 'YYYY-MM-DD', or return None."""
    if not val or not val.strip():
        return None
    val = val.strip()
    try:
        # Handle +0000 timezone format (no colon)
        dt = datetime.strptime(val, "%Y-%m-%dT%H:%M:%S%z")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        pass
    try:
        # Try ISO format
        dt = datetime.fromisoformat(val)
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        pass
    # Try just date
    try:
        dt = datetime.strptime(val, "%Y-%m-%d")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_repeat(val: str) -> str:
    """Parse RRULE like 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=17' → TaskApp repeat_type."""
    if not val or not val.strip():
        return "none"
    val = val.strip()

    # Extract FREQ
    freq_match = re.search(r"FREQ=(\w+)", val)
    if not freq_match:
        return "none"
    freq = freq_match.group(1).upper()

    # Extract INTERVAL
    interval_match = re.search(r"INTERVAL=(\d+)", val)
    interval = int(interval_match.group(1)) if interval_match else 1

    # Map based on freq + interval
    if freq == "DAILY":
        return "daily"
    elif freq == "WEEKLY":
        if interval == 2:
            return "biweekly"
        return "weekly"
    elif freq == "MONTHLY":
        if interval == 3:
            return "quarterly"
        if interval == 6:
            return "semiannual"
        return "monthly"
    elif freq == "YEARLY":
        return "yearly"

    return FREQ_MAP.get(freq, "none")


def auth(session: requests.Session) -> str:
    """Register or login and return the token."""
    # Try register first
    resp = session.post(f"{BASE_URL}/auth/register", json={
        "email": EMAIL,
        "password": PASSWORD,
        "display_name": "TickTick Import"
    })
    if resp.status_code == 200:
        token = resp.json()["access_token"]
        print(f"Registered new user: {EMAIL}")
        return token

    # Already registered, try login
    resp = session.post(f"{BASE_URL}/auth/login", json={
        "email": EMAIL,
        "password": PASSWORD,
    })
    if resp.status_code == 200:
        token = resp.json()["access_token"]
        print(f"Logged in as: {EMAIL}")
        return token

    print(f"Auth failed: {resp.status_code} {resp.text}")
    sys.exit(1)


def read_csv(csv_path: str) -> list[dict]:
    """Read the TickTick CSV, skipping metadata header to find the real column header."""
    rows = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        content = f.read()

    # Find the header row that starts with "Folder Name"
    lines = content.split('\n')
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith('"Folder Name"'):
            header_idx = i
            break

    if header_idx is None:
        print("ERROR: Could not find header row starting with 'Folder Name'")
        return []

    # Rejoin from header onward and parse
    csv_text = '\n'.join(lines[header_idx:])
    reader = csv.DictReader(csv_text.splitlines())
    for row in reader:
        rows.append(row)
    return rows


def create_folders(session: requests.Session, headers: dict, rows: list[dict]) -> dict[str, int]:
    """Create folders from unique Folder Name values. Returns name→id mapping."""
    # First, get existing folders (registration creates defaults)
    resp = session.get(f"{BASE_URL}/folders", headers=headers)
    resp.raise_for_status()
    existing = {f["name"]: f["id"] for f in resp.json()}

    folder_names = set()
    for row in rows:
        name = row.get("Folder Name", "").strip()
        if name:
            folder_names.add(name)

    folder_map = {}
    sort_order = len(existing)  # start after default folders

    for name in sorted(folder_names):
        if name in existing:
            folder_map[name] = existing[name]
            continue
        try:
            resp = session.post(f"{BASE_URL}/folders", headers=headers, json={
                "name": name,
                "sort_order": sort_order,
            })
            resp.raise_for_status()
            folder_map[name] = resp.json()["id"]
            sort_order += 1
        except Exception as e:
            print(f"  Error creating folder '{name}': {e}")

    # Also include existing folders in map
    for name, fid in existing.items():
        if name not in folder_map:
            folder_map[name] = fid

    print(f"Folders: {len(folder_map)} total ({len(folder_map) - len(existing)} new)")
    return folder_map


def create_subfolders(session: requests.Session, headers: dict, rows: list[dict],
                      folder_map: dict[str, int]) -> dict[tuple[str, str], int]:
    """Create subfolders from unique (Folder Name, List Name) pairs. Returns (folder, list_name)→id mapping."""
    list_pairs = set()
    for row in rows:
        folder = row.get("Folder Name", "").strip()
        list_name = row.get("List Name", "").strip()
        if folder and list_name:
            list_pairs.add((folder, list_name))

    subfolder_map: dict[tuple[str, str], int] = {}
    created = 0

    for folder_name, list_name in sorted(list_pairs):
        folder_id = folder_map.get(folder_name)
        if folder_id is None:
            print(f"  Skipping subfolder '{list_name}' - folder '{folder_name}' not found")
            continue

        # Check if subfolder already exists in this folder
        try:
            resp = session.get(f"{BASE_URL}/folders/{folder_id}/subfolders", headers=headers)
            resp.raise_for_status()
            existing = {l["name"]: l["id"] for l in resp.json()}
            if list_name in existing:
                subfolder_map[(folder_name, list_name)] = existing[list_name]
                continue
        except Exception:
            pass

        try:
            resp = session.post(f"{BASE_URL}/folders/{folder_id}/subfolders", headers=headers, json={
                "name": list_name,
                "sort_order": 0,
            })
            resp.raise_for_status()
            subfolder_map[(folder_name, list_name)] = resp.json()["id"]
            created += 1
        except Exception as e:
            print(f"  Error creating subfolder '{list_name}' in '{folder_name}': {e}")

    print(f"Subfolders: {len(subfolder_map)} total ({created} new)")
    return subfolder_map


def create_tags(session: requests.Session, headers: dict, rows: list[dict]) -> dict[str, int]:
    """Create tags from all unique tag values. Returns name→id mapping."""
    tag_names = set()
    for row in rows:
        tags_val = row.get("Tags", "").strip()
        if tags_val:
            for t in tags_val.split(","):
                t = t.strip()
                if t:
                    tag_names.add(t)

    tag_map = {}
    for name in sorted(tag_names):
        try:
            resp = session.post(f"{BASE_URL}/tags", headers=headers, json={"name": name})
            resp.raise_for_status()
            tag_map[name] = resp.json()["id"]
        except Exception as e:
            print(f"  Error creating tag '{name}': {e}")

    print(f"Tags: {len(tag_map)} created")
    return tag_map


def create_tasks(session: requests.Session, headers: dict, rows: list[dict],
                 folder_map: dict[str, int],
                 subfolder_map: dict[tuple[str, str], int],
                 tag_map: dict[str, int]):
    """Create tasks. First parents (no parentId), then children."""

    # Separate parents and children
    parents = []
    children = []
    for row in rows:
        title = row.get("Title", "").strip()
        if not title:
            continue
        parent_id_val = row.get("parentId", "").strip()
        if parent_id_val:
            children.append(row)
        else:
            parents.append(row)

    # ticktick taskId → TaskApp task id
    ticktick_to_app: dict[str, int] = {}
    completed_task_ids: list[int] = []

    task_count = 0
    error_count = 0

    def build_task_payload(row: dict, parent_app_id: int | None = None) -> dict | None:
        title = row.get("Title", "").strip()
        if not title:
            return None

        folder_name = row.get("Folder Name", "").strip()
        list_name = row.get("List Name", "").strip()

        folder_id = folder_map.get(folder_name) if folder_name else None
        subfolder_id = subfolder_map.get((folder_name, list_name)) if (folder_name and list_name) else None

        # Priority mapping
        priority_raw = row.get("Priority", "0").strip()
        priority = PRIORITY_MAP.get(priority_raw, 0)

        # Status: 0→not completed, 1→completed, 2→completed (archived)
        status_raw = row.get("Status", "0").strip()
        is_completed = status_raw in ("1", "2")

        # Dates
        start_date = parse_date(row.get("Start Date", ""))
        due_date = parse_date(row.get("Due Date", ""))

        # Note/Content
        note = row.get("Content", "").strip() or None

        # Tags
        tag_ids = []
        tags_val = row.get("Tags", "").strip()
        if tags_val:
            for t in tags_val.split(","):
                t = t.strip()
                if t and t in tag_map:
                    tag_ids.append(tag_map[t])

        # Repeat
        repeat_type = parse_repeat(row.get("Repeat", ""))

        payload = {
            "title": title,
            "folder_id": folder_id,
            "subfolder_id": subfolder_id,
            "note": note,
            "priority": priority,
            "status": "none",
            "starred": False,
            "repeat_type": repeat_type,
            "tag_ids": tag_ids,
        }

        if start_date:
            payload["start_date"] = start_date
        if due_date:
            payload["due_date"] = due_date
        if parent_app_id is not None:
            payload["parent_id"] = parent_app_id

        return payload, is_completed

    # Create parent tasks
    print(f"\nCreating {len(parents)} parent tasks...")
    for i, row in enumerate(parents):
        try:
            result = build_task_payload(row)
            if result is None:
                continue
            payload, is_completed = result

            resp = session.post(f"{BASE_URL}/tasks", headers=headers, json=payload)
            resp.raise_for_status()
            app_task_id = resp.json()["id"]

            ticktick_id = row.get("taskId", "").strip()
            if ticktick_id:
                ticktick_to_app[ticktick_id] = app_task_id

            if is_completed:
                completed_task_ids.append(app_task_id)

            task_count += 1
            if (i + 1) % 50 == 0:
                print(f"  ...created {i + 1}/{len(parents)} parent tasks")
        except Exception as e:
            error_count += 1
            title = row.get("Title", "?")[:40]
            print(f"  Error creating task '{title}': {e}")

    # Create child tasks
    print(f"\nCreating {len(children)} child tasks...")
    for i, row in enumerate(children):
        try:
            ticktick_parent_id = row.get("parentId", "").strip()
            parent_app_id = ticktick_to_app.get(ticktick_parent_id)

            if parent_app_id is None:
                # Parent not found, create as top-level task
                pass

            result = build_task_payload(row, parent_app_id)
            if result is None:
                continue
            payload, is_completed = result

            resp = session.post(f"{BASE_URL}/tasks", headers=headers, json=payload)
            resp.raise_for_status()
            app_task_id = resp.json()["id"]

            ticktick_id = row.get("taskId", "").strip()
            if ticktick_id:
                ticktick_to_app[ticktick_id] = app_task_id

            if is_completed:
                completed_task_ids.append(app_task_id)

            task_count += 1
            if (i + 1) % 50 == 0:
                print(f"  ...created {i + 1}/{len(children)} child tasks")
        except Exception as e:
            error_count += 1
            title = row.get("Title", "?")[:40]
            print(f"  Error creating child task '{title}': {e}")

    # Mark completed tasks using batch update
    if completed_task_ids:
        print(f"\nMarking {len(completed_task_ids)} tasks as completed...")
        # Batch update in chunks of 50
        for i in range(0, len(completed_task_ids), 50):
            chunk = completed_task_ids[i:i + 50]
            try:
                resp = session.post(f"{BASE_URL}/tasks/batch", headers=headers, json={
                    "task_ids": chunk,
                    "completed": True,
                })
                resp.raise_for_status()
            except Exception as e:
                print(f"  Error marking tasks completed: {e}")

    print(f"\nTasks: {task_count} created ({error_count} errors)")
    return task_count


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    print(f"Importing TickTick backup from: {csv_path}")
    print(f"Target API: {BASE_URL}")
    print()

    # Read CSV
    rows = read_csv(csv_path)
    print(f"CSV rows read: {len(rows)}")

    session = requests.Session()

    # Authenticate
    token = auth(session)
    headers = {"Authorization": f"Bearer {token}"}

    # Create folders
    print()
    folder_map = create_folders(session, headers, rows)

    # Create subfolders
    print()
    subfolder_map = create_subfolders(session, headers, rows, folder_map)

    # Create tags
    print()
    tag_map = create_tags(session, headers, rows)

    # Create tasks
    task_count = create_tasks(session, headers, rows, folder_map, subfolder_map, tag_map)

    print("\n--- Import Complete ---")
    print(f"  Folders:    {len(folder_map)}")
    print(f"  Subfolders: {len(subfolder_map)}")
    print(f"  Tags:    {len(tag_map)}")
    print(f"  Tasks:   {task_count}")


if __name__ == "__main__":
    main()
