/**
 * Pure helpers for the ExercisePickerModal. Split out so jest can cover
 * the search-filter logic without the RN runtime (same split pattern as
 * reminders.ts).
 */
import type { Exercise } from './stores';

/**
 * Case-insensitive substring match against name or slug. Whitespace is
 * trimmed from the query so accidental trailing spaces from mobile
 * keyboards don't empty the list. An empty (or whitespace-only) query
 * returns the input unchanged — the picker renders the full library.
 *
 * `tierFilter` (optional) narrows the result to a single evidence tier
 * value when non-null. Useful for the picker's "Show only RCT" affordance.
 * A tier with zero matches returns []. Null / undefined = "All".
 */
export function filterExercises(
  exercises: readonly Exercise[],
  query: string,
  tierFilter?: string | null,
): Exercise[] {
  const q = query.trim().toLowerCase();
  let out: Exercise[] = q
    ? exercises.filter((ex) => {
        if (ex.name.toLowerCase().includes(q)) return true;
        if (ex.slug && ex.slug.toLowerCase().includes(q)) return true;
        return false;
      })
    : [...exercises];
  if (tierFilter) {
    out = out.filter((ex) => ex.evidence_tier === tierFilter);
  }
  return out;
}
