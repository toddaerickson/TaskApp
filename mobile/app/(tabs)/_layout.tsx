import { colors } from "@/lib/colors";
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ICON = 20;
const BAR_HEIGHT = 48;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.primary,
      tabBarActiveBackgroundColor: 'rgba(26,115,232,0.10)',
      headerStyle: { backgroundColor: colors.primary, height: 56 } as any,
      headerTitleStyle: { fontSize: 17, fontWeight: '600' },
      headerTintColor: '#fff',
      tabBarShowLabel: false,
      tabBarStyle: Platform.OS === 'web' ? ({
        height: `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
        paddingTop: 0,
        paddingBottom: 'max(0px, env(safe-area-inset-bottom))',
      } as any) : {
        height: BAR_HEIGHT + insets.bottom,
        paddingTop: 0,
        paddingBottom: insets.bottom,
      },
      tabBarIconStyle: { marginBottom: 0, marginTop: 0 },
    }}>
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color }) => <Ionicons name="checkmark-circle-outline" size={ICON} color={color} />,
        }}
      />
      <Tabs.Screen
        name="folders"
        options={{
          title: 'Folders',
          tabBarIcon: ({ color }) => <Ionicons name="folder-outline" size={ICON} color={color} />,
        }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: 'Workouts',
          tabBarIcon: ({ color }) => <Ionicons name="barbell-outline" size={ICON} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Ionicons name="settings-outline" size={ICON} color={color} />,
        }}
      />
    </Tabs>
  );
}
