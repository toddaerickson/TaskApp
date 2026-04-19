/**
 * Client-side parse + validate for the portable routine JSON format.
 *
 * The backend (POST /routines/import) re-runs the same checks, so this
 * module exists to give the user immediate, specific feedback in the
 * paste-and-preview UI ("phase_idx out of range on row 4") instead of
 * a single 400 after a round-trip. Kept dependency-free (no React, no
 * api.ts) so the jest setup stays pure-function.
 */

export type Measurement = 'reps' | 'duration' | 'distance' | 'reps_weight';

export interface ImportPhase {
  label: string;
  duration_weeks: number;
  notes?: string | null;
}

export interface ImportExercise {
  slug: string;
  /** 0-based pointer into phases[]; null/omitted = applies in every phase. */
  phase_idx?: number | null;
  target_sets?: number;
  target_reps?: number | null;
  target_weight?: number | null;
  target_duration_sec?: number | null;
  rest_sec?: number | null;
  tempo?: string | null;
  keystone?: boolean;
  notes?: string | null;
}

export interface ImportRequest {
  name: string;
  goal?: string;
  notes?: string | null;
  /** ISO YYYY-MM-DD; null/omitted = flat routine. */
  phase_start_date?: string | null;
  phases?: ImportPhase[];
  exercises: ImportExercise[];
}

export interface ImportPreview {
  request: ImportRequest;
  totals: {
    phases: number;
    exercises: number;
    /** Approximate session minutes per phase (for the active subset). */
    minutesPerPhase: number[];
  };
}

/**
 * Parse JSON and validate against the catalog. Returns either a preview
 * (caller renders + can POST) or a list of human-readable errors.
 *
 * `catalog` is keyed by slug → measurement so we can flag the common
 * "duration exercise written with target_reps" mistake before the user
 * hits Import.
 */
export function parseAndValidate(
  raw: string,
  catalog: ReadonlyMap<string, Measurement>,
): { preview: ImportPreview; errors: [] } | { preview: null; errors: string[] } {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { preview: null, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { preview: null, errors: ['Top-level value must be a JSON object.'] };
  }
  const obj = parsed as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) errors.push('`name` is required and must be a non-empty string.');
  if (name.length > 80) errors.push('`name` is too long (max 80 chars).');

  const phasesRaw = Array.isArray(obj.phases) ? obj.phases : [];
  const phases: ImportPhase[] = [];
  phasesRaw.forEach((p, i) => {
    if (!p || typeof p !== 'object') {
      errors.push(`phases[${i}] must be an object.`);
      return;
    }
    const ph = p as Record<string, unknown>;
    const label = typeof ph.label === 'string' ? ph.label.trim() : '';
    const dw = typeof ph.duration_weeks === 'number' ? ph.duration_weeks : NaN;
    if (!label) errors.push(`phases[${i}].label is required.`);
    if (!Number.isFinite(dw) || dw < 1 || dw > 520) {
      errors.push(`phases[${i}].duration_weeks must be 1..520.`);
    }
    phases.push({
      label,
      duration_weeks: dw,
      notes: typeof ph.notes === 'string' ? ph.notes : null,
    });
  });

  const exercisesRaw = Array.isArray(obj.exercises) ? obj.exercises : [];
  if (exercisesRaw.length === 0) {
    errors.push('`exercises` must include at least one entry.');
  }

  const exercises: ImportExercise[] = [];
  exercisesRaw.forEach((e, i) => {
    if (!e || typeof e !== 'object') {
      errors.push(`exercises[${i}] must be an object.`);
      return;
    }
    const ex = e as Record<string, unknown>;
    const slug = typeof ex.slug === 'string' ? ex.slug.trim() : '';
    if (!slug) {
      errors.push(`exercises[${i}].slug is required.`);
      return;
    }
    const measurement = catalog.get(slug);
    if (!measurement) {
      errors.push(
        `exercises[${i}]: unknown slug "${slug}" — check spelling against the seeded library.`,
      );
    }

    const phase_idx =
      ex.phase_idx === null || ex.phase_idx === undefined
        ? null
        : typeof ex.phase_idx === 'number'
        ? ex.phase_idx
        : NaN;
    if (phase_idx !== null && (!Number.isInteger(phase_idx) || phase_idx < 0 || phase_idx >= phases.length)) {
      errors.push(
        `exercises[${i}].phase_idx=${ex.phase_idx} out of range (have ${phases.length} phase${phases.length === 1 ? '' : 's'}).`,
      );
    }

    const target_reps = typeof ex.target_reps === 'number' ? ex.target_reps : null;
    const target_duration_sec = typeof ex.target_duration_sec === 'number' ? ex.target_duration_sec : null;
    if (measurement === 'duration' && target_duration_sec === null) {
      errors.push(
        `exercises[${i}] (${slug}) is a duration exercise — set \`target_duration_sec\`.`,
      );
    }
    if ((measurement === 'reps' || measurement === 'reps_weight') && target_reps === null) {
      errors.push(
        `exercises[${i}] (${slug}) is a reps exercise — set \`target_reps\`.`,
      );
    }

    exercises.push({
      slug,
      phase_idx,
      target_sets: typeof ex.target_sets === 'number' ? ex.target_sets : 1,
      target_reps,
      target_weight: typeof ex.target_weight === 'number' ? ex.target_weight : null,
      target_duration_sec,
      rest_sec: typeof ex.rest_sec === 'number' ? ex.rest_sec : 60,
      tempo: typeof ex.tempo === 'string' ? ex.tempo : null,
      keystone: ex.keystone === true,
      notes: typeof ex.notes === 'string' ? ex.notes : null,
    });
  });

  if (errors.length > 0) return { preview: null, errors };

  const request: ImportRequest = {
    name,
    goal: typeof obj.goal === 'string' ? obj.goal : 'general',
    notes: typeof obj.notes === 'string' ? obj.notes : null,
    phase_start_date:
      typeof obj.phase_start_date === 'string' ? obj.phase_start_date : null,
    phases,
    exercises,
  };

  // Per-phase work + rest estimate for the preview chip. "All phases"
  // exercises (phase_idx null) count toward every phase.
  const minutesPerPhase: number[] = [];
  const phaseCount = Math.max(1, phases.length);
  for (let p = 0; p < phaseCount; p++) {
    const active = exercises.filter((e) => e.phase_idx === null || e.phase_idx === p);
    const totalSec = active.reduce((sum, e) => {
      const sets = e.target_sets ?? 1;
      const work = (e.target_duration_sec ?? 30) * sets;
      const rest = (e.rest_sec ?? 60) * Math.max(0, sets - 1);
      return sum + work + rest;
    }, 0);
    minutesPerPhase.push(Math.round(totalSec / 60));
  }

  return {
    preview: {
      request,
      totals: { phases: phases.length, exercises: exercises.length, minutesPerPhase },
    },
    errors: [],
  };
}

