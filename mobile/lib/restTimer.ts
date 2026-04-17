// Pure helpers for the session rest timer, separated from the hook so
// they can be unit-tested without mocking the RN runtime. The hook in
// useRestTimer.ts wraps these with real `setInterval` + state.

/** Seconds left, rounded up so "0:01" is visible for at least a tick. */
export function remainingSec(endAtMs: number, nowMs: number): number {
  if (!endAtMs) return 0;
  return Math.max(0, Math.ceil((endAtMs - nowMs) / 1000));
}

/** Add or subtract seconds from a running timer without going into the past. */
export function extend(endAtMs: number, deltaSec: number, nowMs: number): number {
  return Math.max(nowMs, endAtMs + deltaSec * 1000);
}
