import { aggregateByExercise, weeklyCounts } from '../lib/progress';
import type { WorkoutSession, Exercise } from '../lib/stores';

function mkExercise(id: number, name: string, measurement = 'reps'): Exercise {
  return {
    id, user_id: null, name, slug: name.toLowerCase(), category: 'strength',
    primary_muscle: '', equipment: '', difficulty: 1,
    is_bodyweight: true, measurement,
    instructions: '', cue: '', contraindications: '',
    images: [],
  };
}

function mkSession(id: number, started_at: string, sets: any[]): WorkoutSession {
  return {
    id, user_id: 1, routine_id: null,
    started_at, ended_at: null, rpe: undefined, mood: undefined,
    notes: undefined,
    sets: sets.map((s, i) => ({
      id: id * 100 + i, session_id: id, set_number: i + 1,
      completed: true, ...s,
    })),
  };
}

describe('aggregateByExercise', () => {
  it('returns empty when no sessions', () => {
    expect(aggregateByExercise([], [mkExercise(1, 'Bridge')])).toEqual([]);
  });

  it('takes the best single-set value per day per exercise', () => {
    const ex = mkExercise(1, 'Bridge');
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, reps: 10 },
        { exercise_id: 1, reps: 13 },  // best for this day
      ]),
    ];
    const stats = aggregateByExercise(sessions, [ex]);
    expect(stats).toHaveLength(1);
    expect(stats[0].points).toEqual([
      { date: '2026-04-10', value: 13, setCount: 2 },
    ]);
  });

  it('sorts points chronologically', () => {
    const ex = mkExercise(1, 'Bridge');
    const sessions = [
      mkSession(2, '2026-04-12T08:00:00Z', [{ exercise_id: 1, reps: 12 }]),
      mkSession(1, '2026-04-10T08:00:00Z', [{ exercise_id: 1, reps: 10 }]),
      mkSession(3, '2026-04-11T08:00:00Z', [{ exercise_id: 1, reps: 11 }]),
    ];
    const stats = aggregateByExercise(sessions, [ex]);
    expect(stats[0].points.map((p) => p.date)).toEqual([
      '2026-04-10', '2026-04-11', '2026-04-12',
    ]);
  });

  it('multiplies weight × reps for strength moves', () => {
    const ex = mkExercise(1, 'Squat', 'reps_weight');
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, reps: 5, weight: 100 },  // 500 — highest tonnage
        { exercise_id: 1, reps: 3, weight: 140 },  // 420
      ]),
    ];
    expect(aggregateByExercise(sessions, [ex])[0].points[0].value).toBe(500);
  });

  it('falls back to duration for timed exercises', () => {
    const ex = mkExercise(1, 'Stretch', 'duration');
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, duration_sec: 90 },
        { exercise_id: 1, duration_sec: 120 },
      ]),
    ];
    expect(aggregateByExercise(sessions, [ex])[0].points[0].value).toBe(120);
  });

  it('sorts exercises by session count desc', () => {
    const a = mkExercise(1, 'A');
    const b = mkExercise(2, 'B');
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [{ exercise_id: 1, reps: 10 }]),
      mkSession(2, '2026-04-11T08:00:00Z', [{ exercise_id: 1, reps: 10 }]),
      mkSession(3, '2026-04-12T08:00:00Z', [{ exercise_id: 2, reps: 10 }]),
    ];
    const stats = aggregateByExercise(sessions, [a, b]);
    expect(stats[0].name).toBe('A'); // 2 sessions
    expect(stats[1].name).toBe('B'); // 1 session
  });

  it('skips sets with no usable value (all null)', () => {
    const ex = mkExercise(1, 'Bridge');
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [{ exercise_id: 1 }]),
    ];
    expect(aggregateByExercise(sessions, [ex])).toEqual([]);
  });

  it('ignores sets whose exercise_id is not in the exercises list', () => {
    const ex = mkExercise(1, 'Bridge');
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 99, reps: 10 },  // unknown
      ]),
    ];
    expect(aggregateByExercise(sessions, [ex])).toEqual([]);
  });
});

describe('weeklyCounts', () => {
  // Freeze Date.now() so tests are deterministic.
  const FIXED_NOW = new Date('2026-04-15T10:00:00Z').getTime(); // Wednesday
  beforeAll(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW));
  afterAll(() => jest.restoreAllMocks());

  it('returns requested number of weeks', () => {
    const buckets = weeklyCounts([], 8);
    expect(buckets).toHaveLength(8);
  });

  it('defaults to 12 weeks', () => {
    expect(weeklyCounts([])).toHaveLength(12);
  });

  it('buckets a session into the current week', () => {
    const sessions = [mkSession(1, '2026-04-14T08:00:00Z', [])]; // Tue this week
    const buckets = weeklyCounts(sessions, 4);
    // Last bucket = current week
    expect(buckets[buckets.length - 1].count).toBe(1);
    expect(buckets.slice(0, -1).every((b) => b.count === 0)).toBe(true);
  });

  it('buckets a session into the right past week', () => {
    // 15 days ago from fixed now (2026-04-15 Wed) → 2026-03-31 Tue, two full weeks back.
    const sessions = [mkSession(1, '2026-03-31T10:00:00Z', [])];
    const buckets = weeklyCounts(sessions, 4);
    // Fixed now is Wed 4/15. Current-week Monday is 4/13. Two weeks back = 3/30.
    // Session on 3/31 falls into the 3/30 bucket (week index len-3 of 4).
    expect(buckets[buckets.length - 3].count).toBe(1);
  });

  it('ignores sessions older than the window', () => {
    const sessions = [mkSession(1, '2025-01-01T08:00:00Z', [])];
    const buckets = weeklyCounts(sessions, 4);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(0);
  });
});
