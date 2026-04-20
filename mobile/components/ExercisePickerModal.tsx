/**
 * Modal exercise picker used by the routine detail edit mode. Opens as
 * a full-screen sheet, fetches the exercise library on mount, filters
 * live by name/slug as the user types, and calls `onPick` with the
 * selected Exercise. The caller (the routine detail screen) handles
 * the POST to add-exercise-to-routine — keeping that out of this
 * component means the same picker can later feed other flows (e.g.,
 * ad-hoc session exercise-swap) without touching this file.
 *
 * When the library is missing the exercise the user wants, they can
 * expand the "+ Create new exercise" row at the top to enter a name,
 * measurement, and optional primary muscle. On create we POST via
 * api.createExercise and immediately fire onPick(newExercise) so it
 * lands in the routine in one flow — no round-trip through the admin
 * screen required. Slug auto-derives from name server-side.
 */
import { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, TextInput, Image,
  ActivityIndicator, StyleSheet, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import type { Exercise } from '@/lib/stores';
import * as api from '@/lib/api';
import { filterExercises } from '@/lib/exercisePicker';


type Measurement = 'reps' | 'reps_weight' | 'duration' | 'distance';

const MEASUREMENT_OPTIONS: { value: Measurement; label: string }[] = [
  { value: 'reps', label: 'Reps' },
  { value: 'reps_weight', label: 'Reps + weight' },
  { value: 'duration', label: 'Duration (s)' },
  { value: 'distance', label: 'Distance' },
];


export function ExercisePickerModal({
  visible, onClose, onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
}) {
  const [all, setAll] = useState<Exercise[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Create-new form state. Collapsed by default so the picker still
  // reads as a picker; user has to tap the row to expand.
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMeasurement, setNewMeasurement] = useState<Measurement>('reps');
  const [newMuscle, setNewMuscle] = useState('');
  const [newBodyweight, setNewBodyweight] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // Fresh fetch on each open. The library is small (~15-30 rows) and
    // the user may have added new exercises via the admin screen since
    // the last open; caching would risk showing a stale list.
    setError(null);
    api.getExercises()
      .then(setAll)
      .catch((e) => setError(e?.message || 'Failed to load exercises'));
  }, [visible]);

  // Reset local state when the modal closes so reopening starts clean.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setAll(null);
      setCreateOpen(false);
      setNewName('');
      setNewMeasurement('reps');
      setNewMuscle('');
      setNewBodyweight(true);
      setCreating(false);
    }
  }, [visible]);

  const results = all ? filterExercises(all, query) : [];

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created: Exercise = await api.createExercise({
        name,
        measurement: newMeasurement,
        primary_muscle: newMuscle.trim() || undefined,
        is_bodyweight: newBodyweight,
        // slug is omitted — server auto-derives from name.
      });
      // Hand the new exercise straight to the caller so it lands in the
      // routine in one flow. The caller will close the modal via the
      // same onPick callback.
      onPick(created);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Could not create exercise';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Create failed', msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Add exercise</Text>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close exercise picker"
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

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

        {/* Create-new affordance. Expandable row — when collapsed it
            reads as a single "Create new exercise" Pressable; when
            expanded it grows a name / measurement / muscle form. */}
        <Pressable
          onPress={() => setCreateOpen((v) => !v)}
          style={[styles.createRow, createOpen && styles.createRowOpen]}
          accessibilityRole="button"
          accessibilityLabel={createOpen ? 'Collapse create exercise form' : 'Create a new exercise'}
          accessibilityState={{ expanded: createOpen }}
        >
          <Ionicons
            name={createOpen ? 'chevron-down' : 'add-circle-outline'}
            size={18}
            color={colors.primary}
          />
          <Text style={styles.createRowText}>
            {createOpen ? 'New exercise' : "Don't see it? Create a new exercise"}
          </Text>
        </Pressable>

        {createOpen && (
          <View style={styles.createForm}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Kettlebell Swing"
              placeholderTextColor="#bbb"
              style={styles.fieldInput}
              autoCapitalize="words"
              accessibilityLabel="New exercise name"
            />

            <Text style={styles.fieldLabel}>Measurement</Text>
            <View style={styles.measurementRow}>
              {MEASUREMENT_OPTIONS.map((m) => {
                const on = newMeasurement === m.value;
                return (
                  <Pressable
                    key={m.value}
                    onPress={() => setNewMeasurement(m.value)}
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
              value={newMuscle}
              onChangeText={setNewMuscle}
              placeholder="e.g. glutes, shoulders"
              placeholderTextColor="#bbb"
              style={styles.fieldInput}
              autoCapitalize="none"
              accessibilityLabel="Primary muscle"
            />

            <Pressable
              onPress={() => setNewBodyweight((v) => !v)}
              style={[styles.bodyweightRow, newBodyweight && styles.bodyweightRowOn]}
              accessibilityRole="switch"
              accessibilityState={{ checked: newBodyweight }}
              accessibilityLabel="Bodyweight exercise"
            >
              <Ionicons
                name={newBodyweight ? 'checkmark-circle' : 'ellipse-outline'}
                size={16}
                color={newBodyweight ? '#fff' : colors.textMuted}
              />
              <Text style={[styles.bodyweightText, newBodyweight && styles.bodyweightTextOn]}>
                Bodyweight
              </Text>
            </Pressable>

            <Pressable
              style={[styles.createBtn, (!newName.trim() || creating) && { opacity: 0.5 }]}
              onPress={handleCreate}
              disabled={!newName.trim() || creating}
              accessibilityRole="button"
              accessibilityLabel="Create exercise and add to routine"
            >
              <Ionicons name="checkmark" size={14} color="#fff" />
              <Text style={styles.createBtnText}>
                {creating ? 'Creating…' : 'Create & add'}
              </Text>
            </Pressable>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!all && !error && (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
        )}

        {all && (
          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
            {results.length === 0 ? (
              <Text style={styles.empty}>
                {query ? `No exercises match "${query.trim()}"` : 'No exercises in the library yet.'}
              </Text>
            ) : (
              results.map((ex) => (
                <Pressable
                  key={ex.id}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => onPick(ex)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${ex.name} to routine`}
                >
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
                    </Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                </Pressable>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  // 44×44 tap target for a11y; icon is 24.
  closeBtn: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: 22,
  },
  search: {
    margin: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
  },
  createRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 12, marginBottom: 4,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  createRowOpen: { borderStyle: 'solid', backgroundColor: colors.primaryOnLight },
  createRowText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  createForm: {
    marginHorizontal: 12, marginBottom: 8,
    padding: 12, borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  fieldLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8,
    fontSize: 13, backgroundColor: '#fafafa',
  },
  measurementRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  measurementChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#ddd',
  },
  measurementChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  measurementChipText: { fontSize: 12, color: '#555' },
  measurementChipTextOn: { color: '#fff', fontWeight: '700' },
  bodyweightRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#ddd',
    alignSelf: 'flex-start',
  },
  bodyweightRowOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  bodyweightText: { fontSize: 12, color: '#555', fontWeight: '600' },
  bodyweightTextOn: { color: '#fff' },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 12, paddingVertical: 10, borderRadius: 8,
    backgroundColor: colors.primary,
  },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  list: { flex: 1, paddingHorizontal: 12 },
  empty: {
    textAlign: 'center', marginTop: 32,
    color: colors.textMuted, fontStyle: 'italic',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 8, padding: 10,
    marginBottom: 8,
  },
  rowPressed: { opacity: 0.6 },
  thumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: colors.borderSoft },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  errorBox: {
    margin: 12, padding: 10, borderRadius: 6,
    backgroundColor: '#fce8e8',
  },
  errorText: { color: colors.dangerText, fontSize: 13 },
});
