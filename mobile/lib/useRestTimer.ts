import { useCallback, useEffect, useRef, useState } from 'react';
import { extend, remainingSec } from './restTimer';

export interface RestTimerState {
  /** true while a rest countdown is running */
  active: boolean;
  /** seconds remaining (updates ~4x/sec) */
  remaining: number;
  /** initial length of the current rest in seconds — fixed at start(),
   *  bumped by adjust() so the progress bar stays proportional */
  total: number;
  /** begin a rest of `seconds`; no-op on <=0 */
  start: (seconds: number) => void;
  /** cancel immediately, no onComplete fired */
  stop: () => void;
  /** add or subtract seconds from the running rest */
  adjust: (deltaSec: number) => void;
}

/**
 * Countdown timer hoisted above the exercise blocks so tapping a
 * different exercise mid-rest doesn't kill the timer. Uses `Date.now()`
 * + setInterval rather than storing a decrementing counter, so pauses
 * from dropped frames / JS thread hiccups don't drift the clock.
 */
export function useRestTimer(onComplete?: () => void): RestTimerState {
  const [active, setActive] = useState(false);
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const endAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep the callback in a ref so changing the parent's onComplete
  // reference doesn't re-run the start/tick effects below.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  const clearTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const stop = useCallback(() => {
    clearTick();
    endAtRef.current = 0;
    setActive(false);
    setRemaining(0);
    setTotal(0);
  }, [clearTick]);

  const fire = useCallback(() => {
    clearTick();
    endAtRef.current = 0;
    setActive(false);
    setRemaining(0);
    onCompleteRef.current?.();
  }, [clearTick]);

  const tick = useCallback(() => {
    const left = remainingSec(endAtRef.current, Date.now());
    setRemaining(left);
    if (left <= 0) fire();
  }, [fire]);

  const start = useCallback((seconds: number) => {
    if (!seconds || seconds <= 0) return;
    endAtRef.current = Date.now() + seconds * 1000;
    setTotal(seconds);
    setRemaining(seconds);
    setActive(true);
    clearTick();
    tickRef.current = setInterval(tick, 250);
  }, [clearTick, tick]);

  const adjust = useCallback((deltaSec: number) => {
    if (!endAtRef.current) return;
    const now = Date.now();
    endAtRef.current = extend(endAtRef.current, deltaSec, now);
    setTotal((t) => Math.max(1, t + deltaSec));
    setRemaining(remainingSec(endAtRef.current, now));
  }, []);

  useEffect(() => () => { clearTick(); }, [clearTick]);

  return { active, remaining, total, start, stop, adjust };
}
