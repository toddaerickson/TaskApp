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
 * Doses and keystone markings follow published PT protocols so the
 * templates aren't arbitrary. Sources:
 *   - Reiman & Lorenz, "Integration of strength and conditioning
 *     principles into a rehabilitation program" (IJSPT 2011) — glute
 *     med activation: clamshells 3×15, lateral walks 3×10/side.
 *   - Silbernagel et al., "Eccentric overload training for patients
 *     with chronic Achilles tendon pain" (Scand J Med Sci Sports
 *     2001) — 3×15 heel drops, bent + straight knee, twice daily.
 *   - Cook, "Movement" (2010) — wall ankle dorsiflexion 3×30s.
 *   - ACSM Position Stand on static stretching — ≥30s per hold for
 *     a passive ROM gain.
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
    blurb: 'Reiman-protocol glute-med primer + ankle/single-leg work.',
    exercises: [
      // Ankle mobility first — opens dorsiflexion ROM before loaded work.
      { slug: 'banded_ankle_mobilization', target_sets: 2, target_duration_sec: 45, rest_sec: 30 },
      // Keystone: clamshells are the core of Reiman's glute-med activation
      // protocol. 3×15 is the evidence-based dose.
      { slug: 'clamshell_banded', target_sets: 3, target_reps: 15, rest_sec: 30, keystone: true },
      { slug: 'banded_lateral_walk', target_sets: 3, target_reps: 10, rest_sec: 45 },
      { slug: 'single_leg_glute_bridge', target_sets: 3, target_reps: 10, rest_sec: 45 },
      { slug: 'banded_fire_hydrant', target_sets: 2, target_reps: 12, rest_sec: 30 },
    ],
  },
  {
    id: 'ankle-calf-mobility',
    name: 'Ankle & Calf Mobility',
    goal: 'mobility',
    icon: 'footsteps-outline',
    blurb: 'Silbernagel Achilles loading + Cook-style ankle dorsiflexion.',
    exercises: [
      // Passive tissue work first to prep for loaded calf work.
      { slug: 'plantar_fascia_roll', target_sets: 1, target_duration_sec: 60, rest_sec: 15 },
      // Cook: 3×30s holds per side. Open DF ROM before loading.
      { slug: 'wall_ankle_dorsiflexion', target_sets: 3, target_duration_sec: 30, rest_sec: 30 },
      { slug: 'banded_ankle_mobilization', target_sets: 2, target_duration_sec: 45, rest_sec: 30 },
      // 30s+ static holds per ACSM stretching position stand.
      { slug: 'seated_soleus_stretch', target_sets: 2, target_duration_sec: 30, rest_sec: 15 },
      // Keystone: Silbernagel's eccentric heel-drop protocol. 3×15,
      // bent-knee variant targets the soleus. Pair with straight-knee
      // for full protocol (user can add it in edit mode).
      { slug: 'eccentric_calf_raise_bent', target_sets: 3, target_reps: 15, rest_sec: 60, keystone: true },
    ],
  },
  {
    id: 'glute-activation',
    name: 'Glute Activation',
    goal: 'strength',
    icon: 'barbell-outline',
    blurb: 'Glute-max + glute-med primer before heavier lower-body work.',
    exercises: [
      // Keystone: glute bridge is the compound prime-mover for hip extension.
      { slug: 'banded_glute_bridge', target_sets: 3, target_reps: 12, rest_sec: 45, keystone: true },
      // 3×15 matches Reiman for the glute-med isolation piece.
      { slug: 'clamshell_banded', target_sets: 3, target_reps: 15, rest_sec: 30 },
      { slug: 'side_lying_hip_abduction', target_sets: 3, target_reps: 12, rest_sec: 30 },
      // Compound single-leg hinge — keep reps lower, rest longer.
      { slug: 'single_leg_rdl', target_sets: 3, target_reps: 8, rest_sec: 60 },
    ],
  },
  {
    id: 'hip-mobility-quick',
    name: 'Hip Mobility Quick',
    goal: 'mobility',
    icon: 'refresh-outline',
    blurb: 'Desk-break hip flexor and glute reset (≤8 minutes).',
    exercises: [
      // ACSM: 30s+ static holds for passive ROM. 3 sets pushes response.
      { slug: 'half_kneeling_hip_flexor', target_sets: 3, target_duration_sec: 30, rest_sec: 15 },
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
