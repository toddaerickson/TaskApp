/**
 * Round-trip and formatting tests for the shared reminder helpers.
 *
 * The home-screen alarm sheet and the routine-detail editor both read
 * and write the same `routines.reminder_days` CSV column, so drift in
 * parseDays/daysCsv would surface as "set M/W/F in one screen, other
 * shows something different."
 */
import {
  DAYS, parseDays, daysCsv, formatReminder, formatTime12h,
} from '@/lib/reminders';

describe('parseDays', () => {
  it('returns empty set for null / undefined / empty', () => {
    expect(parseDays(null).size).toBe(0);
    expect(parseDays(undefined).size).toBe(0);
    expect(parseDays('').size).toBe(0);
  });

  it('expands "daily" to all 7 days', () => {
    const s = parseDays('daily');
    expect(s.size).toBe(7);
    for (const d of DAYS) expect(s.has(d)).toBe(true);
  });

  it('parses comma-separated subsets', () => {
    const s = parseDays('mon,wed,fri');
    expect(Array.from(s).sort()).toEqual(['fri', 'mon', 'wed']);
  });

  it('is case-insensitive and trims whitespace', () => {
    const s = parseDays(' MON , Wed ,FRI ');
    expect(Array.from(s).sort()).toEqual(['fri', 'mon', 'wed']);
  });

  it('silently drops unknown tokens', () => {
    // Bad data on the wire shouldn't crash the client. Unknown entries
    // (e.g. from a future schema bump) are dropped, not passed through.
    const s = parseDays('mon,funday,wed');
    expect(Array.from(s).sort()).toEqual(['mon', 'wed']);
  });
});

describe('daysCsv', () => {
  it('returns null for the empty set', () => {
    expect(daysCsv(new Set())).toBeNull();
  });

  it('collapses all 7 to "daily"', () => {
    expect(daysCsv(new Set(DAYS))).toBe('daily');
  });

  it('serializes subsets in canonical order', () => {
    // Even if callers insert in random order, the CSV is stable. Makes
    // dirty-checking (old === new) reliable.
    expect(daysCsv(new Set(['fri', 'mon', 'wed']) as Set<any>)).toBe('mon,wed,fri');
  });
});

describe('parseDays / daysCsv round-trip', () => {
  it('preserves every subset', () => {
    const cases = ['daily', 'mon', 'mon,tue', 'sat,sun', 'mon,wed,fri'];
    for (const csv of cases) {
      expect(daysCsv(parseDays(csv))).toBe(csv === 'mon,tue,wed,thu,fri,sat,sun' ? 'daily' : csv);
    }
  });
});

describe('formatTime12h', () => {
  it('formats morning times', () => {
    expect(formatTime12h('07:00')).toBe('7:00 AM');
    expect(formatTime12h('00:30')).toBe('12:30 AM');
  });

  it('formats afternoon times', () => {
    expect(formatTime12h('12:00')).toBe('12:00 PM');
    expect(formatTime12h('18:30')).toBe('6:30 PM');
    expect(formatTime12h('23:59')).toBe('11:59 PM');
  });

  it('returns input unchanged on malformed strings', () => {
    expect(formatTime12h('invalid')).toBe('invalid');
    expect(formatTime12h('25:00')).toBe('25:00');
    expect(formatTime12h('7:00 AM')).toBe('7:00 AM');
  });
});

describe('formatReminder', () => {
  it('returns null when time is missing', () => {
    expect(formatReminder(null, 'daily')).toBeNull();
    expect(formatReminder('', 'mon,wed')).toBeNull();
  });

  it('returns null when no days are selected', () => {
    expect(formatReminder('07:00', null)).toBeNull();
    expect(formatReminder('07:00', '')).toBeNull();
  });

  it('renders Daily for all 7', () => {
    expect(formatReminder('07:00', 'daily')).toBe('Daily · 7:00 AM');
  });

  it('renders subsets with capitalized day names', () => {
    expect(formatReminder('18:30', 'mon,wed,fri')).toBe('Mon · Wed · Fri · 6:30 PM');
  });
});
