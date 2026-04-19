/**
 * Phase manager rendered inside RoutineHeaderEdit on the routine detail
 * screen. Adds, edits, reorders, and deletes phases via the REST API
 * shipped in #32. Zero backend changes in this PR — the component is
 * a pure consumer of existing CRUD.
 *
 * Reorder uses a 3-step swap because the server enforces
 * UNIQUE(routine_id, order_idx) and would 409 on a naive PUT that
 * collides with a sibling. The middle step parks the moving row at a
 * negative, guaranteed-unique index, then each target position is
 * claimed in turn.
 */
import { colors } from '@/lib/colors';
import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Routine, RoutinePhase } from '@/lib/stores';
import * as api from '@/lib/api';
import {
  validateDurationWeeks, countExercisesInPhase,
} from '@/lib/phaseEditor';

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

interface Props {
  routine: Routine;
  onChanged: () => void;
}

export function PhaseEditor({ routine, onChanged }: Props) {
  const phases = (routine.phases ?? []).slice().sort((a, b) => a.order_idx - b.order_idx);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newWeeks, setNewWeeks] = useState('2');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    const weeks = parseInt(newWeeks, 10);
    const err = validateDurationWeeks(weeks);
    if (!newLabel.trim() || err.message) return;
    setBusy(true);
    try {
      await api.createPhase(routine.id, {
        label: newLabel.trim(),
        order_idx: phases.length,
        duration_weeks: weeks,
      });
      setNewLabel('');
      setNewWeeks('2');
      setAdding(false);
      onChanged();
    } finally { setBusy(false); }
  };

  const handleMove = async (from: number, to: number) => {
    if (to < 0 || to >= phases.length || busy) return;
    setBusy(true);
    try {
      const moving = phases[from];
      const displaced = phases[to];
      // 3-step swap to skirt the UNIQUE(routine_id, order_idx) constraint:
      // park the moving row at a negative, guaranteed-unique index first,
      // free up its slot for the displaced row, then land in the target.
      await api.updatePhase(routine.id, moving.id, { order_idx: -moving.id });
      await api.updatePhase(routine.id, displaced.id, { order_idx: from });
      await api.updatePhase(routine.id, moving.id, { order_idx: to });
      onChanged();
    } finally { setBusy(false); }
  };

  const handleDelete = async (phase: RoutinePhase) => {
    const assigned = countExercisesInPhase(routine, phase.id);
    const msg = assigned > 0
      ? `This will unassign ${assigned} exercise${assigned === 1 ? '' : 's'} (they stay in the routine as "all phases").`
      : 'Delete this phase?';
    const ok = await confirm(`Delete "${phase.label}"?`, msg);
    if (!ok) return;
    setBusy(true);
    try {
      await api.deletePhase(routine.id, phase.id);
      onChanged();
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Phases</Text>

      {phases.length === 0 ? (
        <Text style={styles.hint}>
          No phases yet. Add 2–3 to define a progression (e.g. Foundation → Loading → Return).
        </Text>
      ) : (
        phases.map((p, idx) => (
          <PhaseRow
            key={p.id}
            phase={p}
            routineId={routine.id}
            position={idx}
            total={phases.length}
            expanded={editingId === p.id}
            onToggleExpand={() => setEditingId(editingId === p.id ? null : p.id)}
            onMoveUp={() => handleMove(idx, idx - 1)}
            onMoveDown={() => handleMove(idx, idx + 1)}
            onDelete={() => handleDelete(p)}
            onSaved={() => { setEditingId(null); onChanged(); }}
            assignedCount={countExercisesInPhase(routine, p.id)}
            busy={busy}
          />
        ))
      )}

      {adding ? (
        <View style={styles.addForm}>
          <TextInput
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder="Label (e.g. Foundation)"
            style={styles.input}
            accessibilityLabel="New phase label"
          />
          <TextInput
            value={newWeeks}
            onChangeText={setNewWeeks}
            placeholder="Weeks"
            keyboardType="number-pad"
            style={[styles.input, { width: 80 }]}
            accessibilityLabel="New phase duration in weeks"
          />
          <Pressable
            onPress={handleAdd}
            disabled={!newLabel.trim() || validateDurationWeeks(parseInt(newWeeks, 10)).message !== null || busy}
            style={({ pressed }) => [
              styles.addBtn,
              (!newLabel.trim() || busy) && { opacity: 0.5 },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save new phase"
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>Save</Text>}
          </Pressable>
          <Pressable
            onPress={() => { setAdding(false); setNewLabel(''); }}
            style={styles.cancelBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel adding phase"
          >
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setAdding(true)}
          style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Add a phase"
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.addRowText}>Add phase</Text>
        </Pressable>
      )}
    </View>
  );
}

