import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  isPinSet, setPin, verifyPin, isLockedOut, getFailedAttempts, MAX_ATTEMPTS,
} from '@/lib/pin';

type Mode = 'loading' | 'enter' | 'set' | 'confirm' | 'locked';

export default function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [mode, setMode] = useState<Mode>('loading');
  const [entered, setEntered] = useState('');
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [wrong, setWrong] = useState(0);
  const [shake, setShake] = useState(false);
  const [message, setMessage] = useState('');
  const shakeTimer = useRef<any>(null);

  useEffect(() => {
    (async () => {
      if (await isLockedOut()) { setMode('locked'); return; }
      const has = await isPinSet();
      if (!has) { setMode('set'); setMessage('Set a 4-digit PIN to lock the app.'); return; }
      setWrong(await getFailedAttempts());
      setMode('enter');
    })();
    return () => { if (shakeTimer.current) clearTimeout(shakeTimer.current); };
  }, []);

  useEffect(() => {
    if (entered.length !== 4) return;
    (async () => {
      if (mode === 'enter') {
        const ok = await verifyPin(entered);
        if (ok) { onUnlock(); return; }
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
        <View style={styles.dots}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i < entered.length && styles.dotFilled, shake && styles.dotWrong]}
            />
          ))}
        </View>
      )}

      {mode === 'enter' && wrong > 0 && wrong < MAX_ATTEMPTS && (
        <Text style={styles.wrongText}>
          Wrong PIN. {remaining} attempt{remaining === 1 ? '' : 's'} left.
        </Text>
      )}
      {mode === 'locked' && (
        <Text style={styles.lockedText}>
          Too many wrong attempts. Close and reopen the app to try again.
        </Text>
      )}

      {mode !== 'locked' && (
        <View style={styles.pad}>
          {['1','2','3','4','5','6','7','8','9'].map((n) => (
            <Pressable key={n} style={styles.key} onPress={() => press(n)}>
              <Text style={styles.keyText}>{n}</Text>
            </Pressable>
          ))}
          <View style={styles.key} />
          <Pressable style={styles.key} onPress={() => press('0')}>
            <Text style={styles.keyText}>0</Text>
          </Pressable>
          <Pressable style={styles.key} onPress={backspace}>
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
});
