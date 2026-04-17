import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWorkoutStore, WorkoutSession } from '@/lib/stores';
import * as api from '@/lib/api';
import { formatRel } from '@/lib/format';
import { syncRoutineReminders } from '@/lib/routineReminders';

const GOAL_COLORS: Record<string, string> = {
  rehab: '#e67e22', strength: '#1a73e8', mobility: '#27ae60',
  cardio: '#e74c3c', general: '#7f8c8d',
};

export default function WorkoutsScreen() {
  const router = useRouter();
  const { routines, isLoading, loadRoutines } = useWorkoutStore();
  const [recent, setRecent] = useState<WorkoutSession[]>([]);

  useEffect(() => {
    loadRoutines();
    api.listSessions({ limit: 10 }).then(setRecent).catch(() => {});
  }, []);

  // Re-sync local notifications whenever the routine list (and therefore
  // its reminder_time / reminder_days) changes. No-op on web.
  useEffect(() => {
    if (routines.length > 0) {
      syncRoutineReminders(routines).catch(() => {});
    }
  }, [routines]);

  const streak = computeStreak(recent);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Workouts</Text>
          <Text style={styles.headerSub}>{routines.length} routine{routines.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.trackBtn} onPress={() => router.push('/workout/progress')}>
            <Ionicons name="stats-chart-outline" size={16} color="#1a73e8" />
            <Text style={styles.trackBtnText}>Progress</Text>
          </Pressable>
          <Pressable style={styles.trackBtn} onPress={() => router.push('/workout/admin')}>
            <Ionicons name="images-outline" size={16} color="#1a73e8" />
            <Text style={styles.trackBtnText}>Admin</Text>
          </Pressable>
          <Pressable style={styles.trackBtn} onPress={() => router.push('/workout/track')}>
            <Ionicons name="pulse-outline" size={16} color="#1a73e8" />
            <Text style={styles.trackBtnText}>Track</Text>
          </Pressable>
          <View style={styles.streakBox}>
            <Ionicons name="flame" size={18} color="#e67e22" />
            <Text style={styles.streakText}>{streak} day{streak === 1 ? '' : 's'}</Text>
          </View>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#1a73e8" />
      ) : (
        <FlatList
          data={routines}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => {
            const lastSession = recent.find((s) => s.routine_id === item.id);
            return (
              <Pressable
                style={styles.card}
                onPress={() => router.push(`/workout/${item.id}`)}
              >
                <View style={[styles.goalDot, { backgroundColor: GOAL_COLORS[item.goal] || '#999' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardMeta}>
                    {item.exercises.length} exercises · {item.goal}
                    {lastSession && ` · last ${formatRel(lastSession.started_at)}`}
                  </Text>
                  {item.notes ? <Text style={styles.cardNotes} numberOfLines={2}>{item.notes}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color="#bbb" />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="barbell-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>No routines yet</Text>
              <Text style={styles.emptyHint}>
                Run `python seed_workouts.py your@email.com` to create the Ankle Mobility routine.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function computeStreak(sessions: WorkoutSession[]): number {
  if (sessions.length === 0) return 0;
  const days = new Set(
    sessions.map((s) => new Date(s.started_at).toISOString().slice(0, 10))
  );
  let streak = 0;
  const cur = new Date();
  while (days.has(cur.toISOString().slice(0, 10))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  header: {
    // Wrap so the action chips drop to a second row on narrow screens
    // instead of overflowing horizontally and clipping "Track".
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    alignItems: 'center', rowGap: 8,
    padding: 16, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#333' },
  headerSub: { fontSize: 12, color: '#999', marginTop: 2 },
  streakBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff5e6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  streakText: { fontWeight: '700', color: '#e67e22' },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  trackBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#e8f0fe', cursor: 'pointer' as any,
  },
  trackBtnText: { color: '#1a73e8', fontSize: 13, fontWeight: '600' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    cursor: 'pointer' as any,
  },
  goalDot: { width: 8, height: 40, borderRadius: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#222' },
  cardMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  cardNotes: { fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic' },

  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 32 },
  emptyText: { color: '#999', marginTop: 8, fontSize: 16 },
  emptyHint: { color: '#bbb', marginTop: 8, fontSize: 12, textAlign: 'center' },
});
