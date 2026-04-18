import { colors } from "@/lib/colors";
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, PixelRatio } from 'react-native';

// Tab-bar sizing. The label was getting clipped on narrow phones and the
// 20px icon felt oversized relative to the 11px label. Shrinking the icon
// and bumping the font keeps both legible. We also scale with the OS font
// setting (PixelRatio.getFontScale) but cap so a user cranked to "huge"
// doesn't push the label out of a fixed-height bar.
const ICON = 18;
const BASE_LABEL_FONT = 12;
const LABEL_FONT = Math.min(BASE_LABEL_FONT * PixelRatio.getFontScale(), 14);

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.primary,
      headerStyle: { backgroundColor: colors.primary },
      headerTintColor: '#fff',
      // Mobile Safari covers the bottom of the viewport with its own chrome,
      // which was clipping the tab labels' descenders. Reserve enough vertical
      // room for icon (18) + label (12) + padding, and use env(safe-area-...)
      // on web so the bar lifts above the iOS browser bar.
      tabBarStyle: Platform.OS === 'web' ? ({
        height: 68,
        paddingTop: 6,
        // RN-web passes the raw CSS string through; on iOS Safari this lifts
        // the bar above the browser chrome. TS types reject the string, so
        // cast through `any` rather than disabling rules everywhere.
        paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
      } as any) : undefined,
      tabBarLabelStyle: {
        fontSize: LABEL_FONT,
        // Default RN-web line-height is too tight; descenders ("g", "y") get
        // clipped on Safari. Bumping line-height fixes it.
        lineHeight: Math.round(LABEL_FONT * 1.3),
        marginTop: 3,
        // Label should never be chopped mid-word. numberOfLines=1 is the
        // default for tab labels so we only need to make sure it doesn't
        // overflow the tab: let the container clip with ellipsis rather
        // than silently truncating the text mid-glyph.
        includeFontPadding: false,
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
