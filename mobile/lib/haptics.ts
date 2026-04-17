import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Thin wrapper so callers don't need to remember the Platform.OS !== 'web'
// guard and the library's verbose enum names. All calls are fire-and-forget;
// any native failure is swallowed — haptics are a nice-to-have, never critical.
const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

function safe(fn: () => Promise<unknown>) {
  if (!enabled) return;
  try { fn().catch(() => {}); } catch { /* ignore */ }
}

export const haptics = {
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  bump: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  thud: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
