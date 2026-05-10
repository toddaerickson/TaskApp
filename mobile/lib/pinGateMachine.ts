/**
 * PinGate state machine — pure reducer.
 *
 * Extracted from mobile/components/PinGate.tsx so the transition logic
 * is unit-testable without mounting the component, the native
 * SecureStore, or a real biometric prompt. The component still owns
 * the side-effects (verifyPin / authenticateBiometric / clearPin /
 * setBiometricEnabled / onUnlock); this reducer only mutates state in
 * response to events the component dispatches after those calls
 * resolve.
 *
 * Modes:
 *  - 'loading'       — mount-time effect in flight.
 *  - 'intro'         — first run + bio available: ask user to opt in.
 *  - 'bio-unlocking' — splash while the system Face ID / Touch ID
 *                      sheet is up. Cancel/failure → 'enter'. Success
 *                      → caller fires onUnlock (reducer stays put).
 *  - 'enter'         — keypad for a returning user with a PIN set.
 *  - 'set'           — first-run PIN setup (4 digits).
 *  - 'confirm'       — re-enter PIN to confirm during setup.
 *  - 'locked'        — too many wrong attempts; user must reset.
 *
 * The `offerEnableBio` flag is NOT part of the mode union — it
 * overlays whichever mode you're in (today: only ever after 'enter'
 * succeeds or 'confirm' lands). Keeping it as a flag avoids a
 * combinatorial mode explosion and matches the prior component
 * shape.
 *
 * Things the reducer deliberately does NOT track:
 *  - `bioAutoTried` (a ref in the component) — guards the once-only
 *    biometric prompt on entry to 'bio-unlocking'. State that's
 *    React-render-irrelevant lives in a ref, not the reducer.
 *  - onUnlock invocation — fire from the side-effect useEffect after
 *    dispatching the success action.
 */
import type { BiometricKind } from './biometric';
import { MAX_ATTEMPTS } from './pinConstants';

export type Mode =
  | 'loading'
  | 'intro'
  | 'bio-unlocking'
  | 'enter'
  | 'set'
  | 'confirm'
  | 'locked';

export type State = {
  mode: Mode;
  entered: string;
  firstPin: string | null;
  wrong: number;
  shake: boolean;
  message: string;
  bioKind: BiometricKind;
  bioEnabled: boolean;
  offerEnableBio: boolean;
  /** Set true when the user picked "Continue with Face ID" at the
   *  intro AND the system verified it. After PIN_CONFIRM_OK lands,
   *  bioEnabled flips without re-prompting the user. */
  autoEnableBio: boolean;
  /** Overlay flag: when in 'locked' mode and the user taps Reset PIN,
   *  this opens a password-entry screen that calls the backend
   *  /auth/verify-password before clearing pin.hash. Without this gate,
   *  anyone holding the unlocked phone could walk past PinGate by
   *  tapping Reset PIN. */
  pendingReset: boolean;
  /** Inline error shown on the password-entry overlay. '' = no error. */
  resetError: string;
  /** True while verifyPassword() is in flight — disables the submit
   *  button so a slow network doesn't enable double-submit. */
  resetVerifying: boolean;
};

export const initialState: State = {
  mode: 'loading',
  entered: '',
  firstPin: null,
  wrong: 0,
  shake: false,
  message: '',
  bioKind: 'none',
  bioEnabled: false,
  offerEnableBio: false,
  autoEnableBio: false,
  pendingReset: false,
  resetError: '',
  resetVerifying: false,
};

