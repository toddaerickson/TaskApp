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

type Measurement = 'reps' | 'reps_weight' | 'duration' | 'distance';
const MEASUREMENT_OPTIONS: { value: Measurement; label: string }[] = [
  { value: 'reps', label: 'Reps' },
  { value: 'reps_weight', label: 'Reps + weight' },
  { value: 'duration', label: 'Duration (s)' },
  { value: 'distance', label: 'Distance' },
];

export default function ExerciseLibraryScreen() {
  const undo = useUndoSnackbar();
  const [all, setAll] = useState<Exercise[] | null>(null);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Inline-rowError per exercise id — set when a delete-409 surfaced so
  // the user sees "Used in N routines…" right below the offending row.
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Set<number>>(new Set());

  // Edit sheet
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [eName, setEName] = useState('');
  const [eMuscle, setEMuscle] = useState('');
  const [eMeasurement, setEMeasurement] = useState<Measurement>('reps');
  const [eBusy, setEBusy] = useState(false);

  const reload = () => {
    setErr(null);
    api.getExercises()
      .then(setAll)
      .catch((e) => setErr(e?.message || 'Failed to load exercises'));
  };

  useEffect(reload, []);

  const visible = useMemo(() => {
    if (!all) return [];
    return filterExercises(all, query)
      .filter((ex) => !pendingDelete.has(ex.id));
  }, [all, query, pendingDelete]);

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
          const status = e?.response?.status;
          const detail = e?.response?.data?.detail;
          if (status === 409 && detail) {
            setRowError((prev) => ({ ...prev, [ex.id]: detail }));
          } else if (status === 403) {
            setRowError((prev) => ({
              ...prev,
              [ex.id]: 'Global exercises are read-only. Create your own copy to edit.',
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Exercise library' }} />

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

      {!all && !err && (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
      )}
      {err && <Text style={styles.error}>{err}</Text>}

      {all && (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
          {visible.length === 0 ? (
            <Text style={styles.empty}>
              {query ? `No exercises match "${query.trim()}"` : 'No exercises in the library yet.'}
            </Text>
          ) : (
            visible.map((ex) => {
              const isGlobal = ex.user_id === null;
              return (
                <View key={ex.id}>
                  <View style={styles.row}>
                    {ex.images[0]?.url ? (
                      <Image source={{ uri: ex.images[0].url }} style={styles.thumb} />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPlaceholder]}>
                        <Ionicons name="barbell-outline" size={20} color={colors.textMuted} />
                      </View>
                    )}
                    <View style={styles.rowText}>
                      <Text style={styles.rowName}>{ex.name}</Text>
                      <Text style={styles.rowMeta}>
                        {ex.primary_muscle || ex.category} · {ex.measurement}
                        {isGlobal ? ' · global' : ''}
                      </Text>
                    </View>
                    {!isGlobal && (
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
                          accessibilityLabel={`Delete ${ex.name}`}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.danger} />
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
        </ScrollView>
      )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  search: {
    margin: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
  },
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
});
