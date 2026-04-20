/**
 * Bottom-sheet editor for a logged session set. Opens when the user taps
 * a row in the session screen (whole row is pressable — no pencil icon).
 *
 *   <SessionSetEditSheet
 *     set={theSet}
 *     measurement="reps"
 *     tracksSymptoms={session.tracks_symptoms}
 *     onClose={() => setEditing(null)}
 *     onSaved={reload}
 *     onDeleted={optimisticallyDropAndUndoSnackbar}
 *   />
 *
 * Diff semantics match the InlineDoseEditor (#46): only fields the user
 * actually changed are sent in the PATCH body, so a "tap-save without
 * editing" closes the sheet without a network round-trip and doesn't
 * bump updated_at.
 *
 * Delete is the caller's responsibility — we fire `onDeleted` so the
 * caller can optimistically remove the row and surface the Undo
 * snackbar. Keeping the actual `api.deleteSet` call outside this
 * component means the caller can defer the DELETE until the undo
 * window closes.
 */
import { useMemo, useRef, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, StyleSheet, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import type { SessionSet } from '@/lib/stores';
import * as api from '@/lib/api';
import { EditField } from './EditField';
import {
  diffSetEdit, isDirty, toEditString, SetEditFields,
} from '@/lib/sessionSetEdit';


export function SessionSetEditSheet({
  set, measurement, tracksSymptoms, onClose, onSaved, onDeleted,
}: {
  set: SessionSet;
  /** Exercise measurement — drives which input group renders (reps/weight
   *  vs duration). Duration exercises suppress the reps/weight row. */
  measurement: string;
  /** Session-time flag from #47. When false we suppress the pain_score
   *  row so strength sessions don't show rehab UX. */
  tracksSymptoms: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Fired *before* the DELETE hits the server. The caller is expected
   *  to optimistically remove the row and surface an Undo snackbar; the
   *  snackbar's onTimeout commits the actual DELETE. */
  onDeleted: (set: SessionSet) => void;
}) {
  const initial = useRef<SetEditFields>({
    reps: toEditString(set.reps),
    weight: toEditString(set.weight),
    duration_sec: toEditString(set.duration_sec),
    rpe: toEditString(set.rpe),
    pain_score: toEditString(set.pain_score),
    notes: set.notes ?? '',
  }).current;

  const [fields, setFields] = useState<SetEditFields>({ ...initial });
  const [busy, setBusy] = useState(false);

  const update = <K extends keyof SetEditFields>(k: K, v: SetEditFields[K]) => {
    setFields((f) => ({ ...f, [k]: v }));
  };

  const isReps = measurement === 'reps' || measurement === 'reps_weight';
  const isDuration = measurement === 'duration';

  // Compute the diff live so the Save button can reflect dirtiness; the
  // same diff drives the payload on save.
  const dirty = useMemo(() => isDirty(initial, fields), [fields, initial]);

  const save = async () => {
    const patch = diffSetEdit(initial, fields);
    if (Object.keys(patch).length === 0) {
      // Nothing changed — no round-trip. Mirrors #46.
      onClose();
      return;
    }
    setBusy(true);
    try {
      await api.patchSet(set.id, patch);
      onSaved();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Save failed';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Could not save', msg);
    } finally {
      setBusy(false);
    }
  };

  const requestDismiss = () => {
    if (!dirty) { onClose(); return; }
    // Web: confirm(). Native: Alert.alert.
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm('Discard changes?')) onClose();
      return;
    }
    Alert.alert('Discard changes?', 'Your edits to this set will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const handleDelete = () => {
    // Don't await; fire the callback and let the parent handle the
    // optimistic remove + snackbar. The actual DELETE lands on
    // snackbar timeout, not here.
    onDeleted(set);
    onClose();
  };

  return (
    <Modal
      visible
      onRequestClose={requestDismiss}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit set {set.set_number}</Text>
          <Pressable
            onPress={requestDismiss}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close set editor"
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {isReps && (
            <View style={styles.row}>
              <EditField label="Reps" numeric
                value={fields.reps}
                onChange={(v) => update('reps', v)} />
              <EditField label="Weight (lb)" numeric
                value={fields.weight}
                onChange={(v) => update('weight', v)} />
            </View>
          )}
          {isDuration && (
            <View style={styles.row}>
              <EditField label="Duration (s)" numeric
                value={fields.duration_sec}
                onChange={(v) => update('duration_sec', v)} />
            </View>
          )}
          <View style={styles.row}>
            <EditField label="RPE (1–10)" numeric
              value={fields.rpe}
              onChange={(v) => update('rpe', v)} />
            {tracksSymptoms && (
              <EditField label="Pain (0–10)" numeric
                value={fields.pain_score}
                onChange={(v) => update('pain_score', v)} />
            )}
          </View>
          <EditField label="Notes"
            value={fields.notes}
            onChange={(v) => update('notes', v)}
            placeholder="Optional" />

          {/* Save */}
          <Pressable
            style={({ pressed }) => [
              styles.saveBtn,
              (!dirty || busy) && styles.saveBtnDisabled,
              pressed && { opacity: 0.7 },
            ]}
            onPress={save}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Save changes to set"
          >
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text>
          </Pressable>

          {/* Destructive footer — deletes this set. Kept visually
              separated so a quick tap on the Save area doesn't hit
              the delete. */}
          <View style={styles.destructiveZone}>
            <Text style={styles.destructiveHint}>
              Mis-logged the whole set?
            </Text>
            <Pressable
              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel={`Delete set ${set.set_number}`}
            >
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={styles.deleteText}>Delete set</Text>
            </Pressable>
          </View>
        </ScrollView>
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
  closeBtn: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: 22,
  },
  body: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 16, paddingVertical: 14, borderRadius: 10,
    backgroundColor: colors.primary,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  destructiveZone: {
    marginTop: 32, paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    alignItems: 'center', gap: 8,
  },
  destructiveHint: { fontSize: 12, color: colors.textMuted },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10,
    backgroundColor: colors.danger, minWidth: 180,
  },
  deleteText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
