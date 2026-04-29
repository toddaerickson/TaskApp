/**
 * Cross-platform error/info alerts.
 *
 * Background: `Alert.alert(title, message)` on RN Web silently renders
 * nothing — the user gets no feedback when something fails. Several
 * screens previously inlined a `Platform.OS === 'web'` branch to fall
 * back to `window.alert`. Two of those screens (workout/session/[id].tsx
 * + components/RoutineImportCard.tsx) had a local `showError` helper;
 * everywhere else either used a bare `Alert.alert` (silent on web) or
 * a web-only `window.alert` with no `else` (silent on native).
 *
 * This module is the single shared helper. Replaces both anti-patterns.
 *
 * Usage:
 *   import { showError } from '@/lib/alerts';
 *   showError('Save failed', describeApiError(e, 'Could not save.'));
 *
 * Notes:
 *   - Native uses `Alert.alert(title, message)` (no buttons, dismissable).
 *   - Web uses `window.alert(\`${title}: ${message}\`)` — joins title +
 *     message with a colon because the browser dialog has no title slot.
 *   - Doesn't block the calling promise — `window.alert` is sync but the
 *     function signature stays sync to match. If a caller needs a
 *     callback after dismissal, build a separate helper that resolves
 *     a Promise.
 */
import { Alert, Platform } from 'react-native';


export function showError(title: string, message: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}: ${message}`);
  } else {
    Alert.alert(title, message);
  }
}


/**
 * Same shape as showError but semantically distinguishes an info /
 * success message (e.g. "Imported successfully") from an error. The
 * implementation is identical today — the split exists so callers
 * read clearly and a future styled-toast replacement can route by
 * intent.
 */
export function showInfo(title: string, message: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}: ${message}`);
  } else {
    Alert.alert(title, message);
  }
}
