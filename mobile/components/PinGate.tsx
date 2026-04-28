import { colors } from "@/lib/colors";
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  isPinSet, setPin, verifyPin, isLockedOut, getFailedAttempts, touchUnlock,
  clearPin, MAX_ATTEMPTS,
} from '@/lib/pin';
import {
  biometricKind, isBiometricAvailable, isBiometricEnabled, setBiometricEnabled,
  authenticateBiometric, BiometricKind,
} from '@/lib/biometric';
import { haptics } from '@/lib/haptics';

// 'intro' only fires on first run when biometrics are available — it
// reframes the PIN setup as a fallback so the user isn't surprised later.
type Mode = 'loading' | 'intro' | 'enter' | 'set' | 'confirm' | 'locked';

export default function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [mode, setMode] = useState<Mode>('loading');
  const [entered, setEntered] = useState('');
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [wrong, setWrong] = useState(0);
  const [shake, setShake] = useState(false);
  const [message, setMessage] = useState('');
  const [bioKind, setBioKind] = useState<BiometricKind>('none');
  const [bioEnabled, setBioEnabled] = useState(false);
  const [offerEnableBio, setOfferEnableBio] = useState(false);
  // Set by the intro "Continue with Face ID" button. After the user
  // finishes the required PIN setup we auto-enable biometric without
  // showing the post-setup offer again.
  const [autoEnableBio, setAutoEnableBio] = useState(false);
  const shakeTimer = useRef<any>(null);
  const bioAutoTried = useRef(false);

  useEffect(() => {
    (async () => {
      const bk = await biometricKind();
      setBioKind(bk);
      setBioEnabled(await isBiometricEnabled());
      if (await isLockedOut()) { setMode('locked'); return; }
      const has = await isPinSet();
      if (!has) {
        // First run: if biometrics are available, lead with the intro so
        // the user knows Face ID / Touch ID will be the primary unlock
        // and the PIN is a backup. Otherwise jump straight to PIN setup.
        if (bk !== 'none') {
          setMode('intro');
        } else {
          setMode('set');
          setMessage('Set a 4-digit PIN to lock the app.');
        }
        return;
      }
      setWrong(await getFailedAttempts());
      setMode('enter');
    })();
    return () => { if (shakeTimer.current) clearTimeout(shakeTimer.current); };
  }, []);

  // Auto-prompt biometric on first entry into 'enter' mode if the user has
  // enabled it. One try — if they cancel, fall through to PIN.
  useEffect(() => {
    if (mode !== 'enter' || bioAutoTried.current) return;
    if (!bioEnabled || bioKind === 'none') return;
    bioAutoTried.current = true;
    (async () => {
      const ok = await authenticateBiometric(bioPrompt(bioKind));
      if (ok) {
        await touchUnlock();
        onUnlock();
      }
    })();
  }, [mode, bioEnabled, bioKind]);

  const tryBiometric = async () => {
    const ok = await authenticateBiometric(bioPrompt(bioKind));
    if (ok) { await touchUnlock(); onUnlock(); }
  };

  useEffect(() => {
    if (entered.length !== 4) return;
    (async () => {
      if (mode === 'enter') {
        const ok = await verifyPin(entered);
        if (ok) {
          haptics.success();
          if (bioKind !== 'none' && !bioEnabled) { setOfferEnableBio(true); return; }
          onUnlock();
          return;
        }
        haptics.error();
        const attempts = await getFailedAttempts();
        setWrong(attempts);
        shakeIt();
        if (attempts >= MAX_ATTEMPTS) setMode('locked');
      } else if (mode === 'set') {
        setFirstPin(entered);
        setMode('confirm');
        setMessage('Re-enter the same PIN to confirm.');
        setTimeout(() => setEntered(''), 120);
      } else if (mode === 'confirm') {
        if (entered === firstPin) {
          await setPin(entered);
          haptics.success();
          // If the user picked "Continue with Face ID" at the intro, we
          // already confirmed their intent — skip the second prompt and
          // flip the flag directly.
          if (autoEnableBio) {
            await setBiometricEnabled(true);
            setBioEnabled(true);
            onUnlock();
            return;
          }
          if (bioKind !== 'none') { setOfferEnableBio(true); return; }
          onUnlock();
        } else {
          haptics.error();
          setFirstPin(null);
          setMode('set');
          setMessage("PINs didn't match. Try again.");
          shakeIt();
        }
      }
    })();
  }, [entered]);

  const shakeIt = () => {
    setShake(true);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => { setShake(false); setEntered(''); }, 500);
  };

  const press = (n: string) => {
    if (entered.length < 4) {
      haptics.tap();
      setEntered((e) => e + n);
    }
  };
  const backspace = () => {
    haptics.tap();
    setEntered((e) => e.slice(0, -1));
  };

  // Web-only: support typing the PIN via keyboard. The keypad still
  // works as before; this just adds a parallel input channel for users
  // on a desktop browser where mousing through nine round buttons is
  // slow and feels off. Native (iOS / Android) ignores this — there's
  // no physical keyboard, and on Expo Go the listener noises onto a
  // global Document polyfill.
  //
  // Only digits 0-9 and Backspace are honored. Enter / Return is a
  // no-op because completion auto-submits at length 4. We don't
  // preventDefault on non-handled keys — leave native browser
  // shortcuts alone (Cmd-R, devtools etc.).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (mode !== 'enter' && mode !== 'set' && mode !== 'confirm') return;
    if (offerEnableBio) return;
    if (typeof document === 'undefined') return;

    const onKey = (e: KeyboardEvent) => {
      // Don't intercept while a focused text field consumes the key —
      // PinGate currently has no inputs, but a future wrapper might.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, offerEnableBio]);

  if (mode === 'loading') {
    return <View style={styles.container}><ActivityIndicator size="large" color={colors.primary} /></View>;
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
            onPress={() => {
              setAutoEnableBio(false);
              setMode('set');
              setMessage('Set a 4-digit PIN to lock the app.');
            }}
            accessibilityRole="button"
          >
            <Text style={styles.ghostBtnText}>PIN only</Text>
          </Pressable>
          <Pressable
            style={styles.primaryBtn}
            onPress={async () => {
              // Verify the user actually has biometrics enrolled — system
              // reports `face` availability even when no face is scanned.
              // If the user cancels here we fall back to plain PIN setup.
              const ok = await authenticateBiometric(`Use ${bLabel} to unlock TaskApp`);
              setAutoEnableBio(ok);
              setMode('set');
              setMessage(
                ok
                  ? `Now set a 4-digit PIN as a backup for ${bLabel}.`
                  : 'Set a 4-digit PIN to lock the app.',
              );
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
            onPress={() => { setOfferEnableBio(false); onUnlock(); }}
          >
            <Text style={styles.ghostBtnText}>Not now</Text>
          </Pressable>
          <Pressable
            style={styles.primaryBtn}
            onPress={async () => {
              const ok = await authenticateBiometric(`Enable ${bioLabel(bioKind)}`);
              if (ok) { await setBiometricEnabled(true); setBioEnabled(true); }
              setOfferEnableBio(false);
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
            Too many wrong attempts. Reset the PIN to continue — you'll
            be asked to set a new one.
          </Text>
          <Pressable
            style={styles.resetBtn}
            onPress={async () => {
              await clearPin();
              setEntered('');
              setFirstPin(null);
              setWrong(0);
              setMessage('');
              // After clearPin(), isPinSet() returns false; the next gate
              // pass routes to the "set" / "intro" branch. Re-running the
              // mount-time effect would do the same thing but we already
              // know the state, so transition directly.
              setMode('set');
            }}
            accessibilityRole="button"
            accessibilityLabel="Reset PIN and start over"
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

function bioLabel(kind: BiometricKind): string {
  if (kind === 'face') return 'Face ID';
  if (kind === 'fingerprint') return 'Touch ID';
  if (kind === 'iris') return 'Iris';
  return 'Biometrics';
}

function bioPrompt(kind: BiometricKind): string {
  return `Unlock TaskApp with ${bioLabel(kind)}`;
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
