import { colors } from "@/lib/colors";
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Switch, Pressable,
  ActivityIndicator, useWindowDimensions, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore, useFolderStore, useTagStore, Task, Tag, Reminder } from '@/lib/stores';
import * as api from '@/lib/api';
import Dropdown from '@/components/Dropdown';
import DateField from '@/components/DateField';
import TaskReminderEditor from '@/components/TaskReminderEditor';
import { useUndoSnackbar } from '@/components/UndoSnackbar';

/** Yes/no confirm that works on both web and native. `Alert.alert`
 *  silently no-ops on Expo web, which is why the Delete Task button
 *  previously did nothing when clicked in the browser. */
function confirmDestructive(title: string, message: string, destructiveLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: destructiveLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

// Shared definitions with create.tsx. Kept inline rather than factored
// into a shared module because the two screens diverge on a few bits
// (create allows multi-add; edit has reminders + delete). If they
// drift further, extract.
const PRIORITIES = [
  { value: 0, label: 'Low', color: '#999' },
  { value: 1, label: 'Medium', color: colors.warningSoft },
  { value: 2, label: 'High', color: colors.warning },
  { value: 3, label: 'Top', color: colors.danger },
];

const STATUS_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'next_action', label: 'Next action' },
  { value: 'active', label: 'Active' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'hold', label: 'Hold' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'someday', label: 'Someday' },
  { value: 'cancelled', label: 'Cancelled' },
];

