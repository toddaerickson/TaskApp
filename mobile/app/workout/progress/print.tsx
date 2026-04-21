/**
 * Printable progress report for PT hand-off. Renders a single-page
 * layout with heatmap + weekly bar + top-3 exercise trends. Intended
 * to be opened from the Progress header's PDF button and saved via
 * the browser's native print menu → "Save as PDF".
 *
 * Web-only: on native the route just tells the user to use the web
 * build. No new npm deps — `window.print()` + an inline print
 * stylesheet that hides navigation chrome does the job.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import * as api from '@/lib/api';
import type { Exercise, WorkoutSession } from '@/lib/stores';
import { aggregateByExercise } from '@/lib/progress';
import StreakHeatmap from '@/components/StreakHeatmap';

export default function ProgressPrintScreen() {
  const { range } = useLocalSearchParams<{ range?: string }>();
  const rangeDays = range ? Number(range) : 0;
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.listSessions({ limit: 200 }),
      api.getExercises(),
    ]).then(([s, e]) => {
      setSessions(s);
      setExercises(e);
    }).finally(() => setLoading(false));
  }, []);

  const stats = useMemo(
    () => aggregateByExercise(sessions, exercises),
    [sessions, exercises],
  );

  // Clamp sessions to the selected range for summary numbers so the
  // print layout matches what the user selected on the main page.
  const sessionsInRange = useMemo(() => {
    if (!rangeDays || rangeDays <= 0) return sessions;
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - rangeDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return sessions.filter((s) => s.started_at.slice(0, 10) >= cutoffStr);
  }, [sessions, rangeDays]);

  const totalSets = sessionsInRange.reduce((n, s) => n + (s.sets?.length ?? 0), 0);
  const top3 = stats.slice(0, 3);

  const rangeLabel = rangeDays > 0 ? `Last ${rangeDays} days` : 'All time';

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Printable report' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Inject a one-off <style> tag on web so the browser's print view
  // hides navigation chrome + scroll artifacts. Cleaned up on unmount
  // so coming back from print doesn't leave the style bound.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.setAttribute('data-taskapp-print', '1');
    style.textContent = `
      @media print {
        /* Hide everything except our print container */
        body * { visibility: hidden; }
        [data-taskapp-print-root], [data-taskapp-print-root] * { visibility: visible; }
        [data-taskapp-print-root] { position: absolute; inset: 0; padding: 24px; }
        /* Hide React Native's header + tab chrome */
        header, nav, [role="tablist"] { display: none !important; }
      }
    `;
    document.head.appendChild(style);
    return () => { style.parentNode?.removeChild(style); };
  }, []);

  const triggerPrint = () => {
    if (Platform.OS === 'web') window.print();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      {...(Platform.OS === 'web' ? { 'data-taskapp-print-root': '1' } as any : {})}
    >
      <Stack.Screen
        options={{
          title: 'Printable report',
          headerRight: () => (
            <Pressable
              onPress={triggerPrint}
              style={({ pressed }) => [styles.printBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Open browser print dialog"
              hitSlop={8}
            >
              <Ionicons name="print" size={16} color="#fff" />
              <Text style={styles.printText}>Print</Text>
            </Pressable>
          ),
        }}
      />

      <Text style={styles.title}>TaskApp · Workout progress report</Text>
      <Text style={styles.sub}>{rangeLabel} · generated {new Date().toLocaleDateString()}</Text>

      <View style={styles.statRow}>
        <Stat label="Sessions" value={String(sessionsInRange.length)} />
        <Stat label="Sets logged" value={String(totalSets)} />
        <Stat label="Exercises used" value={String(stats.length)} />
      </View>

      <Text style={styles.sectionHeader}>Streak heatmap</Text>
      <StreakHeatmap sessions={sessions} rangeDays={rangeDays} />

      <Text style={styles.sectionHeader}>Top exercises</Text>
      {top3.length === 0 ? (
        <Text style={styles.emptyLine}>No exercises logged in this range.</Text>
      ) : (
        top3.map((s) => (
          <View key={s.exercise_id} style={styles.exRow}>
            <Text style={styles.exName}>{s.name}</Text>
            <Text style={styles.exMeta}>
              {s.sessions} session{s.sessions === 1 ? '' : 's'} · {s.points.length} day{s.points.length === 1 ? '' : 's'}
              {s.points.length > 0
                ? ` · best ${Math.max(...s.points.map((p) => p.value))}`
                : ''}
            </Text>
          </View>
        ))
      )}

      {Platform.OS !== 'web' && (
        <Text style={styles.nativeNote}>
          PDF export is available from the web build — open this page in Safari.
        </Text>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessibilityRole="summary" accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#222' },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 16 },
  sectionHeader: {
    fontSize: 14, fontWeight: '700', color: colors.primary,
    marginTop: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  statRow: { flexDirection: 'row', gap: 12 },
  stat: {
    flex: 1, padding: 10,
    borderWidth: 1, borderColor: '#eee', borderRadius: 8,
    alignItems: 'center',
  },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.primary },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  exRow: {
    borderBottomWidth: 1, borderBottomColor: '#eee',
    paddingVertical: 8,
  },
  exName: { fontSize: 14, fontWeight: '600', color: '#222' },
  exMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  emptyLine: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  printBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    marginRight: 8, borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
  },
  printText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  nativeNote: {
    marginTop: 24, padding: 12,
    backgroundColor: '#fff9e6', borderRadius: 6,
    fontSize: 12, color: colors.warning, textAlign: 'center',
  },
});
