import { useEffect, useState } from 'react';
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

  if (unlocked === null) return null;
  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;

  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: '#1a73e8' }, headerTintColor: '#fff' }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="task/[id]" options={{ title: 'Task Details' }} />
      <Stack.Screen name="task/create" options={{ title: 'New Task', presentation: 'modal' }} />
      <Stack.Screen name="workout/[routineId]" options={{ title: 'Routine' }} />
      <Stack.Screen name="workout/session/[id]" options={{ title: 'Workout', headerBackTitle: 'Cancel' }} />
      <Stack.Screen name="workout/track" options={{ title: 'Symptom Tracker' }} />
      <Stack.Screen name="workout/admin" options={{ title: 'Image Admin' }} />
    </Stack>
  );
}