export type Action =
  /** Mount-time effect resolved. The component reads pin + bio state,
   *  then dispatches this once. */
  | {
      type: 'MOUNT_RESOLVED';
      bioKind: BiometricKind;
      bioEnabled: boolean;
      lockedOut: boolean;
      hasPin: boolean;
      failedAttempts: number;
    }
  /** Digit keypad press OR keyboard digit on web. No-op past 4 chars. */
  | { type: 'DIGIT'; n: string }
  /** Keypad backspace OR keyboard Backspace. No-op when empty. */
  | { type: 'BACKSPACE' }
  /** Bulk clear (e.g. after a shake settles or a mode change). */
  | { type: 'CLEAR_ENTERED' }
  /** verifyPin returned true. If bio is available but not enabled,
   *  this opens the offer overlay; otherwise the component fires
   *  onUnlock straight from the effect. */
  | { type: 'PIN_VERIFIED' }
  /** verifyPin returned false. `attempts` is the post-increment count
   *  from getFailedAttempts so the reducer can decide whether to lock. */
  | { type: 'PIN_REJECTED'; attempts: number }
  /** Setup: 4 digits entered in 'set' mode, capture as firstPin and
   *  advance to 'confirm'. */
  | { type: 'PIN_FIRST_CAPTURED' }
  /** Setup confirm matched + setPin completed. autoEnableBio flips
   *  bioEnabled; otherwise the offer may open. */
  | { type: 'PIN_CONFIRM_OK' }
  /** Setup confirm did NOT match. Drop back to 'set' with a message. */
  | { type: 'PIN_CONFIRM_MISMATCH' }
  /** Biometric prompt succeeded. Component fires onUnlock; reducer is
   *  a no-op here, kept for tests to assert "no transition on success". */
  | { type: 'BIO_OK' }
  /** Biometric cancelled or failed. From bio-unlocking → keypad. */
  | { type: 'BIO_CANCEL' }
  /** Intro: user picked "PIN only" — skip biometric, go straight to setup. */
  | { type: 'INTRO_PIN_ONLY' }
  /** Intro: user picked "Continue with Face ID" + system verified. */
  | { type: 'INTRO_BIO_OK' }
  /** Intro: user picked "Continue with Face ID" but system cancelled. */
  | { type: 'INTRO_BIO_FAIL' }
  /** Offer overlay: user picked "Not now". Component fires onUnlock. */
  | { type: 'OFFER_BIO_DECLINED' }
  /** Offer overlay: user picked "Enable" + system verified. Component
   *  setBiometricEnabled(true) before dispatch; the reducer just
   *  flips bioEnabled + closes the overlay. */
  | { type: 'OFFER_BIO_ACCEPTED' }
  /** Locked screen: user tapped Reset PIN — open the password gate. */
  | { type: 'RESET_REQUESTED' }
  /** Password gate: user tapped Cancel. */
  | { type: 'RESET_CANCELLED' }
  /** Password gate: verifyPassword call started (disables submit). */
  | { type: 'RESET_VERIFYING' }
  /** Password gate: verifyPassword returned 401 — surface inline. */
  | { type: 'RESET_VERIFY_FAILED'; message: string }
  /** Password gate: verify succeeded + clearPin completed. */
  | { type: 'RESET_PIN_CLEARED' }
  /** Shake animation settled — clear the wrong-shake visual + entered. */
  | { type: 'SHAKE_DONE' };

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'MOUNT_RESOLVED': {
      let mode: Mode;
      let message = '';
      if (action.lockedOut) {
        mode = 'locked';
      } else if (!action.hasPin) {
        if (action.bioKind !== 'none') {
          mode = 'intro';
        } else {
          mode = 'set';
          message = 'Set a 4-digit PIN to lock the app.';
        }
      } else if (action.bioKind !== 'none' && action.bioEnabled) {
        mode = 'bio-unlocking';
      } else {
        mode = 'enter';
      }
      return {
        ...state,
        bioKind: action.bioKind,
        bioEnabled: action.bioEnabled,
        wrong: action.failedAttempts,
        mode,
        message,
      };
    }

    case 'DIGIT':
      if (state.entered.length >= 4) return state;
      return { ...state, entered: state.entered + action.n };

    case 'BACKSPACE':
      if (state.entered.length === 0) return state;
      return { ...state, entered: state.entered.slice(0, -1) };

    case 'CLEAR_ENTERED':
      return { ...state, entered: '' };

    case 'PIN_VERIFIED':
      // Show the enable-bio offer if bio is available but the user
      // hasn't turned it on yet. Otherwise no state change; component
      // fires onUnlock from its effect.
      if (state.bioKind !== 'none' && !state.bioEnabled) {
        return { ...state, offerEnableBio: true };
      }
      return state;

    case 'PIN_REJECTED': {
      const lockedOut = action.attempts >= MAX_ATTEMPTS;
      return {
        ...state,
        wrong: action.attempts,
        shake: true,
        mode: lockedOut ? 'locked' : state.mode,
      };
    }

    case 'PIN_FIRST_CAPTURED':
      return {
        ...state,
        firstPin: state.entered,
        mode: 'confirm',
        message: 'Re-enter the same PIN to confirm.',
      };

    case 'PIN_CONFIRM_OK':
      if (state.autoEnableBio) {
        return { ...state, bioEnabled: true };
      }
      if (state.bioKind !== 'none') {
        return { ...state, offerEnableBio: true };
      }
      return state;

    case 'PIN_CONFIRM_MISMATCH':
      return {
        ...state,
        firstPin: null,
        mode: 'set',
        message: "PINs didn't match. Try again.",
        shake: true,
      };

    case 'BIO_OK':
      return state;

    case 'BIO_CANCEL':
      return { ...state, mode: 'enter' };

    case 'INTRO_PIN_ONLY':
      return {
        ...state,
        autoEnableBio: false,
        mode: 'set',
        message: 'Set a 4-digit PIN to lock the app.',
      };

    case 'INTRO_BIO_OK': {
      const bLabel = bioLabel(state.bioKind);
      return {
        ...state,
        autoEnableBio: true,
        mode: 'set',
        message: `Now set a 4-digit PIN as a backup for ${bLabel}.`,
      };
    }

    case 'INTRO_BIO_FAIL':
      return {
        ...state,
        autoEnableBio: false,
        mode: 'set',
        message: 'Set a 4-digit PIN to lock the app.',
      };

    case 'OFFER_BIO_DECLINED':
      return { ...state, offerEnableBio: false };

    case 'OFFER_BIO_ACCEPTED':
      return { ...state, offerEnableBio: false, bioEnabled: true };

    case 'RESET_REQUESTED':
      return { ...state, pendingReset: true, resetError: '', resetVerifying: false };

    case 'RESET_CANCELLED':
      return { ...state, pendingReset: false, resetError: '', resetVerifying: false };

    case 'RESET_VERIFYING':
      return { ...state, resetVerifying: true, resetError: '' };

    case 'RESET_VERIFY_FAILED':
      return { ...state, resetVerifying: false, resetError: action.message };

    case 'RESET_PIN_CLEARED':
      return {
        ...state,
        entered: '',
        firstPin: null,
        wrong: 0,
        message: '',
        mode: 'set',
        pendingReset: false,
        resetError: '',
        resetVerifying: false,
      };

    case 'SHAKE_DONE':
      return { ...state, shake: false, entered: '' };

    default: {
      // Exhaustiveness check — adding a new Action case forces an update here.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

export function bioLabel(kind: BiometricKind): string {
  if (kind === 'face') return 'Face ID';
  if (kind === 'fingerprint') return 'Touch ID';
  if (kind === 'iris') return 'Iris';
  return 'Biometrics';
}

export function bioPrompt(kind: BiometricKind): string {
  return `Unlock TaskApp with ${bioLabel(kind)}`;
}
