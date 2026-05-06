/**
 * Pure helpers for the time picker (PR-B3).
 *
 * The picker accepts two input modes:
 *   1. A 30-minute-slot dropdown anchored at 6:00 AM as the default
 *      scroll position. Lists 6:00 AM through 9:30 PM (32 slots) but
 *      can be overridden via free-form input below.
 *   2. A free-form text input that accepts strict 24-hour military
 *      time ("2100" → 21:00, "0900" → 09:00, "0000" → 00:00).
 *
 * Both modes write the same `HH:MM` (24-hour, zero-padded) string,
 * which is the contract the rest of the codebase already uses
 * (taskReminder.ts, workout/[routineId].tsx routine.reminder_time).
 *
 * TZ note: this module returns wall-clock `HH:MM` only. Combining
 * with a date to produce an ISO timestamp happens in `taskReminder.ts`,
 * which uses `new Date(y, mo, d, h, mi)` — local TZ. For a single-
 * user self-hosted app where the operator is in TASKAPP_TZ on their
 * iPhone, this is correct. Cross-device same-user with a different
 * iPhone TZ is a pre-existing edge case (silent-killer S1) NOT
 * addressed here; surfaced as a known limitation.
 */

/** All 30-minute slots from 06:00 to 21:30, formatted `HH:MM` (24-hour). */
export const DEFAULT_SLOTS_06_TO_2130: readonly string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 21; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
})();

/** Display a `HH:MM` (24-hour) value in 12-hour form for the dropdown
 *  and the trigger button. "21:30" → "9:30 PM"; "06:00" → "6:00 AM". */
export function formatTime12(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  if (h < 0 || h > 23) return hhmm;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${min} ${ampm}`;
}

/**
 * Parse free-form military-time input into a `HH:MM` (24-hour)
 * string, or null if the input is ambiguous / malformed / overflowed.
 *
 * Strict spec (per silent-killer agent I1 + architect agent I5):
 *   - Accept exactly 3 or 4 digits. Pad to 4 with a leading zero
 *     before parsing: "900" → "0900" → 09:00. (Operator-friendly:
 *     dropping a leading zero on AM times is a common typing habit.)
 *   - Optional internal colon: "9:00", "21:00" — colon stripped
 *     before digit count.
 *   - Reject hour > 23: "2400" is NOT midnight — that's "0000".
 *   - Reject minute > 59: "2360" is rejected (no roll-over).
 *   - Reject 2-or-fewer-digit input: "30" / "0" / "9" / "" — too
 *     ambiguous (could be hour-only, could be minute-only, could
 *     be a typo). Forces the operator to be explicit.
 *   - Reject 5+ digits, non-digit chars (other than the optional
 *     colon), and whitespace anywhere except leading/trailing.
 */
export function parseMilitaryTime(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Strip a single colon if present.
  const stripped = trimmed.replace(':', '');
  // Digits only after stripping the colon.
  if (!/^\d+$/.test(stripped)) return null;
  // Pad 3-digit input to 4: "900" → "0900". Reject everything else.
  let digits: string;
  if (stripped.length === 3) digits = '0' + stripped;
  else if (stripped.length === 4) digits = stripped;
  else return null;

  const h = Number(digits.slice(0, 2));
  const m = Number(digits.slice(2, 4));
  if (h < 0 || h > 23) return null;
  if (m < 0 || m > 59) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

/**
 * Snap an arbitrary `HH:MM` value to the nearest available slot in
 * the dropdown. Used to highlight the active row when the operator
 * has typed a custom time that happens to align with a slot.
 * Returns null if the time is outside the slot range.
 */
export function findExactSlot(hhmm: string, slots: readonly string[]): string | null {
  return slots.includes(hhmm) ? hhmm : null;
}
