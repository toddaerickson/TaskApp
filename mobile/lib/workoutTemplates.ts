/**
 * Pre-built workout templates shown on the Workouts home screen as a
 * "Quick start" strip. Tapping a card resolves the exercise slugs to
 * real ids (via `api.getExercises`) and POSTs a single routine create
 * with the exercises inline — no separate "Add Exercise" step.
 *
 * Slugs must exist in `backend/seed_data/exercise_snapshot.json`. The
 * parity test in `__tests__/workoutTemplates.test.ts` fails if a slug
 * here isn't in the snapshot, so drift is caught at test time rather
 * than as a silent "template creates 3 of 5 exercises" surprise.
 *
 * Targets are intentionally conservative defaults — the user can edit
 * any routine after creation. Pick sets/reps for strength/rehab moves
 * and duration for stretches / holds (matches each exercise's
 * `measurement` column).
 */

export type WorkoutGoal = 'rehab' | 'mobility' | 'strength' | 'cardio' | 'general';

export interface TemplateExercise {
  slug: string;
  /** For reps-measured moves. Omit for duration-measured ones. */
  target_sets?: number;
  target_reps?: number;
  /** For duration-measured moves (stretches, holds, rolls). */
  target_duration_sec?: number;
  rest_sec?: number;
  keystone?: boolean;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  goal: WorkoutGoal;
  /** Ionicons name. */
  icon: string;
  /** One-line pitch shown on the card subtitle. */
  blurb: string;
  exercises: TemplateExercise[];
}

export const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'lower-body-prehab',
    name: 'Lower-Body Prehab',
    goal: 'rehab',
    icon: 'body-outline',
    blurb: 'Runner staple: ankles, glutes, single-leg stability.',
    exercises: [
      { slug: 'banded_ankle_mobilization', target_sets: 2, target_duration_sec: 45, rest_sec: 30 },
      { slug: 'clamshell_banded', target_sets: 2, target_reps: 15, rest_sec: 30 },
      { slug: 'banded_lateral_walk', target_sets: 2, target_reps: 12, rest_sec: 45 },
      { slug: 'single_leg_glute_bridge', target_sets: 2, target_reps: 10, rest_sec: 45 },
      { slug: 'banded_fire_hydrant', target_sets: 2, target_reps: 12, rest_sec: 30 },
    ],
  },
  {
    id: 'ankle-calf-mobility',
    name: 'Ankle & Calf Mobility',
    goal: 'mobility',
    icon: 'footsteps-outline',
    blurb: 'Unstick tight ankles and calves before a run or at desk breaks.',
    exercises: [
      { slug: 'plantar_fascia_roll', target_sets: 1, target_duration_sec: 60, rest_sec: 15 },
      { slug: 'wall_ankle_dorsiflexion', target_sets: 2, target_duration_sec: 30, rest_sec: 30 },
      { slug: 'banded_ankle_mobilization', target_sets: 2, target_duration_sec: 45, rest_sec: 30 },
      { slug: 'seated_soleus_stretch', target_sets: 2, target_duration_sec: 45, rest_sec: 15 },
      { slug: 'eccentric_calf_raise_bent', target_sets: 2, target_reps: 10, rest_sec: 45 },
    ],
  },
  {
    id: 'glute-activation',
    name: 'Glute Activation',
    goal: 'strength',
    icon: 'barbell-outline',
    blurb: 'Wake up the glute med and glute max before heavier work.',
    exercises: [
      { slug: 'banded_glute_bridge', target_sets: 3, target_reps: 12, rest_sec: 45, keystone: true },
      { slug: 'clamshell_banded', target_sets: 3, target_reps: 15, rest_sec: 30 },
      { slug: 'side_lying_hip_abduction', target_sets: 3, target_reps: 12, rest_sec: 30 },
      { slug: 'single_leg_rdl', target_sets: 3, target_reps: 8, rest_sec: 60 },
    ],
  },
  {
    id: 'hip-mobility-quick',
    name: 'Hip Mobility Quick',
    goal: 'mobility',
    icon: 'refresh-outline',
    blurb: 'Fast hip-flexor and glute reset — fits in a coffee break.',
    exercises: [
      { slug: 'half_kneeling_hip_flexor', target_sets: 2, target_duration_sec: 45, rest_sec: 15 },
      { slug: 'banded_fire_hydrant', target_sets: 2, target_reps: 12, rest_sec: 30 },
      { slug: 'single_leg_glute_bridge', target_sets: 2, target_reps: 10, rest_sec: 30 },
    ],
  },
];

/** Rough minute-count for the card subtitle. Based on target work time
 * + rest, with a 15s per-rep assumption for reps-measured moves. */
export function estimateMinutes(template: WorkoutTemplate): number {
  let sec = 0;
  for (const ex of template.exercises) {
    const sets = ex.target_sets ?? 1;
    const workPerSet = ex.target_duration_sec ?? (ex.target_reps ?? 10) * 3;
    const rest = ex.rest_sec ?? 30;
    sec += sets * workPerSet + Math.max(0, sets - 1) * rest;
  }
  return Math.max(1, Math.round(sec / 60));
}
