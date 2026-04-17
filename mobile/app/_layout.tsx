import { colors } from "@/lib/colors";
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import PinGate from '@/components/PinGate';
import { isRecentlyUnlocked } from '@/lib/pin';

export default function RootLayout() {
  const loadToken = useAuthStore((s) => s.loadToken);
  const [unlocked, setUnlocked] = useState<boolean | null>(null);

  useEffect(() => {
    loadToken();
    (async () => {
      setUnlocked(await isRecentlyUnlocked());
    })();
  }, []);

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
  );
}
