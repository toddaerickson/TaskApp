import {
  MissedReminder,
  dismissKey,
  filterDismissed,
  localDateKey,
} from '@/lib/missedReminders';

const mk = (id: number, name = 'X'): MissedReminder => ({
  routine_id: id,
  name,
  goal: 'mobility',
  reminder_time: '07:00',
  expected_at: '2026-04-28T11:00:00Z',
});

describe('dismissKey', () => {
  test('namespaces by prefix + routine + date', () => {
    expect(dismissKey(42, '2026-04-28')).toBe(
      'missed_reminder_dismissed:42:2026-04-28',
    );
  });

  test('different dates produce different keys (so yesterday\'s dismiss does not suppress today)', () => {
    expect(dismissKey(1, '2026-04-27')).not.toBe(dismissKey(1, '2026-04-28'));
  });

  test('different routines produce different keys', () => {
    expect(dismissKey(1, '2026-04-28')).not.toBe(dismissKey(2, '2026-04-28'));
  });
});

describe('localDateKey', () => {
  test('formats YYYY-MM-DD with zero-padded month and day', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('filterDismissed', () => {
  test('empty dismiss set returns input unchanged', () => {
    const reminders = [mk(1), mk(2), mk(3)];
    expect(filterDismissed(reminders, new Set(), '2026-04-28')).toEqual(reminders);
  });

  test('drops dismissed routine ids for the given date', () => {
    const reminders = [mk(1), mk(2), mk(3)];
    const dismissed = new Set([dismissKey(2, '2026-04-28')]);
    const out = filterDismissed(reminders, dismissed, '2026-04-28');
    expect(out.map((m) => m.routine_id)).toEqual([1, 3]);
  });

  test('a dismiss for a different date does not suppress today', () => {
    const reminders = [mk(1)];
    const dismissed = new Set([dismissKey(1, '2026-04-27')]); // yesterday
    expect(filterDismissed(reminders, dismissed, '2026-04-28')).toHaveLength(1);
  });

  test('all dismissed → empty list', () => {
    const reminders = [mk(1), mk(2)];
    const dismissed = new Set([
      dismissKey(1, '2026-04-28'),
      dismissKey(2, '2026-04-28'),
    ]);
    expect(filterDismissed(reminders, dismissed, '2026-04-28')).toEqual([]);
  });
});
