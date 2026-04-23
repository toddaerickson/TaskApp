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
  Image, Modal, Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import type { Exercise } from '@/lib/stores';
import * as api from '@/lib/api';
import { filterExercises } from '@/lib/exercisePicker';
import { useUndoSnackbar } from '@/components/UndoSnackbar';
import ImageSearchModal from '@/components/ImageSearchModal';

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
      if (Platform.OS === 'web') window.alert(msg);
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
          placeholderTextColor="#bbb"
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.search}
          accessibilityLabel="Search exercises"
        />

        <View
          style={styles.catRow}
          accessibilityRole="tablist"
          accessibilityLabel="Filter by category"
        >
          {CATEGORIES.map((c) => {
            const on = category === c.value;
            return (
              <Pressable
                key={c.value}
                onPress={() => setCategory(c.value)}
                style={[styles.catChip, on && styles.catChipActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={c.label}
              >
                <Text
                  style={[styles.catChipText, on && styles.catChipTextActive]}
                  numberOfLines={1}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.archivedRow}>
          <Pressable
            onPress={() => setShowArchived((v) => !v)}
            style={[styles.archivedToggle, showArchived && styles.archivedToggleOn]}
            accessibilityRole="switch"
            accessibilityState={{ checked: showArchived }}
            accessibilityLabel="Show archived exercises"
          >
            <Ionicons
              name={showArchived ? 'eye' : 'eye-off-outline'}
              size={14}
              color={showArchived ? '#fff' : colors.textMuted}
            />
            <Text style={[styles.archivedToggleText, showArchived && styles.archivedToggleTextOn]}>
              {showArchived ? 'Showing archived' : 'Show archived'}
            </Text>
          </Pressable>
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
                        <Image
                          source={{ uri: ex.images[0].url }}
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

      {/* Edit sheet */}
      <Modal
        visible={editing !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.editOverlay}>
          <View style={styles.editCard}>
            <View style={styles.editHead}>
              <Text style={styles.editTitle}>Edit exercise</Text>
              <Pressable
                onPress={() => setEditing(null)}
                accessibilityRole="button"
                accessibilityLabel="Close edit sheet"
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color="#888" />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={eName}
              onChangeText={setEName}
              style={styles.fieldInput}
              autoCapitalize="words"
              accessibilityLabel="Exercise name"
            />

            <Text style={styles.fieldLabel}>Measurement</Text>
            <View style={styles.measurementRow}>
              {MEASUREMENT_OPTIONS.map((m) => {
                const on = eMeasurement === m.value;
                return (
                  <Pressable
                    key={m.value}
                    onPress={() => setEMeasurement(m.value)}
                    style={[styles.measurementChip, on && styles.measurementChipOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={m.label}
                  >
                    <Text style={[styles.measurementChipText, on && styles.measurementChipTextOn]}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

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
                    <Image source={{ uri: img.url }} style={styles.imageThumb} />
                    <Pressable
                      style={styles.imageDeleteBtn}
                      onPress={async () => {
                        await api.deleteExerciseImage(img.id);
                        reload();
                        setEditing((prev) =>
                          prev ? { ...prev, images: prev.images.filter((i) => i.id !== img.id) } : null,
                        );
                      }}
                      hitSlop={4}
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
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.saveBtnText}>{eBusy ? 'Saving…' : 'Save changes'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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
    margin: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
  },
  catRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    cursor: 'pointer' as any,
  },
  catChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catChipText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  catChipTextActive: { color: '#fff' },
  list: { flex: 1, paddingHorizontal: 12 },
  empty: {
    textAlign: 'center', marginTop: 32, color: colors.textMuted, fontStyle: 'italic',
  },
  error: { color: colors.danger, textAlign: 'center', margin: 12 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 8, padding: 10,
    marginBottom: 6,
  },
  thumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: colors.borderSoft },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  iconBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  rowErrorText: {
    color: colors.danger, fontSize: 12,
    paddingHorizontal: 12, paddingBottom: 8, marginTop: -2,
  },
  rowArchived: { opacity: 0.55 },
  thumbArchived: { opacity: 0.6 },
  rowNameArchived: { textDecorationLine: 'line-through' },
  archivedRow: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: 12, paddingBottom: 4,
    flexShrink: 0, flexGrow: 0,
  },
  archivedToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    cursor: 'pointer' as any,
  },
  archivedToggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  archivedToggleText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  archivedToggleTextOn: { color: '#fff' },

  editOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 20,
  },
  editCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },
  editHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  editTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  fieldLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 12, marginBottom: 4 },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10,
    fontSize: 14, backgroundColor: '#fafafa', color: '#333',
  },
  measurementRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  measurementChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#ddd',
  },
  measurementChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  measurementChipText: { fontSize: 12, color: '#555' },
  measurementChipTextOn: { color: '#fff', fontWeight: '700' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 16, paddingVertical: 12, borderRadius: 8,
    backgroundColor: colors.primary, cursor: 'pointer' as any,
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  imageStrip: { flexGrow: 0, marginBottom: 4 },
  imageThumbWrap: { position: 'relative', marginRight: 8 },
  imageThumb: { width: 72, height: 72, borderRadius: 6, backgroundColor: colors.borderSoft },
  imageDeleteBtn: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: '#fff', borderRadius: 10,
  },
  noImageText: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },
  findImageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, cursor: 'pointer' as any,
  },
  findImageText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
});
