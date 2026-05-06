/**
 * Pure-function helpers that compute "Move to..." option lists per
 * grouping field. Pure so they live in the node-libs jest project and
 * the Sheet component itself stays a thin renderer.
 *
 * Why this exists: the drag-to-regroup feature (PR-D2+) and the
 * non-drag "Move to..." sheet (PR-D1, this PR) both need to enumerate
 * "what targets exist for this grouping field?" Sharing the helpers
 * keeps the two paths in sync — the targets you can drop on are
 * exactly the targets the sheet lists.
 *
 * Each option carries an opaque `value` (the field value to PATCH),
 * a user-facing `label`, and an optional `icon` for the row.
 *
 * `currentValue` is rendered with a checkmark in the sheet UI so the
 * user can see "this row is already in folder X." Tapping the same
 * option is a no-op (handled by the sheet, not here).
 */

import type { Folder } from './stores';

export type MoveToOption<T> = {
  value: T;
  label: string;
  /** Optional Ionicons name. */
  icon?: string;
};

/** Folder targets for a task. Includes a sentinel "No folder" option
 *  with value=null so a user can move a task out of any folder. */
export function folderOptions(
  folders: Pick<Folder, 'id' | 'name'>[],
): MoveToOption<number | null>[] {
  return [
    { value: null, label: 'No folder', icon: 'folder-open-outline' },
    ...folders.map((f) => ({
      value: f.id,
      label: f.name,
      icon: 'folder-outline',
    })),
  ];
}

/** Priority levels: 0=none, 1=low, 2=normal, 3=high, 4=urgent.
 *  Mirrors the PRIORITY_LABELS table in tasks.tsx; lifted here so the
 *  sheet doesn't import from the screen. */
export function priorityOptions(): MoveToOption<number>[] {
  return [
    { value: 0, label: 'None', icon: 'flag-outline' },
    { value: 1, label: 'Low' },
    { value: 2, label: 'Normal' },
    { value: 3, label: 'High' },
    { value: 4, label: 'Urgent' },
  ];
}

/** Task status options. The values match the server enum. */
export function statusOptions(): MoveToOption<string>[] {
  return [
    { value: 'none', label: 'None' },
    { value: 'inbox', label: 'Inbox' },
    { value: 'next_action', label: 'Next' },
    { value: 'waiting_for', label: 'Waiting' },
    { value: 'someday', label: 'Someday' },
    { value: 'done', label: 'Done' },
  ];
}

/** Star is a binary; "Starred" / "Not starred" reads cleaner than
 *  "True / False" in the action sheet. */
export function starredOptions(): MoveToOption<boolean>[] {
  return [
    { value: true, label: 'Starred', icon: 'star' },
    { value: false, label: 'Not starred', icon: 'star-outline' },
  ];
}

/** Routine goal options. Mirrors `GOAL_FILTER_OPTIONS` in workouts.tsx
 *  but without the "all" sentinel (you can't set goal to "all"). */
export function goalOptions(): MoveToOption<string>[] {
  return [
    { value: 'strength', label: 'Strength' },
    { value: 'rehab', label: 'Rehab' },
    { value: 'mobility', label: 'Mobility' },
    { value: 'cardio', label: 'Cardio' },
    { value: 'general', label: 'General' },
  ];
}
