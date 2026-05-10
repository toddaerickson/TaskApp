/**
 * PinGate — local-device unlock for TaskApp.
 *
 * State transitions live in mobile/lib/pinGateMachine.ts (pure
 * reducer, unit-tested in pinGateMachine.test.ts). This component
 * owns the side-effects: reading pin/biometric state on mount,
 * verifying / setting / clearing the PIN, prompting the system
 * biometric sheet, firing onUnlock, and rendering the right view
 * for the current mode.
 *
 * The pattern: every async side-effect either dispatches a
 * `_RESOLVED`-shaped action when it completes (so the reducer drives
 * the next mode) or calls onUnlock directly when the user is done
 * with the gate. The reducer never knows about onUnlock or about
 * storage primitives.
 */
import { colors } from "@/lib/colors";
import { useEffect, useReducer, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  isPinSet, setPin, verifyPin, isLockedOut, getFailedAttempts, touchUnlock,
  clearPin, MAX_ATTEMPTS,
} from '@/lib/pin';
import {
  biometricKind, isBiometricEnabled, setBiometricEnabled,
  authenticateBiometric,
} from '@/lib/biometric';
import { haptics } from '@/lib/haptics';
import {
  initialState, reduce, bioLabel, bioPrompt,
} from '@/lib/pinGateMachine';
import { verifyPassword } from '@/lib/api';

