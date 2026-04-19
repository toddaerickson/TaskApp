/**
 * Phase READ helpers shared between the routine detail screen and the
 * session runner. Centralized so both render the same "which exercises
 * apply right now" answer — drift between the two would break the
 * user's promise that tapping Start runs what the detail page showed.
 *
 * Write-side helpers (validation, reorder, swap, count) live in
 * `phaseEditor.ts` so the read path can import this file without
 * pulling in editor-only logic.
 */
import { Routine, RoutineExercise, RoutinePhase } from './stores';

export interface PhaseDisplayInfo {
  phase: RoutinePhase;
  /** 1-based position for display (e.g. "Phase 2 / 4"). */
  position: number;
  total: number;
  /** Whole days remaining in the current phase. Negative values are
   *  clamped to 0 and the caller renders "complete" instead — the
   *  server already pins to the last phase past the end, so this only
   *  matters for clarity. */
  daysLeft: number;
}

/**
 * Resolve the currently-active phase plus human-friendly context for the
 * banner. Returns null when the routine is flat (no phases or no start
 * date), matching the server's `current_phase_id` semantics.
 */
export function getActivePhaseInfo(
  routine: Routine,
  now: Date = new Date(),
): PhaseDisplayInfo | null {
  const phases = routine.phases ?? [];
  const currentId = routine.current_phase_id;
  if (!phases.length || !currentId || !routine.phase_start_date) return null;

  const phase = phases.find((p) => p.id === currentId);
  if (!phase) return null;

  const sorted = [...phases].sort((a, b) => a.order_idx - b.order_idx);
  const position = sorted.findIndex((p) => p.id === phase.id) + 1;

  const start = parseIsoDate(routine.phase_start_date);
  if (!start) {
    // Server gave us a phase but the date is bad — fall back to a
    // positional-only banner with daysLeft=0 rather than dropping the
    // entire banner. The UI still conveys "you're in phase 2 of 4."
    return { phase, position, total: sorted.length, daysLeft: 0 };
  }

  // Cumulative offset in weeks from phase 0 start.
  let offsetWeeks = 0;
  for (const p of sorted) {
    if (p.id === phase.id) break;
    offsetWeeks += p.duration_weeks;
  }
  const phaseEnd = new Date(start);
  phaseEnd.setDate(phaseEnd.getDate() + (offsetWeeks + phase.duration_weeks) * 7);
  const msLeft = phaseEnd.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  return { phase, position, total: sorted.length, daysLeft };
}

/**
 * Exercises that apply right now. A routine_exercise with `phase_id ===
 * null` is a "every phase" exercise (e.g. warmup); those always show.
 * With a phase active, phase-scoped REs show only when their phase_id
 * matches. When `activePhaseId` is null (flat routine), every RE shows.
 */
export function filterExercisesForPhase(
  exercises: RoutineExercise[],
  activePhaseId: number | null | undefined,
): RoutineExercise[] {
  if (!activePhaseId) return exercises;
  return exercises.filter(
    (re) => re.phase_id == null || re.phase_id === activePhaseId,
  );
}

function parseIsoDate(value: string): Date | null {
  // Accept "YYYY-MM-DD" and longer ISO strings. new Date(string) is
  // timezone-dependent for date-only inputs on some runtimes (parses as
  // UTC midnight) which is fine for day-level math; we only care about
  // day granularity for the banner.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isFinite(d.getTime()) ? d : null;
}
