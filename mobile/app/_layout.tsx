import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useAuthStore } from '@/lib/stores';

export default function RootLayout() {
  const loadToken = useAuthStore((s) => s.loadToken);

  useEffect(() => {
    loadToken();
  }, []);

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
