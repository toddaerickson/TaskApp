/**
 * Date helpers shared by `DateField` (the picker UI) and any future
 * date-formatting code. Pure functions — no RN imports — so they
 * live in `node-libs` jest project for fast unit tests.
 *
 * Why this module exists: the previous in-component implementation of
 * the native picker's onChange did `d.toISOString().slice(0, 10)` to
 * derive the stored `YYYY-MM-DD`. That converts to UTC, which can roll
 * the calendar date forward across the device's TZ boundary —
 * silently storing tomorrow's date when the user picks "today" in the
 * evening on a negative-UTC TZ. Replaced with `toLocalIsoDate()`
 * below, which composes the string from the Date's local components.
 */

/**
 * Build `YYYY-MM-DD` from a Date using the device's local TZ
 * components. Round-trips with HTML's `<input type="date">` value
 * (which is also TZ-naive) and with PG's `DATE` column.
 *
 * Don't use `d.toISOString().slice(0, 10)` — that converts to UTC
 * first, which silently shifts the calendar date for any Date whose
 * local hours are non-zero in a TZ with a negative-UTC offset (e.g.
 * picking "May 6" at 9 PM ET when the picker preserves the current
 * time-of-day rather than zeroing it).
 */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format a stored `YYYY-MM-DD` (TZ-naive) as `MM/DD/YY` for compact
 * display next to the picker trigger. Returns empty string for empty
 * input so callers can render the placeholder.
 */
export function prettyIsoDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}
