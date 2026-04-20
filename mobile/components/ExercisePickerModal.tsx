/**
 * Modal exercise picker used by the routine detail edit mode. Opens as
 * a full-screen sheet, fetches the exercise library on mount, filters
 * live by name/slug as the user types, and calls `onPick` with the
 * selected Exercise. The caller (the routine detail screen) handles
 * the POST to add-exercise-to-routine — keeping that out of this
 * component means the same picker can later feed other flows (e.g.,
 * ad-hoc session exercise-swap) without touching this file.
 */
import { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, TextInput, Image,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import type { Exercise } from '@/lib/stores';
import * as api from '@/lib/api';
import { filterExercises } from '@/lib/exercisePicker';


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
    }
  }, [visible]);

  const results = all ? filterExercises(all, query) : [];

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
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.search}
          accessibilityLabel="Search exercises"
        />

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
