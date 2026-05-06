/**
 * Pure-function geometry helpers for drag-and-drop drop-target
 * detection. No React, no RN imports — lives in the node-libs jest
 * project so the math is testable without rendering.
 *
 * Why this exists separately from the components: the actual drag
 * gesture is tied up in react-native-gesture-handler / Reanimated
 * worklets, which are hard to test. The math of "given the pointer
 * at (x,y), which DropTarget contains it?" is pure and high-stakes
 * (a wrong answer drops a task in the wrong group). Splitting it
 * out keeps the geometry verifiable in isolation.
 *
 * Coordinate convention: all rects are in WINDOW coordinates (the
 * absolute screen pixels reported by `View.measureInWindow`). The
 * caller is responsible for converting gesture absolute positions
 * to window coords if needed.
 */

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

/** True iff `point` falls inside `rect` (inclusive on top/left, exclusive on bottom/right). */
export function isPointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x
    && point.x < rect.x + rect.width
    && point.y >= rect.y
    && point.y < rect.y + rect.height
  );
}

/**
 * Return the id of the first registered drop target whose rect contains
 * the point, or null if none. Order is stable — earlier-registered
 * targets win on overlap. Used by the drag layer to show the active
 * drop indicator.
 */
export function findActiveTarget(
  point: Point,
  targets: { id: string; rect: Rect }[],
): string | null {
  for (const t of targets) {
    if (isPointInRect(point, t.rect)) return t.id;
  }
  return null;
}

/**
 * Edge-of-scroller auto-scroll velocity. Returns pixels/frame to
 * scroll the parent — positive = scroll down, negative = scroll up.
 * Within `threshold` of the top → scroll up; within `threshold` of
 * the bottom → scroll down; otherwise 0.
 *
 * Velocity ramps linearly from 0 at the threshold boundary to
 * `maxSpeed` at the very edge, so the user doesn't get a sudden
 * jolt when the pointer crosses into the auto-scroll zone.
 */
export function autoScrollVelocity(
  pointerY: number,
  scrollerRect: Rect,
  threshold: number,
  maxSpeed: number,
): number {
  const topEdge = scrollerRect.y;
  const bottomEdge = scrollerRect.y + scrollerRect.height;

  if (pointerY < topEdge + threshold) {
    // Above the threshold line near the top.
    const proximity = Math.max(0, Math.min(1, (topEdge + threshold - pointerY) / threshold));
    return -proximity * maxSpeed;
  }

  if (pointerY > bottomEdge - threshold) {
    // Below the threshold line near the bottom.
    const proximity = Math.max(0, Math.min(1, (pointerY - (bottomEdge - threshold)) / threshold));
    return proximity * maxSpeed;
  }

  return 0;
}