/**
 * Inverse: serialize a routine fetched from the API back to the portable
 * format. Used by the Export-to-clipboard button on routine detail.
 *
 * `phaseIdById` is built from routine.phases — server phase ids → 0-based
 * index, so the export survives import into a different account.
 */
export function serializeRoutine(routine: {
  name: string;
  goal: string;
  notes: string | null;
  phase_start_date?: string | null;
  phases?: { id: number; label: string; order_idx: number; duration_weeks: number; notes?: string | null }[];
  exercises: {
    exercise?: { slug?: string };
    phase_id?: number | null;
    target_sets?: number;
    target_reps?: number | null;
    target_weight?: number | null;
    target_duration_sec?: number | null;
    rest_sec?: number | null;
    tempo?: string | null;
    keystone?: boolean;
    notes?: string | null;
  }[];
}): ImportRequest {
  const phases = (routine.phases ?? [])
    .slice()
    .sort((a, b) => a.order_idx - b.order_idx);
  const phaseIdToIdx = new Map<number, number>();
  phases.forEach((p, i) => phaseIdToIdx.set(p.id, i));

  return {
    name: routine.name,
    goal: routine.goal,
    notes: routine.notes ?? null,
    phase_start_date: routine.phase_start_date ?? null,
    phases: phases.map((p) => ({
      label: p.label,
      duration_weeks: p.duration_weeks,
      notes: p.notes ?? null,
    })),
    exercises: routine.exercises.map((e) => ({
      slug: e.exercise?.slug ?? '',
      phase_idx:
        e.phase_id == null ? null : phaseIdToIdx.get(e.phase_id) ?? null,
      target_sets: e.target_sets ?? 1,
      target_reps: e.target_reps ?? null,
      target_weight: e.target_weight ?? null,
      target_duration_sec: e.target_duration_sec ?? null,
      rest_sec: e.rest_sec ?? 60,
      tempo: e.tempo ?? null,
      keystone: e.keystone === true,
      notes: e.notes ?? null,
    })),
  };
}
