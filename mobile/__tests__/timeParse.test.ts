/**
 * Unit tests for the military-time parser + slot helpers (PR-B3).
 *
 * Spec gates from the multi-agent plan review:
 *   - Silent-killer I1: strict 3- or 4-digit only, no overflow,
 *     reject ambiguous "900"/"30"/"2400"/"2360"
 *   - Architect I5: strict reject on overflow, no silent rolling
 *   - UI I1: free-form must accept any 00:00-23:59 (so the 6am-9pm
 *     slot range is a soft scroll position, not a hard bound)
 */
import {
  DEFAULT_SLOTS_06_TO_2130,
  findExactSlot,
  formatTime12,
  parseMilitaryTime,
} from '../lib/timeParse';

describe('parseMilitaryTime', () => {
  describe('happy path', () => {
    test('4-digit standard: 2100 → 21:00', () => {
      expect(parseMilitaryTime('2100')).toBe('21:00');
    });

    test('4-digit AM: 0900 → 09:00', () => {
      expect(parseMilitaryTime('0900')).toBe('09:00');
    });

    test('midnight: 0000 → 00:00', () => {
      expect(parseMilitaryTime('0000')).toBe('00:00');
    });

    test('end of day: 2359 → 23:59', () => {
      expect(parseMilitaryTime('2359')).toBe('23:59');
    });

    test('with colon: 9:00 → 09:00', () => {
      expect(parseMilitaryTime('9:00')).toBe('09:00');
    });

    test('with colon: 21:00 → 21:00', () => {
      expect(parseMilitaryTime('21:00')).toBe('21:00');
    });

    test('3-digit pads: 900 → 09:00', () => {
      expect(parseMilitaryTime('900')).toBe('09:00');
    });

    test('whitespace trimmed: "  2100  " → 21:00', () => {
      expect(parseMilitaryTime('  2100  ')).toBe('21:00');
    });
  });

  describe('rejections (silent-killer I1)', () => {
    test('empty', () => { expect(parseMilitaryTime('')).toBeNull(); });
    test('whitespace only', () => { expect(parseMilitaryTime('   ')).toBeNull(); });
    test('1-digit "0"', () => { expect(parseMilitaryTime('0')).toBeNull(); });
    test('1-digit "9"', () => { expect(parseMilitaryTime('9')).toBeNull(); });
    test('2-digit "30"', () => { expect(parseMilitaryTime('30')).toBeNull(); });
    test('2-digit "21"', () => { expect(parseMilitaryTime('21')).toBeNull(); });
    test('5-digit "21000"', () => { expect(parseMilitaryTime('21000')).toBeNull(); });
    test('hour overflow "2400"', () => { expect(parseMilitaryTime('2400')).toBeNull(); });
    test('hour overflow "2500"', () => { expect(parseMilitaryTime('2500')).toBeNull(); });
    test('minute overflow "2360"', () => { expect(parseMilitaryTime('2360')).toBeNull(); });
    test('minute overflow "0099"', () => { expect(parseMilitaryTime('0099')).toBeNull(); });
    test('non-digit "abc"', () => { expect(parseMilitaryTime('abc')).toBeNull(); });
    test('non-digit "21pm"', () => { expect(parseMilitaryTime('21pm')).toBeNull(); });
    test('multiple colons "21:00:00"', () => { expect(parseMilitaryTime('21:00:00')).toBeNull(); });
    test('non-string null', () => { expect(parseMilitaryTime(null as any)).toBeNull(); });
    test('non-string undefined', () => { expect(parseMilitaryTime(undefined as any)).toBeNull(); });
  });

  describe('boundary acceptance (UI I1: full 24h range allowed)', () => {
    test('5 AM workout: 0530', () => {
      expect(parseMilitaryTime('0530')).toBe('05:30');
    });

    test('10 PM med reminder: 2200', () => {
      expect(parseMilitaryTime('2200')).toBe('22:00');
    });

    test('11:59 PM: 2359', () => {
      expect(parseMilitaryTime('2359')).toBe('23:59');
    });
  });
});

describe('formatTime12', () => {
  test('midnight: 00:00 → 12:00 AM', () => {
    expect(formatTime12('00:00')).toBe('12:00 AM');
  });

  test('noon: 12:00 → 12:00 PM', () => {
    expect(formatTime12('12:00')).toBe('12:00 PM');
  });

  test('AM slot: 06:00 → 6:00 AM', () => {
    expect(formatTime12('06:00')).toBe('6:00 AM');
  });

  test('PM slot: 21:30 → 9:30 PM', () => {
    expect(formatTime12('21:30')).toBe('9:30 PM');
  });

  test('1 AM: 01:00 → 1:00 AM', () => {
    expect(formatTime12('01:00')).toBe('1:00 AM');
  });

  test('11:59 PM: 23:59 → 11:59 PM', () => {
    expect(formatTime12('23:59')).toBe('11:59 PM');
  });

  test('malformed input passes through', () => {
    expect(formatTime12('garbage')).toBe('garbage');
  });
});

describe('DEFAULT_SLOTS_06_TO_2130', () => {
  test('starts at 06:00', () => {
    expect(DEFAULT_SLOTS_06_TO_2130[0]).toBe('06:00');
  });

  test('ends at 21:30', () => {
    expect(DEFAULT_SLOTS_06_TO_2130[DEFAULT_SLOTS_06_TO_2130.length - 1]).toBe('21:30');
  });

  test('count: 32 slots (16 hours × 2)', () => {
    // 06:00, 06:30, 07:00, ... 21:30 = (21-6+1)*2 = 32
    expect(DEFAULT_SLOTS_06_TO_2130.length).toBe(32);
  });

  test('includes morning workout slot 07:00', () => {
    expect(DEFAULT_SLOTS_06_TO_2130).toContain('07:00');
  });

  test('includes evening reminder slot 21:00', () => {
    expect(DEFAULT_SLOTS_06_TO_2130).toContain('21:00');
  });

  test('does NOT include early-morning 05:00 (parser handles it)', () => {
    expect(DEFAULT_SLOTS_06_TO_2130).not.toContain('05:00');
  });

  test('does NOT include late-night 22:00 (parser handles it)', () => {
    expect(DEFAULT_SLOTS_06_TO_2130).not.toContain('22:00');
  });
});

describe('findExactSlot', () => {
  test('returns slot when present', () => {
    expect(findExactSlot('06:00', DEFAULT_SLOTS_06_TO_2130)).toBe('06:00');
    expect(findExactSlot('21:30', DEFAULT_SLOTS_06_TO_2130)).toBe('21:30');
  });

  test('returns null when outside range', () => {
    expect(findExactSlot('05:00', DEFAULT_SLOTS_06_TO_2130)).toBeNull();
    expect(findExactSlot('22:00', DEFAULT_SLOTS_06_TO_2130)).toBeNull();
  });

  test('returns null for off-grid time within range', () => {
    expect(findExactSlot('07:15', DEFAULT_SLOTS_06_TO_2130)).toBeNull();
  });
});
