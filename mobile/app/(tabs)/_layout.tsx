import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';

// Expo Router / RN Tabs pass a `size` that's too big on web (≈28) relative
// to the compact label. Pin the icon to a sensible value and reserve
// vertical room for the label so it doesn't get pushed out of the bar.
const ICON = 20;

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: '#1a73e8',
      headerStyle: { backgroundColor: '#1a73e8' },
      headerTintColor: '#fff',
      tabBarStyle: {
        height: Platform.OS === 'web' ? 56 : undefined,
        paddingBottom: Platform.OS === 'web' ? 6 : undefined,
        paddingTop: Platform.OS === 'web' ? 4 : undefined,
      },
      tabBarLabelStyle: { fontSize: 11 },
      tabBarIconStyle: { marginBottom: 0 },
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
