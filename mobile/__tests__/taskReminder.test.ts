import {
  toISO, validateReminderInput, formatReminderRow, formatReminderChip,
} from '../lib/taskReminder';

describe('toISO', () => {
  it('returns an ISO string for valid inputs', () => {
    const iso = toISO('2026-04-20', '14:30');
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('rejects malformed date', () => {
    expect(toISO('2026/04/20', '14:30')).toBeNull();
    expect(toISO('abc', '14:30')).toBeNull();
    expect(toISO('', '14:30')).toBeNull();
  });

  it('rejects malformed time', () => {
    expect(toISO('2026-04-20', '14')).toBeNull();
    expect(toISO('2026-04-20', '25:00')).toBeNull();
    expect(toISO('2026-04-20', '14:61')).toBeNull();
  });

  it('rejects overflow dates that Date() would silently accept', () => {
    // Feb 31 → Mar 3 via Date(); must not leak through.
    expect(toISO('2026-02-31', '10:00')).toBeNull();
    expect(toISO('2026-13-01', '10:00')).toBeNull();
  });
});

describe('validateReminderInput', () => {
  it('rejects empty inputs with actionable errors', () => {
    expect(validateReminderInput('', '')).toEqual({
      ok: false, error: 'Pick a date and a time.',
    });
    expect(validateReminderInput('', '14:30')).toEqual({
      ok: false, error: 'Pick a date.',
    });
    expect(validateReminderInput('2026-04-20', '')).toEqual({
      ok: false, error: 'Pick a time.',
    });
  });

  it('rejects bad formats', () => {
    const r1 = validateReminderInput('20/04/2026', '14:30');
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/YYYY-MM-DD/);

    const r2 = validateReminderInput('2026-04-20', '2pm');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/HH:MM/);
  });

  it('accepts a valid future reminder without warning', () => {
    // now = 2026-04-20 12:00; reminder = 2026-04-21 09:00
    const now = new Date(2026, 3, 20, 12, 0).getTime();
    const r = validateReminderInput('2026-04-21', '09:00', now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.iso).toBeTruthy();
      expect(r.warning).toBeUndefined();
    }
  });

  it('accepts a past reminder but flags it with a warning', () => {
    const now = new Date(2026, 3, 20, 12, 0).getTime();
    const r = validateReminderInput('2026-04-19', '09:00', now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warning).toMatch(/already passed/);
  });
});

describe('formatReminderRow', () => {
  it('renders a date + time label', () => {
    const iso = new Date(2026, 3, 20, 15, 45).toISOString();
    const out = formatReminderRow(iso);
    // Format depends on locale, but the interpunct separator and the day
    // number should always appear.
    expect(out).toContain('·');
    expect(out).toContain('20');
  });

  it('returns the input string unchanged for bad ISO', () => {
    expect(formatReminderRow('not-a-date')).toBe('not-a-date');
  });
});

describe('formatReminderChip', () => {
  const now = new Date(2026, 3, 20, 12, 0).getTime();

  it('returns null for past reminders', () => {
    const past = new Date(2026, 3, 20, 11, 0).toISOString();
    expect(formatReminderChip(past, now)).toBeNull();
  });

  it('formats minutes', () => {
    const soon = new Date(2026, 3, 20, 12, 30).toISOString();
    expect(formatReminderChip(soon, now)).toBe('in 30m');
  });

  it('formats hours', () => {
    const later = new Date(2026, 3, 20, 15, 0).toISOString();
    expect(formatReminderChip(later, now)).toBe('in 3h');
  });

  it('formats days', () => {
    const tomorrow = new Date(2026, 3, 22, 12, 0).toISOString();
    expect(formatReminderChip(tomorrow, now)).toBe('in 2d');
  });

  it('formats weeks', () => {
    const nextMonth = new Date(2026, 4, 11, 12, 0).toISOString();
    expect(formatReminderChip(nextMonth, now)).toBe('in 3w');
  });
});
