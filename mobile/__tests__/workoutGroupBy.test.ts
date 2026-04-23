import { bucketRoutines } from '../lib/workoutGroupBy';
import type { Routine, RoutineExercise } from '../lib/stores';

function mkRoutine(overrides: Partial<Routine> & { id: number; name: string }): Routine {
  return {
    id: overrides.id,
    user_id: 1,
    name: overrides.name,
    goal: overrides.goal ?? 'general',
    notes: undefined,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    reminder_time: overrides.reminder_time,
    reminder_days: overrides.reminder_days,
    tracks_symptoms: false,
    updated_at: null,
    exercises: [] as RoutineExercise[],
  };
}

describe('bucketRoutines — goal', () => {
  it('clusters routines by goal in canonical order', () => {
    const routines = [
      mkRoutine({ id: 1, name: 'Rehab A', goal: 'rehab' }),
      mkRoutine({ id: 2, name: 'Mobility A', goal: 'mobility' }),
      mkRoutine({ id: 3, name: 'Rehab B', goal: 'rehab' }),
      mkRoutine({ id: 4, name: 'General A', goal: 'general' }),
    ];
    const out = bucketRoutines(routines, 'goal', new Map(), new Date('2026-04-21'));
    expect(out.map((b) => b.key)).toEqual(['general', 'mobility', 'rehab']);
    expect(out.find((b) => b.key === 'rehab')!.items).toHaveLength(2);
  });
});

describe('bucketRoutines — day', () => {
  it('duplicates a multi-day routine into each day bucket', () => {
    const routines = [
      mkRoutine({ id: 1, name: 'MonWed', reminder_days: 'mon,wed' }),
      mkRoutine({ id: 2, name: 'Wed only', reminder_days: 'wed' }),
    ];
    const out = bucketRoutines(routines, 'day', new Map(), new Date('2026-04-21'));
    expect(out.map((b) => b.key)).toEqual(['mon', 'wed']);
    expect(out[0].items.map((r) => r.name)).toEqual(['MonWed']);
    expect(out[1].items.map((r) => r.name)).toEqual(['MonWed', 'Wed only']);
  });

  it('puts routines with no reminder_days into "No day"', () => {
    const routines = [
      mkRoutine({ id: 1, name: 'Tue', reminder_days: 'tue' }),
      mkRoutine({ id: 2, name: 'Unscheduled' }),
    ];
    const out = bucketRoutines(routines, 'day', new Map(), new Date('2026-04-21'));
    expect(out[out.length - 1]).toEqual(
      expect.objectContaining({ key: 'none', label: 'No day' }),
    );
    expect(out[out.length - 1].items.map((r) => r.name)).toEqual(['Unscheduled']);
  });
});

describe('bucketRoutines — lastPerformed', () => {
  const now = new Date('2026-04-21T12:00:00Z'); // Tuesday

  it('buckets by today / this_week / this_month / older / never', () => {
    const lastPerformed = new Map<number, string>([
      [1, '2026-04-21T08:00:00Z'], // today
      [2, '2026-04-20T08:00:00Z'], // this week (Monday, same week)
      [3, '2026-04-10T08:00:00Z'], // this month
      [4, '2026-03-10T08:00:00Z'], // older (>30 days)
      // 5 never performed (not in map)
    ]);
    const routines = [
      mkRoutine({ id: 1, name: 'Today' }),
      mkRoutine({ id: 2, name: 'ThisWeek' }),
      mkRoutine({ id: 3, name: 'ThisMonth' }),
      mkRoutine({ id: 4, name: 'Older' }),
      mkRoutine({ id: 5, name: 'Never' }),
    ];
    const out = bucketRoutines(routines, 'lastPerformed', lastPerformed, now);
    expect(out.map((b) => b.key)).toEqual([
      'today', 'this_week', 'this_month', 'older', 'never',
    ]);
    expect(out[0].items[0].name).toBe('Today');
    expect(out[1].items[0].name).toBe('ThisWeek');
    expect(out[2].items[0].name).toBe('ThisMonth');
    expect(out[3].items[0].name).toBe('Older');
    expect(out[4].items[0].name).toBe('Never');
  });

  it('omits empty buckets so the list doesn\'t show placeholder zeros', () => {
    const routines = [mkRoutine({ id: 1, name: 'Only' })];
    const lastPerformed = new Map<number, string>([[1, '2026-04-21T10:00:00Z']]);
    const out = bucketRoutines(routines, 'lastPerformed', lastPerformed, now);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('today');
  });
});