const REPEAT_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: 'Every 6 months' },
  { value: 'yearly', label: 'Yearly' },
];

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { update, remove, load: reloadTasks } = useTaskStore();
  const { folders, load: loadFolders } = useFolderStore();
  const { tags, load: loadTags } = useTagStore();
  const undo = useUndoSnackbar();
  const { width } = useWindowDimensions();
  const isNarrow = width < 700;

  const [task, setTask] = useState<Task | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [folderId, setFolderId] = useState<number | null>(null);
  const [priority, setPriority] = useState(0);
  const [status, setStatus] = useState('none');
  const [starred, setStarred] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [repeatType, setRepeatType] = useState('none');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  useEffect(() => {
    loadFolders();
    loadTags();
    loadTask();
  }, [id]);

  const loadTask = async () => {
    try {
      const t = await api.getTask(Number(id));
      setTask(t);
      setTitle(t.title);
      setNote(t.note || '');
      setFolderId(t.folder_id);
      setPriority(t.priority);
      setStatus(t.status);
      setStarred(t.starred);
      setStartDate(t.start_date || '');
      setDueDate(t.due_date || '');
      setRepeatType(t.repeat_type || 'none');
      setSelectedTagIds(t.tags?.map((tg: Tag) => tg.id) || []);
      setReminders(t.reminders || []);
    } catch {
      Alert.alert('Error', 'Task not found');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const reloadReminders = async () => {
    try {
      const list = await api.getReminders(Number(id));
      setReminders(list);
    } catch {
      // Fall back to reloading the whole task — the GET /reminders
      // endpoint might have been temporarily unreachable.
      loadTask();
    }
  };

  const handleSave = async () => {
    // Inline validation instead of Alert.alert which is a silent no-op
    // on Expo web. Clearing the error on next edit is driven by the
    // TextInput's onChangeText below.
    if (!title.trim()) {
      setTitleError('Title is required.');
      return;
    }
    setTitleError(null);
    setSaving(true);
    try {
      await update(Number(id), {
        title: title.trim(),
        folder_id: folderId,
        note: note || null,
        priority,
        status,
        starred,
        start_date: startDate || null,
        due_date: dueDate || null,
        repeat_type: repeatType,
        tag_ids: selectedTagIds,
      });
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Failed to save';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirmDestructive(
      `Delete "${title || 'this task'}"?`,
      'The task will be removed. You have 5 seconds to undo.',
      'Delete',
    );
    if (!ok) return;
    // Navigate back immediately so the user sees the row disappear.
    // The actual DELETE fires when the undo window elapses; tapping
    // undo before then is pure local state (no server round-trip).
    const taskId = Number(id);
    router.back();
    undo.show({
      message: 'Task deleted',
      onUndo: () => {
        // The task is still on the server (we haven't fired DELETE
        // yet). On undo the store reloads; the row reappears.
        reloadTasks();
      },
      onTimeout: async () => {
        try {
          await remove(taskId);
        } catch {
          // If the DELETE fails we reload so the UI reflects the real
          // server state (task still present).
          reloadTasks();
        }
      },
    });
  };

  const handleCreateTag = async () => {
    const name = newTag.trim();
    if (!name || addingTag) return;
    setAddingTag(true);
    try {
      const created = await api.createTag(name);
      await loadTags();
      setNewTag('');
      if (created?.id) setSelectedTagIds((prev) => [...prev, created.id]);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Try again.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Tag not created', msg);
    } finally {
      setAddingTag(false);
    }
  };

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const folderOptions = [
    { value: null as number | null, label: 'None' },
    ...folders.map((f) => ({ value: f.id as number | null, label: f.name })),
  ];

  // Summary of hidden advanced values so the user knows something's set
  // when the section is collapsed. Matches the create screen exactly.
  const advancedSummary = (() => {
    const bits: string[] = [];
    if (status !== 'none') bits.push(status.replace('_', ' '));
    if (startDate) bits.push(`start ${startDate}`);
    if (dueDate) bits.push(`due ${dueDate}`);
    if (repeatType !== 'none') bits.push(repeatType);
    if (note) bits.push('note');
    return bits.join(' · ');
  })();

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <ScrollView style={[styles.container, isNarrow && styles.containerNarrow]} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Title */}
      <Text style={styles.label}>Task</Text>
      <TextInput
        style={[styles.input, titleError && styles.inputError]}
        value={title}
        onChangeText={(v) => { setTitle(v); if (titleError) setTitleError(null); }}
        accessibilityLabel="Task title"
      />
      {titleError && <Text style={styles.errorText}>{titleError}</Text>}

      {/* Folder — dropdown, same as create.tsx (was a chip strip) */}
      <Text style={styles.label}>Folder</Text>
      <Dropdown
        value={folderId}
        options={folderOptions}
        onChange={setFolderId}
        placeholder="Pick a folder"
      />

      {/* Priority — color-coded chips, same style as create.tsx */}
      <Text style={styles.label}>Priority</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => {
          const active = priority === p.value;
          return (
            <TouchableOpacity
              key={p.value}
              style={[
                styles.priChip,
                { borderColor: p.color },
                active && { backgroundColor: p.color },
              ]}
              onPress={() => setPriority(p.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Priority ${p.label}`}
            >
              <Text style={[
                styles.priChipText,
                { color: active ? '#fff' : p.color },
              ]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Starred */}
      <View style={styles.switchRow}>
        <Text style={styles.label}>Starred</Text>
        <Switch
          value={starred}
          onValueChange={setStarred}
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Starred"
        />
      </View>

      {/* Tags — same layout + inline create as create.tsx */}
      <Text style={styles.label}>Tags</Text>
      {tags.length > 0 && (
        <View style={[styles.chipRow, { flexWrap: 'wrap', marginBottom: 6 }]}>
          {tags.map((t) => {
            const on = selectedTagIds.includes(t.id);
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.tagChip, on && styles.tagChipOn]}
                onPress={() => toggleTag(t.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Text style={on ? styles.chipTextActive : styles.chipText}>
                  {t.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <View style={styles.newTagRow}>
        <TextInput
          value={newTag}
          onChangeText={setNewTag}
          placeholder={tags.length === 0 ? 'Create your first tag…' : '+ New tag'}
          accessibilityLabel="New tag name"
          placeholderTextColor="#bbb"
          style={styles.newTagInput}
          autoCapitalize="none"
          onSubmitEditing={handleCreateTag}
          returnKeyType="done"
        />
        <Pressable
          style={[styles.newTagBtn, (!newTag.trim() || addingTag) && { opacity: 0.5 }]}
          onPress={handleCreateTag}
          disabled={!newTag.trim() || addingTag}
          accessibilityRole="button"
          accessibilityLabel="Add tag"
        >
          <Ionicons name="add" size={18} color="#fff" />
        </Pressable>
      </View>

      {/* Reminders stay visible — they're only available on edit */}
      <TaskReminderEditor
        taskId={Number(id)}
        reminders={reminders}
        onChanged={reloadReminders}
      />

      {/* Advanced collapse — status, dates, repeat, note. Mirrors create.tsx. */}
      <Pressable
        style={styles.advancedToggle}
        onPress={() => setAdvancedOpen(!advancedOpen)}
        accessibilityRole="button"
        accessibilityState={{ expanded: advancedOpen }}
      >
        <Ionicons
          name={advancedOpen ? 'chevron-down' : 'chevron-forward'}
          size={16} color={colors.primary}
        />
        <Text style={styles.advancedToggleText}>
          {advancedOpen ? 'Hide' : 'More'} options
        </Text>
        {!advancedOpen && advancedSummary ? (
          <Text style={styles.advancedSummary} numberOfLines={1}>
            · {advancedSummary}
          </Text>
        ) : null}
      </Pressable>

      {advancedOpen && (
        <View>
          <Text style={styles.label}>Status</Text>
          <Dropdown
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
            placeholder="Select status"
          />

          <Text style={styles.label}>Start date</Text>
          <DateField value={startDate} onChange={setStartDate} placeholder="Pick a start date" />

          <Text style={styles.label}>Due date</Text>
          <DateField value={dueDate} onChange={setDueDate} placeholder="Pick a due date" />

          <Text style={styles.label}>Repeat</Text>
          <Dropdown
            value={repeatType}
            options={REPEAT_OPTIONS}
            onChange={setRepeatType}
            placeholder="Repeat cadence"
          />

          <Text style={styles.label}>Note</Text>
          <TextInput
            style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
            value={note}
            onChangeText={setNote}
            multiline
            placeholder="Add notes…"
            placeholderTextColor="#bbb"
            accessibilityLabel="Task note"
          />
        </View>
      )}

      <TouchableOpacity
        style={[styles.saveButton, saving && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={saving}
        accessibilityRole="button"
      >
        <Ionicons name="checkmark" size={20} color="#fff" />
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} accessibilityRole="button">
        <Ionicons name="trash-outline" size={18} color={colors.danger} />
        <Text style={styles.deleteText}>Delete Task</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  containerNarrow: { padding: 12 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  label: { fontSize: 13, fontWeight: '600', color: '#666', marginTop: 16, marginBottom: 6, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, color: '#333' },
  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 4 },

  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap' },

  priChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, backgroundColor: '#fff',
  },
  priChipText: { fontSize: 13, fontWeight: '600' },

  tagChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f3e8ff' },
  tagChipOn: { backgroundColor: colors.violet },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { fontSize: 13, color: '#fff', fontWeight: '600' },

  newTagRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  newTagInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10,
    fontSize: 14, color: '#333', backgroundColor: '#fafafa',
  },
  newTagBtn: {
    width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.violet, cursor: 'pointer' as any,
  },

  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12,
  },

  advancedToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
  },
  advancedToggleText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  advancedSummary: { color: colors.textMuted, fontSize: 12, flex: 1 },

  saveButton: {
    flexDirection: 'row', backgroundColor: colors.success, borderRadius: 8, padding: 16,
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24,
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 16, padding: 12,
  },
  deleteText: { color: colors.danger, fontSize: 15 },
});
