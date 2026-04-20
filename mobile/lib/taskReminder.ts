/**
 * Pure helpers for the task-reminder picker UI.
 *
 * The picker splits a moment into two plain-text inputs (YYYY-MM-DD + HH:MM)
 * to avoid pulling in a date-picker dependency. These helpers validate and
 * convert user input into the ISO string the backend expects, and are
 * unit-tested in isolation.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/**
 * Combine a YYYY-MM-DD date and HH:MM time (both local-time) into an ISO
 * string. Returns null when either input is malformed or the resulting
 * Date is invalid (e.g. "2026-02-31 10:00").
 */
export function toISO(dateStr: string, timeStr: string): string | null {
  const dm = DATE_RE.exec(dateStr);
  const tm = TIME_RE.exec(timeStr);
  if (!dm || !tm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  if (h < 0 || h > 23) return null;
  if (mi < 0 || mi > 59) return null;
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Reject overflow — e.g. Feb 31 → Mar 3 via the Date constructor.
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d ||
    dt.getHours() !== h ||
    dt.getMinutes() !== mi
  ) {
    return null;
  }
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export type ReminderValidation =
  | { ok: true; iso: string; warning?: string }
  | { ok: false; error: string };

/**
 * Validate user input and return either the ISO string plus an optional
 * "this is in the past" warning, or a user-facing error message.
 * `now` is injectable so tests don't need to mock Date.
 */
export function validateReminderInput(
  dateStr: string,
  timeStr: string,
  now: number = Date.now(),
): ReminderValidation {
  if (!dateStr.trim() && !timeStr.trim()) {
    return { ok: false, error: 'Pick a date and a time.' };
  }
  if (!dateStr.trim()) return { ok: false, error: 'Pick a date.' };
  if (!timeStr.trim()) return { ok: false, error: 'Pick a time.' };
  if (!DATE_RE.test(dateStr)) {
    return { ok: false, error: 'Date must look like YYYY-MM-DD.' };
  }
  if (!TIME_RE.test(timeStr)) {
    return { ok: false, error: 'Time must look like HH:MM (24-hour).' };
  }
  const iso = toISO(dateStr, timeStr);
  if (!iso) {
    return { ok: false, error: 'That date or time isn\'t valid.' };
  }
  const ts = new Date(iso).getTime();
  if (ts <= now) {
    // Past reminders still save — useful for logging after-the-fact —
    // but the picker surfaces a soft warning so it's not confusing.
    return { ok: true, iso, warning: 'This time has already passed.' };
  }
  return { ok: true, iso };
}

/**
 * Pretty-print an ISO reminder timestamp for the list rows. Local time,
 * no seconds. Example: "Apr 20, 2026 · 3:45 PM".
 */
export function formatReminderRow(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit',
  });
  return `${date} · ${time}`;
}

/**
 * Relative "in 2h" / "in 3d" label for the task-list chip. Nullable when
 * the reminder is already past, so callers can hide the chip.
 * `now` is injectable for deterministic tests.
 */
export function formatReminderChip(iso: string, now: number = Date.now()): string | null {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  const diffMs = ts - now;
  if (diffMs <= 0) return null;
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `in ${days}d`;
  const weeks = Math.round(days / 7);
  return `in ${weeks}w`;
}
