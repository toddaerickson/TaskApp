import { filterExercises } from '@/lib/exercisePicker';
import type { Exercise } from '@/lib/stores';

const mk = (id: number, name: string, slug?: string): Exercise => ({
  id, user_id: null, name, slug,
  category: 'strength', primary_muscle: 'glutes', equipment: 'none',
  difficulty: 1, is_bodyweight: true, measurement: 'reps',
  images: [],
});

const LIBRARY: Exercise[] = [
  mk(1, 'Wall Ankle Dorsiflexion', 'wall_ankle_dorsiflexion'),
  mk(2, 'Banded Glute Bridge', 'banded_glute_bridge'),
  mk(3, 'Clamshell (banded)', 'clamshell_banded'),
];

describe('filterExercises', () => {
  test('empty query returns the full list', () => {
    expect(filterExercises(LIBRARY, '')).toHaveLength(3);
  });

  test('whitespace-only query returns the full list', () => {
    expect(filterExercises(LIBRARY, '   ')).toHaveLength(3);
  });

  test('case-insensitive name substring match', () => {
    const got = filterExercises(LIBRARY, 'WALL');
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(1);
  });

  test('substring anywhere in the name', () => {
    const got = filterExercises(LIBRARY, 'bridge');
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(2);
  });

  test('slug match when name does not match', () => {
    // "wall_ankle" exists only in the slug, not verbatim in the name
    // ("Wall Ankle Dorsiflexion" has a space).
    const got = filterExercises(LIBRARY, 'wall_ankle');
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(1);
  });

  test('trims query whitespace before matching', () => {
    expect(filterExercises(LIBRARY, '  banded  ')).toHaveLength(2);
  });

  test('no matches returns empty array', () => {
    expect(filterExercises(LIBRARY, 'zzzzz')).toEqual([]);
  });
});
