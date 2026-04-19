/**
 * Turn a routine exercise's target fields into the ordered list of
 * strings rendered on the routine detail screen ("3×15 · rest 45s").
 * Each token maps to the field(s) an inline tap should edit, so the
 * UI layer can make the chip pressable and open the matching editor.
 *
 * Pure function — kept out of the screen file so it can be unit tested
 * without the RN renderer. Shape mirrors `formatTarget` that used to
 * live in `app/workout/[routineId].tsx`.
 */

export type DoseTokenKind = 'work' | 'weight' | 'tempo' | 'rest';

export interface DoseToken {
  kind: DoseTokenKind;
  label: string;
}

export interface DoseInput {
  target_sets?: number | null;
  target_reps?: number | null;
  target_duration_sec?: number | null;
  target_weight?: number | null;
  tempo?: string | null;
  rest_sec?: number | null;
}

export function tokenizeDose(re: DoseInput): DoseToken[] {
  const tokens: DoseToken[] = [];

  const sets = re.target_sets || 0;
  const reps = re.target_reps || 0;
  const dur = re.target_duration_sec || 0;
  if (sets || reps || dur) {
    let label = '';
    if (sets) label += `${sets}×`;
    if (reps) label += `${reps}`;
    else if (dur) label += `${dur}s`;
    tokens.push({ kind: 'work', label });
  }

  if (re.target_weight) tokens.push({ kind: 'weight', label: `@${re.target_weight}lb` });
  if (re.tempo) tokens.push({ kind: 'tempo', label: `tempo ${re.tempo}` });
  if (re.rest_sec) tokens.push({ kind: 'rest', label: `rest ${re.rest_sec}s` });

  return tokens;
}

export function joinDoseLabels(tokens: DoseToken[]): string {
  return tokens.map((t) => t.label).join(' · ');
}
