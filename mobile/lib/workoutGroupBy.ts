/**
 * Pure bucketing logic for the Workouts tab's group-by dropdown.
 * Extracted from workouts.tsx so it can be unit-tested without
 * pulling the whole screen (Zustand, FlatList, ReminderSheet) into
 * the test environment.
 *
 * Four grouping modes: none (handled inline), goal, day,
 * lastPerformed. Returns a deterministic list of { key, label, items }
 * buckets — the renderer just walks it.
 */
import type { Routine } from './stores';
import { parseDays, DAYS } from './reminders';

export interface RoutineBucket {
  key: string;
  label: string;
  items: Routine[];
}

type GroupMode = 'goal' | 'day' | 'lastPerformed';

const GOAL_ORDER = ['general', 'strength', 'mobility', 'rehab', 'cardio'] as const;
const GOAL_LABELS: Record<string, string> = {
  general: 'General', strength: 'Strength', mobility: 'Mobility',
  rehab: 'Rehab', cardio: 'Cardio',
};

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

// Ordered bucket ids for the recency grouping. "never" trails.
const RECENCY_ORDER = ['today', 'this_week', 'this_month', 'older', 'never'] as const;
const RECENCY_LABELS: Record<(typeof RECENCY_ORDER)[number], string> = {
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  older: 'Older',
  never: 'Never performed',
};

/**
 * Bucket a sorted list of routines according to the group mode.
 * `now` is injectable so tests don't depend on wall-clock time.
 */
export function bucketRoutines(
  routines: Routine[],
  mode: GroupMode,
  lastPerformedByRoutine: Map<number, string>,
  now: Date,
): RoutineBucket[] {
  if (mode === 'goal') return bucketByGoal(routines);
  if (mode === 'day') return bucketByDay(routines);
  return bucketByRecency(routines, lastPerformedByRoutine, now);
}

function bucketByGoal(routines: Routine[]): RoutineBucket[] {
  const map = new Map<string, Routine[]>();
  for (const r of routines) {
    const key = r.goal || 'general';
    (map.get(key) ?? map.set(key, []).get(key)!).push(r);
  }
  const out: RoutineBucket[] = [];
  for (const key of GOAL_ORDER) {
    const items = map.get(key);
    if (items) { out.push({ key, label: GOAL_LABELS[key] ?? key, items }); map.delete(key); }
  }
  // Any unrecognized goal (shouldn't happen today but defensive) trails.
  for (const [key, items] of map) out.push({ key, label: GOAL_LABELS[key] ?? key, items });
  return out;
}

function bucketByDay(routines: Routine[]): RoutineBucket[] {
  // A routine scheduled Mon+Wed appears under both Monday and Wednesday
  // buckets — the user's mental model is "what's on my plate today", so
  // duplication is intentional. Unscheduled routines trail in "No day".
  const map = new Map<string, Routine[]>();
  const unscheduled: Routine[] = [];
  for (const r of routines) {
    const days = parseDays(r.reminder_days);
    if (days.size === 0) { unscheduled.push(r); continue; }
    for (const d of days) {
      (map.get(d) ?? map.set(d, []).get(d)!).push(r);
    }
  }
  const out: RoutineBucket[] = [];
  for (const d of DAYS) {
    const items = map.get(d);
    if (items) out.push({ key: d, label: DAY_LABELS[d] ?? d, items });
  }
  if (unscheduled.length) out.push({ key: 'none', label: 'No day', items: unscheduled });
  return out;
}

function bucketByRecency(
  routines: Routine[],
  lastPerformedByRoutine: Map<number, string>,
  now: Date,
): RoutineBucket[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  // Week starts Monday to match the existing weeklyCounts heuristic.
  const weekStart = new Date(today);
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  weekStart.setDate(today.getDate() - dow);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const map: Record<(typeof RECENCY_ORDER)[number], Routine[]> = {
    today: [], this_week: [], this_month: [], older: [], never: [],
  };
  for (const r of routines) {
    const ts = lastPerformedByRoutine.get(r.id);
    if (!ts) { map.never.push(r); continue; }
    const day = ts.slice(0, 10);
    if (day === todayStr) map.today.push(r);
    else if (day >= weekStartStr) map.this_week.push(r);
    else if (day >= monthStartStr) map.this_month.push(r);
    else map.older.push(r);
  }
  return RECENCY_ORDER
    .filter((k) => map[k].length > 0)
    .map((k) => ({ key: k, label: RECENCY_LABELS[k], items: map[k] }));
}
