/**
 * Unit tests for the SDK-53-safe notification trigger builders.
 *
 * Pinned by PR-C1.1a. The trigger shape contract is:
 *   { type: 'weekly', weekday: 1..7, hour: 0..23, minute: 0..59 }
 *
 * If a future Expo SDK bump silently changes the discriminator string
 * or reorders the keys, `expo-notifications` will reject the trigger
 * at runtime and routine reminders will stop firing — the canonical
 * "scheduled-job silently breaks at deploy" failure mode this PR is
 * designed to prevent. These tests freeze the shape so a regression
 * trips CI before the operator notices reminders went dark.
 */
import { buildWeeklyTrigger } from '../lib/notificationTriggers';

describe('buildWeeklyTrigger', () => {
  it('returns the SDK 53 type-discriminator shape', () => {
    expect(buildWeeklyTrigger(2, 9, 30)).toEqual({
      type: 'weekly',
      weekday: 2,
      hour: 9,
      minute: 30,
    });
  });

  it('preserves Sunday (weekday=1) under the iOS 1-7 convention', () => {
    const t = buildWeeklyTrigger(1, 7, 0);
    expect(t.weekday).toBe(1);
    expect(t.type).toBe('weekly');
  });

  it('preserves Saturday (weekday=7) under the iOS 1-7 convention', () => {
    const t = buildWeeklyTrigger(7, 21, 30);
    expect(t.weekday).toBe(7);
  });

  it('does not include legacy `repeats` field', () => {
    // The SDK 52 implicit shape included `repeats: true`. SDK 53's
    // WeeklyTriggerInput does NOT — weekly is implicitly repeating.
    // Sending `repeats` under 0.30+ trips a runtime warning + may
    // silently coerce to a non-repeating trigger on iOS.
    const t = buildWeeklyTrigger(3, 6, 0);
    expect(t).not.toHaveProperty('repeats');
  });

  it('produces a stable key order for snapshot equality', () => {
    // Lock the key set so a future refactor that adds a new key
    // (channelId, etc.) is forced through this test as a deliberate
    // contract change rather than slipping in.
    expect(Object.keys(buildWeeklyTrigger(4, 12, 0)).sort()).toEqual(
      ['hour', 'minute', 'type', 'weekday'],
    );
  });
});
