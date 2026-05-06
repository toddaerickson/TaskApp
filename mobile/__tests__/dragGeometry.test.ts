/**
 * Geometry tests for drag-and-drop drop-target detection. The math
 * is the high-stakes part of the feature (wrong answer = item drops
 * in the wrong group), so test it ruthlessly in isolation.
 *
 * Pure-function tests, run in the node-libs jest project.
 */
import {
  isPointInRect,
  findActiveTarget,
  autoScrollVelocity,
} from '../lib/dragGeometry';

describe('isPointInRect', () => {
  const rect = { x: 100, y: 100, width: 50, height: 50 };

  it('returns true for points strictly inside', () => {
    expect(isPointInRect({ x: 125, y: 125 }, rect)).toBe(true);
  });

  it('includes the top-left edge', () => {
    expect(isPointInRect({ x: 100, y: 100 }, rect)).toBe(true);
  });

  it('excludes the bottom-right edge (canonical "inclusive top-left, exclusive bottom-right" convention)', () => {
    // Without the exclusion, two adjacent rects (e.g. group A ending at
    // y=150 and group B starting at y=150) would both claim the y=150
    // pointer and the drop target choice depends on iteration order.
    expect(isPointInRect({ x: 150, y: 125 }, rect)).toBe(false);
    expect(isPointInRect({ x: 125, y: 150 }, rect)).toBe(false);
  });

  it('returns false for points outside in any direction', () => {
    expect(isPointInRect({ x: 99, y: 125 }, rect)).toBe(false);
    expect(isPointInRect({ x: 125, y: 99 }, rect)).toBe(false);
    expect(isPointInRect({ x: 200, y: 125 }, rect)).toBe(false);
    expect(isPointInRect({ x: 125, y: 200 }, rect)).toBe(false);
  });
});

describe('findActiveTarget', () => {
  const targets = [
    { id: 'folder-1', rect: { x: 0, y: 0, width: 300, height: 100 } },
    { id: 'folder-2', rect: { x: 0, y: 100, width: 300, height: 100 } },
    { id: 'folder-3', rect: { x: 0, y: 200, width: 300, height: 100 } },
  ];

  it('returns the id of the target containing the point', () => {
    expect(findActiveTarget({ x: 150, y: 50 }, targets)).toBe('folder-1');
    expect(findActiveTarget({ x: 150, y: 150 }, targets)).toBe('folder-2');
    expect(findActiveTarget({ x: 150, y: 250 }, targets)).toBe('folder-3');
  });

  it('returns null when no target contains the point', () => {
    expect(findActiveTarget({ x: 500, y: 500 }, targets)).toBeNull();
  });

  it('on overlap, returns the FIRST target in iteration order (stable, predictable)', () => {
    // Tied targets should not flicker between drops; pin the order.
    const overlapping = [
      { id: 'a', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'b', rect: { x: 0, y: 0, width: 100, height: 100 } },
    ];
    expect(findActiveTarget({ x: 50, y: 50 }, overlapping)).toBe('a');
  });

  it('handles empty target list', () => {
    expect(findActiveTarget({ x: 50, y: 50 }, [])).toBeNull();
  });
});

describe('autoScrollVelocity', () => {
  const scrollerRect = { x: 0, y: 100, width: 400, height: 600 };  // window-coords y=100..700
  const threshold = 60;
  const maxSpeed = 8;

  it('returns 0 when pointer is well inside the scroller', () => {
    expect(autoScrollVelocity(400, scrollerRect, threshold, maxSpeed)).toBe(0);
  });

  it('returns negative (scroll-up) speed near the top edge', () => {
    // Right at the top edge → maximum scroll-up speed.
    expect(autoScrollVelocity(100, scrollerRect, threshold, maxSpeed)).toBe(-maxSpeed);
  });

  it('returns positive (scroll-down) speed near the bottom edge', () => {
    // Right at the bottom edge → maximum scroll-down speed.
    expect(autoScrollVelocity(700, scrollerRect, threshold, maxSpeed)).toBe(maxSpeed);
  });

  it('ramps linearly across the threshold zone (no sudden jolts)', () => {
    // Halfway through the top threshold → half speed.
    const half = autoScrollVelocity(100 + threshold / 2, scrollerRect, threshold, maxSpeed);
    expect(half).toBeCloseTo(-maxSpeed / 2, 1);
  });

  it('clamps to zero at the threshold boundary', () => {
    // Exactly at the threshold-zone boundary → zero (no jitter on ingress).
    expect(autoScrollVelocity(100 + threshold, scrollerRect, threshold, maxSpeed)).toBe(0);
    expect(autoScrollVelocity(700 - threshold, scrollerRect, threshold, maxSpeed)).toBe(0);
  });

  it('returns scroll-up for pointers ABOVE the scroller (e.g. dragged outside the top)', () => {
    // Important for "drag toward an item that's above the visible
    // window" — the velocity should keep ramping (clamped to maxSpeed)
    // even when the pointer leaves the scroller bounds.
    expect(autoScrollVelocity(50, scrollerRect, threshold, maxSpeed)).toBe(-maxSpeed);
  });

  it('returns scroll-down for pointers BELOW the scroller', () => {
    expect(autoScrollVelocity(800, scrollerRect, threshold, maxSpeed)).toBe(maxSpeed);
  });
});