interface PhaseRowProps {
  phase: RoutinePhase;
  routineId: number;
  position: number;
  total: number;
  expanded: boolean;
  assignedCount: number;
  busy: boolean;
  onToggleExpand: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onSaved: () => void;
}

function PhaseRow(props: PhaseRowProps) {
  const { phase, routineId, position, total, expanded, assignedCount, busy } = props;
  const [label, setLabel] = useState(phase.label);
  const [weeks, setWeeks] = useState(String(phase.duration_weeks));
  const [notes, setNotes] = useState(phase.notes ?? '');
  const [saving, setSaving] = useState(false);

  const canMoveUp = position > 0 && !busy;
  const canMoveDown = position < total - 1 && !busy;
  const weeksErr = validateDurationWeeks(parseInt(weeks, 10));
  const dirty = label !== phase.label || weeks !== String(phase.duration_weeks) || notes !== (phase.notes ?? '');

  const save = async () => {
    if (weeksErr.message || !label.trim() || !dirty) return;
    setSaving(true);
    try {
      await api.updatePhase(routineId, phase.id, {
        label: label.trim(),
        duration_weeks: parseInt(weeks, 10),
        notes: notes.trim() || null,
      });
      props.onSaved();
    } finally { setSaving(false); }
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowIdx}>{position + 1}.</Text>
        <Pressable
          onPress={props.onToggleExpand}
          style={styles.rowMain}
          accessibilityRole="button"
          accessibilityLabel={`Edit phase ${phase.label}`}
        >
          <Text style={styles.rowLabel}>{phase.label}</Text>
          <Text style={styles.rowMeta}>
            {phase.duration_weeks} wk{phase.duration_weeks === 1 ? '' : 's'}
            {assignedCount > 0 ? ` · ${assignedCount} ex` : ''}
          </Text>
        </Pressable>
        <View style={styles.rowActions}>
          <Pressable
            onPress={props.onMoveUp}
            disabled={!canMoveUp}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canMoveUp }}
            accessibilityLabel={`Move phase ${phase.label} up`}
          >
            <Ionicons name="chevron-up" size={18} color={canMoveUp ? colors.text : '#ccc'} />
          </Pressable>
          <Pressable
            onPress={props.onMoveDown}
            disabled={!canMoveDown}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canMoveDown }}
            accessibilityLabel={`Move phase ${phase.label} down`}
          >
            <Ionicons name="chevron-down" size={18} color={canMoveDown ? colors.text : '#ccc'} />
          </Pressable>
          <Pressable
            onPress={props.onDelete}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={`Delete phase ${phase.label}`}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
        </View>
      </View>
      {expanded && (
        <View style={styles.rowEdit}>
          <Text style={styles.fieldLabel}>Label</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            style={styles.input}
            accessibilityLabel="Phase label"
          />
          <Text style={styles.fieldLabel}>Weeks</Text>
          <TextInput
            value={weeks}
            onChangeText={setWeeks}
            keyboardType="number-pad"
            style={[styles.input, { width: 80 }]}
            accessibilityLabel="Phase duration in weeks"
          />
          {weeksErr.message && <Text style={styles.errorText}>{weeksErr.message}</Text>}
          <Text style={styles.fieldLabel}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
            accessibilityLabel="Phase notes"
          />
          <Pressable
            onPress={save}
            disabled={!dirty || saving || !!weeksErr.message || !label.trim()}
            style={({ pressed }) => [
              styles.saveBtn,
              (!dirty || saving || !!weeksErr.message) && { opacity: 0.5 },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save phase changes"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12 },
  sectionLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 6, fontWeight: '700', textTransform: 'uppercase' },
  hint: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginBottom: 8 },
  row: { backgroundColor: '#fafbfc', borderRadius: 6, borderWidth: 1, borderColor: '#e4e7eb', marginBottom: 6 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 8 },
  rowIdx: { fontSize: 13, fontWeight: '700', color: colors.textMuted, width: 22 },
  rowMain: { flex: 1, minHeight: 44, justifyContent: 'center' },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: 2 },
  iconBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  rowEdit: { padding: 10, borderTopWidth: 1, borderTopColor: '#e4e7eb', gap: 4 },
  fieldLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 4, padding: 8, fontSize: 14, backgroundColor: '#fff', minHeight: 36 },
  errorText: { fontSize: 11, color: colors.danger, marginTop: 2 },
  saveBtn: {
    marginTop: 8, backgroundColor: colors.primary, paddingVertical: 10,
    paddingHorizontal: 16, borderRadius: 6, alignSelf: 'flex-start', minHeight: 44,
    minWidth: 80, alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, minHeight: 44,
  },
  addRowText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  addForm: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  addBtn: {
    backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 6, minHeight: 36, justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  cancelBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
  },
});
