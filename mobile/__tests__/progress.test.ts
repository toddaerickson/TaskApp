import {
  aggregateByExercise, weeklyCounts,
  metricSeries, availableMetrics, filterByRange,
} from '../lib/progress';
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
    expect(stats[0].points).toHaveLength(1);
    expect(stats[0].points[0]).toEqual(expect.objectContaining({
      date: '2026-04-10', value: 13, setCount: 2,
    }));
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
  // Pass an explicit `now` to every call. The prior test mocked
  // `Date.now()` via jest.spyOn, but `new Date()` in V8 doesn't route
  // through Date.now — it reads the clock via a C++ primitive — so the
  // spy was a no-op and the suite only passed when the real wall clock
  // happened to fall in the same Monday-week as FIXED_NOW.
  const FIXED_NOW = new Date('2026-04-15T10:00:00Z'); // Wednesday

  it('returns requested number of weeks', () => {
    const buckets = weeklyCounts([], 8, FIXED_NOW);
    expect(buckets).toHaveLength(8);
  });

  it('defaults to 12 weeks', () => {
    expect(weeklyCounts([], undefined, FIXED_NOW)).toHaveLength(12);
  });

  it('buckets a session into the current week', () => {
    const sessions = [mkSession(1, '2026-04-14T08:00:00Z', [])]; // Tue this week
    const buckets = weeklyCounts(sessions, 4, FIXED_NOW);
    // Last bucket = current week
    expect(buckets[buckets.length - 1].count).toBe(1);
    expect(buckets.slice(0, -1).every((b) => b.count === 0)).toBe(true);
  });

  it('buckets a session into the right past week', () => {
    // 15 days ago from fixed now (2026-04-15 Wed) → 2026-03-31 Tue, two full weeks back.
    const sessions = [mkSession(1, '2026-03-31T10:00:00Z', [])];
    const buckets = weeklyCounts(sessions, 4, FIXED_NOW);
    // Fixed now is Wed 4/15. Current-week Monday is 4/13. Two weeks back = 3/30.
    // Session on 3/31 falls into the 3/30 bucket (week index len-3 of 4).
    expect(buckets[buckets.length - 3].count).toBe(1);
  });

  it('ignores sessions older than the window', () => {
    const sessions = [mkSession(1, '2025-01-01T08:00:00Z', [])];
    const buckets = weeklyCounts(sessions, 4, FIXED_NOW);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(0);
  });
});

describe('aggregateByExercise PR markers', () => {
  it('flags a day as PR when its value is the running max', () => {
    const ex = { ...mkExercise(1, 'Bridge') };
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [{ exercise_id: 1, reps: 10 }]),
      mkSession(2, '2026-04-11T08:00:00Z', [{ exercise_id: 1, reps: 9 }]),
      mkSession(3, '2026-04-12T08:00:00Z', [{ exercise_id: 1, reps: 13 }]),
    ];
    const pts = aggregateByExercise(sessions, [ex])[0].points;
    expect(pts.map((p) => !!p.pr)).toEqual([true, false, true]);
  });
});

describe('metricSeries', () => {
  it('returns empty for an exercise with no data', () => {
    expect(metricSeries([], 1, 'reps')).toEqual([]);
  });

  it('picks the max reps per day', () => {
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, reps: 8 },
        { exercise_id: 1, reps: 12 },
      ]),
    ];
    const series = metricSeries(sessions, 1, 'reps');
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(12);
    expect(series[0].pr).toBe(true);
  });

  it('flags pain "new low" days instead of new-max', () => {
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [{ exercise_id: 1, pain_score: 5 }]),
      mkSession(2, '2026-04-11T08:00:00Z', [{ exercise_id: 1, pain_score: 3 }]),
      mkSession(3, '2026-04-12T08:00:00Z', [{ exercise_id: 1, pain_score: 4 }]),
      mkSession(4, '2026-04-13T08:00:00Z', [{ exercise_id: 1, pain_score: 2 }]),
    ];
    const series = metricSeries(sessions, 1, 'pain');
    expect(series.map((p) => !!p.pr)).toEqual([true, true, false, true]);
  });

  it('picks the worst (max) pain of the day', () => {
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, pain_score: 2 },
        { exercise_id: 1, pain_score: 6 },
        { exercise_id: 1, pain_score: 4 },
      ]),
    ];
    expect(metricSeries(sessions, 1, 'pain')[0].value).toBe(6);
  });

  it('ignores other exercises', () => {
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, reps: 10 },
        { exercise_id: 2, reps: 99 },
      ]),
    ];
    const series = metricSeries(sessions, 1, 'reps');
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(10);
  });
});

describe('availableMetrics', () => {
  it('returns empty when no sets', () => {
    expect(availableMetrics([], 1)).toEqual([]);
  });

  it('returns only metrics with at least one value', () => {
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, reps: 8, duration_sec: 30 },
      ]),
    ];
    expect(availableMetrics(sessions, 1)).toEqual(['reps', 'duration']);
  });

  it('includes pain when any set has pain_score, even zero', () => {
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, reps: 8, pain_score: 0 },
      ]),
    ];
    expect(availableMetrics(sessions, 1)).toEqual(['reps', 'pain']);
  });

  it('ignores metrics with only non-positive values', () => {
    const sessions = [
      mkSession(1, '2026-04-10T08:00:00Z', [
        { exercise_id: 1, reps: 0, weight: 0 },
      ]),
    ];
    expect(availableMetrics(sessions, 1)).toEqual([]);
  });
});

describe('filterByRange', () => {
  const now = new Date('2026-04-20T12:00:00Z');
  const points = [
    { date: '2026-03-01', value: 5, setCount: 1 },
    { date: '2026-04-01', value: 6, setCount: 1 },
    { date: '2026-04-19', value: 7, setCount: 1 },
    { date: '2026-04-20', value: 8, setCount: 1 },
  ];

  it('keeps points within the last N days', () => {
    const last30 = filterByRange(points, 30, now);
    expect(last30.map((p) => p.date)).toEqual(['2026-04-01', '2026-04-19', '2026-04-20']);
  });

  it('returns all points when days <= 0', () => {
    expect(filterByRange(points, 0, now)).toEqual(points);
    expect(filterByRange(points, -5, now)).toEqual(points);
  });

  it('returns the full list when everything is in-window', () => {
    expect(filterByRange(points, 365, now)).toEqual(points);
  });
});
