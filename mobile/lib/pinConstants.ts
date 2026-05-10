/**
 * PIN-gate constants that need to be readable from both the
 * storage layer (pin.ts — imports react-native Platform) AND the
 * pure-function reducer (pinGateMachine.ts — must stay
 * Platform-free so the node-libs jest project can run it without
 * the react-native transform).
 *
 * Anything imported from here MUST stay pure data — no
 * side-effects, no react-native imports — or the reducer's test
 * project breaks.
 */

/** Consecutive wrong PIN entries before the gate locks. */
export const MAX_ATTEMPTS = 5;

/** Re-gate after this many minutes of no activity. 4-hour window
 *  set in PR-3; revisit when the threat model changes. */
export const TIMEOUT_MIN = 240;
