/**
 * Admin card: paste a routine JSON template, preview validation +
 * totals, then Import. Server validation runs again on POST so this
 * card is for fast feedback, not the security boundary.
 */
import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import { Exercise } from '@/lib/stores';
import * as api from '@/lib/api';
import { parseAndValidate, Measurement } from '@/lib/routineImport';

const SAMPLE = `{
  "name": "Achilles Rehab (Silbernagel)",
  "goal": "rehab",
  "phase_start_date": "2026-04-20",
  "phases": [
    { "label": "Pain-free loading", "duration_weeks": 2 },
    { "label": "Eccentric loading", "duration_weeks": 6 },
    { "label": "Return to activity", "duration_weeks": 4 }
  ],
  "exercises": [
    { "slug": "wall_ankle_dorsiflexion", "phase_idx": null, "target_sets": 2, "target_duration_sec": 30 },
    { "slug": "single_leg_glute_bridge", "phase_idx": 1, "target_sets": 3, "target_reps": 15, "keystone": true }
  ]
}`;

function showError(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}: ${message}`);
  else Alert.alert(title, message);
}

interface Props {
  exercises: Exercise[];
  onImported?: (routineId: number) => void;
}

export function RoutineImportCard({ exercises, onImported }: Props) {
  const [paste, setPaste] = useState('');
  const [importing, setImporting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const catalog = useMemo(() => {
    const m = new Map<string, Measurement>();
    for (const e of exercises) {
      if (e.slug) m.set(e.slug, (e.measurement as Measurement) || 'reps');
    }
    return m;
  }, [exercises]);

  const result = useMemo(
    () => (paste.trim() ? parseAndValidate(paste, catalog) : null),
    [paste, catalog],
  );

  const canImport = result !== null && result.errors.length === 0 && !importing;

  const handleImport = async () => {
    if (!result || result.errors.length > 0 || !result.preview) return;
    setImporting(true);
    setServerError(null);
    try {
      const created = await api.importRoutine(result.preview.request);
      onImported?.(created.id);
      setPaste('');
      if (Platform.OS === 'web') window.alert(`Imported "${created.name}".`);
      else Alert.alert('Imported', `"${created.name}" is in your routines.`);
    } catch (e) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Import failed.';
      setServerError(typeof detail === 'string' ? detail : JSON.stringify(detail));
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Import routine from JSON</Text>
      <Text style={styles.hint}>
        Paste a routine template. See the docs for the schema; tap Sample to load an example.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        <Pressable
          onPress={() => setPaste(SAMPLE)}
          style={styles.smallBtn}
          accessibilityRole="button"
          accessibilityLabel="Load sample routine JSON"
        >
          <Ionicons name="document-text-outline" size={14} color={colors.primary} />
          <Text style={styles.smallBtnText}>Sample</Text>
        </Pressable>
        <Pressable
          onPress={() => setPaste('')}
          style={styles.smallBtn}
          accessibilityRole="button"
          accessibilityLabel="Clear paste area"
        >
          <Ionicons name="close-outline" size={14} color={colors.textMuted} />
          <Text style={styles.smallBtnText}>Clear</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.pasteBox}
        placeholder={'{ "name": "...", "exercises": [ ... ] }'}
        accessibilityLabel="Routine JSON paste area"
        placeholderTextColor="#bbb"
        value={paste}
        onChangeText={setPaste}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />

      {result && result.errors.length > 0 && (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>{result.errors.length} issue{result.errors.length === 1 ? '' : 's'}</Text>
          {result.errors.slice(0, 8).map((err, i) => (
            <Text key={i} style={styles.errorLine}>• {err}</Text>
          ))}
          {result.errors.length > 8 && (
            <Text style={styles.errorLine}>… and {result.errors.length - 8} more</Text>
          )}
        </View>
      )}

      {result && result.preview && (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>Preview</Text>
          <Text style={styles.previewLine}>
            <Text style={styles.previewLabel}>Name: </Text>
            {result.preview.request.name}
          </Text>
          <Text style={styles.previewLine}>
            <Text style={styles.previewLabel}>Goal: </Text>
            {result.preview.request.goal}
          </Text>
          <Text style={styles.previewLine}>
            <Text style={styles.previewLabel}>Phases: </Text>
            {result.preview.totals.phases || '(flat routine)'}
          </Text>
          <Text style={styles.previewLine}>
            <Text style={styles.previewLabel}>Exercises: </Text>
            {result.preview.totals.exercises}
          </Text>
          {result.preview.totals.minutesPerPhase.length > 1 && (
            <Text style={styles.previewLine}>
              <Text style={styles.previewLabel}>Per phase ~min: </Text>
              {result.preview.totals.minutesPerPhase.join(' / ')}
            </Text>
          )}
        </View>
      )}

      {serverError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Server rejected import</Text>
          <Text style={styles.errorLine}>{serverError}</Text>
        </View>
      )}

      <Pressable
        onPress={handleImport}
        disabled={!canImport}
        style={[styles.importBtn, !canImport && styles.importBtnDisabled]}
        accessibilityRole="button"
        accessibilityLabel="Import routine"
      >
        {importing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="download-outline" size={16} color="#fff" />
            <Text style={styles.importBtnText}>Import routine</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 12,
    borderWidth: 1, borderColor: '#eee',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 4 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#f5f6fa', borderRadius: 6,
    minHeight: 32,
  },
  smallBtnText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  pasteBox: {
    minHeight: 140, borderWidth: 1, borderColor: '#ddd', borderRadius: 6,
    padding: 8, fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    color: '#222', textAlignVertical: 'top',
  },
  errorBox: {
    marginTop: 8, padding: 8, backgroundColor: '#fff5f5',
    borderRadius: 6, borderWidth: 1, borderColor: '#fed7d7',
  },
  errorTitle: { fontSize: 13, fontWeight: '700', color: colors.danger, marginBottom: 4 },
  errorLine: { fontSize: 12, color: colors.danger, marginTop: 2 },
  previewBox: {
    marginTop: 8, padding: 8, backgroundColor: '#f0f8ff',
    borderRadius: 6, borderWidth: 1, borderColor: '#cce4f7',
  },
  previewTitle: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  previewLine: { fontSize: 12, color: '#222', marginTop: 2 },
  previewLabel: { fontWeight: '600', color: colors.textMuted },
  importBtn: {
    marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 6,
    minHeight: 44,
  },
  importBtnDisabled: { backgroundColor: '#bbb' },
  importBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