export default function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const {
    mode, entered, firstPin, wrong, shake, message, bioKind, bioEnabled,
    offerEnableBio, pendingReset, resetError, resetVerifying,
  } = state;
  // Local-only input — never lands in the reducer (no benefit to a
  // re-renderable hold of the user's typed password, and keeping it
  // local means the cleared-on-close behavior is just an unmount).
  const [resetPassword, setResetPassword] = useState('');
  const shakeTimer = useRef<any>(null);
  const bioAutoTried = useRef(false);

  // --- Mount: read pin + bio state, dispatch the routing decision. ---
  useEffect(() => {
    (async () => {
      const [bk, bEnabled, lockedOut, hasPin, attempts] = await Promise.all([
        biometricKind(),
        isBiometricEnabled(),
        isLockedOut(),
        isPinSet(),
        getFailedAttempts(),
      ]);
      dispatch({
        type: 'MOUNT_RESOLVED',
        bioKind: bk,
        bioEnabled: bEnabled,
        lockedOut,
        hasPin,
        failedAttempts: attempts,
      });
    })();
    return () => { if (shakeTimer.current) clearTimeout(shakeTimer.current); };
  }, []);

  // --- Bio-unlocking: fire biometric immediately on entry. ---
  // The splash stays up while the system sheet is visible so the user
  // never sees a keypad flash on a successful unlock.
  useEffect(() => {
    if (mode !== 'bio-unlocking' || bioAutoTried.current) return;
    bioAutoTried.current = true;
    (async () => {
      const ok = await authenticateBiometric(bioPrompt(bioKind));
      if (ok) {
        await touchUnlock();
        onUnlock();
        return;
      }
      dispatch({ type: 'BIO_CANCEL' });
    })();
  }, [mode, bioKind, onUnlock]);

  // --- 4 digits entered: run the appropriate side-effect for this mode. ---
  useEffect(() => {
    if (entered.length !== 4) return;
    (async () => {
      if (mode === 'enter') {
        const ok = await verifyPin(entered);
        if (ok) {
          haptics.success();
          if (bioKind !== 'none' && !bioEnabled) {
            dispatch({ type: 'PIN_VERIFIED' });
          } else {
            onUnlock();
          }
          return;
        }
        haptics.error();
        const attempts = await getFailedAttempts();
        dispatch({ type: 'PIN_REJECTED', attempts });
      } else if (mode === 'set') {
        dispatch({ type: 'PIN_FIRST_CAPTURED' });
        // Brief clear so the user sees the dots reset before re-entry.
        setTimeout(() => dispatch({ type: 'CLEAR_ENTERED' }), 120);
      } else if (mode === 'confirm') {
        if (entered === firstPin) {
          await setPin(entered);
          haptics.success();
          if (state.autoEnableBio) {
            await setBiometricEnabled(true);
            dispatch({ type: 'PIN_CONFIRM_OK' });
            onUnlock();
            return;
          }
          if (bioKind !== 'none') {
            dispatch({ type: 'PIN_CONFIRM_OK' });
          } else {
            onUnlock();
          }
        } else {
          haptics.error();
          dispatch({ type: 'PIN_CONFIRM_MISMATCH' });
        }
      }
    })();
    // We deliberately depend only on `entered` — same as the original
    // component. Re-running on every state change would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered]);

  // --- Shake settle: schedule SHAKE_DONE after the animation window. ---
  useEffect(() => {
    if (!shake) return;
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => dispatch({ type: 'SHAKE_DONE' }), 500);
  }, [shake]);

  // --- Web keypad: physical keyboard input mirrors the touch keypad. ---
  // Native (iOS / Android) ignores this — there's no physical keyboard,
  // and the listener noises onto a global Document polyfill on Expo Go.
  // Only digits 0-9 and Backspace are honored.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (mode !== 'enter' && mode !== 'set' && mode !== 'confirm') return;
    if (offerEnableBio) return;
    if (typeof document === 'undefined') return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        haptics.tap();
        dispatch({ type: 'DIGIT', n: e.key });
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        haptics.tap();
        dispatch({ type: 'BACKSPACE' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, offerEnableBio]);

  const press = (n: string) => {
    haptics.tap();
    dispatch({ type: 'DIGIT', n });
  };
  const backspace = () => {
    haptics.tap();
    dispatch({ type: 'BACKSPACE' });
  };

  const tryBiometric = async () => {
    const ok = await authenticateBiometric(bioPrompt(bioKind));
    if (ok) { await touchUnlock(); onUnlock(); }
  };

  // ----- render -----

  if (mode === 'loading') {
    return <View style={styles.container}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  if (mode === 'bio-unlocking') {
    return (
      <View style={styles.container} accessibilityLabel={`Unlocking with ${bioLabel(bioKind)}`}>
        <Ionicons
          name={bioKind === 'face' ? 'happy-outline' : 'finger-print'}
          size={56} color={colors.primary}
        />
        <Text style={styles.title}>Unlocking…</Text>
        <Pressable
          style={styles.bioBtn}
          onPress={() => dispatch({ type: 'BIO_CANCEL' })}
          accessibilityRole="button"
        >
          <Text style={styles.bioBtnText}>Use PIN instead</Text>
        </Pressable>
      </View>
    );
  }

  if (mode === 'intro') {
    const bLabel = bioLabel(bioKind);
    return (
      <View style={styles.container}>
        <Ionicons
          name={bioKind === 'face' ? 'happy-outline' : 'finger-print'}
          size={56} color={colors.primary}
        />
        <Text style={styles.title}>Lock TaskApp with {bLabel}</Text>
        <Text style={styles.subtitle}>
          {bLabel} will be the primary unlock. You'll also set a 4-digit PIN as a backup for when {bLabel} isn't available.
        </Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 28 }}>
          <Pressable
            style={styles.ghostBtn}
            onPress={() => dispatch({ type: 'INTRO_PIN_ONLY' })}
            accessibilityRole="button"
          >
            <Text style={styles.ghostBtnText}>PIN only</Text>
          </Pressable>
          <Pressable
            style={styles.primaryBtn}
            onPress={async () => {
              // Verify the user actually has biometrics enrolled — system
              // reports `face` availability even when no face is scanned.
              const ok = await authenticateBiometric(`Use ${bLabel} to unlock TaskApp`);
              dispatch({ type: ok ? 'INTRO_BIO_OK' : 'INTRO_BIO_FAIL' });
            }}
            accessibilityRole="button"
          >
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Continue with {bLabel}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (mode === 'locked' && pendingReset) {
    const submit = async () => {
      if (!resetPassword || resetVerifying) return;
      dispatch({ type: 'RESET_VERIFYING' });
      try {
        const ok = await verifyPassword(resetPassword);
        if (!ok) {
          dispatch({ type: 'RESET_VERIFY_FAILED', message: 'Wrong password.' });
          return;
        }
        await clearPin();
        setResetPassword('');
        dispatch({ type: 'RESET_PIN_CLEARED' });
      } catch {
        // Network / 5xx — keep the lockout intact, let the user retry.
        // Don't reveal whether the server is up vs. the password is
        // wrong (the 401 path above is the only "wrong password" signal).
        dispatch({
          type: 'RESET_VERIFY_FAILED',
          message: "Couldn't reach the server. Check your connection.",
        });
      }
    };
    return (
      <View style={styles.container}>
        <Ionicons name="lock-closed" size={48} color={colors.primary} />
        <Text style={styles.title}>Enter account password</Text>
        <Text style={styles.subtitle}>
          Verify your account password to reset the PIN. The PIN itself stays cleared
          until you set a new one.
        </Text>
        <TextInput
          style={styles.resetInput}
          value={resetPassword}
          onChangeText={setResetPassword}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoComplete="current-password"
          placeholder="Password"
          placeholderTextColor="#6b7280"
          accessibilityLabel="Account password"
          onSubmitEditing={submit}
          returnKeyType="go"
          editable={!resetVerifying}
        />
        {!!resetError && (
          <Text style={styles.wrongText} accessibilityLiveRegion="polite">{resetError}</Text>
        )}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <Pressable
            style={styles.ghostBtn}
            onPress={() => {
              setResetPassword('');
              dispatch({ type: 'RESET_CANCELLED' });
            }}
            accessibilityRole="button"
          >
            <Text style={styles.ghostBtnText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, (resetVerifying || !resetPassword) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={resetVerifying || !resetPassword}
            accessibilityRole="button"
          >
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>
              {resetVerifying ? 'Verifying…' : 'Verify'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (offerEnableBio) {
    return (
      <View style={styles.container}>
        <Ionicons
          name={bioKind === 'face' ? 'happy-outline' : 'finger-print'}
          size={56} color={colors.primary}
        />
        <Text style={styles.title}>Enable {bioLabel(bioKind)}?</Text>
        <Text style={styles.subtitle}>
          Unlock TaskApp with {bioLabel(bioKind)} instead of your PIN. Your PIN still works as a fallback.
        </Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
          <Pressable
            style={styles.ghostBtn}
            onPress={() => { dispatch({ type: 'OFFER_BIO_DECLINED' }); onUnlock(); }}
          >
            <Text style={styles.ghostBtnText}>Not now</Text>
          </Pressable>
          <Pressable
            style={styles.primaryBtn}
            onPress={async () => {
              const ok = await authenticateBiometric(`Enable ${bioLabel(bioKind)}`);
              if (ok) {
                await setBiometricEnabled(true);
                dispatch({ type: 'OFFER_BIO_ACCEPTED' });
              } else {
                dispatch({ type: 'OFFER_BIO_DECLINED' });
              }
              onUnlock();
            }}
          >
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Enable</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const title = mode === 'set' ? 'Set PIN'
    : mode === 'confirm' ? 'Confirm PIN'
    : mode === 'locked' ? 'Locked'
    : 'Enter PIN';
  const remaining = MAX_ATTEMPTS - wrong;

  return (
    <View style={styles.container}>
      <Ionicons
        name={mode === 'set' ? 'key-outline' : 'lock-closed'}
        size={48}
        color={mode === 'locked' ? colors.danger : colors.primary}
      />
      <Text style={styles.title}>{title}</Text>
      {!!message && mode !== 'locked' && <Text style={styles.subtitle}>{message}</Text>}

      {mode !== 'locked' && (
        <View
          style={styles.dots}
          accessibilityRole="progressbar"
          accessibilityLabel={`${entered.length} of 4 digits entered`}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i < entered.length && styles.dotFilled, shake && styles.dotWrong]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          ))}
        </View>
      )}

      {mode === 'enter' && wrong > 0 && wrong < MAX_ATTEMPTS && (
        <Text style={styles.wrongText}>
          Wrong PIN. {remaining} attempt{remaining === 1 ? '' : 's'} left.
        </Text>
      )}
      {mode === 'enter' && bioKind !== 'none' && bioEnabled && (
        <Pressable style={styles.bioBtn} onPress={tryBiometric}>
          <Ionicons
            name={bioKind === 'face' ? 'happy-outline' : 'finger-print'}
            size={16} color={colors.primary}
          />
          <Text style={styles.bioBtnText}>Use {bioLabel(bioKind)}</Text>
        </Pressable>
      )}
      {mode === 'locked' && (
        <>
          <Text style={styles.lockedText}>
            Too many wrong attempts. Enter your account password to
            reset the PIN.
          </Text>
          <Pressable
            style={styles.resetBtn}
            onPress={() => {
              setResetPassword('');
              dispatch({ type: 'RESET_REQUESTED' });
            }}
            accessibilityRole="button"
            accessibilityLabel="Reset PIN with your account password"
          >
            <Ionicons name="refresh-outline" size={16} color="#fff" />
            <Text style={styles.resetBtnText}>Reset PIN</Text>
          </Pressable>
        </>
      )}

      {mode !== 'locked' && (
        <View style={styles.pad}>
          {['1','2','3','4','5','6','7','8','9'].map((n) => (
            <Pressable
              key={n}
              style={styles.key}
              onPress={() => press(n)}
              accessibilityRole="button"
              accessibilityLabel={`Digit ${n}`}
            >
              <Text style={styles.keyText}>{n}</Text>
            </Pressable>
          ))}
          <View style={styles.key} accessibilityElementsHidden importantForAccessibility="no" />
          <Pressable
            style={styles.key}
            onPress={() => press('0')}
            accessibilityRole="button"
            accessibilityLabel="Digit 0"
          >
            <Text style={styles.keyText}>0</Text>
          </Pressable>
          <Pressable
            style={styles.key}
            onPress={backspace}
            accessibilityRole="button"
            accessibilityLabel="Delete last digit"
          >
            <Ionicons name="backspace-outline" size={24} color="#666" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#f5f6fa',
    alignItems: 'center', justifyContent: 'center', paddingTop: 40,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#333', marginTop: 12 },
  subtitle: { fontSize: 13, color: '#666', marginTop: 6, textAlign: 'center', paddingHorizontal: 40 },

  dots: { flexDirection: 'row', gap: 14, marginTop: 28, marginBottom: 12 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#bbb' },
  dotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  dotWrong: { borderColor: colors.danger, backgroundColor: colors.danger },

  wrongText: { color: colors.danger, fontSize: 13, marginTop: 4, height: 20 },
  lockedText: { color: colors.danger, fontSize: 14, marginTop: 20, textAlign: 'center', paddingHorizontal: 40 },
  // 44pt minHeight for HIG; primary-blue filled to read as the
  // affordance the user expects to tap to escape the lockout.
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 16, minHeight: 44,
    borderRadius: 8,
    marginTop: 16,
    justifyContent: 'center',
  },
  resetBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  pad: {
    flexDirection: 'row', flexWrap: 'wrap', width: 240,
    justifyContent: 'space-between', marginTop: 20, gap: 12,
  },
  key: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    cursor: 'pointer' as any,
  },
  keyText: { fontSize: 26, color: '#333', fontWeight: '500' },

  resetInput: {
    width: 260,
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: '#333',
    marginTop: 24,
    backgroundColor: '#fff',
  },

  bioBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#e8f0fe', marginTop: 12, cursor: 'pointer' as any,
  },
  bioBtnText: { color: colors.primary, fontSize: 13, fontWeight: '600' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8,
    cursor: 'pointer' as any,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  ghostBtn: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#ddd', cursor: 'pointer' as any,
  },
  ghostBtnText: { color: '#666', fontWeight: '600', fontSize: 14 },
});
