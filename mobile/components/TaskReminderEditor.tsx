/**
 * Task-reminder picker mounted under the Note field on task detail /
 * create screens. Lists current reminders, supports add + delete, and
 * routes delete through the global undo snackbar.
 *
 * Two text inputs (YYYY-MM-DD + HH:MM) instead of a native date-picker
 * dependency — matches the existing routine `reminder_time` aesthetic
 * and keeps the build small. Validation + ISO conversion live in pure
 * helpers (`lib/taskReminder.ts`) so they can be unit-tested.
 */
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import * as api from '@/lib/api';
import { useUndoSnackbar } from '@/components/UndoSnackbar';
import type { Reminder } from '@/lib/stores';
import {
  formatReminderRow, validateReminderInput,
} from '@/lib/taskReminder';

interface Props {
  taskId?: number | null;
  reminders: Reminder[];
  onChanged: () => void;
}

export default function TaskReminderEditor({ taskId, reminders, onChanged }: Props) {
  const undo = useUndoSnackbar();
  const [adding, setAdding] = useState(false);
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // IDs queued for deletion. We hide them from the list immediately so the
  // undo window is a pure local operation; the server round-trip happens
  // only when the snackbar times out.
  const [pendingDelete, setPendingDelete] = useState<Set<number>>(new Set());

  // Pre-save state for the create screen: no taskId yet, so there's
  // nowhere to POST. Hint once and get out of the way.
  if (!taskId) {
    return (
      <View>
        <Text style={styles.label}>Reminders</Text>
        <Text style={styles.preSaveHint}>
          Save the task first, then add reminders.
        </Text>
      </View>
    );
  }

  const openAdd = () => {
    setAdding(true);
    setDateStr('');
    setTimeStr('');
    setError(null);
    setWarning(null);
  };

  const cancelAdd = () => {
    setAdding(false);
    setError(null);
    setWarning(null);
  };

  const submitAdd = async () => {
    const result = validateReminderInput(dateStr, timeStr);
    if (!result.ok) {
      setError(result.error);
      setWarning(null);
      return;
    }
    setError(null);
    setWarning(null);
    try {
      await api.addReminder(taskId, result.iso);
      cancelAdd();
      onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not save reminder.');
    }
  };

  // Hide the row locally, show the snackbar, and defer the server DELETE
  // until the grace window expires. Undo just un-hides the row.
  const deleteReminder = (r: Reminder) => {
    setPendingDelete((prev) => new Set(prev).add(r.id));
    undo.show({
      message: 'Reminder removed',
      onUndo: () => {
        setPendingDelete((prev) => {
          const next = new Set(prev);
          next.delete(r.id);
          return next;
        });
      },
      onTimeout: async () => {
        try {
          await api.deleteReminder(r.id);
        } finally {
          setPendingDelete((prev) => {
            const next = new Set(prev);
            next.delete(r.id);
            return next;
          });
          onChanged();
        }
      },
    });
  };

  // Sort ascending by remind_at so the next-upcoming is at the top;
  // filter out rows the user just queued for delete.
  const sorted = [...reminders]
    .filter((r) => !pendingDelete.has(r.id))
    .sort(
      (a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()
    );

  return (
    <View>
      <Text style={styles.label}>Reminders</Text>

      {sorted.length === 0 && !adding && (
        <Text style={styles.emptyHint}>No reminders yet.</Text>
      )}

      {sorted.map((r) => (
        <View key={r.id} style={styles.row}>
          <Ionicons name="alarm-outline" size={16} color={colors.warning} />
          <Text style={styles.rowText}>{formatReminderRow(r.remind_at)}</Text>
          <Pressable
            onPress={() => deleteReminder(r)}
            hitSlop={8}
            style={styles.trashBtn}
            accessibilityRole="button"
            accessibilityLabel="Remove reminder"
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
          </Pressable>
        </View>
      ))}

      {adding ? (
        <View style={styles.addForm}>
          <View style={styles.addFormInputs}>
            <TextInput
              style={styles.dateInput}
              value={dateStr}
              onChangeText={setDateStr}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#bbb"
              accessibilityLabel="Reminder date"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />
            <TextInput
              style={styles.timeInput}
              value={timeStr}
              onChangeText={setTimeStr}
              placeholder="HH:MM"
              placeholderTextColor="#bbb"
              accessibilityLabel="Reminder time (24-hour)"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          {error && <Text style={styles.errText}>{error}</Text>}
          {warning && <Text style={styles.warnText}>{warning}</Text>}
          <View style={styles.addFormActions}>
            <Pressable
              style={styles.saveBtn}
              onPress={submitAdd}
              accessibilityRole="button"
              accessibilityLabel="Save reminder"
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.saveBtnText}>Save</Text>
            </Pressable>
            <Pressable
              style={styles.cancelBtn}
              onPress={cancelAdd}
              accessibilityRole="button"
              accessibilityLabel="Cancel reminder"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          style={styles.addTrigger}
          onPress={openAdd}
          accessibilityRole="button"
          accessibilityLabel="Add reminder"
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.addTriggerText}>Add reminder</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13, fontWeight: '600', color: '#666',
    marginTop: 16, marginBottom: 6, textTransform: 'uppercase',
  },
  preSaveHint: {
    color: colors.textMuted, fontSize: 13, fontStyle: 'italic',
    paddingVertical: 4,
  },
  emptyHint: {
    color: colors.textMuted, fontSize: 13, marginBottom: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: '#fafafa',
    borderRadius: 8, marginBottom: 6,
  },
  rowText: { flex: 1, fontSize: 14, color: '#333' },
  trashBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  addTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, cursor: 'pointer' as any,
  },
  addTriggerText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  addForm: {
    borderWidth: 1, borderColor: '#e3e7ee', borderRadius: 10,
    padding: 10, gap: 8, backgroundColor: '#fff',
  },
  addFormInputs: { flexDirection: 'row', gap: 8 },
  dateInput: {
    flex: 2, borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 10, fontSize: 14, backgroundColor: '#fafafa', color: '#333',
  },
  timeInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 10, fontSize: 14, backgroundColor: '#fafafa', color: '#333',
  },
  errText: { color: colors.danger, fontSize: 13 },
  warnText: { color: colors.warning, fontSize: 13 },
  addFormActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, cursor: 'pointer' as any,
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cancelBtn: {
    paddingHorizontal: 12, paddingVertical: 8, cursor: 'pointer' as any,
  },
  cancelBtnText: { color: colors.textMuted, fontSize: 14 },
});
