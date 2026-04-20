/**
 * Settings → Account sub-screen. Three adjacent operations that
 * previously required direct DB / SecureStore edits:
 *
 *  - Change password (server-side bcrypt rotate via POST /auth/change-password)
 *  - Change PIN (device-local via lib/pin.ts; no server round-trip)
 *  - Edit display name (PUT /auth/me)
 *
 * Each section lives in its own card. Errors are rendered inline (no
 * Alert modals) so the user's place in the form survives a validation
 * bounce. No session invalidation on password change — single-user
 * self-hosted; PinGate mitigates the stolen-device case.
 */
import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import * as api from '@/lib/api';
import { useAuthStore } from '@/lib/stores';
import {
  isPinSet, verifyPin, setPin as writePin, clearPin,
} from '@/lib/pin';

export default function AccountSettingsScreen() {
  const router = useRouter();
  const { user, logout, setDisplayName: storeSetDisplayName } = useAuthStore();

  // --- Change password --------------------------------------------------
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwStatus, setPwStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const submitPasswordChange = async () => {
    setPwStatus(null);
    if (!curPw || !newPw || !confirmPw) {
      setPwStatus({ kind: 'err', text: 'Fill in all three fields.' });
      return;
    }
    if (newPw.length < 8) {
      setPwStatus({ kind: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPw !== confirmPw) {
      setPwStatus({ kind: 'err', text: 'New password and confirmation don\'t match.' });
      return;
    }
    setPwBusy(true);
    try {
      await api.changePassword(curPw, newPw);
      setCurPw(''); setNewPw(''); setConfirmPw('');
      setPwStatus({ kind: 'ok', text: 'Password updated.' });
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 401) {
        setPwStatus({ kind: 'err', text: 'Current password is incorrect.' });
      } else if (status === 422) {
        setPwStatus({ kind: 'err', text: 'New password doesn\'t meet the length requirement.' });
      } else {
        setPwStatus({ kind: 'err', text: detail || 'Could not change password.' });
      }
    } finally {
      setPwBusy(false);
    }
  };

  // --- Change PIN -------------------------------------------------------
  // Single view with a small step cursor so the user can re-type without
  // losing context. pinHasBeenSet skips step 1 for users who haven't set
  // a PIN yet.
  const [pinStep, setPinStep] = useState<'current' | 'new' | 'confirm'>('current');
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinStatus, setPinStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinHasBeenSet, setPinHasBeenSet] = useState<boolean | null>(null);

  const ensurePinStatusLoaded = async () => {
    if (pinHasBeenSet === null) {
      const has = await isPinSet();
      setPinHasBeenSet(has);
      if (!has) setPinStep('new');
    }
  };

  // Kick the check off once on mount without useEffect overhead — it's a
  // single storage read and we don't need to re-run it.
  if (pinHasBeenSet === null) ensurePinStatusLoaded();

  const submitPinChange = async () => {
    setPinStatus(null);
    if (pinHasBeenSet && pinStep === 'current') {
      if (!/^\d{4}$/.test(pinCurrent)) {
        setPinStatus({ kind: 'err', text: 'Enter your 4-digit current PIN.' });
        return;
      }
      setPinBusy(true);
      try {
        const ok = await verifyPin(pinCurrent);
        if (!ok) {
          setPinStatus({ kind: 'err', text: 'Current PIN is incorrect.' });
          return;
        }
        setPinStep('new');
      } finally {
        setPinBusy(false);
      }
      return;
    }
    if (pinStep === 'new') {
      if (!/^\d{4}$/.test(pinNew)) {
        setPinStatus({ kind: 'err', text: 'New PIN must be 4 digits.' });
        return;
      }
      setPinStep('confirm');
      return;
    }
    // confirm step
    if (pinNew !== pinConfirm) {
      setPinStatus({ kind: 'err', text: 'PINs don\'t match. Try again.' });
      return;
    }
    setPinBusy(true);
    try {
      await writePin(pinNew);
      setPinCurrent(''); setPinNew(''); setPinConfirm('');
      setPinStep(pinHasBeenSet ? 'current' : 'new');
      setPinHasBeenSet(true);
      setPinStatus({ kind: 'ok', text: 'PIN updated.' });
    } catch (e: any) {
      setPinStatus({ kind: 'err', text: e?.message || 'Could not save PIN.' });
    } finally {
      setPinBusy(false);
    }
  };

  const handleForgotPin = () => {
    const runClear = async () => {
      await clearPin();
      await logout();
      router.replace('/(auth)/login');
    };
    const msg = 'This signs you out and clears the PIN on this device. You\'ll need to log in and set a new PIN.';
    if (Platform.OS === 'web') {
      if (window.confirm(`Clear PIN and sign out?\n\n${msg}`)) runClear();
    } else {
      Alert.alert('Clear PIN?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear & sign out', style: 'destructive', onPress: runClear },
      ]);
    }
  };

  // --- Display name -----------------------------------------------------
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [dnStatus, setDnStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [dnBusy, setDnBusy] = useState(false);

  const submitDisplayName = async () => {
    setDnStatus(null);
    setDnBusy(true);
    try {
      const trimmed = displayName.trim();
      const res = await api.updateProfile({ display_name: trimmed || null });
      storeSetDisplayName(res?.display_name ?? null);
      setDnStatus({ kind: 'ok', text: 'Display name saved.' });
    } catch (e: any) {
      setDnStatus({
        kind: 'err',
        text: e?.response?.data?.detail || 'Could not save display name.',
      });
    } finally {
      setDnBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Stack.Screen options={{ title: 'Account' }} />

      {/* Display name */}
      <Text style={styles.sectionLabel}>Display name</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="How should we address you?"
          placeholderTextColor="#bbb"
          accessibilityLabel="Display name"
          autoCapitalize="words"
        />
        {dnStatus && (
          <Text style={dnStatus.kind === 'ok' ? styles.okText : styles.errText}>
            {dnStatus.text}
          </Text>
        )}
        <Pressable
          style={[styles.saveBtn, dnBusy && { opacity: 0.6 }]}
          onPress={submitDisplayName}
          disabled={dnBusy}
          accessibilityRole="button"
        >
          {dnBusy
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.saveBtnText}>Save name</Text>}
        </Pressable>
      </View>

      {/* Password */}
      <Text style={styles.sectionLabel}>Change password</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={curPw}
          onChangeText={setCurPw}
          placeholder="Current password"
          placeholderTextColor="#bbb"
          accessibilityLabel="Current password"
          secureTextEntry
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          value={newPw}
          onChangeText={setNewPw}
          placeholder="New password (min 8 characters)"
          placeholderTextColor="#bbb"
          accessibilityLabel="New password"
          secureTextEntry
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          value={confirmPw}
          onChangeText={setConfirmPw}
          placeholder="Confirm new password"
          placeholderTextColor="#bbb"
          accessibilityLabel="Confirm new password"
          secureTextEntry
          autoCapitalize="none"
        />
        {pwStatus && (
          <Text style={pwStatus.kind === 'ok' ? styles.okText : styles.errText}>
            {pwStatus.text}
          </Text>
        )}
        <Pressable
          style={[styles.saveBtn, pwBusy && { opacity: 0.6 }]}
          onPress={submitPasswordChange}
          disabled={pwBusy}
          accessibilityRole="button"
        >
          {pwBusy
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.saveBtnText}>Update password</Text>}
        </Pressable>
      </View>

      {/* PIN */}
      <Text style={styles.sectionLabel}>
        {pinHasBeenSet === false ? 'Set PIN' : 'Change PIN'}
      </Text>
      <View style={styles.card}>
        {pinHasBeenSet && pinStep === 'current' && (
          <TextInput
            key="pin-current"
            style={styles.input}
            value={pinCurrent}
            onChangeText={(t) => setPinCurrent(t.replace(/\D/g, '').slice(0, 4))}
            placeholder="Current PIN"
            placeholderTextColor="#bbb"
            accessibilityLabel="Current PIN"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
          />
        )}
        {pinStep === 'new' && (
          <TextInput
            key="pin-new"
            style={styles.input}
            value={pinNew}
            onChangeText={(t) => setPinNew(t.replace(/\D/g, '').slice(0, 4))}
            placeholder="New 4-digit PIN"
            placeholderTextColor="#bbb"
            accessibilityLabel="New PIN"
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            maxLength={4}
          />
        )}
        {pinStep === 'confirm' && (
          <TextInput
            key="pin-confirm"
            style={styles.input}
            value={pinConfirm}
            onChangeText={(t) => setPinConfirm(t.replace(/\D/g, '').slice(0, 4))}
            placeholder="Confirm new PIN"
            placeholderTextColor="#bbb"
            accessibilityLabel="Confirm new PIN"
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            maxLength={4}
          />
        )}
        {pinStatus && (
          <Text style={pinStatus.kind === 'ok' ? styles.okText : styles.errText}>
            {pinStatus.text}
          </Text>
        )}
        <Pressable
          style={[styles.saveBtn, pinBusy && { opacity: 0.6 }]}
          onPress={submitPinChange}
          disabled={pinBusy}
          accessibilityRole="button"
        >
          {pinBusy
            ? <ActivityIndicator size="small" color="#fff" />
            : (
              <Text style={styles.saveBtnText}>
                {pinStep === 'current' ? 'Next'
                  : pinStep === 'new' ? 'Next'
                  : 'Save PIN'}
              </Text>
            )}
        </Pressable>
        {pinHasBeenSet && (
          <Pressable
            style={styles.forgotBtn}
            onPress={handleForgotPin}
            accessibilityRole="button"
          >
            <Ionicons name="help-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.forgotText}>Forgot PIN — clear &amp; sign out</Text>
          </Pressable>
        )}
      </View>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  card: {
    backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 10,
    padding: 14, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 10, fontSize: 15, backgroundColor: '#fafafa', color: '#333',
  },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: 8,
    paddingVertical: 12, alignItems: 'center',
    cursor: 'pointer' as any,
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  okText: { color: colors.success, fontSize: 13 },
  errText: { color: colors.danger, fontSize: 13 },
  forgotBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center', paddingVertical: 8,
    cursor: 'pointer' as any,
  },
  forgotText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
