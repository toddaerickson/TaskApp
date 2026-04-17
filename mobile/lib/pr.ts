/**
 * Personal-record helpers. Split out as pure functions so session rendering
 * stays testable without the backend round-trip: given historical bests +
 * the current session's sets (in chronological order), return the set IDs
 * that established a new PR.
 *
 * A set counts as a PR if it strictly beats the running best for EITHER
 * weight, reps, or duration_sec. Running best walks forward through the
 * session, so two PRs in a single workout are both marked.
 */

export interface HistoricalBest {
  exercise_id: number;
  max_weight?: number | null;
  max_reps?: number | null;
  max_duration_sec?: number | null;
}

export interface BestSnapshot {
  weight: number;
  reps: number;
  duration: number;
}

export interface SessionSetLike {
  id: number;
  exercise_id: number;
  reps?: number | null;
  weight?: number | null;
  duration_sec?: number | null;
}

export function toBestsMap(bests: HistoricalBest[]): Record<number, BestSnapshot> {
  const out: Record<number, BestSnapshot> = {};
  for (const b of bests) {
    out[b.exercise_id] = {
      weight: b.max_weight ?? 0,
      reps: b.max_reps ?? 0,
      duration: b.max_duration_sec ?? 0,
    };
  }
  return out;
}

/**
 * Walk `sets` in chronological order and return the ids whose values
 * strictly exceed the running best for their exercise. `bests` is treated
 * as the starting snapshot from before the current session.
 */
export function computePRs(
  bests: Record<number, BestSnapshot>,
  sets: SessionSetLike[],
): Set<number> {
  const running: Record<number, BestSnapshot> = {};
  for (const [k, v] of Object.entries(bests)) running[Number(k)] = { ...v };

  const pr = new Set<number>();
  for (const s of sets) {
    const cur = running[s.exercise_id] ?? { weight: 0, reps: 0, duration: 0 };
    const w = s.weight ?? 0;
    const r = s.reps ?? 0;
    const d = s.duration_sec ?? 0;
    // "Beat" requires a positive value — an empty set (no weight/reps/dur)
    // shouldn't register as a PR just because priors were zero.
    const beats =
      (w > cur.weight && w > 0) ||
      (r > cur.reps && r > 0) ||
      (d > cur.duration && d > 0);
    if (beats) pr.add(s.id);
    running[s.exercise_id] = {
      weight: Math.max(cur.weight, w),
      reps: Math.max(cur.reps, r),
      duration: Math.max(cur.duration, d),
    };
  }
  return pr;
}
