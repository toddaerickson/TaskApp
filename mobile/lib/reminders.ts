/**
 * Reminder helpers shared between the routine detail editor and the
 * home-screen alarm-icon sheet. Centralizing here means both entry
 * points use exactly the same day-CSV parsing and display formatting,
 * so "daily" stays "daily" everywhere and a user-facing bug can't come
 * from the two screens disagreeing.
 *
 * Wire format on the server (`routines.reminder_days`):
 *   - null         → no reminder days set
 *   - "daily"      → all 7 days
 *   - "mon,wed,fri" → comma-separated lowercase 3-letter codes, any
 *     subset of the week, in any order (normalized to canonical order
 *     on write)
 *
 * `reminder_time` is "HH:MM" 24h, or null when the reminder is off.
 */

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayCode = (typeof DAYS)[number];

const DAY_SET: ReadonlySet<string> = new Set(DAYS);

export function parseDays(csv: string | null | undefined): Set<DayCode> {
  if (!csv) return new Set();
  const norm = csv.toLowerCase().trim();
  if (norm === 'daily') return new Set(DAYS);
  const out = new Set<DayCode>();
  for (const token of norm.split(',')) {
    const t = token.trim();
    if (DAY_SET.has(t)) out.add(t as DayCode);
  }
  return out;
}

/** Canonical wire format. Returns null for empty — server interprets
 *  null as "no days set," which combined with a null time means
 *  "reminder off." Set order-normalized so a round-trip is stable. */
export function daysCsv(set: Set<DayCode>): string | null {
  if (set.size === 0) return null;
  if (set.size === 7) return 'daily';
  return DAYS.filter((d) => set.has(d)).join(',');
}

const DAY_LABEL: Record<DayCode, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

/** Human-readable one-liner for the card / card preview. Returns `null`
 *  when there's nothing to show (no time OR no days). */
export function formatReminder(
  time: string | null | undefined,
  daysStr: string | null | undefined,
): string | null {
  if (!time || !time.trim()) return null;
  const days = parseDays(daysStr);
  if (days.size === 0) return null;

  const dayPart = days.size === 7
    ? 'Daily'
    : DAYS.filter((d) => days.has(d)).map((d) => DAY_LABEL[d]).join(' · ');
  const timePart = formatTime12h(time.trim());
  return `${dayPart} · ${timePart}`;
}

/** "07:00" → "7:00 AM", "14:30" → "2:30 PM". Preserves the input if
 *  it doesn't look like 24h HH:MM. */
export function formatTime12h(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const h24 = Number(m[1]);
  const mm = m[2];
  if (!Number.isFinite(h24) || h24 < 0 || h24 > 23) return time;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${period}`;
}
