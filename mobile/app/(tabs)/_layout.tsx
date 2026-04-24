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
      // Shade the active tab so selection is visible at a glance — each
      // screen used to print its name as a big title underneath the header,
      // which duplicated the tab label. Removing those titles freed vertical
      // space; this keeps "which tab am I on" obvious without the duplicate.
      tabBarActiveBackgroundColor: 'rgba(26,115,232,0.10)',
      headerStyle: { backgroundColor: colors.primary, height: 56 } as any,
      headerTitleStyle: { fontSize: 17, fontWeight: '600' },
      headerTintColor: '#fff',
      // Mobile Safari covers the bottom of the viewport with its own chrome,
      // which was clipping the tab labels' descenders. Reserve enough vertical
      // room for icon (18) + label (12) + padding, and grow the bar by the
      // iOS home-indicator inset so labels don't sit under it on iPhones.
      // Growing height (not just padding) keeps the icon+label space intact;
      // if only padding grew, the usable area shrank by the inset amount.
      //
      // Tightened the vertical padding (top 6→3, bottom min 10→6, bar 68→58)
      // so the tab bar feels like a crisp footer on iPhone rather than
      // wasting ~15px of whitespace around the icons. Total content:
      // 3 (top) + 18 (icon) + 2 (label margin) + 16 (label line-height) +
      // 6 (bottom min) = 45px, comfortably inside 58px.
      tabBarStyle: Platform.OS === 'web' ? ({
        height: 'calc(58px + env(safe-area-inset-bottom))',
        paddingTop: 3,
        // RN-web passes the raw CSS string through; on iOS Safari this lifts
        // the bar above the browser chrome. TS types reject the string, so
        // cast through `any` rather than disabling rules everywhere.
        paddingBottom: 'max(6px, env(safe-area-inset-bottom))',
      } as any) : undefined,
      tabBarLabelStyle: {
        fontSize: LABEL_FONT,
        // Default RN-web line-height is too tight; descenders ("g", "y") get
        // clipped on Safari. Bumping line-height fixes it.
        lineHeight: Math.round(LABEL_FONT * 1.3),
        marginTop: 2,
        // Label should never be chopped mid-word. numberOfLines=1 is the
        // default for tab labels so we only need to make sure it doesn't
        // overflow the tab: let the container clip with ellipsis rather
        // than silently truncating the text mid-glyph.
        includeFontPadding: false,
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
