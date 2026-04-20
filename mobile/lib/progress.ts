/**
 * Pure functions for aggregating sessions into progress chart data.
 * Client-side only — server already returns fully-hydrated sessions.
 */
import type { WorkoutSession, SessionSet, Exercise } from './stores';

export interface StatPoint {
  date: string;
  value: number;
  setCount: number;
  /** True when this day's value was an all-time high for this exercise
   *  up to and including this day. The chart renders a PR marker. */
  pr?: boolean;
}

export interface ExerciseStat {
  exercise_id: number;
  name: string;
  measurement: string;
  sessions: number;
  points: StatPoint[];
}

/** Metric dimension for per-metric charting. "pain" is only non-empty for
 *  rehab sessions (tracks_symptoms=true on the parent session). */
export type Metric = 'reps' | 'weight' | 'duration' | 'pain';

/** Pick a per-metric value from a set. Pain is the max of pain_score;
 *  the "best" of the day is the highest reading (worst feeling), so the
 *  chart reads as "your pain level hit X on this day". */
function pickMetricValue(set: SessionSet, metric: Metric): number | null {
  switch (metric) {
    case 'reps':
      return typeof set.reps === 'number' && set.reps > 0 ? set.reps : null;
    case 'weight':
      return typeof set.weight === 'number' && set.weight > 0 ? set.weight : null;
    case 'duration':
      return typeof set.duration_sec === 'number' && set.duration_sec > 0 ? set.duration_sec : null;
    case 'pain':
      return typeof set.pain_score === 'number' ? set.pain_score : null;
  }
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
    markPRs(points);
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

/** Mark a point as PR if its value is the running max up to and including
 *  its day. Mutates in place for simplicity. Higher-is-better semantics. */
function markPRs(points: StatPoint[]): void {
  let best = -Infinity;
  for (const p of points) {
    if (p.value > best) { p.pr = true; best = p.value; }
  }
}

/** Per-metric, per-exercise daily series. Best value of the day. PRs
 *  flagged with higher-is-better (same direction as aggregateByExercise).
 *  Pain is inverted UX-wise: higher pain is worse, so "PR" there means
 *  "pain floor" — we flag only decreasing-minimums. */
export function metricSeries(
  sessions: WorkoutSession[],
  exerciseId: number,
  metric: Metric,
): StatPoint[] {
  // day → best (or worst for pain)
  const byDay = new Map<string, { best: number; setCount: number }>();
  for (const s of sessions) {
    const day = s.started_at.slice(0, 10);
    for (const set of s.sets || []) {
      if (set.exercise_id !== exerciseId) continue;
      const v = pickMetricValue(set, metric);
      if (v === null) continue;
      const cur = byDay.get(day);
      if (!cur) {
        byDay.set(day, { best: v, setCount: 1 });
      } else if (metric === 'pain') {
        // For pain: store the MAX of the day (worst reading), matches
        // the aggregate-intent of "how bad did it get."
        if (v > cur.best) cur.best = v;
        cur.setCount += 1;
      } else {
        if (v > cur.best) cur.best = v;
        cur.setCount += 1;
      }
    }
  }
  const points: StatPoint[] = [...byDay.entries()]
    .map(([date, v]) => ({ date, value: v.best, setCount: v.setCount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (metric === 'pain') markPainLows(points); else markPRs(points);
  return points;
}

/** Pain-specific: flag a day as a "new low" when its value is the running
 *  minimum. Lower pain is better. */
function markPainLows(points: StatPoint[]): void {
  let low = Infinity;
  for (const p of points) {
    if (p.value < low) { p.pr = true; low = p.value; }
  }
}

/** Which metrics have at least one usable value across all sessions for
 *  this exercise. Used to hide toggle chips that would draw an empty
 *  chart. Order is stable so the UI can map the list directly. */
export function availableMetrics(
  sessions: WorkoutSession[],
  exerciseId: number,
): Metric[] {
  const seen: Record<Metric, boolean> = {
    reps: false, weight: false, duration: false, pain: false,
  };
  for (const s of sessions) {
    for (const set of s.sets || []) {
      if (set.exercise_id !== exerciseId) continue;
      if (!seen.reps && typeof set.reps === 'number' && set.reps > 0) seen.reps = true;
      if (!seen.weight && typeof set.weight === 'number' && set.weight > 0) seen.weight = true;
      if (!seen.duration && typeof set.duration_sec === 'number' && set.duration_sec > 0) seen.duration = true;
      if (!seen.pain && typeof set.pain_score === 'number') seen.pain = true;
    }
  }
  const order: Metric[] = ['reps', 'weight', 'duration', 'pain'];
  return order.filter((m) => seen[m]);
}

/** Keep only points whose date is within the last `days` days (inclusive).
 *  `now` is injectable so tests don't need to mock Date. */
export function filterByRange(
  points: StatPoint[],
  days: number,
  now: Date = new Date(),
): StatPoint[] {
  if (!Number.isFinite(days) || days <= 0) return points;
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= cutoffStr);
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
export function weeklyCounts(
  sessions: WorkoutSession[],
  weeks = 12,
  // `now` is injectable for tests. `jest.spyOn(Date, 'now')` does NOT
  // intercept the `new Date()` constructor in V8 (it reads the clock
  // via a C++ primitive, not through Date.now), so tests that want
  // deterministic output must pass their own `now`. The existing test
  // suite used Date.now spy only and passed by luck — whenever the
  // wall clock happened to fall in the same Monday-week as its
  // FIXED_NOW constant.
  now: Date = new Date(),
): { label: string; count: number }[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // Start-of-week = Monday.
  const dow = (today.getDay() + 6) % 7;
  const monday = new Date(today); monday.setDate(today.getDate() - dow);

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

