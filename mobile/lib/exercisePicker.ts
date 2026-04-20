/**
 * Pure helpers for the ExercisePickerModal. Split out so jest can cover
 * the search-filter logic without the RN runtime (same split pattern as
 * phaseEditor.ts and reminders.ts).
 */
import type { Exercise } from './stores';

/**
 * Case-insensitive substring match against name or slug. Whitespace is
 * trimmed from the query so accidental trailing spaces from mobile
 * keyboards don't empty the list. An empty (or whitespace-only) query
 * returns the input unchanged — the picker renders the full library.
 */
export function filterExercises(
  exercises: readonly Exercise[],
  query: string,
): Exercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...exercises];
  return exercises.filter((ex) => {
    if (ex.name.toLowerCase().includes(q)) return true;
    if (ex.slug && ex.slug.toLowerCase().includes(q)) return true;
    return false;
  });
}
