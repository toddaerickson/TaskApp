import { tokenizeDose, joinDoseLabels } from '../lib/doseTokens';

describe('tokenizeDose', () => {
  it('returns an empty list when no dose fields are set', () => {
    expect(tokenizeDose({})).toEqual([]);
  });

  it('combines sets and reps into a single work token', () => {
    expect(tokenizeDose({ target_sets: 3, target_reps: 15 })).toEqual([
      { kind: 'work', label: '3×15' },
    ]);
  });

  it('combines sets and duration into a single work token', () => {
    expect(tokenizeDose({ target_sets: 3, target_duration_sec: 30 })).toEqual([
      { kind: 'work', label: '3×30s' },
    ]);
  });

  it('prefers reps over duration when both are present', () => {
    // Exercises are either reps- or duration-measured; if both creep in,
    // reps wins at display time (matches the legacy formatTarget order).
    expect(
      tokenizeDose({ target_sets: 3, target_reps: 10, target_duration_sec: 30 }),
    ).toEqual([{ kind: 'work', label: '3×10' }]);
  });

  it('renders reps alone when sets are omitted', () => {
    expect(tokenizeDose({ target_reps: 15 })).toEqual([{ kind: 'work', label: '15' }]);
  });

  it('renders duration alone when sets are omitted', () => {
    expect(tokenizeDose({ target_duration_sec: 60 })).toEqual([
      { kind: 'work', label: '60s' },
    ]);
  });

  it('emits weight, tempo, and rest tokens in a stable order', () => {
    const tokens = tokenizeDose({
      target_sets: 3, target_reps: 8, target_weight: 50, tempo: '3-1-3', rest_sec: 45,
    });
    expect(tokens).toEqual([
      { kind: 'work', label: '3×8' },
      { kind: 'weight', label: '@50lb' },
      { kind: 'tempo', label: 'tempo 3-1-3' },
      { kind: 'rest', label: 'rest 45s' },
    ]);
  });

  it('treats nulls the same as undefined', () => {
    expect(
      tokenizeDose({
        target_sets: null, target_reps: null, target_duration_sec: null,
        target_weight: null, tempo: null, rest_sec: null,
      }),
    ).toEqual([]);
  });

  it('skips zero values — a zero rest is not a meaningful chip', () => {
    expect(tokenizeDose({ target_sets: 3, target_reps: 10, rest_sec: 0 })).toEqual([
      { kind: 'work', label: '3×10' },
    ]);
  });
});

describe('joinDoseLabels', () => {
  it('joins tokens with the middle-dot separator used in the UI', () => {
    const joined = joinDoseLabels([
      { kind: 'work', label: '3×15' },
      { kind: 'rest', label: 'rest 45s' },
    ]);
    expect(joined).toBe('3×15 · rest 45s');
  });

  it('returns an empty string for an empty list', () => {
    expect(joinDoseLabels([])).toBe('');
  });
});
