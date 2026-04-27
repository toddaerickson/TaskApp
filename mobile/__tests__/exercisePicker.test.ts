import { filterExercises } from '@/lib/exercisePicker';
import type { Exercise } from '@/lib/stores';

type Tier = NonNullable<Exercise['evidence_tier']>;

const mk = (
  id: number,
  name: string,
  slug?: string,
  evidence_tier: Tier | null = null,
): Exercise => ({
  id, user_id: null, name, slug,
  category: 'strength', primary_muscle: 'glutes', equipment: 'none',
  difficulty: 1, is_bodyweight: true, measurement: 'reps',
  images: [],
  evidence_tier,
});

const LIBRARY: Exercise[] = [
  mk(1, 'Wall Ankle Dorsiflexion', 'wall_ankle_dorsiflexion'),
  mk(2, 'Banded Glute Bridge', 'banded_glute_bridge'),
  mk(3, 'Clamshell (banded)', 'clamshell_banded'),
];

const TIERED_LIBRARY: Exercise[] = [
  mk(10, 'Bird Dog', 'bird_dog', 'MECHANISM'),
  mk(11, 'Eccentric Heel Drops', 'eccentric_heel_drops_alfredson', 'RCT'),
  mk(12, 'Copenhagen Plank', 'copenhagen_plank', 'RCT'),
  mk(13, 'Inverted Row', 'inverted_row', 'PRACTITIONER'),
  mk(14, 'Cossack Squat', 'cossack_squat', null),
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

describe('filterExercises tierFilter', () => {
  test('null tierFilter returns everything (incl. NULL-tier rows)', () => {
    expect(filterExercises(TIERED_LIBRARY, '', null)).toHaveLength(5);
    expect(filterExercises(TIERED_LIBRARY, '', undefined)).toHaveLength(5);
  });

  test('RCT filter returns only RCT-tier rows', () => {
    const got = filterExercises(TIERED_LIBRARY, '', 'RCT');
    expect(got.map((e) => e.id).sort()).toEqual([11, 12]);
  });

  test('MECHANISM filter excludes other tiers and NULL', () => {
    const got = filterExercises(TIERED_LIBRARY, '', 'MECHANISM');
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(10);
  });

  test('PRACTITIONER filter returns only the one practitioner row', () => {
    const got = filterExercises(TIERED_LIBRARY, '', 'PRACTITIONER');
    expect(got.map((e) => e.id)).toEqual([13]);
  });

  test('THEORETICAL filter with zero matches returns []', () => {
    expect(filterExercises(TIERED_LIBRARY, '', 'THEORETICAL')).toEqual([]);
  });

  test('tierFilter combines with substring search', () => {
    // Two RCT rows; only one matches "drop"
    const got = filterExercises(TIERED_LIBRARY, 'drop', 'RCT');
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe(11);
  });

  test('NULL-tier rows excluded by any non-null tier filter', () => {
    // Cossack Squat (id 14) has tier null.
    const got = filterExercises(TIERED_LIBRARY, 'cossack', 'PRACTITIONER');
    expect(got).toEqual([]);
  });
});
