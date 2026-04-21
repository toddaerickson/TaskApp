/**
 * Home-tab preference. Stored in localStorage on web; native falls back
 * to the default every session (no-op on write).
 *
 * Kept sync so `app/index.tsx` can choose the redirect target without a
 * loading-spinner detour. This is web-primary; a native port can swap
 * in AsyncStorage without touching callers.
 */
import { Platform } from 'react-native';

export type HomeTab = 'tasks' | 'folders' | 'workouts';

const KEY = 'home.tab';
const DEFAULT: HomeTab = 'tasks';

function isHomeTab(v: unknown): v is HomeTab {
  return v === 'tasks' || v === 'folders' || v === 'workouts';
}

export function loadHomeTab(): HomeTab {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      const v = localStorage.getItem(KEY);
      if (isHomeTab(v)) return v;
    } catch {
      // Storage access can throw in private-browsing on Safari —
      // swallow and fall through to the default.
    }
  }
  return DEFAULT;
}

export function saveHomeTab(tab: HomeTab): void {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(KEY, tab);
    } catch {
      // Same private-browsing guard.
    }
  }
}
