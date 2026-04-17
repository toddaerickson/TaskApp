import { colors } from "@/lib/colors";
import { useEffect, useState } from 'react';
import { AppState, View, Text, Pressable, StyleSheet, ScrollView, Modal } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import PinGate from '@/components/PinGate';
import { isRecentlyUnlocked } from '@/lib/pin';
import { onSessionExpired } from '@/lib/sessionExpiry';

// Expo-router picks up a named `ErrorBoundary` export from a layout and
// renders it in place of the route tree when any descendant throws.
// Without this, an uncaught error blanks the whole app.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const router = useRouter();
  return (
    <ScrollView contentContainerStyle={errStyles.container}>
      <Text style={errStyles.title}>Something went wrong</Text>
      <Text style={errStyles.msg}>{error.message || 'An unexpected error occurred.'}</Text>
      <View style={errStyles.row}>
        <Pressable style={errStyles.primaryBtn} onPress={retry} accessibilityRole="button">
          <Text style={errStyles.primaryText}>Try again</Text>
        </Pressable>
        <Pressable
          style={errStyles.secondaryBtn}
          onPress={() => { try { router.replace('/(tabs)/tasks'); } catch { retry(); } }}
          accessibilityRole="button"
        >
          <Text style={errStyles.secondaryText}>Go home</Text>
        </Pressable>
      </View>
      {__DEV__ && error.stack ? (
        <Text style={errStyles.stack}>{error.stack}</Text>
      ) : null}
    </ScrollView>
  );
}

const errStyles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#222', marginBottom: 10 },
  msg: { fontSize: 15, color: '#555', marginBottom: 20 },
  row: { flexDirection: 'row', gap: 10 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12 },
  secondaryText: { color: '#444', fontWeight: '600' },
  stack: { marginTop: 24, fontSize: 11, color: '#888', fontFamily: 'monospace' as any },
});

export default function RootLayout() {
  const loadToken = useAuthStore((s) => s.loadToken);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    loadToken();
    (async () => {
      setUnlocked(await isRecentlyUnlocked());
    })();
  }, []);

  // When the axios 401 interceptor fires, clear auth state and surface a
  // modal so the user knows why they were bounced instead of landing on
  // login with no explanation. The token was already wiped in the
  // interceptor, so we just reset the store.
  useEffect(() => {
    return onSessionExpired(() => {
      logout().catch(() => {});
      setSessionExpired(true);
    });
  }, [logout]);

  const dismissExpiredModal = () => {
    setSessionExpired(false);
    try { router.replace('/(auth)/login'); } catch { /* router not ready yet */ }
  };

  // Re-lock when the unlock window expires. Two triggers:
  //   1. App returns to foreground after >15 min in background.
  //   2. App stays open past the 15-min mark (polled every 30s).
  useEffect(() => {
    if (!unlocked) return;
    const recheck = async () => {
      if (!(await isRecentlyUnlocked())) setUnlocked(false);
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') recheck();
    });
    const id = setInterval(recheck, 30_000);
    return () => { sub.remove(); clearInterval(id); };
  }, [unlocked]);

  if (unlocked === null) return null;
  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;

  return (
    <>
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.primary }, headerTintColor: '#fff' }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: 'Task Details' }} />
        <Stack.Screen name="task/create" options={{ title: 'New Task', presentation: 'modal' }} />
        <Stack.Screen name="workout/[routineId]" options={{ title: 'Routine' }} />
        <Stack.Screen name="workout/session/[id]" options={{ title: 'Workout', headerBackTitle: 'Cancel' }} />
        <Stack.Screen name="workout/progress" options={{ title: 'Progress' }} />
        <Stack.Screen name="workout/track" options={{ title: 'Symptom Tracker' }} />
        <Stack.Screen name="workout/admin" options={{ title: 'Image Admin' }} />
      </Stack>
      <Modal visible={sessionExpired} transparent animationType="fade" onRequestClose={dismissExpiredModal}>
        <View style={sessionStyles.overlay}>
          <View style={sessionStyles.card}>
            <Text style={sessionStyles.title}>Session expired</Text>
            <Text style={sessionStyles.body}>
              For your security, you've been signed out. Sign in again to continue.
            </Text>
            <Pressable style={sessionStyles.btn} onPress={dismissExpiredModal} accessibilityRole="button">
              <Text style={sessionStyles.btnText}>Sign in</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const sessionStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 20,
    width: '100%', maxWidth: 360,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222' },
  body: { fontSize: 14, color: '#555', marginTop: 8, lineHeight: 20 },
  btn: {
    backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12,
    alignItems: 'center', marginTop: 18,
  },
  btnText: { color: '#fff', fontWeight: '700' },
});
