import { colors } from "@/lib/colors";
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Switch, ActivityIndicator, useWindowDimensions, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore, useFolderStore, useTagStore, Task, Tag, Reminder } from '@/lib/stores';
import * as api from '@/lib/api';
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

const PRIORITIES = [
  { value: 0, label: 'Low', color: '#999' },
  { value: 1, label: 'Medium', color: colors.warningSoft },
  { value: 2, label: 'High', color: colors.warning },
  { value: 3, label: 'Top', color: colors.danger },
];

const STATUSES = ['none', 'next_action', 'active', 'waiting', 'hold', 'postponed', 'someday', 'cancelled'];

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
  const [dueDate, setDueDate] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

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
      setDueDate(t.due_date || '');
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
        due_date: dueDate || null,
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
        } catch (e: any) {
          // If the DELETE fails we reload so the UI reflects the real
          // server state (task still present).
          reloadTasks();
        }
      },
    });
  };

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <ScrollView style={[styles.container, isNarrow && styles.containerNarrow]}>
      <Text style={styles.label}>Task</Text>
      <TextInput
        style={[styles.input, titleError && styles.inputError]}
        value={title}
        onChangeText={(v) => { setTitle(v); if (titleError) setTitleError(null); }}
        accessibilityLabel="Task title"
      />
      {titleError && <Text style={styles.errorText}>{titleError}</Text>}

      <Text style={styles.label}>Folder</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
        <TouchableOpacity style={[styles.chip, folderId === null && styles.chipActive]} onPress={() => setFolderId(null)}>
          <Text style={folderId === null ? styles.chipTextActive : styles.chipText}>None</Text>
        </TouchableOpacity>
        {folders.map((f) => (
          <TouchableOpacity key={f.id} style={[styles.chip, folderId === f.id && styles.chipActive]} onPress={() => setFolderId(f.id)}>
            <Text style={folderId === f.id ? styles.chipTextActive : styles.chipText}>{f.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.label}>Priority</Text>
      <View style={[styles.chipRow, styles.chipRowWrap]}>
        {PRIORITIES.map((p) => (
          <TouchableOpacity key={p.value} style={[styles.chip, priority === p.value && { backgroundColor: p.color }]} onPress={() => setPriority(p.value)}>
            <Text style={priority === p.value ? styles.chipTextActive : styles.chipText}>{p.value} {p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Status</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
        {STATUSES.map((s) => (
          <TouchableOpacity key={s} style={[styles.chip, status === s && styles.chipActive]} onPress={() => setStatus(s)}>
            <Text style={status === s ? styles.chipTextActive : styles.chipText}>{s.replace('_', ' ')}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.switchRow}>
        <Text style={styles.label}>Starred</Text>
        <Switch value={starred} onValueChange={setStarred} trackColor={{ true: colors.accent }} />
      </View>

      <Text style={styles.label}>Due date</Text>
      <DateField value={dueDate} onChange={setDueDate} placeholder="Pick a due date" />

      {tags.length > 0 && (
        <>
          <Text style={styles.label}>Tags</Text>
          <View style={[styles.chipRow, styles.chipRowWrap]}>
            {tags.map((t) => (
              <TouchableOpacity key={t.id} style={[styles.chip, selectedTagIds.includes(t.id) && styles.tagActive]} onPress={() => toggleTag(t.id)}>
                <Text style={selectedTagIds.includes(t.id) ? styles.chipTextActive : styles.chipText}>{t.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Note</Text>
      <TextInput
        style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder="Add notes…"
        // Light gray so the hint doesn't read as real pre-filled text.
        // See task/create.tsx for the same fix.
        placeholderTextColor="#bbb"
        accessibilityLabel="Task note"
      />

      <TaskReminderEditor
        taskId={Number(id)}
        reminders={reminders}
        onChanged={reloadReminders}
      />

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
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
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  chipRowContent: { gap: 8, paddingRight: 8 },
  chipRowWrap: { flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f0f0f0' },
  chipActive: { backgroundColor: colors.primary },
  tagActive: { backgroundColor: colors.violet },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { fontSize: 13, color: '#fff', fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  saveButton: { backgroundColor: colors.success, borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 24 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16, padding: 12 },
  deleteText: { color: colors.danger, fontSize: 15 },
});
