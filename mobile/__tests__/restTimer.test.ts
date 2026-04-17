import { extend, remainingSec } from '../lib/restTimer';

describe('restTimer helpers', () => {
  describe('remainingSec', () => {
    it('returns 0 for a null/zero endAt', () => {
      expect(remainingSec(0, 1_000_000)).toBe(0);
    });

    it('rounds partial seconds up so the label never flashes 0 early', () => {
      const now = 1_000_000_000;
      // 500 ms left → ceil → 1s
      expect(remainingSec(now + 500, now)).toBe(1);
      // 1001 ms left → ceil → 2s
      expect(remainingSec(now + 1001, now)).toBe(2);
    });

    it('returns the full duration when called at t0', () => {
      const now = 1_000_000_000;
      expect(remainingSec(now + 30_000, now)).toBe(30);
    });

    it('clamps to zero once the clock runs out', () => {
      const now = 1_000_000_000;
      expect(remainingSec(now - 5_000, now)).toBe(0);
    });
  });

  describe('extend', () => {
    it('adds positive seconds to the end time', () => {
      const now = 1_000_000_000;
      const endAt = now + 10_000;
      expect(extend(endAt, 15, now)).toBe(now + 25_000);
    });

    it('subtracts seconds without crossing into the past', () => {
      const now = 1_000_000_000;
      const endAt = now + 5_000; // 5s left
      // -10s would put us at now - 5000; clamp to now
      expect(extend(endAt, -10, now)).toBe(now);
    });

    it('keeps the end time unchanged when delta is zero', () => {
      const now = 1_000_000_000;
      const endAt = now + 7_000;
      expect(extend(endAt, 0, now)).toBe(endAt);
    });
  });
});
