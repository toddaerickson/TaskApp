"""Per-user seed helpers.

Splits one-shot setup logic out of route handlers so the same shape
can be reused outside the /auth/register path (e.g. a future admin
"reset folders to defaults" tool, integration test fixtures, or a
bulk-import flow that creates users programmatically).

Mirrors the shape of `seed_workouts.seed_global_routines_for_all_users`
— a small idempotent function that takes an open cursor and the
target user_id, leaves transaction lifecycle to the caller. This is
intentional: the register flow wraps the user insert + folder seed
in a single transaction so a folder INSERT failure rolls back the
user too.
"""

# The canonical first-launch folder set for a brand-new GTD user.
# The leading numeric prefix on each name doubles as the visual sort
# in the mobile sidebar; `sort_order` mirrors it explicitly so a
# future rename doesn't silently reorder existing users.
DEFAULT_FOLDERS: list[tuple[str, int]] = [
    ("Critical", 0),
    ("1. Capture", 1),
    ("2. Do Now", 2),
    ("3. Delegate (Waiting)", 3),
    ("4. Defer (Follow-up)", 4),
    ("5. Social", 5),
    ("6. Someday/Maybe", 6),
    ("7. Reference", 7),
]


def seed_default_folders(cur, user_id: int) -> None:
    """Insert the default GTD folder set for a freshly-created user.

    Takes an open cursor; the caller owns transaction lifecycle.
    """
    for name, order in DEFAULT_FOLDERS:
        cur.execute(
            "INSERT INTO folders (user_id, name, sort_order) VALUES (?, ?, ?)",
            (user_id, name, order),
        )
