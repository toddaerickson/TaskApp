import {
  diffSetEdit, isDirty, toEditString, SetEditFields,
} from '@/lib/sessionSetEdit';

const blank: SetEditFields = {
  reps: '', weight: '', duration_sec: '',
  rpe: '', pain_score: '', notes: '',
};

describe('toEditString', () => {
  test('null becomes empty string', () => {
    expect(toEditString(null)).toBe('');
  });
  test('undefined becomes empty string', () => {
    expect(toEditString(undefined)).toBe('');
  });
  test('number roundtrips', () => {
    expect(toEditString(12)).toBe('12');
  });
  test('zero is rendered as "0", not blank', () => {
    // A zero pain score is a legitimate value (pain-free) and must
    // survive the edit roundtrip rather than being treated as "unset."
    expect(toEditString(0)).toBe('0');
  });
});

describe('diffSetEdit', () => {
  test('no changes returns empty object', () => {
    const initial: SetEditFields = { ...blank, reps: '10' };
    expect(diffSetEdit(initial, { ...initial })).toEqual({});
  });

  test('single field change returns only that field', () => {
    const initial: SetEditFields = { ...blank, reps: '8', weight: '50' };
    const current: SetEditFields = { ...initial, reps: '10' };
    expect(diffSetEdit(initial, current)).toEqual({ reps: 10 });
  });

  test('clearing a field sends null, not empty string', () => {
    const initial: SetEditFields = { ...blank, reps: '8' };
    const current: SetEditFields = { ...blank, reps: '' };
    expect(diffSetEdit(initial, current)).toEqual({ reps: null });
  });

  test('multiple field changes all surface', () => {
    const initial: SetEditFields = { ...blank, reps: '8', weight: '50', rpe: '6' };
    const current: SetEditFields = { ...blank, reps: '10', weight: '55', rpe: '6' };
    expect(diffSetEdit(initial, current)).toEqual({ reps: 10, weight: 55 });
  });

  test('notes change sends the string (or null if cleared)', () => {
    const initial: SetEditFields = { ...blank, notes: 'felt heavy' };
    expect(diffSetEdit(initial, { ...initial, notes: 'felt good' }))
      .toEqual({ notes: 'felt good' });
    expect(diffSetEdit(initial, { ...initial, notes: '' }))
      .toEqual({ notes: null });
  });

  test('typed-then-reverted produces no diff', () => {
    // Same behaviour as the dose chip editor's initial-value snapshot
    // (#46) — a user who types then reverts shouldn't bump updated_at
    // and 409 other clients.
    const initial: SetEditFields = { ...blank, reps: '10' };
    const current: SetEditFields = { ...initial };
    expect(diffSetEdit(initial, current)).toEqual({});
  });
});

describe('isDirty', () => {
  test('identical state is clean', () => {
    const s: SetEditFields = { ...blank, reps: '10' };
    expect(isDirty(s, { ...s })).toBe(false);
  });

  test('any field change marks dirty', () => {
    const initial: SetEditFields = { ...blank, reps: '10' };
    expect(isDirty(initial, { ...initial, reps: '11' })).toBe(true);
    expect(isDirty(initial, { ...initial, notes: 'x' })).toBe(true);
  });
});
