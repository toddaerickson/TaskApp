import { colors } from "@/lib/colors";
import { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, Pressable, StyleSheet, ScrollView, Modal, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import { onSessionExpired } from '@/lib/sessionExpiry';
import { reportError } from '@/lib/errorReporter';
import { initSentry, sentryWrap } from '@/lib/sentry';
import { UndoSnackbarProvider } from '@/components/UndoSnackbar';

// Fire Sentry init at module load so it's live before any component
// mounts — an error during the first render would otherwise escape. No-op
// when EXPO_PUBLIC_SENTRY_DSN is unset, so dev Expo Go runs stay quiet.
initSentry();

// Web-only PWA polish: service worker + viewport-fit=cover.
// Expo SDK 52 emits its own <meta name="viewport"> and doesn't offer a
// clean hook in app.json to override it (web.meta *adds* tags, doesn't
// replace). We runtime-patch the content attribute so the iPhone
// notch-area gets the full-bleed treatment, and we register the SW
// (see public/sw.js). Failures here are non-fatal — the app works
// without either.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    const existing = viewport.getAttribute('content') || '';
    if (!existing.includes('viewport-fit')) {
      viewport.setAttribute('content', `${existing}, viewport-fit=cover`);
    }
  }
  // Expo SDK 52 ignores web.links in app.json, so the manifest + iOS
  // install icons declared there never make it into the HTML. Inject them
  // at runtime so "Add to Home Screen" picks up the PWA metadata.
  const linkDefs: [string, string, string?][] = [
    ['manifest', '/manifest.json'],
    ['apple-touch-icon', '/apple-touch-icon.png'],
    ['icon', '/favicon.svg', 'image/svg+xml'],
  ];
  for (const [rel, href, type] of linkDefs) {
    if (!document.querySelector(`link[rel="${rel}"][href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (type) link.type = type;
      document.head.appendChild(link);
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // Swallow: failed registration is not a user-visible error.
        // eslint-disable-next-line no-console
        console.warn('[sw] registration failed:', err);
      });
    });
  }
}

// Expo-router picks up a named `ErrorBoundary` export from a layout and
// renders it in place of the route tree when any descendant throws.
// Without this, an uncaught error blanks the whole app.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const router = useRouter();
  // Forward the uncaught render error to our telemetry shim. Covers the
  // gap between the axios interceptor (network/5xx only) and runtime
  // errors in component trees.
  useEffect(() => {
    reportError(error, { route: 'ErrorBoundary' });
  }, [error]);
  return (
    <ScrollView contentContainerStyle={errStyles.container}>
      <Text style={errStyles.title}>Something went wrong</Text>
      <Text style={errStyles.msg}>{error.message || 'An unexpected error occurred.'}</Text>
      <View style={errStyles.row}>
        <Pressable style={errStyles.primaryBtn} onPress={retry} accessibilityRole="button">
          <Text style={errStyles.primaryText}>Try again</Text>
        </Pressable>
        <Pressable
          style={errStyles.secondaryBtn}
          onPress={() => { try { router.replace('/(tabs)/tasks'); } catch { retry(); } }}
          accessibilityRole="button"
        >
          <Text style={errStyles.secondaryText}>Go home</Text>
        </Pressable>
      </View>
      {__DEV__ && error.stack ? (
        <Text style={errStyles.stack}>{error.stack}</Text>
      ) : null}
    </ScrollView>
  );
}

const errStyles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#222', marginBottom: 10 },
  msg: { fontSize: 15, color: '#555', marginBottom: 20 },
  row: { flexDirection: 'row', gap: 10 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12 },
  secondaryText: { color: '#444', fontWeight: '600' },
  stack: { marginTop: 24, fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' as any },
});

function RootLayout() {
  const loadToken = useAuthStore((s) => s.loadToken);
  const logout = useAuthStore((s) => s.logout);
  const isLoading = useAuthStore((s) => s.isLoading);
  const router = useRouter();
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    loadToken();
  }, []);

  // When the axios 401 interceptor fires, clear auth state and surface a
  // modal so the user knows why they were bounced instead of landing on
  // login with no explanation. The token was already wiped in the
  // interceptor, so we just reset the store.
  useEffect(() => {
    return onSessionExpired(() => {
      logout().catch(() => {});
      setSessionExpired(true);
    });
  }, [logout]);

  const dismissExpiredModal = () => {
    setSessionExpired(false);
    try { router.replace('/(auth)/login'); } catch { /* router not ready yet */ }
  };

  // Cold-start auth-loading curtain. Without this, a deep link to a
  // non-root screen (push notification → /workout/session/[id], a
  // shared URL to /(tabs)/settings, etc.) mounts that screen with the
  // zustand auth state still uninitialized — settings.tsx briefly
  // shows undefined user.email, conditional renders on `user` fall
  // through, etc. The axios interceptor reads the token from
  // SecureStore directly so axios calls aren't *missing* auth — this
  // is purely a "flash of empty state" fix at the layout level.
  // index.tsx already has this guard for the root route; pulling it
  // up to the layout extends the same UX to every deep-link target.
  if (isLoading) {
    return (
      <View style={loadingStyles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // GestureHandlerRootView must wrap the OUTERMOST navigation root for
  // react-native-gesture-handler to receive native touch events. Added
  // in PR-D0 for the upcoming drag-and-drop work; harmless overhead
  // for screens that don't use gestures (just a flex:1 wrapper). On
  // web, this maps to a div with passive listeners.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <UndoSnackbarProvider>
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.primary, height: 56 } as any, headerTitleStyle: { fontSize: 17, fontWeight: '600' }, headerTintColor: '#fff' }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: 'Task Details' }} />
        <Stack.Screen name="task/create" options={{ title: 'New Task', presentation: 'modal' }} />
        <Stack.Screen name="workout/[routineId]" options={{ title: 'Routine' }} />
        <Stack.Screen name="workout/session/[id]" options={{ title: 'Workout', headerBackTitle: 'Back' }} />
        <Stack.Screen name="workout/progress/index" options={{ title: 'Progress' }} />
        <Stack.Screen name="workout/progress/print" options={{ title: 'Printable report' }} />
        <Stack.Screen name="workout/track" options={{ title: 'Symptom Tracker' }} />
        <Stack.Screen name="workout/admin" options={{ title: 'Image Admin' }} />
      </Stack>
      <Modal visible={sessionExpired} transparent animationType="fade" onRequestClose={dismissExpiredModal}>
        <View style={sessionStyles.overlay}>
          <View style={sessionStyles.card}>
            <Text style={sessionStyles.title}>Session expired</Text>
            <Text style={sessionStyles.body}>
              For your security, you've been signed out. Sign in again to continue.
            </Text>
            <Pressable style={sessionStyles.btn} onPress={dismissExpiredModal} accessibilityRole="button">
              <Text style={sessionStyles.btnText}>Sign in</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </UndoSnackbarProvider>
    </GestureHandlerRootView>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
});

const sessionStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 20,
    width: '100%', maxWidth: 360,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222' },
  body: { fontSize: 14, color: '#555', marginTop: 8, lineHeight: 20 },
  btn: {
    backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12,
    alignItems: 'center', marginTop: 18,
  },
  btnText: { color: '#fff', fontWeight: '700' },
});

// Wrap so Sentry can pick up navigation breadcrumbs + auto-instrument the
// component tree. Pass-through when Sentry isn't initialized.
export default sentryWrap(RootLayout);
