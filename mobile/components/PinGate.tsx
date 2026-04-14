import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  isPinSet, setPin, verifyPin, isLockedOut, getFailedAttempts, touchUnlock,
  MAX_ATTEMPTS,
} from '@/lib/pin';
import {
  biometricKind, isBiometricAvailable, isBiometricEnabled, setBiometricEnabled,
  authenticateBiometric, BiometricKind,
} from '@/lib/biometric';

type Mode = 'loading' | 'enter' | 'set' | 'confirm' | 'locked';

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
  const shakeTimer = useRef<any>(null);
  const bioAutoTried = useRef(false);

  useEffect(() => {
    (async () => {
      setBioKind(await biometricKind());
      setBioEnabled(await isBiometricEnabled());
      if (await isLockedOut()) { setMode('locked'); return; }
      const has = await isPinSet();
      if (!has) { setMode('set'); setMessage('Set a 4-digit PIN to lock the app.'); return; }
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
          if (bioKind !== 'none' && !bioEnabled) { setOfferEnableBio(true); return; }
          onUnlock();
          return;
        }
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
          if (bioKind !== 'none') { setOfferEnableBio(true); return; }
          onUnlock();
        } else {
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

  const press = (n: string) => { if (entered.length < 4) setEntered((e) => e + n); };
  const backspace = () => setEntered((e) => e.slice(0, -1));

  if (mode === 'loading') {
    return <View style={styles.container}><ActivityIndicator size="large" color="#1a73e8" /></View>;
  }

  if (offerEnableBio) {
    return (
      <View style={styles.container}>
        <Ionicons
          name={bioKind === 'face' ? 'happy-outline' : 'finger-print'}
          size={56} color="#1a73e8"
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
        color={mode === 'locked' ? '#e74c3c' : '#1a73e8'}
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
            size={16} color="#1a73e8"
          />
          <Text style={styles.bioBtnText}>Use {bioLabel(bioKind)}</Text>
        </Pressable>
      )}
      {mode === 'locked' && (
        <Text style={styles.lockedText}>
          Too many wrong attempts. Close and reopen the app to try again.
        </Text>
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
  dotFilled: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  dotWrong: { borderColor: '#e74c3c', backgroundColor: '#e74c3c' },

  wrongText: { color: '#e74c3c', fontSize: 13, marginTop: 4, height: 20 },
  lockedText: { color: '#e74c3c', fontSize: 14, marginTop: 20, textAlign: 'center', paddingHorizontal: 40 },

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
  bioBtnText: { color: '#1a73e8', fontSize: 13, fontWeight: '600' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1a73e8', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8,
    cursor: 'pointer' as any,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  ghostBtn: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#ddd', cursor: 'pointer' as any,
  },
  ghostBtnText: { color: '#666', fontWeight: '600', fontSize: 14 },
});
