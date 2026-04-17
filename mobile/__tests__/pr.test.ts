import { computePRs, toBestsMap } from '../lib/pr';

describe('pr helpers', () => {
  describe('toBestsMap', () => {
    it('normalizes nullable bests to zeros', () => {
      const map = toBestsMap([
        { exercise_id: 1, max_weight: 50, max_reps: 10, max_duration_sec: null },
        { exercise_id: 2, max_weight: null, max_reps: null, max_duration_sec: 30 },
      ]);
      expect(map[1]).toEqual({ weight: 50, reps: 10, duration: 0 });
      expect(map[2]).toEqual({ weight: 0, reps: 0, duration: 30 });
    });

    it('returns an empty object for an empty list', () => {
      expect(toBestsMap([])).toEqual({});
    });
  });

  describe('computePRs', () => {
    const bests = {
      1: { weight: 20, reps: 8, duration: 0 },
      2: { weight: 0, reps: 0, duration: 30 },
    };

    it('flags a strict weight PR', () => {
      const prs = computePRs(bests, [
        { id: 10, exercise_id: 1, weight: 25, reps: 5 },
      ]);
      expect(prs).toEqual(new Set([10]));
    });

    it('flags a strict rep PR at the same weight', () => {
      const prs = computePRs(bests, [
        { id: 11, exercise_id: 1, weight: 20, reps: 10 },
      ]);
      expect(prs).toEqual(new Set([11]));
    });

    it('matches-but-does-not-beat is NOT a PR', () => {
      const prs = computePRs(bests, [
        { id: 12, exercise_id: 1, weight: 20, reps: 8 },
      ]);
      expect(prs).toEqual(new Set());
    });

    it('walks running best forward; second set only PRs if it beats the first', () => {
      const prs = computePRs(bests, [
        { id: 13, exercise_id: 1, weight: 22, reps: 5 },   // PR: weight > 20
        { id: 14, exercise_id: 1, weight: 21, reps: 6 },   // not a PR: weight < 22
        { id: 15, exercise_id: 1, weight: 23, reps: 3 },   // PR: weight > 22
      ]);
      expect(prs).toEqual(new Set([13, 15]));
    });

    it('treats the first-ever logged set as a PR when there is no history', () => {
      const prs = computePRs({}, [
        { id: 20, exercise_id: 7, reps: 10 },
      ]);
      expect(prs).toEqual(new Set([20]));
    });

    it('empty set (no weight, no reps, no duration) is never a PR', () => {
      const prs = computePRs({}, [
        { id: 21, exercise_id: 7 },
      ]);
      expect(prs).toEqual(new Set());
    });

    it('flags a duration PR on an isometric exercise', () => {
      const prs = computePRs(bests, [
        { id: 30, exercise_id: 2, duration_sec: 45 },
      ]);
      expect(prs).toEqual(new Set([30]));
    });

    it('does not mix history across exercises', () => {
      const prs = computePRs(bests, [
        { id: 40, exercise_id: 2, weight: 5, reps: 100 }, // bests for ex 2 are all zero → PR
      ]);
      expect(prs).toEqual(new Set([40]));
    });
  });
});
