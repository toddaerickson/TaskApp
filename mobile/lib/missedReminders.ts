/**
 * Pure helpers for the V1 missed-reminders inbox banner. The banner
 * persists "I dismissed this miss for today" via kvStorage so the
 * operator doesn't see the same row again until tomorrow's reminder
 * time fires (or they re-add the routine to the today bucket).
 *
 * Shape decision: client-side dismiss only. No backend dismiss table.
 * Rationale: V1 dogfooding scope. If the operator clears site data
 * they re-see dismissed entries — acceptable trade for zero schema.
 *
 * Date format is `YYYY-MM-DD` derived from the device's local clock,
 * not the server's TZ. The server's TZ (TASKAPP_TZ) decides what's
 * "missed today"; the dismiss key just deduplicates within that local
 * day from the device's view. Worst case: device + server cross
 * midnight at different moments and the dismiss reappears for ~a
 * minute. Acceptable.
 */

const PREFIX = 'missed_reminder_dismissed';

export interface MissedReminder {
  routine_id: number;
  name: string;
  goal: string;
  reminder_time: string; // "HH:MM"
  expected_at: string;   // ISO timestamp
  target_minutes?: number | null;
}

/**
 * The dismiss key includes the routine id AND the local YYYY-MM-DD so
 * yesterday's dismiss doesn't suppress today's miss for the same
 * routine.
 */
export function dismissKey(routineId: number, isoDate: string): string {
  return `${PREFIX}:${routineId}:${isoDate}`;
}

/** YYYY-MM-DD in the device's local TZ — used for the dismiss key. */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Filter the server response by client-side dismisses. Pure function —
 * the storage I/O is the caller's responsibility (so the React effect
 * can debounce / coordinate with focus).
 */
export function filterDismissed(
  reminders: readonly MissedReminder[],
  dismissedKeys: ReadonlySet<string>,
  isoDate: string,
): MissedReminder[] {
  return reminders.filter(
    (m) => !dismissedKeys.has(dismissKey(m.routine_id, isoDate)),
  );
}
