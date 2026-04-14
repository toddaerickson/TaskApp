/**
 * Pure functions for aggregating sessions into progress chart data.
 * Client-side only — server already returns fully-hydrated sessions.
 */
import type { WorkoutSession, SessionSet, Exercise } from './stores';

export interface ExerciseStat {
  exercise_id: number;
  name: string;
  measurement: string;
  sessions: number;
  points: { date: string; value: number; setCount: number }[];
}

/** Group sets by (exercise_id, session date), compute the best single-set value per day. */
export function aggregateByExercise(
  sessions: WorkoutSession[],
  exercises: Exercise[],
): ExerciseStat[] {
  const exById = new Map(exercises.map((e) => [e.id, e]));
  // { exerciseId -> { yyyy-mm-dd -> {best, setCount} } }
  const buckets = new Map<number, Map<string, { best: number; setCount: number }>>();

  for (const s of sessions) {
    const day = s.started_at.slice(0, 10);
    for (const set of s.sets || []) {
      const value = pickValue(set);
      if (value === null) continue;
      const m = buckets.get(set.exercise_id) ?? new Map();
      const cur = m.get(day);
      if (!cur || value > cur.best) m.set(day, { best: value, setCount: (cur?.setCount ?? 0) + 1 });
      else cur.setCount += 1;
      buckets.set(set.exercise_id, m);
    }
  }

  const out: ExerciseStat[] = [];
  for (const [exId, dayMap] of buckets) {
    const ex = exById.get(exId);
    if (!ex) continue;
    const points = [...dayMap.entries()]
      .map(([date, v]) => ({ date, value: v.best, setCount: v.setCount }))
      .sort((a, b) => a.date.localeCompare(b.date));
    out.push({
      exercise_id: exId,
      name: ex.name,
      measurement: ex.measurement,
      sessions: new Set(points.map((p) => p.date)).size,
      points,
    });
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

/** Pick the "best" number on a set: weight*reps (strength), else reps, else duration. */
function pickValue(set: SessionSet): number | null {
  if (set.weight && set.reps) return set.weight * set.reps;
  if (set.reps) return set.reps;
  if (set.duration_sec) return set.duration_sec;
  if (set.distance_m) return set.distance_m;
  return null;
}

/** Sessions-per-week bar chart data. Returns oldest-first, 12 weeks. */
export function weeklyCounts(sessions: WorkoutSession[], weeks = 12): { label: string; count: number }[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  // Start-of-week = Monday.
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dow);

  const buckets: { label: string; count: number; start: Date }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(monday); d.setDate(monday.getDate() - i * 7);
    buckets.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0, start: d });
  }

  for (const s of sessions) {
    const sd = new Date(s.started_at);
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (sd >= buckets[i].start) { buckets[i].count++; break; }
    }
  }
  return buckets.map(({ label, count }) => ({ label, count }));
}
