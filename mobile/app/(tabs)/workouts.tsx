import { colors } from "@/lib/colors";
import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, Modal, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWorkoutStore, WorkoutSession } from '@/lib/stores';
import { SkeletonList } from '@/components/Skeleton';
import * as api from '@/lib/api';
import { describeApiError } from '@/lib/apiErrors';
import { formatRel } from '@/lib/format';
import { syncRoutineReminders } from '@/lib/routineReminders';

const GOAL_COLORS: Record<string, string> = {
  rehab: colors.warning, strength: colors.primary, mobility: colors.success,
  cardio: colors.danger, general: '#7f8c8d',
};

const GOAL_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'strength', label: 'Strength' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'rehab', label: 'Rehab' },
  { value: 'cardio', label: 'Cardio' },
];

export default function WorkoutsScreen() {
  const router = useRouter();
  const { routines, isLoading, loadRoutines } = useWorkoutStore();
  const [recent, setRecent] = useState<WorkoutSession[]>([]);

  // "New routine" mini-modal. The previous empty state pointed users at
  // the seed script / Track symptoms; neither made sense for a self-
  // hosted solo user who just wants to build their first routine.
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('general');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    loadRoutines();
    api.listSessions({ limit: 10 })
      .then(setRecent)
      .catch((e) => console.warn('[workouts] listSessions failed:', e));
  }, []);

  // Re-sync local notifications whenever the routine list (and therefore
  // its reminder_time / reminder_days) changes. No-op on web.
  useEffect(() => {
    if (routines.length > 0) {
      syncRoutineReminders(routines)
        .catch((e) => console.warn('[workouts] syncRoutineReminders failed:', e));
    }
  }, [routines]);

  const streak = computeStreak(recent);

  const openCreate = () => {
    setNewName('');
    setNewGoal('general');
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) { setCreateError('Name is required.'); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const routine = await api.createRoutine({ name, goal: newGoal });
      setCreateOpen(false);
      await loadRoutines();
      // Deep-link into the freshly-made routine so the user can add
      // exercises immediately — otherwise we dump them back on a list
      // with a routine that has zero moves.
      router.push(`/workout/${routine.id}`);
    } catch (e) {
      setCreateError(describeApiError(e, 'Could not create routine.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Workouts</Text>
          <Text style={styles.headerSub}>{routines.length} routine{routines.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.newBtn} onPress={openCreate} accessibilityRole="button" accessibilityLabel="New routine">
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.newBtnText}>Routine</Text>
          </Pressable>
          <Pressable style={styles.trackBtn} onPress={() => router.push('/workout/progress')}>
            <Ionicons name="stats-chart-outline" size={16} color={colors.primary} />
            <Text style={styles.trackBtnText}>Progress</Text>
          </Pressable>
          <Pressable style={styles.trackBtn} onPress={() => router.push('/workout/admin')}>
            <Ionicons name="images-outline" size={16} color={colors.primary} />
            <Text style={styles.trackBtnText}>Admin</Text>
          </Pressable>
          <Pressable style={styles.trackBtn} onPress={() => router.push('/workout/track')}>
            <Ionicons name="pulse-outline" size={16} color={colors.primary} />
            <Text style={styles.trackBtnText}>Track</Text>
          </Pressable>
          <View style={styles.streakBox}>
            <Ionicons name="flame" size={18} color={colors.warning} />
            <Text style={styles.streakText}>{streak} day{streak === 1 ? '' : 's'}</Text>
          </View>
        </View>
      </View>

      {isLoading ? (
        <View style={{ padding: 12 }}>
          <SkeletonList count={4} variant="card" />
        </View>
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
              <Ionicons name="barbell-outline" size={64} color="#d0d7e2" />
              <Text style={styles.emptyTitle}>No routines yet</Text>
              <Text style={styles.emptyHint}>
                Routines group exercises you do together. Create one and add moves from the library.
              </Text>
              <Pressable
                style={styles.emptyCta}
                onPress={openCreate}
                accessibilityRole="button"
                accessibilityLabel="Create your first routine"
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.emptyCtaText}>Create routine</Text>
              </Pressable>
            </View>
          }
        />
      )}

      <Modal
        visible={createOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>New routine</Text>
              <Pressable
                onPress={() => setCreateOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close new-routine dialog"
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color="#888" />
              </Pressable>
            </View>

            <Text style={styles.modalLabel}>Name</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Morning mobility"
              accessibilityLabel="Routine name"
              placeholderTextColor="#bbb"
              style={styles.modalInput}
              autoFocus
              autoCapitalize="sentences"
              onSubmitEditing={submitCreate}
              returnKeyType="done"
            />

            <Text style={styles.modalLabel}>Goal</Text>
            <View style={styles.goalRow}>
              {GOAL_OPTIONS.map((g) => (
                <Pressable
                  key={g.value}
                  onPress={() => setNewGoal(g.value)}
                  style={[
                    styles.goalChip,
                    newGoal === g.value && {
                      backgroundColor: GOAL_COLORS[g.value],
                      borderColor: GOAL_COLORS[g.value],
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: newGoal === g.value }}
                >
                  <Text style={[
                    styles.goalChipText,
                    newGoal === g.value && { color: '#fff', fontWeight: '700' },
                  ]}>
                    {g.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {createError && <Text style={styles.modalError}>{createError}</Text>}

            <Pressable
              style={[styles.modalSave, (!newName.trim() || creating) && { opacity: 0.5 }]}
              onPress={submitCreate}
              disabled={!newName.trim() || creating}
              accessibilityRole="button"
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.modalSaveText}>{creating ? 'Creating…' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  streakBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff5e6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  streakText: { fontWeight: '700', color: colors.warning },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: colors.primary, cursor: 'pointer' as any,
  },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  trackBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#e8f0fe', cursor: 'pointer' as any,
  },
  trackBtnText: { color: colors.primary, fontSize: 13, fontWeight: '600' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    cursor: 'pointer' as any,
  },
  goalDot: { width: 8, height: 40, borderRadius: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#222' },
  cardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  cardNotes: { fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic' },

  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 32 },
  emptyText: { color: colors.textMuted, marginTop: 8, fontSize: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#444', marginTop: 12 },
  emptyHint: { color: '#8a94a6', marginTop: 6, fontSize: 13, textAlign: 'center', maxWidth: 300 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 18,
    cursor: 'pointer' as any,
  },
  emptyCtaText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },
  modalHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  modalLabel: { fontSize: 12, color: '#666', fontWeight: '700', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10,
    fontSize: 15, backgroundColor: '#fafafa',
  },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  goalChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee',
    cursor: 'pointer' as any,
  },
  goalChipText: { fontSize: 13, color: '#555', fontWeight: '600' },
  modalError: { color: colors.danger, fontSize: 13, marginTop: 10 },
  modalSave: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingVertical: 12, marginTop: 18,
    cursor: 'pointer' as any,
  },
  modalSaveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
