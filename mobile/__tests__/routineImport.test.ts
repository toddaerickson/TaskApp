/**
 * Pure-function tests for routineImport.parseAndValidate /
 * serializeRoutine. The serialize→parse round trip uses the real
 * exercise_snapshot.json catalog so a drift between the import format
 * and the seeded library is caught at jest time, not in production.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  parseAndValidate, serializeRoutine, Measurement,
} from '@/lib/routineImport';

type SnapshotExercise = { slug: string; measurement: Measurement };
const SNAPSHOT_PATH = path.resolve(
  __dirname, '..', '..', 'backend', 'seed_data', 'exercise_snapshot.json',
);
const snapshot: { exercises: SnapshotExercise[] } = JSON.parse(
  fs.readFileSync(SNAPSHOT_PATH, 'utf-8'),
);
const catalog = new Map<string, Measurement>(
  snapshot.exercises.map((e) => [e.slug, e.measurement]),
);

const goodSlugDuration = snapshot.exercises.find((e) => e.measurement === 'duration')!.slug;
const goodSlugReps = snapshot.exercises.find((e) => e.measurement === 'reps')!.slug;

describe('parseAndValidate', () => {
  test('happy path: minimal flat routine', () => {
    const json = JSON.stringify({
      name: 'Tiny',
      exercises: [
        { slug: goodSlugDuration, target_duration_sec: 30, target_sets: 2 },
      ],
    });
    const result = parseAndValidate(json, catalog);
    expect(result.errors).toEqual([]);
    expect(result.preview!.totals.exercises).toBe(1);
  });

  test('invalid JSON returns parser error', () => {
    const result = parseAndValidate('{not json', catalog);
    expect(result.preview).toBeNull();
    expect(result.errors[0]).toMatch(/Not valid JSON/);
  });

  test('missing name surfaces required-field error', () => {
    const json = JSON.stringify({
      exercises: [{ slug: goodSlugDuration, target_duration_sec: 30 }],
    });
    const result = parseAndValidate(json, catalog);
    expect(result.errors.some((e) => e.includes('`name` is required'))).toBe(true);
  });

  test('unknown slug is rejected with a helpful message', () => {
    const json = JSON.stringify({
      name: 'Bad',
      exercises: [{ slug: 'nope_not_real', target_reps: 10 }],
    });
    const result = parseAndValidate(json, catalog);
    expect(result.errors.some((e) => e.includes('unknown slug "nope_not_real"'))).toBe(true);
  });

  test('measurement mismatch (duration ex without target_duration_sec) is rejected', () => {
    const json = JSON.stringify({
      name: 'Bad',
      exercises: [{ slug: goodSlugDuration, target_reps: 10 }],
    });
    const result = parseAndValidate(json, catalog);
    expect(result.errors.some((e) => /duration exercise/.test(e))).toBe(true);
  });

  test('empty exercises array is rejected', () => {
    const json = JSON.stringify({ name: 'Empty', exercises: [] });
    const result = parseAndValidate(json, catalog);
    expect(result.errors.some((e) => e.includes('at least one'))).toBe(true);
  });
});

describe('serializeRoutine round trip', () => {
  test('serialize(routine) → parseAndValidate has zero errors', () => {
    const routine = {
      name: 'Rehab Routine',
      goal: 'rehab',
      notes: 'Test routine',
      exercises: [
        {
          exercise: { slug: goodSlugDuration },
          target_sets: 2,
          target_duration_sec: 30,
          rest_sec: 30,
        },
        {
          exercise: { slug: goodSlugReps },
          target_sets: 3,
          target_reps: 15,
          rest_sec: 60,
          keystone: true,
        },
      ],
    };
    const exported = serializeRoutine(routine);

    const reparsed = parseAndValidate(JSON.stringify(exported), catalog);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.preview!.totals.exercises).toBe(2);
  });
});
