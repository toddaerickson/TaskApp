import { colors } from "@/lib/colors";
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  const { token, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return token ? <Redirect href="/(tabs)/tasks" /> : <Redirect href="/(auth)/login" />;
}
