/**
 * Shape + parity tests for the Workouts home-screen template strip.
 *
 * The parity test (slugs exist in the seed snapshot, measurement lines
 * up with reps vs duration) is the one that matters — it catches drift
 * between the template list and the backend's exercise catalog before
 * a user taps a card and gets a routine with silently-missing moves.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  WORKOUT_TEMPLATES, estimateMinutes, WorkoutGoal,
} from '@/lib/workoutTemplates';

type SnapshotExercise = {
  slug: string;
  measurement: 'reps' | 'duration' | 'distance';
};

const SNAPSHOT_PATH = path.resolve(
  __dirname, '..', '..', 'backend', 'seed_data', 'exercise_snapshot.json',
);

const snapshot: { exercises: SnapshotExercise[] } = JSON.parse(
  fs.readFileSync(SNAPSHOT_PATH, 'utf-8'),
);
const snapshotBySlug = new Map<string, SnapshotExercise>();
for (const ex of snapshot.exercises) snapshotBySlug.set(ex.slug, ex);

const VALID_GOALS: WorkoutGoal[] = ['rehab', 'mobility', 'strength', 'cardio', 'general'];

describe('WORKOUT_TEMPLATES', () => {
  it('is a non-empty list', () => {
    expect(WORKOUT_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('every template has unique id, non-empty name, valid goal, ≥1 exercise', () => {
    const seen = new Set<string>();
    for (const t of WORKOUT_TEMPLATES) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(t.id)).toBe(false);
      seen.add(t.id);
      expect(t.name.length).toBeGreaterThan(0);
      expect(VALID_GOALS).toContain(t.goal);
      expect(t.exercises.length).toBeGreaterThan(0);
      expect(t.icon.length).toBeGreaterThan(0);
    }
  });

  it('every referenced slug exists in the seed snapshot', () => {
    for (const t of WORKOUT_TEMPLATES) {
      for (const te of t.exercises) {
        expect(snapshotBySlug.has(te.slug)).toBe(true);
      }
    }
  });

  it('targets match each exercise measurement (reps vs duration)', () => {
    // Reps-measured moves must have target_reps, not target_duration_sec.
    // Duration-measured moves must have target_duration_sec, not target_reps.
    // Mismatches would create a routine the session UI can't display well.
    for (const t of WORKOUT_TEMPLATES) {
      for (const te of t.exercises) {
        const ex = snapshotBySlug.get(te.slug);
        if (!ex) continue; // covered by the parity test above
        if (ex.measurement === 'reps') {
          expect(te.target_reps).toBeDefined();
          expect(te.target_duration_sec).toBeUndefined();
        } else if (ex.measurement === 'duration') {
          expect(te.target_duration_sec).toBeDefined();
          expect(te.target_reps).toBeUndefined();
        }
      }
    }
  });

  it('estimateMinutes returns a positive integer', () => {
    for (const t of WORKOUT_TEMPLATES) {
      const m = estimateMinutes(t);
      expect(Number.isInteger(m)).toBe(true);
      expect(m).toBeGreaterThan(0);
    }
  });
});
