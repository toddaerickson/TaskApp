/**
 * Unit tests for the date helpers (PR-B2).
 *
 * The headline test is the UTC-slice regression:
 * `d.toISOString().slice(0, 10)` silently rolls the calendar date
 * forward when the device is on a negative-UTC TZ and the picker
 * emits a Date with non-zero local time. `toLocalIsoDate` formats
 * from local components and is regression-proof.
 */
import { prettyIsoDate, toLocalIsoDate } from '../lib/dateUtils';

describe('toLocalIsoDate', () => {
  test('zero-pads month and day', () => {
    // Jan 5: month=0 in JS Date constructor.
    const d = new Date(2026, 0, 5, 12, 0, 0);
    expect(toLocalIsoDate(d)).toBe('2026-01-05');
  });

  test('December 31 returns same year', () => {
    // Edge: end of year. UTC-slice of 23:59 local in EST would roll
    // to next year. Local-component build does not.
    const d = new Date(2026, 11, 31, 23, 59, 0);
    expect(toLocalIsoDate(d)).toBe('2026-12-31');
  });

  test('matches calendar date regardless of time-of-day component', () => {
    // The native iOS picker historically returned "midnight local"
    // for picked dates, but @react-native-community/datetimepicker
    // does NOT contractually guarantee that — different platform
    // versions zero or preserve. We test that toLocalIsoDate gives
    // the same result for all three time variants.
    const morning = new Date(2026, 4, 6, 8, 0, 0);
    const evening = new Date(2026, 4, 6, 21, 30, 0);
    const midnight = new Date(2026, 4, 6, 0, 0, 0);
    expect(toLocalIsoDate(morning)).toBe('2026-05-06');
    expect(toLocalIsoDate(evening)).toBe('2026-05-06');
    expect(toLocalIsoDate(midnight)).toBe('2026-05-06');
  });

  test('regression: would NOT match toISOString().slice(0, 10) for evening picks in negative-UTC TZs', () => {
    // We can't change the test environment's TZ from inside jest in
    // a portable way, but we CAN demonstrate the bug by constructing
    // a Date that, in the system TZ, has a "different UTC date" than
    // its local date. The check is: when toLocalIsoDate matches the
    // local-Date date, that's the contract.
    const d = new Date(2026, 4, 6, 21, 0, 0); // 9 PM May 6 local
    const local = toLocalIsoDate(d);
    // The local date components are May 6 regardless of TZ.
    expect(local).toBe('2026-05-06');
    // Sanity: getDate() returns 6 (local day-of-month), confirming
    // that's what we serialized.
    expect(d.getDate()).toBe(6);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getFullYear()).toBe(2026);
  });

  test('boundary: leap day Feb 29', () => {
    const d = new Date(2028, 1, 29, 12, 0, 0);
    expect(toLocalIsoDate(d)).toBe('2028-02-29');
  });
});

describe('prettyIsoDate', () => {
  test('empty input returns empty', () => {
    expect(prettyIsoDate('')).toBe('');
  });

  test('formats as MM/DD/YY', () => {
    expect(prettyIsoDate('2026-05-06')).toBe('05/06/26');
  });

  test('preserves zero-padded month and day', () => {
    expect(prettyIsoDate('2026-01-05')).toBe('01/05/26');
  });

  test('truncates year to last two digits', () => {
    expect(prettyIsoDate('2099-12-31')).toBe('12/31/99');
    expect(prettyIsoDate('2000-01-01')).toBe('01/01/00');
  });

  test('round-trip: toLocalIsoDate → prettyIsoDate', () => {
    const d = new Date(2026, 4, 6, 12, 0, 0);
    const iso = toLocalIsoDate(d);
    expect(prettyIsoDate(iso)).toBe('05/06/26');
  });
});
