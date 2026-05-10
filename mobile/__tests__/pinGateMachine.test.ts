/**
 * PinGate reducer tests — covers each transition without mounting the
 * component, the native SecureStore, or any biometric module. These
 * complement the existing component tests (PinGate.test.tsx) which
 * cover render + side-effect wiring.
 */
import { initialState, reduce, bioLabel, bioPrompt } from '@/lib/pinGateMachine';

describe('pinGateMachine.reduce', () => {
  describe('MOUNT_RESOLVED', () => {
    it('routes to locked when lockedOut is true (overrides everything else)', () => {
      const next = reduce(initialState, {
        type: 'MOUNT_RESOLVED',
        bioKind: 'face',
        bioEnabled: true,
        lockedOut: true,
        hasPin: true,
        failedAttempts: 5,
      });
      expect(next.mode).toBe('locked');
      expect(next.wrong).toBe(5);
    });

    it('routes to intro on first run when biometrics are available', () => {
      const next = reduce(initialState, {
        type: 'MOUNT_RESOLVED',
        bioKind: 'face',
        bioEnabled: false,
        lockedOut: false,
        hasPin: false,
        failedAttempts: 0,
      });
      expect(next.mode).toBe('intro');
      expect(next.message).toBe('');
    });

    it('routes to set with a prompt on first run when biometrics are unavailable', () => {
      const next = reduce(initialState, {
        type: 'MOUNT_RESOLVED',
        bioKind: 'none',
        bioEnabled: false,
        lockedOut: false,
        hasPin: false,
        failedAttempts: 0,
      });
      expect(next.mode).toBe('set');
      expect(next.message).toBe('Set a 4-digit PIN to lock the app.');
    });

    it('routes to bio-unlocking when returning + bio is enabled', () => {
      const next = reduce(initialState, {
        type: 'MOUNT_RESOLVED',
        bioKind: 'face',
        bioEnabled: true,
        lockedOut: false,
        hasPin: true,
        failedAttempts: 0,
      });
      expect(next.mode).toBe('bio-unlocking');
    });

    it('routes to enter when returning + bio is available but disabled', () => {
      const next = reduce(initialState, {
        type: 'MOUNT_RESOLVED',
        bioKind: 'face',
        bioEnabled: false,
        lockedOut: false,
        hasPin: true,
        failedAttempts: 0,
      });
      expect(next.mode).toBe('enter');
    });

    it('routes to enter when returning + bio is unavailable', () => {
      const next = reduce(initialState, {
        type: 'MOUNT_RESOLVED',
        bioKind: 'none',
        bioEnabled: false,
        lockedOut: false,
        hasPin: true,
        failedAttempts: 2,
      });
      expect(next.mode).toBe('enter');
      expect(next.wrong).toBe(2);
    });
  });

  describe('DIGIT / BACKSPACE / CLEAR_ENTERED', () => {
    const enterMode = { ...initialState, mode: 'enter' as const };

    it('appends a digit', () => {
      const next = reduce(enterMode, { type: 'DIGIT', n: '7' });
      expect(next.entered).toBe('7');
    });

    it('is a no-op past 4 digits', () => {
      const four = { ...enterMode, entered: '1234' };
      const next = reduce(four, { type: 'DIGIT', n: '5' });
      expect(next).toBe(four);
    });

    it('backspace pops the last digit', () => {
      const next = reduce({ ...enterMode, entered: '12' }, { type: 'BACKSPACE' });
      expect(next.entered).toBe('1');
    });

    it('backspace on empty is a no-op (returns same reference)', () => {
      const next = reduce(enterMode, { type: 'BACKSPACE' });
      expect(next).toBe(enterMode);
    });

    it('CLEAR_ENTERED resets entered to empty', () => {
      const next = reduce({ ...enterMode, entered: '99' }, { type: 'CLEAR_ENTERED' });
      expect(next.entered).toBe('');
    });
  });

  describe('PIN_VERIFIED', () => {
    it('opens the enable-bio offer when bio is available but disabled', () => {
      const state = { ...initialState, mode: 'enter' as const, bioKind: 'face' as const, bioEnabled: false };
      const next = reduce(state, { type: 'PIN_VERIFIED' });
      expect(next.offerEnableBio).toBe(true);
    });

    it('does NOT open the offer when bio is already enabled', () => {
      const state = { ...initialState, mode: 'enter' as const, bioKind: 'face' as const, bioEnabled: true };
      const next = reduce(state, { type: 'PIN_VERIFIED' });
      expect(next.offerEnableBio).toBe(false);
    });

    it('does NOT open the offer when bio is unavailable', () => {
      const state = { ...initialState, mode: 'enter' as const, bioKind: 'none' as const };
      const next = reduce(state, { type: 'PIN_VERIFIED' });
      expect(next.offerEnableBio).toBe(false);
    });
  });

  describe('PIN_REJECTED', () => {
    const state = { ...initialState, mode: 'enter' as const };

    it('increments wrong + shakes', () => {
      const next = reduce(state, { type: 'PIN_REJECTED', attempts: 1 });
      expect(next.wrong).toBe(1);
      expect(next.shake).toBe(true);
      expect(next.mode).toBe('enter');
    });

    it('transitions to locked at MAX_ATTEMPTS', () => {
      const next = reduce(state, { type: 'PIN_REJECTED', attempts: 5 });
      expect(next.mode).toBe('locked');
      expect(next.wrong).toBe(5);
    });
  });

  describe('PIN setup flow', () => {
    it('PIN_FIRST_CAPTURED moves to confirm with the prompt + carries firstPin', () => {
      const setMode = { ...initialState, mode: 'set' as const, entered: '4321' };
      const next = reduce(setMode, { type: 'PIN_FIRST_CAPTURED' });
      expect(next.mode).toBe('confirm');
      expect(next.firstPin).toBe('4321');
      expect(next.message).toBe('Re-enter the same PIN to confirm.');
    });

    it('PIN_CONFIRM_OK flips bioEnabled silently when autoEnableBio was set', () => {
      const state = {
        ...initialState,
        mode: 'confirm' as const,
        bioKind: 'face' as const,
        autoEnableBio: true,
      };
      const next = reduce(state, { type: 'PIN_CONFIRM_OK' });
      expect(next.bioEnabled).toBe(true);
      expect(next.offerEnableBio).toBe(false);
    });

    it('PIN_CONFIRM_OK opens the offer when bio is available but autoEnableBio was not set', () => {
      const state = {
        ...initialState,
        mode: 'confirm' as const,
        bioKind: 'fingerprint' as const,
        autoEnableBio: false,
      };
      const next = reduce(state, { type: 'PIN_CONFIRM_OK' });
      expect(next.offerEnableBio).toBe(true);
      expect(next.bioEnabled).toBe(false);
    });

    it('PIN_CONFIRM_OK is a clean unlock-now when bio is unavailable', () => {
      const state = { ...initialState, mode: 'confirm' as const, bioKind: 'none' as const };
      const next = reduce(state, { type: 'PIN_CONFIRM_OK' });
      expect(next.offerEnableBio).toBe(false);
      expect(next.bioEnabled).toBe(false);
    });

    it('PIN_CONFIRM_MISMATCH drops back to set + clears firstPin + shakes', () => {
      const state = {
        ...initialState,
        mode: 'confirm' as const,
        firstPin: '1234',
        entered: '5678',
      };
      const next = reduce(state, { type: 'PIN_CONFIRM_MISMATCH' });
      expect(next.mode).toBe('set');
      expect(next.firstPin).toBeNull();
      expect(next.message).toMatch(/didn't match/i);
      expect(next.shake).toBe(true);
    });
  });

  describe('biometric transitions', () => {
    it('BIO_OK is a no-op (component fires onUnlock)', () => {
      const state = { ...initialState, mode: 'bio-unlocking' as const, bioKind: 'face' as const };
      const next = reduce(state, { type: 'BIO_OK' });
      expect(next).toBe(state);
    });

    it('BIO_CANCEL falls through to the keypad', () => {
      const state = { ...initialState, mode: 'bio-unlocking' as const, bioKind: 'face' as const };
      const next = reduce(state, { type: 'BIO_CANCEL' });
      expect(next.mode).toBe('enter');
    });
  });

  describe('intro transitions', () => {
    const intro = { ...initialState, mode: 'intro' as const, bioKind: 'face' as const };

    it('INTRO_PIN_ONLY → set with the plain prompt', () => {
      const next = reduce(intro, { type: 'INTRO_PIN_ONLY' });
      expect(next.mode).toBe('set');
      expect(next.autoEnableBio).toBe(false);
      expect(next.message).toBe('Set a 4-digit PIN to lock the app.');
    });

    it('INTRO_BIO_OK → set with autoEnableBio + bio-flavored prompt', () => {
      const next = reduce(intro, { type: 'INTRO_BIO_OK' });
      expect(next.mode).toBe('set');
      expect(next.autoEnableBio).toBe(true);
      expect(next.message).toContain('Face ID');
    });

    it('INTRO_BIO_FAIL → set with autoEnableBio cleared + plain prompt', () => {
      const next = reduce(intro, { type: 'INTRO_BIO_FAIL' });
      expect(next.mode).toBe('set');
      expect(next.autoEnableBio).toBe(false);
      expect(next.message).toBe('Set a 4-digit PIN to lock the app.');
    });
  });

  describe('offer transitions', () => {
    const withOffer = { ...initialState, mode: 'enter' as const, offerEnableBio: true, bioKind: 'face' as const };

    it('OFFER_BIO_DECLINED just closes the overlay', () => {
      const next = reduce(withOffer, { type: 'OFFER_BIO_DECLINED' });
      expect(next.offerEnableBio).toBe(false);
      expect(next.bioEnabled).toBe(false);
    });

    it('OFFER_BIO_ACCEPTED closes the overlay + flips bioEnabled', () => {
      const next = reduce(withOffer, { type: 'OFFER_BIO_ACCEPTED' });
      expect(next.offerEnableBio).toBe(false);
      expect(next.bioEnabled).toBe(true);
    });
  });

  describe('reset password-gate flow', () => {
    const locked = { ...initialState, mode: 'locked' as const, wrong: 5 };

    it('RESET_REQUESTED opens the password overlay + clears any prior error', () => {
      const state = { ...locked, resetError: 'old message' };
      const next = reduce(state, { type: 'RESET_REQUESTED' });
      expect(next.pendingReset).toBe(true);
      expect(next.resetError).toBe('');
      expect(next.resetVerifying).toBe(false);
      // Stays in locked mode — overlay only.
      expect(next.mode).toBe('locked');
    });

    it('RESET_CANCELLED closes the overlay + clears verify state', () => {
      const state = {
        ...locked,
        pendingReset: true,
        resetError: 'wrong password',
        resetVerifying: true,
      };
      const next = reduce(state, { type: 'RESET_CANCELLED' });
      expect(next.pendingReset).toBe(false);
      expect(next.resetError).toBe('');
      expect(next.resetVerifying).toBe(false);
      expect(next.mode).toBe('locked');
    });

    it('RESET_VERIFYING flips the in-flight flag + clears the prior error', () => {
      const state = { ...locked, pendingReset: true, resetError: 'wrong before' };
      const next = reduce(state, { type: 'RESET_VERIFYING' });
      expect(next.resetVerifying).toBe(true);
      expect(next.resetError).toBe('');
    });

    it('RESET_VERIFY_FAILED surfaces the message + clears the in-flight flag', () => {
      const state = { ...locked, pendingReset: true, resetVerifying: true };
      const next = reduce(state, { type: 'RESET_VERIFY_FAILED', message: 'Wrong password.' });
      expect(next.resetVerifying).toBe(false);
      expect(next.resetError).toBe('Wrong password.');
      // Overlay stays open so the user can retry.
      expect(next.pendingReset).toBe(true);
    });

    it('RESET_PIN_CLEARED resets all reset-flow state alongside the input fields', () => {
      const state = {
        ...locked,
        entered: '1234',
        firstPin: '0000',
        message: 'something',
        pendingReset: true,
        resetError: 'wrong',
        resetVerifying: true,
      };
      const next = reduce(state, { type: 'RESET_PIN_CLEARED' });
      expect(next.mode).toBe('set');
      expect(next.entered).toBe('');
      expect(next.firstPin).toBeNull();
      expect(next.wrong).toBe(0);
      expect(next.message).toBe('');
      expect(next.pendingReset).toBe(false);
      expect(next.resetError).toBe('');
      expect(next.resetVerifying).toBe(false);
    });

    it('SHAKE_DONE clears shake + entered', () => {
      const state = { ...initialState, shake: true, entered: '99' };
      const next = reduce(state, { type: 'SHAKE_DONE' });
      expect(next.shake).toBe(false);
      expect(next.entered).toBe('');
    });
  });
});

describe('bioLabel / bioPrompt', () => {
  it('maps kinds to user-facing labels', () => {
    expect(bioLabel('face')).toBe('Face ID');
    expect(bioLabel('fingerprint')).toBe('Touch ID');
    expect(bioLabel('iris')).toBe('Iris');
    expect(bioLabel('none')).toBe('Biometrics');
  });

  it('bioPrompt embeds the label', () => {
    expect(bioPrompt('face')).toBe('Unlock TaskApp with Face ID');
    expect(bioPrompt('fingerprint')).toBe('Unlock TaskApp with Touch ID');
  });
});
