/**
 * Tests for the phase helpers. These cover the same time-math the server
 * does — duplicated on the client so the banner can render immediately
 * without another round-trip, and stay correct if the local clock is a
 * few seconds ahead of the server's.
 *
 * Contract check: getActivePhaseInfo + filterExercisesForPhase together
 * must match what `resolve_current_phase_id` returns on the backend (the
 * pytest file `test_routine_phases.py` exercises that side).
 */
import { getActivePhaseInfo, filterExercisesForPhase } from '@/lib/phases';
import { Routine, RoutineExercise, RoutinePhase } from '@/lib/stores';

const baseRoutine = (): Routine => ({
  id: 1, user_id: 1, name: 'R', goal: 'rehab',
  sort_order: 0, created_at: '2026-01-01T00:00:00Z',
  exercises: [],
});

const mkPhase = (id: number, label: string, order_idx: number, duration_weeks: number): RoutinePhase => ({
  id, routine_id: 1, label, order_idx, duration_weeks,
});

describe('getActivePhaseInfo', () => {
  it('returns null when there are no phases', () => {
    expect(getActivePhaseInfo(baseRoutine())).toBeNull();
  });

  it('returns null when phase_start_date is missing', () => {
    const r: Routine = {
      ...baseRoutine(),
      phases: [mkPhase(1, 'A', 0, 2)],
      current_phase_id: 1,
    };
    expect(getActivePhaseInfo(r)).toBeNull();
  });

  it('returns null when current_phase_id is missing', () => {
    const r: Routine = {
      ...baseRoutine(),
      phases: [mkPhase(1, 'A', 0, 2)],
      phase_start_date: '2026-01-01',
    };
    expect(getActivePhaseInfo(r)).toBeNull();
  });

  it('computes position, total, and daysLeft from a mid-phase timestamp', () => {
    // Day 3 of a 2-week phase 1 (first of two phases) → daysLeft = 11.
    const r: Routine = {
      ...baseRoutine(),
      phases: [mkPhase(1, 'Initial', 0, 2), mkPhase(2, 'Strength', 1, 4)],
      phase_start_date: '2026-01-01',
      current_phase_id: 1,
    };
    const info = getActivePhaseInfo(r, new Date('2026-01-04T12:00:00Z'));
    expect(info).not.toBeNull();
    expect(info!.phase.id).toBe(1);
    expect(info!.position).toBe(1);
    expect(info!.total).toBe(2);
    // Allow +/- 1 day slack for TZ rounding on the Date boundary.
    expect(info!.daysLeft).toBeGreaterThanOrEqual(10);
    expect(info!.daysLeft).toBeLessThanOrEqual(12);
  });

  it('clamps daysLeft to 0 when the phase window has ended', () => {
    // A one-week phase viewed 100 days later. Server would have bumped
    // current_phase_id to the next phase, but defensive clamping matters
    // for a stale cached response.
    const r: Routine = {
      ...baseRoutine(),
      phases: [mkPhase(1, 'A', 0, 1)],
      phase_start_date: '2026-01-01',
      current_phase_id: 1,
    };
    const info = getActivePhaseInfo(r, new Date('2026-04-15T00:00:00Z'));
    expect(info!.daysLeft).toBe(0);
  });

  it('respects order_idx for position numbering regardless of array order', () => {
    const r: Routine = {
      ...baseRoutine(),
      // Deliberately out of canonical order.
      phases: [mkPhase(2, 'Strength', 1, 4), mkPhase(1, 'Initial', 0, 2)],
      phase_start_date: '2026-01-01',
      current_phase_id: 2,
    };
    const info = getActivePhaseInfo(r, new Date('2026-02-01T00:00:00Z'));
    expect(info!.position).toBe(2);
    expect(info!.total).toBe(2);
  });
});

describe('filterExercisesForPhase', () => {
  const withPhase = (id: number, phase_id: number | null): RoutineExercise => ({
    id, routine_id: 1, exercise_id: id, sort_order: id,
    keystone: false, phase_id: phase_id ?? undefined,
  });

  it('returns everything when active phase is null (flat routine)', () => {
    const exs = [withPhase(1, null), withPhase(2, 99)];
    expect(filterExercisesForPhase(exs, null)).toEqual(exs);
  });

  it('returns only null-phase + matching-phase REs when a phase is active', () => {
    const exs = [
      withPhase(1, null),      // every-phase warmup
      withPhase(2, 10),        // phase 10
      withPhase(3, 20),        // phase 20
      withPhase(4, null),      // every-phase cooldown
    ];
    const out = filterExercisesForPhase(exs, 20);
    expect(out.map((r) => r.id)).toEqual([1, 3, 4]);
  });
});
