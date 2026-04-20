import { colors } from "@/lib/colors";
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, Modal, TextInput, ScrollView, Platform, Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWorkoutStore, WorkoutSession, Exercise, Routine } from '@/lib/stores';
import { SkeletonList } from '@/components/Skeleton';
import ReminderSheet from '@/components/ReminderSheet';
import * as api from '@/lib/api';
import { describeApiError } from '@/lib/apiErrors';
import { formatRel } from '@/lib/format';
import { syncRoutineReminders } from '@/lib/routineReminders';
import {
  WORKOUT_TEMPLATES, WorkoutTemplate, estimateMinutes,
} from '@/lib/workoutTemplates';
import { formatReminder } from '@/lib/reminders';

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
  // Rehab-routine flag at creation time. Complements the in-detail toggle
  // from #51 so users can declare intent before the first session — no
  // need to create then immediately flip. Default off keeps strength
  // creations untouched.
  const [newTracksSymptoms, setNewTracksSymptoms] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-template "creating…" flag so taps during the round-trip disable
  // that card without blanking the whole strip. Keyed on template.id.
  const [instantiating, setInstantiating] = useState<string | null>(null);

  // Reminder sheet: null when closed, the target routine when open. Kept
  // here (not per-card) so exactly one sheet can be open at a time.
  const [reminderTarget, setReminderTarget] = useState<Routine | null>(null);

  // Refetch every time the tab regains focus. `useEffect([])` only fires
  // on mount, which meant mutations to a routine from the detail screen
  // (add / remove exercise, rename, change reminder) were invisible here
  // until a full app restart — the card would still show the stale
  // "{n} exercises" count after the user navigated back. `useFocusEffect`
  // matches expo-router's focus lifecycle and mirrors the pattern used
  // on the routine detail screen for the same reason.
  useFocusEffect(useCallback(() => {
    loadRoutines();
    api.listSessions({ limit: 10 })
      .then(setRecent)
      .catch((e) => console.warn('[workouts] listSessions failed:', e));
  }, [loadRoutines]));

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
    setNewTracksSymptoms(false);
    setCreateError(null);
    setCreateOpen(true);
  };

  // Instantiate a pre-built template. Resolves each slug to an exercise
  // id via the user's library, then POSTs a single routine-create with
  // the exercises inline. If the library is empty (unseeded user) we
  // abort with a friendly message instead of creating an empty routine.
  const startFromTemplate = async (template: WorkoutTemplate) => {
    if (instantiating) return;
    setInstantiating(template.id);
    try {
      const exercises: Exercise[] = await api.getExercises();
      const bySlug = new Map<string, Exercise>();
      for (const ex of exercises) {
        if (ex.slug) bySlug.set(ex.slug, ex);
      }
      const resolved = template.exercises
        .map((te, idx) => {
          const ex = bySlug.get(te.slug);
          if (!ex) return null;
          return {
            exercise_id: ex.id,
            sort_order: idx,
            target_sets: te.target_sets ?? null,
            target_reps: te.target_reps ?? null,
            target_duration_sec: te.target_duration_sec ?? null,
            rest_sec: te.rest_sec ?? null,
            keystone: Boolean(te.keystone),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (resolved.length === 0) {
        const msg = 'Your exercise library is empty. Run `seed_workouts.py` on the backend to load the starter set, then try again.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('No exercises yet', msg);
        return;
      }

      const missing = template.exercises.length - resolved.length;
      if (missing > 0) {
        // Non-fatal: some users may have deleted a seeded exercise. Still
        // create the routine with what we could resolve so the user is
        // unblocked; log the drop so it's visible in dev.
        console.warn('[workouts] template %s missing %d of %d exercises',
          template.id, missing, template.exercises.length);
      }

      const routine = await api.createRoutine({
        name: template.name,
        goal: template.goal,
        exercises: resolved,
      });
      await loadRoutines();
      router.push(`/workout/${routine.id}`);
    } catch (e) {
      const msg = describeApiError(e, 'Could not create routine from template.');
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Template failed', msg);
    } finally {
      setInstantiating(null);
    }
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) { setCreateError('Name is required.'); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const routine = await api.createRoutine({
        name, goal: newGoal, tracks_symptoms: newTracksSymptoms,
      });
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
      {/* Tab bar below already labels this as "Workouts"; skip the big title
          to free vertical space. The primary action (New routine) stays
          prominent; secondary tools are collapsed into icon-only buttons
          so they don't out-shout the create/choose flow. */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.newBtn} onPress={openCreate} accessibilityRole="button" accessibilityLabel="New routine">
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.newBtnText}>New routine</Text>
          </Pressable>
          <Text style={styles.headerCount}>
            {routines.length} routine{routines.length === 1 ? '' : 's'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.streakBox}>
            <Ionicons name="flame" size={14} color={colors.warning} />
            <Text style={styles.streakText}>{streak}</Text>
          </View>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/workout/progress')}
            accessibilityRole="button"
            accessibilityLabel="Progress"
          >
            <Ionicons name="stats-chart-outline" size={18} color={colors.primary} />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/workout/admin')}
            accessibilityRole="button"
            accessibilityLabel="Exercise image admin"
          >
            <Ionicons name="images-outline" size={18} color={colors.primary} />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/workout/track')}
            accessibilityRole="button"
            accessibilityLabel="Track symptoms"
          >
            <Ionicons name="pulse-outline" size={18} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {/* Quick-start template strip. Solves the blank-page problem: tap
          a card to create a pre-built routine in one round-trip and land
          on its detail screen ready to edit or run. Horizontal scroll so
          a 4th/5th card can fit without breaking the page rhythm. */}
      <View style={styles.templateSection}>
        <Text style={styles.sectionLabel}>Quick start</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.templateRow}
        >
          {WORKOUT_TEMPLATES.map((t) => {
            const mins = estimateMinutes(t);
            const busy = instantiating === t.id;
            return (
              <Pressable
                key={t.id}
                style={[
                  styles.templateCard,
                  { borderLeftColor: GOAL_COLORS[t.goal] || '#999' },
                  busy && { opacity: 0.5 },
                ]}
                onPress={() => startFromTemplate(t)}
                disabled={Boolean(instantiating)}
                accessibilityRole="button"
                accessibilityLabel={`Start ${t.name}, ${t.exercises.length} exercises, about ${mins} minute${mins === 1 ? '' : 's'}`}
                accessibilityState={{ busy, disabled: Boolean(instantiating) && !busy }}
              >
                <Ionicons
                  name={t.icon as any}
                  size={22}
                  color={GOAL_COLORS[t.goal] || '#666'}
                />
                <Text style={styles.templateName} numberOfLines={2}>{t.name}</Text>
                <Text style={styles.templateMeta}>
                  {t.exercises.length} ex · {mins} min
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
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
            const reminderLabel = formatReminder(item.reminder_time, item.reminder_days);
            const scheduled = Boolean(reminderLabel);
            return (
              <Pressable
                style={styles.card}
                onPress={() => router.push(`/workout/${item.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open routine ${item.name}`}
              >
                <View style={[styles.goalDot, { backgroundColor: GOAL_COLORS[item.goal] || '#999' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardMeta}>
                    {item.exercises.length} exercises · {item.goal}
                    {lastSession && ` · last ${formatRel(lastSession.started_at)}`}
                  </Text>
                  {reminderLabel && (
                    <View style={styles.reminderRow}>
                      <Ionicons name="alarm" size={12} color={colors.warning} />
                      <Text style={styles.reminderText} numberOfLines={1}>{reminderLabel}</Text>
                    </View>
                  )}
                  {item.notes ? <Text style={styles.cardNotes} numberOfLines={2}>{item.notes}</Text> : null}
                </View>
                <Pressable
                  // Swallow the tap so it doesn't bubble to the card's
                  // onPress (which would navigate instead of opening
                  // the sheet).
                  onPress={(e) => { e.stopPropagation(); setReminderTarget(item); }}
                  style={styles.alarmBtn}
                  accessibilityRole="button"
                  accessibilityLabel={
                    scheduled
                      ? `Edit reminder for ${item.name}: ${reminderLabel}`
                      : `Set reminder for ${item.name}`
                  }
                  hitSlop={8}
                >
                  <Ionicons
                    name={scheduled ? 'alarm' : 'alarm-outline'}
                    size={20}
                    color={scheduled ? colors.warning : '#999'}
                  />
                </Pressable>
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

            {/* Rehab toggle — mirrors the in-detail chip from #51. Declared
                at creation so the first session honors the flag without a
                round-trip flip. */}
            <Pressable
              onPress={() => setNewTracksSymptoms((v) => !v)}
              style={[styles.rehabModalToggle, newTracksSymptoms && styles.rehabModalToggleOn]}
              accessibilityRole="switch"
              accessibilityState={{ checked: newTracksSymptoms }}
              accessibilityLabel="Track pain and symptoms in this routine"
              accessibilityHint="When on, sessions render a per-set pain chip and use Silbernagel-style advance/hold/back-off suggestions"
            >
              <Ionicons
                name={newTracksSymptoms ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={newTracksSymptoms ? '#fff' : '#888'}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rehabModalText, newTracksSymptoms && styles.rehabModalTextOn]}>
                  {newTracksSymptoms ? 'Tracking pain and symptoms' : 'Track pain and symptoms'}
                </Text>
                <Text style={[styles.rehabModalHint, newTracksSymptoms && styles.rehabModalHintOn]}>
                  Pain chip per set · pain-monitored progression
                </Text>
              </View>
            </Pressable>

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

      {reminderTarget && (
        <ReminderSheet
          routine={reminderTarget}
          onClose={() => setReminderTarget(null)}
          onSaved={loadRoutines}
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
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    alignItems: 'center', rowGap: 8,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerCount: { fontSize: 12, color: colors.textMuted },
  streakBox: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff5e6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  streakText: { fontWeight: '700', color: colors.warning, fontSize: 12 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: colors.primary, cursor: 'pointer' as any,
  },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  iconBtn: {
    padding: 6, borderRadius: 8,
    backgroundColor: '#e8f0fe', cursor: 'pointer' as any,
  },

  templateSection: { paddingTop: 10, paddingBottom: 4, backgroundColor: '#fff' },
  sectionLabel: {
    fontSize: 11, color: colors.textMuted, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: 16, marginBottom: 6,
  },
  templateRow: { paddingHorizontal: 12, paddingBottom: 10, gap: 10 },
  templateCard: {
    // 160×96 minimum — comfortably above the 44×44 tap-target floor.
    width: 160, minHeight: 96,
    backgroundColor: '#f5f6fa', borderRadius: 10,
    borderLeftWidth: 3,
    padding: 12,
    justifyContent: 'space-between',
    cursor: 'pointer' as any,
  },
  templateName: { fontSize: 13, fontWeight: '700', color: '#222', marginTop: 8 },
  templateMeta: { fontSize: 11, color: colors.textMuted, marginTop: 4 },

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
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  reminderText: { fontSize: 12, color: colors.warning, fontWeight: '600' },
  alarmBtn: {
    // 44×44 tap target above the WCAG minimum, separate from the
    // card-level press that navigates to detail.
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },

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
  rehabModalToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10, marginTop: 14,
    borderWidth: 1, borderColor: '#ddd',
    backgroundColor: '#fafafa',
    cursor: 'pointer' as any,
  },
  rehabModalToggleOn: { backgroundColor: colors.warning, borderColor: colors.warning },
  rehabModalText: { fontSize: 14, fontWeight: '700', color: '#333' },
  rehabModalTextOn: { color: '#fff' },
  rehabModalHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  rehabModalHintOn: { color: 'rgba(255,255,255,0.85)' },
  modalError: { color: colors.danger, fontSize: 13, marginTop: 10 },
  modalSave: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingVertical: 12, marginTop: 18,
    cursor: 'pointer' as any,
  },
  modalSaveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
