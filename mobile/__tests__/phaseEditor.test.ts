import {
  validateDurationWeeks, swapPhases, isPhased, countExercisesInPhase,
  reorderPhaseIds,
} from '@/lib/phaseEditor';
import type { RoutinePhase } from '@/lib/stores';

const mkPhase = (id: number, order_idx: number, label = `P${id}`): RoutinePhase => ({
  id, routine_id: 1, label, order_idx, duration_weeks: 2, notes: null,
});

describe('validateDurationWeeks', () => {
  test.each([
    [1, null], [52, null], [520, null],
  ])('accepts %d', (n, expected) => {
    expect(validateDurationWeeks(n).message).toBe(expected);
  });

  test('rejects zero', () => {
    expect(validateDurationWeeks(0).message).toMatch(/at least 1/);
  });

  test('rejects > 520', () => {
    expect(validateDurationWeeks(521).message).toMatch(/520/);
  });

  test('rejects non-integer', () => {
    expect(validateDurationWeeks(2.5).message).toMatch(/whole number/);
  });

  test('rejects non-numeric', () => {
    expect(validateDurationWeeks('two' as unknown).message).toMatch(/number/);
    expect(validateDurationWeeks(null).message).toMatch(/number/);
  });
});

describe('swapPhases', () => {
  test('swaps two rows + rewrites order_idx to array position', () => {
    const phases = [mkPhase(10, 0), mkPhase(20, 1), mkPhase(30, 2)];
    const next = swapPhases(phases, 0, 1);
    expect(next.map((p) => p.id)).toEqual([20, 10, 30]);
    expect(next.map((p) => p.order_idx)).toEqual([0, 1, 2]);
  });

  test('is a no-op when i === j', () => {
    const phases = [mkPhase(10, 0), mkPhase(20, 1)];
    expect(swapPhases(phases, 0, 0)).toBe(phases);
  });

  test('is a no-op when either index is out of range', () => {
    const phases = [mkPhase(10, 0), mkPhase(20, 1)];
    expect(swapPhases(phases, 0, 5)).toBe(phases);
    expect(swapPhases(phases, -1, 1)).toBe(phases);
  });

  test('rewrites order_idx even if the source indices were stale', () => {
    // Server could return phases with gaps (e.g. after a delete before
    // the next reorder). Swap should still produce a contiguous 0..N-1.
    const phases = [mkPhase(10, 0), mkPhase(20, 5), mkPhase(30, 10)];
    const next = swapPhases(phases, 1, 2);
    expect(next.map((p) => p.order_idx)).toEqual([0, 1, 2]);
  });
});

describe('isPhased', () => {
  test('true when phases > 0 AND phase_start_date set', () => {
    expect(isPhased({ phases: [mkPhase(1, 0)], phase_start_date: '2026-04-20' })).toBe(true);
  });

  test('false when no phases', () => {
    expect(isPhased({ phases: [], phase_start_date: '2026-04-20' })).toBe(false);
  });

  test('false when phases but no start date', () => {
    expect(isPhased({ phases: [mkPhase(1, 0)], phase_start_date: null })).toBe(false);
  });

  test('false when phases missing entirely', () => {
    expect(isPhased({ phase_start_date: '2026-04-20' })).toBe(false);
  });
});

describe('countExercisesInPhase', () => {
  test('counts only exercises with matching phase_id', () => {
    const routine = {
      exercises: [
        { id: 1, routine_id: 1, exercise_id: 10, sort_order: 0, phase_id: 100, keystone: false },
        { id: 2, routine_id: 1, exercise_id: 11, sort_order: 1, phase_id: 100, keystone: false },
        { id: 3, routine_id: 1, exercise_id: 12, sort_order: 2, phase_id: 200, keystone: false },
        { id: 4, routine_id: 1, exercise_id: 13, sort_order: 3, phase_id: null, keystone: false },
      ],
    };
    expect(countExercisesInPhase(routine, 100)).toBe(2);
    expect(countExercisesInPhase(routine, 200)).toBe(1);
    expect(countExercisesInPhase(routine, 999)).toBe(0);
  });

  test('handles missing exercises array', () => {
    expect(countExercisesInPhase({ exercises: undefined as never }, 100)).toBe(0);
  });
});

describe('reorderPhaseIds', () => {
  const phases = [mkPhase(10, 0), mkPhase(20, 1), mkPhase(30, 2), mkPhase(40, 3)];

  test('move down: first to third', () => {
    expect(reorderPhaseIds(phases, 0, 2)).toEqual([20, 30, 10, 40]);
  });

  test('move up: last to first', () => {
    expect(reorderPhaseIds(phases, 3, 0)).toEqual([40, 10, 20, 30]);
  });

  test('adjacent swap', () => {
    expect(reorderPhaseIds(phases, 1, 2)).toEqual([10, 30, 20, 40]);
  });

  test('no-op when from === to', () => {
    expect(reorderPhaseIds(phases, 2, 2)).toEqual([10, 20, 30, 40]);
  });

  test('out-of-range leaves order unchanged', () => {
    expect(reorderPhaseIds(phases, 4, 0)).toEqual([10, 20, 30, 40]);
    expect(reorderPhaseIds(phases, 0, -1)).toEqual([10, 20, 30, 40]);
  });

  test('empty list', () => {
    expect(reorderPhaseIds([], 0, 0)).toEqual([]);
  });
});
