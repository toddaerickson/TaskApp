/**
 * UndoSnackbar — the React layer for the undo-window state machine.
 *
 * Wraps the pure reducer from lib/undoSnackbar.ts in a context provider
 * and a bottom-of-screen view. Mount `<UndoSnackbarProvider>` once at
 * the root; any screen beneath it can `useUndoSnackbar()` and call
 * `show()` to trigger a 5-second grace period before a destructive
 * write commits.
 *
 *   const { show } = useUndoSnackbar();
 *   show({
 *     message: 'Set deleted',
 *     onUndo: () => setSet(savedSet),          // user hit undo
 *     onTimeout: () => api.deleteSet(id),      // commit the write
 *   });
 *
 * Caveat: the caller must *not* fire the destructive API call before
 * show(). Instead, optimistically update local state and let the
 * snackbar's onTimeout do the server round-trip. Undo becomes a pure
 * local operation.
 */
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import {
  UNDO_WINDOW_MS, UndoEntry, initialUndoState, undoReducer,
} from '@/lib/undoSnackbar';


interface UndoSnackbarApi {
  show: (entry: { message: string; onUndo?: () => void; onTimeout?: () => void }) => void;
  current: UndoEntry | null;
  undo: () => void;
  dismiss: () => void;
}

const UndoSnackbarContext = createContext<UndoSnackbarApi | null>(null);


export function UndoSnackbarProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(undoReducer, initialUndoState);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reschedule the auto-dismiss timer whenever the current entry changes.
  // Keyed on id so rapid show()s cleanly restart.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (state.current) {
      timerRef.current = setTimeout(
        () => dispatch({ type: 'timeout' }),
        UNDO_WINDOW_MS,
      );
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.current?.id]);

  const api: UndoSnackbarApi = {
    current: state.current,
    show: useCallback(
      (entry) => dispatch({ type: 'show', ...entry }),
      [],
    ),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    dismiss: useCallback(() => dispatch({ type: 'dismiss' }), []),
  };

  return (
    <UndoSnackbarContext.Provider value={api}>
      {children}
      <UndoSnackbarView />
    </UndoSnackbarContext.Provider>
  );
}

export function useUndoSnackbar(): UndoSnackbarApi {
  const ctx = useContext(UndoSnackbarContext);
  if (!ctx) {
    throw new Error('useUndoSnackbar() must be used inside <UndoSnackbarProvider>');
  }
  return ctx;
}

function UndoSnackbarView() {
  const { current, undo } = useUndoSnackbar();
  if (!current) return null;
  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        <Text style={styles.message}>{current.message}</Text>
        <Pressable
          onPress={undo}
          style={({ pressed }) => [styles.undoBtn, pressed && { opacity: 0.7 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Undo"
        >
          <Ionicons name="arrow-undo" size={16} color="#fff" />
          <Text style={styles.undoText}>Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}

// 16 from the bottom on web (no safe-area), 48 on native to clear a
// potential tab bar + home indicator. Tweak per platform, don't try
// to use useSafeAreaInsets here — it'd require another provider at
// the root and the 48 works on every device we've tested.
const BOTTOM_INSET = Platform.OS === 'web' ? 16 : 48;

const styles = StyleSheet.create({
  container: {
    position: 'absolute', left: 0, right: 0, bottom: BOTTOM_INSET,
    alignItems: 'center', pointerEvents: 'box-none',
  },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.text,
    paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 8, minWidth: 280, maxWidth: 520,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  message: { color: '#fff', fontSize: 14, flexShrink: 1, marginRight: 12 },
  undoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  undoText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
