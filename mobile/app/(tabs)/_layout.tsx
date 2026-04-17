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
      // Mobile Safari covers the bottom of the viewport with its own chrome,
      // which was clipping the tab labels' descenders. Reserve enough vertical
      // room for icon (20) + label (12) + padding, and use env(safe-area-...)
      // on web so the bar lifts above the iOS browser bar.
      tabBarStyle: Platform.OS === 'web' ? ({
        height: 64,
        paddingTop: 6,
        // RN-web passes the raw CSS string through; on iOS Safari this lifts
        // the bar above the browser chrome. TS types reject the string, so
        // cast through `any` rather than disabling rules everywhere.
        paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
      } as any) : undefined,
      tabBarLabelStyle: {
        fontSize: 11,
        // Default RN-web line-height is too tight; descenders ("g", "y") get
        // clipped on Safari. Bumping line-height fixes it.
        lineHeight: 14,
        marginTop: 2,
      },
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
