import { colors } from "@/lib/colors";
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import { ActivityIndicator, View } from 'react-native';
import { loadHomeTab } from '@/lib/homeTab';

export default function Index() {
  const { token, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!token) return <Redirect href="/(auth)/login" />;
  // Respect the user's chosen home tab (workouts / tasks / folders).
  // Default is 'tasks' so existing users see no change.
  const tab = loadHomeTab();
  return <Redirect href={`/(tabs)/${tab}`} />;
}
