/**
 * Exercise library CRUD surface. The only place (besides the picker's
 * inline create from PR #54) where a user can edit an exercise's name
 * / measurement / primary muscle, or delete one outright.
 *
 * Global (user_id = null) exercises are read-only — the backend returns
 * 403 on delete/update — so we render them without affordances. User-
 * created exercises get edit + delete. Delete is gated by the backend's
 * 409-on-referenced guard: the error payload carries a human-readable
 * "Used in N routines; remove it from there first." message, which we
 * surface inline without a dialog.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import { spacing, type as ftype, radii, shadow, minHitTarget } from '@/lib/theme';
import { Chip, ChipStrip } from '@/components/Chip';
import { Sheet } from '@/components/Sheet';
import type { Exercise } from '@/lib/stores';
import * as api from '@/lib/api';
import { filterExercises } from '@/lib/exercisePicker';
import { useUndoSnackbar } from '@/components/UndoSnackbar';
import { ExerciseImage } from '@/components/ExerciseImage';
import ImageSearchModal from '@/components/ImageSearchModal';
import { showError } from '@/lib/alerts';

type Measurement = 'reps' | 'reps_weight' | 'duration' | 'distance';
const MEASUREMENT_OPTIONS: { value: Measurement; label: string }[] = [
  { value: 'reps', label: 'Reps' },
  { value: 'reps_weight', label: 'Reps + weight' },
  { value: 'duration', label: 'Duration (s)' },
  { value: 'distance', label: 'Distance' },
];

// Category filter chips. Values match the backend category strings seeded
// by seed_workouts.py (rehab / strength / mobility / cardio / general).
// 'all' is a sentinel that disables category filtering.
type CategoryKey = 'all' | 'rehab' | 'strength' | 'mobility' | 'cardio' | 'general';
const CATEGORIES: { value: CategoryKey; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'rehab', label: 'Rehab' },
  { value: 'strength', label: 'Strength' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'general', label: 'General' },
];

export default function ExerciseLibraryScreen() {
  const undo = useUndoSnackbar();
  const [all, setAll] = useState<Exercise[] | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryKey>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Inline-rowError per exercise id — surfaces backend 403 messages
  // (cross-user delete attempt) or unexpected failures under the row.
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Set<number>>(new Set());

  // Edit sheet
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [eName, setEName] = useState('');
  const [eMuscle, setEMuscle] = useState('');
  const [eMeasurement, setEMeasurement] = useState<Measurement>('reps');
  const [eBusy, setEBusy] = useState(false);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);

  const reload = () => {
    setErr(null);
    api.getExercises({ include_archived: showArchived })
      .then(setAll)
      .catch((e) => setErr(e?.message || 'Failed to load exercises'));
  };

  // Refetch when the user flips the archived toggle so the server does
  // the filtering rather than the client (keeps payload small on
  // libraries with many archived rows).
  useEffect(reload, [showArchived]);

  const visible = useMemo(() => {
    if (!all) return [];
    return filterExercises(all, query)
      .filter((ex) => category === 'all' || ex.category === category)
      .filter((ex) => !pendingDelete.has(ex.id));
  }, [all, query, category, pendingDelete]);

  const openEdit = (ex: Exercise) => {
    setEditing(ex);
    setEName(ex.name);
    setEMuscle(ex.primary_muscle ?? '');
    setEMeasurement((ex.measurement as Measurement) ?? 'reps');
  };

  const submitEdit = async () => {
    if (!editing) return;
    const name = eName.trim();
    if (!name) return;
    setEBusy(true);
    try {
      await api.updateExercise(editing.id, {
        name,
        primary_muscle: eMuscle.trim() || null,
        measurement: eMeasurement,
      });
      setEditing(null);
      reload();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Save failed';
      showError('Save failed', msg);
    } finally {
      setEBusy(false);
    }
  };

  const handleDelete = (ex: Exercise) => {
    // Clear any prior inline error for this row.
    setRowError((prev) => {
      if (!(ex.id in prev)) return prev;
      const next = { ...prev }; delete next[ex.id]; return next;
    });
    setPendingDelete((prev) => new Set(prev).add(ex.id));
    undo.show({
      message: `Deleted "${ex.name}"`,
      onUndo: () => {
        setPendingDelete((prev) => {
          const next = new Set(prev);
          next.delete(ex.id);
          return next;
        });
      },
      onTimeout: async () => {
        try {
          await api.deleteExercise(ex.id);
          reload();
        } catch (e: any) {
          // Server now soft-deletes, so referenced exercises no longer
          // 409 — the one error that still reaches us is 403 on a
          // cross-user delete attempt (impossible in single-user
          // self-hosted, but kept for safety).
          const status = e?.response?.status;
          const detail = e?.response?.data?.detail;
          if (status === 403) {
            setRowError((prev) => ({
              ...prev,
              [ex.id]: detail || "Can't archive this exercise.",
            }));
          } else if (detail) {
            setRowError((prev) => ({ ...prev, [ex.id]: detail }));
          }
        } finally {
          setPendingDelete((prev) => {
            const next = new Set(prev);
            next.delete(ex.id);
            return next;
          });
        }
      },
    });
  };

  const handleRestore = async (ex: Exercise) => {
    try {
      await api.restoreExercise(ex.id);
      reload();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || 'Restore failed';
      setRowError((prev) => ({ ...prev, [ex.id]: detail }));
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Exercise library' }} />

      {/* Non-scrollable header: search + category chips + archived toggle.
          Pinned to content height so the list below gets all remaining space. */}
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or slug"
          placeholderTextColor={colors.placeholder}
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.search}
          accessibilityLabel="Search exercises"
        />

        <View style={styles.catRow}>
          <ChipStrip
            ariaLabel="Filter by category"
            value={category}
            onChange={setCategory}
            options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          />
        </View>

        <View style={styles.archivedRow}>
          <Chip
            icon={showArchived ? 'eye' : 'eye-off-outline'}
            label={showArchived ? 'Showing archived' : 'Show archived'}
            selected={showArchived}
            onPress={() => setShowArchived((v) => !v)}
            accessibilityLabel="Show archived exercises"
          />
        </View>
      </View>
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
        {!all && !err && (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
        )}
        {err && <Text style={styles.error}>{err}</Text>}

        {all && (
          <>
            {visible.length === 0 ? (
              <Text style={styles.empty}>
                {query ? `No exercises match "${query.trim()}"` : 'No exercises in the library yet.'}
              </Text>
            ) : (
              visible.map((ex) => {
                const isGlobal = ex.user_id === null;
                const isArchived = !!ex.archived_at;
                return (
                  <View key={ex.id}>
                    <View style={[styles.row, isArchived && styles.rowArchived]}>
                      {ex.images[0]?.url ? (
                        <ExerciseImage
                          uri={ex.images[0].url}
                          alt={ex.images[0].alt_text || `${ex.name} demonstration`}
                          style={[styles.thumb, isArchived && styles.thumbArchived]}
                        />
                      ) : (
                        <View style={[styles.thumb, styles.thumbPlaceholder]}>
                          <Ionicons name="barbell-outline" size={20} color={colors.textMuted} />
                        </View>
                      )}
                      <View style={styles.rowText}>
                        <Text style={[styles.rowName, isArchived && styles.rowNameArchived]}>
                          {ex.name}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {ex.primary_muscle || ex.category} · {ex.measurement}
                          {isGlobal ? ' · global' : ''}
                          {isArchived ? ' · archived' : ''}
                        </Text>
                      </View>
                      {isArchived ? (
                        <Pressable
                          onPress={() => handleRestore(ex)}
                          hitSlop={8}
                          style={styles.iconBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Restore ${ex.name}`}
                        >
                          <Ionicons name="refresh" size={16} color={colors.primary} />
                        </Pressable>
                      ) : (
                        <>
                          <Pressable
                            onPress={() => openEdit(ex)}
                            hitSlop={8}
                            style={styles.iconBtn}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${ex.name}`}
                          >
                            <Ionicons name="pencil" size={16} color={colors.primary} />
                          </Pressable>
                          <Pressable
                            onPress={() => handleDelete(ex)}
                            hitSlop={8}
                            style={styles.iconBtn}
                            accessibilityRole="button"
                            accessibilityLabel={`Archive ${ex.name}`}
                          >
                            <Ionicons name="archive-outline" size={16} color={colors.danger} />
                          </Pressable>
                        </>
                      )}
                    </View>
                    {rowError[ex.id] && (
                      <Text style={styles.rowErrorText}>{rowError[ex.id]}</Text>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}
        </ScrollView>

      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit exercise"
      >
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          value={eName}
          onChangeText={setEName}
          style={styles.fieldInput}
          autoCapitalize="words"
          accessibilityLabel="Exercise name"
        />

        <Text style={styles.fieldLabel}>Measurement</Text>
        <ChipStrip
          ariaLabel="Measurement"
          value={eMeasurement}
          onChange={setEMeasurement}
          options={MEASUREMENT_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
        />

        <Text style={styles.fieldLabel}>Primary muscle (optional)</Text>
        <TextInput
          value={eMuscle}
          onChangeText={setEMuscle}
          style={styles.fieldInput}
          autoCapitalize="none"
          accessibilityLabel="Primary muscle"
        />

        {/* Image management */}
        <Text style={styles.fieldLabel}>Images</Text>
        {editing && editing.images.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageStrip}>
            {editing.images.map((img) => (
              <View key={img.id} style={styles.imageThumbWrap}>
                <ExerciseImage
                  uri={img.url}
                  alt={img.alt_text || `${editing.name} demonstration`}
                  style={styles.imageThumb}
                />
                <Pressable
                  style={styles.imageDeleteBtn}
                  onPress={async () => {
                    await api.deleteExerciseImage(img.id);
                    reload();
                    setEditing((prev) =>
                      prev ? { ...prev, images: prev.images.filter((i) => i.id !== img.id) } : null,
                    );
                  }}
                  hitSlop={spacing.sm}
                  accessibilityRole="button"
                  accessibilityLabel="Remove image"
                >
                  <Ionicons name="close-circle" size={20} color={colors.danger} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.noImageText}>No images yet.</Text>
        )}
        <Pressable
          style={styles.findImageBtn}
          onPress={() => setImageSearchOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={editing?.images.length ? 'Find another image' : 'Add image'}
        >
          <Ionicons name="sparkles" size={14} color={colors.primary} />
          <Text style={styles.findImageText}>
            {editing?.images.length ? 'Find another image' : 'Add image'}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.saveBtn, (!eName.trim() || eBusy) && { opacity: 0.5 }]}
          onPress={submitEdit}
          disabled={!eName.trim() || eBusy}
          accessibilityRole="button"
        >
          <Ionicons name="checkmark" size={16} color={colors.onColor} />
          <Text style={styles.saveBtnText}>{eBusy ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>
      </Sheet>

      {editing && (
        <ImageSearchModal
          visible={imageSearchOpen}
          exerciseId={editing.id}
          exerciseName={editing.name}
          onClose={() => setImageSearchOpen(false)}
          onSaved={() => {
            reload();
            // Refresh the editing exercise so the image strip updates
            api.getExercises({ include_archived: showArchived }).then((exs) => {
              const updated = exs.find((e: Exercise) => e.id === editing.id);
              if (updated) setEditing(updated);
            });
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexShrink: 0, flexGrow: 0 },
  search: {
    margin: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    fontSize: ftype.input, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
  },
  catRow: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
  },
  list: { flex: 1, paddingHorizontal: spacing.md },
  empty: {
    textAlign: 'center', marginTop: spacing.xxl, color: colors.textMuted, fontStyle: 'italic',
  },
  error: { color: colors.danger, textAlign: 'center', margin: spacing.md },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.sm, padding: spacing.sm + 2,
    marginBottom: spacing.xs + 2,
    ...shadow.card,
  },
  thumb: { width: 44, height: 44, borderRadius: radii.xs + 2, backgroundColor: colors.borderSoft },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowName: { fontSize: ftype.bodyLg, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: ftype.caption, color: colors.textMuted, marginTop: 2 },
  iconBtn: {
    // 44pt minimum hit target — UI agent flagged the prior 36pt as
    // sub-WCAG. Visual size unchanged via flexbox centering.
    width: minHitTarget, height: minHitTarget,
    alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  rowErrorText: {
    color: colors.danger, fontSize: ftype.caption,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, marginTop: -2,
  },
  rowArchived: { opacity: 0.55 },
  thumbArchived: { opacity: 0.6 },
  rowNameArchived: { textDecorationLine: 'line-through' },
  archivedRow: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: spacing.md, paddingBottom: spacing.xs,
    flexShrink: 0, flexGrow: 0,
  },

  fieldLabel: {
    fontSize: ftype.caption, color: colors.textMuted, fontWeight: '700',
    marginTop: spacing.md, marginBottom: spacing.xs + 2,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  fieldInput: {
    borderWidth: 1, borderColor: colors.borderInput, borderRadius: radii.sm, padding: spacing.sm + 2,
    fontSize: ftype.input, backgroundColor: colors.surfaceAlt, color: colors.text,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2,
    marginTop: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.sm,
    backgroundColor: colors.primary, cursor: 'pointer' as any,
  },
  saveBtnText: { color: colors.onColor, fontSize: ftype.body, fontWeight: '700' },

  imageStrip: { flexGrow: 0, marginBottom: spacing.xs },
  imageThumbWrap: { position: 'relative', marginRight: spacing.sm },
  imageThumb: { width: 72, height: 72, borderRadius: radii.xs + 2, backgroundColor: colors.borderSoft },
  imageDeleteBtn: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: colors.surface, borderRadius: radii.md - 2,
  },
  noImageText: { fontSize: ftype.body - 1, color: colors.textMuted, fontStyle: 'italic', marginBottom: spacing.xs },
  findImageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, cursor: 'pointer' as any,
  },
  findImageText: { fontSize: ftype.body - 1, color: colors.primary, fontWeight: '600' },
});
