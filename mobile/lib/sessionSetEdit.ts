/**
 * Shape + diff helpers for the SessionSetEditSheet.
 *
 * Keeps the "only PATCH fields the user actually changed" logic out of
 * the component so jest can cover it. Same pattern as the dose chip
 * editor's initial-vs-current diff from #46.
 */

export interface SetEditFields {
  reps: string;
  weight: string;
  duration_sec: string;
  rpe: string;
  pain_score: string;
  notes: string;
}

/**
 * Stringify a numeric-or-null field for the text input. Null becomes
 * empty string (not "null" or "0") so the input renders blank.
 */
export function toEditString(v: number | null | undefined): string {
  return v == null ? '' : String(v);
}

/**
 * Compute a PATCH payload with only the fields that changed between
 * `initial` and `current`. Unchanged fields stay out — we don't want to
 * send target_reps=10 over itself and bump updated_at for no reason
 * (the same bug #46 fixed for the dose chip editor).
 *
 * Numeric-ish fields are coerced from stringified form: empty string
 * becomes null (user cleared the field), a non-empty value becomes
 * Number(). Notes is a plain string; empty becomes null so the server
 * treats it as "cleared."
 */
export function diffSetEdit(
  initial: SetEditFields,
  current: SetEditFields,
): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  const numericKeys: (keyof SetEditFields)[] = [
    'reps', 'weight', 'duration_sec', 'rpe', 'pain_score',
  ];
  for (const k of numericKeys) {
    if (current[k] === initial[k]) continue;
    out[k] = current[k] === '' ? null : Number(current[k]);
  }
  if (current.notes !== initial.notes) {
    out.notes = current.notes === '' ? null : current.notes;
  }
  return out;
}

/**
 * Has the user made any edit at all? Used by the unsaved-changes guard
 * to decide whether dismissing the sheet should prompt "Discard?"
 */
export function isDirty(initial: SetEditFields, current: SetEditFields): boolean {
  return (Object.keys(initial) as (keyof SetEditFields)[]).some(
    (k) => initial[k] !== current[k],
  );
}
