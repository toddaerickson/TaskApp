import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import * as api from '@/lib/api';
import { colors } from '@/lib/colors';
import { kv } from '@/lib/kvStorage';
import {
  MissedReminder,
  dismissKey,
  filterDismissed,
  localDateKey,
} from '@/lib/missedReminders';
import { describeApiError } from '@/lib/apiErrors';
import { RoutineDurationPill } from '@/components/RoutineDurationPill';

/**
 * Top-of-Workouts-tab banner showing routines whose `reminder_time`
 * already passed today and the user hasn't started.
 *
 * V1 of routine reminder UX. Full web push (cron + VAPID + service
 * worker) is deferred to V2 once we know whether the inbox alone is
 * enough — the in-app surface costs us no infra and zero iOS PWA
 * quirks. Worst case the user opens the app and sees the missed-row
 * minutes-to-hours later than a push would; for the morning-mobility
 * workflow that's the typical path anyway.
 *
 * Per-row "Start now" hits POST /sessions and routes into the active
 * session screen. "Dismiss" persists `${PREFIX}:${routine_id}:${YMD}`
 * in kvStorage; banner filters dismissed entries client-side. No
 * server round-trip on dismiss.
 */
export function MissedRemindersBanner() {
  const router = useRouter();
  const [reminders, setReminders] = useState<MissedReminder[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = localDateKey();

  const reload = useCallback(async () => {
    setError(null);
    try {
      const fresh = await api.getMissedReminders();
      setReminders(fresh);
    } catch (e) {
      setError(describeApiError(e, "Couldn't load missed reminders."));
    }
  }, []);

  // Refetch + reload dismisses each time the Workouts tab regains focus.
  // Tracking dismisses in component state lets the banner update
  // optimistically on tap before the kv write resolves.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await reload();
        // Read every dismiss key for today. The set is small (one entry
        // per routine the user dismissed today), so a per-key loop is
        // cheaper than a getAllKeys filter.
        if (cancelled) return;
        // Pre-populate `dismissed` from storage so a dismiss that
        // happened on a prior screen / yesterday-still-active session
        // survives a reload.
        const next = new Set<string>();
        for (const m of reminders) {
          const k = dismissKey(m.routine_id, today);
          const v = await kv.getItem(k);
          if (v) next.add(k);
        }
        if (!cancelled) setDismissed(next);
      })();
      return () => { cancelled = true; };
      // `reminders` intentionally NOT in the dep array — we only want
      // to refetch on focus, not on every state update. The storage
      // read uses whatever was just fetched.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload, today]),
  );

  const visible = filterDismissed(reminders, dismissed, today);
  if (!visible.length && !error) return null;

  const handleStart = async (routineId: number) => {
    setStarting(routineId);
    try {
      const session = await api.startSession(routineId);
      router.push(`/workout/session/${session.id}`);
    } catch (e) {
      setError(describeApiError(e, "Couldn't start the session."));
    } finally {
      setStarting(null);
    }
  };

  const handleDismiss = async (routineId: number) => {
    const k = dismissKey(routineId, today);
    // Optimistic — flip UI before the storage write returns. kv.setItem
    // can't fail meaningfully (localStorage quota / private mode is
    // already swallowed by the kvStorage shim).
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(k);
      return next;
    });
    void kv.setItem(k, '1');
  };

  return (
    <View style={styles.container} accessibilityLabel="Missed routine reminders">
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.dangerText} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {visible.map((m) => (
        <View key={m.routine_id} style={styles.card}>
          <Ionicons name="time-outline" size={18} color={colors.warningText} />
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={1}>{m.name}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>scheduled {m.reminder_time}</Text>
              <RoutineDurationPill minutes={m.target_minutes} />
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.startBtn, pressed && { opacity: 0.7 }]}
            disabled={starting === m.routine_id}
            onPress={() => handleStart(m.routine_id)}
            accessibilityRole="button"
            accessibilityLabel={`Start ${m.name} now`}
          >
            {starting === m.routine_id ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="play" size={12} color="#fff" />
                <Text style={styles.startBtnText}>Start</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={styles.dismissBtn}
            onPress={() => handleDismiss(m.routine_id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${m.name} for today`}
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingTop: 8, gap: 6 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primaryOnLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '600', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { fontSize: 11, color: colors.textMuted },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    minHeight: 32,
    borderRadius: 6,
    justifyContent: 'center',
  },
  startBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  dismissBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 4,
  },
  errorText: { color: colors.dangerText, fontSize: 12 },
});
