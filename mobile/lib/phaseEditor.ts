/**
 * Pure-function helpers backing the phase editor UI. Kept separate from
 * the component so jest can cover them without the RN runtime (same split
 * as `routineImport.ts` and `reminders.ts`).
 */
import type { Routine, RoutinePhase } from './stores';

export interface DurationError {
  /** Null when valid; human-readable message otherwise. */
  message: string | null;
}

/**
 * duration_weeks must be 1..520 (server enforces the same bounds via the
 * PhaseCreate model Field(ge=1, le=520)). Returning a message rather than
 * throwing lets the UI render inline feedback next to the input.
 */
export function validateDurationWeeks(n: unknown): DurationError {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { message: 'Duration must be a number.' };
  }
  if (!Number.isInteger(n)) {
    return { message: 'Duration must be a whole number of weeks.' };
  }
  if (n < 1) return { message: 'Duration must be at least 1 week.' };
  if (n > 520) return { message: 'Duration may not exceed 520 weeks (10 years).' };
  return { message: null };
}

/**
 * Swap two phases in a list and rewrite `order_idx` to match array
 * position so the server's UNIQUE(routine_id, order_idx) constraint
 * stays satisfied when the caller PUTs each row. Idempotent when i===j,
 * or when either index is out of range (returns the original list).
 */
export function swapPhases(
  phases: RoutinePhase[],
  i: number,
  j: number,
): RoutinePhase[] {
  if (i === j) return phases;
  if (i < 0 || j < 0 || i >= phases.length || j >= phases.length) return phases;
  const next = phases.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((p, idx) => ({ ...p, order_idx: idx }));
}

/**
 * Compute the id list to POST to /phases/reorder for a single "move phase
 * at index `from` to index `to`" operation. Out-of-range or no-op inputs
 * return the unchanged id order.
 */
export function reorderPhaseIds(
  phases: RoutinePhase[],
  from: number,
  to: number,
): number[] {
  const ids = phases.map((p) => p.id);
  if (from === to) return ids;
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const [moving] = ids.splice(from, 1);
  ids.splice(to, 0, moving);
  return ids;
}

/**
 * A routine is "phased" (the banner shows, exercises filter) only when
 * it has at least one phase AND phase_start_date is set. Matches the
 * server-side resolver in `hydrate_routines_full`.
 */
export function isPhased(routine: Pick<Routine, 'phases' | 'phase_start_date'>): boolean {
  return Boolean(routine.phases && routine.phases.length > 0 && routine.phase_start_date);
}

/**
 * Count of exercises currently pinned to a given phase. Used by the
 * delete-phase confirm dialog so the user knows how many rows will
 * become "all-phases" when the phase is removed (server CASCADEs
 * phase_id to NULL on phase delete — we don't destroy the exercise).
 */
export function countExercisesInPhase(
  routine: Pick<Routine, 'exercises'>,
  phaseId: number,
): number {
  return (routine.exercises ?? []).filter((e) => e.phase_id === phaseId).length;
}
