import { colors } from "@/lib/colors";
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Pressable,
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

function confirmDestructive(title: string, message: string, destructiveLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
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
  { value: 1, label: 'Med', color: colors.warningSoft },
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
  const taskId = Number(id);
  const router = useRouter();
  const { remove, load: reloadTasks } = useTaskStore();
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
  const [titleError, setTitleError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  // Auto-save indicator
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadFolders();
    loadTags();
    loadTask();
  }, [id]);

  const loadTask = async () => {
    try {
      const t = await api.getTask(taskId);
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
      const list = await api.getReminders(taskId);
      setReminders(list);
    } catch {
      loadTask();
    }
  };

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 1200);
  }, []);

  const autoSave = useCallback(async (updates: Record<string, any>) => {
    try {
      await api.updateTask(taskId, updates);
      reloadTasks();
      flashSaved();
    } catch { /* silent */ }
  }, [taskId, flashSaved, reloadTasks]);

  // Field change helpers — auto-save immediately.
  const handleTitleBlur = () => {
    const t = title.trim();
    if (!t) { setTitleError('Title is required.'); return; }
    setTitleError(null);
    autoSave({ title: t });
  };
  const changePriority = (v: number) => { setPriority(v); autoSave({ priority: v }); };
  const changeFolder = (v: number | null) => { setFolderId(v); autoSave({ folder_id: v }); };
  const changeStarred = () => { const v = !starred; setStarred(v); autoSave({ starred: v }); };
  const changeStatus = (v: string) => { setStatus(v); autoSave({ status: v }); };
  const changeStartDate = (v: string) => { setStartDate(v); autoSave({ start_date: v || null }); };
  const changeDueDate = (v: string) => { setDueDate(v); autoSave({ due_date: v || null }); };
  const changeRepeat = (v: string) => { setRepeatType(v); autoSave({ repeat_type: v }); };
  const changeNote = (v: string) => {
    setNote(v);
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    noteTimerRef.current = setTimeout(() => autoSave({ note: v || null }), 500);
  };

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) => {
      const next = prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId];
      autoSave({ tag_ids: next });
      return next;
    });
  };

  const handleDelete = async () => {
    const ok = await confirmDestructive(
      `Delete "${title || 'this task'}"?`,
      'The task will be removed. You have 5 seconds to undo.',
      'Delete',
    );
    if (!ok) return;
    router.back();
    undo.show({
      message: 'Task deleted',
      onUndo: () => { reloadTasks(); },
      onTimeout: async () => {
        try { await remove(taskId); } catch { reloadTasks(); }
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
      if (created?.id) {
        setSelectedTagIds((prev) => {
          const next = [...prev, created.id];
          autoSave({ tag_ids: next });
          return next;
        });
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Try again.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Tag not created', msg);
    } finally {
      setAddingTag(false);
    }
  };

  const folderOptions = [
    { value: null as number | null, label: 'None' },
    ...folders.map((f) => ({ value: f.id as number | null, label: f.name })),
  ];

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
    <ScrollView
      style={[styles.container, isNarrow && styles.containerNarrow]}
      contentContainerStyle={{ paddingBottom: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Saved indicator */}
      {saved && (
        <View style={styles.savedBadge}>
          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          <Text style={styles.savedText}>Saved</Text>
        </View>
      )}

      {/* Title + Star inline */}
      <Text style={styles.label}>Task</Text>
      <View style={styles.titleRow}>
        <TextInput
          style={[styles.input, styles.titleInput, titleError && styles.inputError]}
          value={title}
          onChangeText={(v) => { setTitle(v); if (titleError) setTitleError(null); }}
          onBlur={handleTitleBlur}
          accessibilityLabel="Task title"
          returnKeyType="done"
          onSubmitEditing={handleTitleBlur}
        />
        <Pressable
          onPress={changeStarred}
          style={styles.starBtn}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: starred }}
          accessibilityLabel="Starred"
          hitSlop={6}
        >
          <Ionicons
            name={starred ? 'star' : 'star-outline'}
            size={22}
            color={starred ? '#b8860b' : '#767676'}
          />
        </Pressable>
      </View>
      {titleError && <Text style={styles.errorText}>{titleError}</Text>}

      {/* Folder + Priority side by side */}
      <View style={styles.twoCol}>
        <View style={styles.col}>
          <Text style={styles.label}>Folder</Text>
          <Dropdown
            value={folderId}
            options={folderOptions}
            onChange={changeFolder}
            placeholder="Folder"
            compact
          />
        </View>
        <View style={styles.col}>
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
                  onPress={() => changePriority(p.value)}
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
        </View>
      </View>

      {/* Tags */}
      <Text style={styles.label}>Tags</Text>
      {tags.length > 0 && (
        <View style={[styles.chipRow, { flexWrap: 'wrap', marginBottom: 4 }]}>
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
          hitSlop={6}
        >
          <Ionicons name="add" size={16} color="#fff" />
        </Pressable>
      </View>

      {/* Reminders — edit-only, always visible */}
      <TaskReminderEditor
        taskId={taskId}
        reminders={reminders}
        onChanged={reloadReminders}
      />

      {/* Advanced collapse */}
      <Pressable
        style={styles.advancedToggle}
        onPress={() => setAdvancedOpen(!advancedOpen)}
        accessibilityRole="button"
        accessibilityState={{ expanded: advancedOpen }}
      >
        <Ionicons
          name={advancedOpen ? 'chevron-down' : 'chevron-forward'}
          size={14} color={colors.primary}
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
          {/* Status + Repeat side by side */}
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Status</Text>
              <Dropdown
                value={status}
                options={STATUS_OPTIONS}
                onChange={changeStatus}
                placeholder="Status"
                compact
              />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Repeat</Text>
              <Dropdown
                value={repeatType}
                options={REPEAT_OPTIONS}
                onChange={changeRepeat}
                placeholder="Repeat"
                compact
              />
            </View>
          </View>

          {/* Start + Due side by side */}
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Start</Text>
              <DateField value={startDate} onChange={changeStartDate} placeholder="Start date" compact />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Due</Text>
              <DateField value={dueDate} onChange={changeDueDate} placeholder="Due date" compact />
            </View>
          </View>

          <Text style={styles.label}>Note</Text>
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            value={note}
            onChangeText={changeNote}
            multiline
            placeholder="Add notes…"
            placeholderTextColor="#bbb"
            accessibilityLabel="Task note"
          />
        </View>
      )}

      {/* Delete — no save button, everything auto-saves */}
      <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} accessibilityRole="button">
        <Ionicons name="trash-outline" size={16} color={colors.danger} />
        <Text style={styles.deleteText}>Delete Task</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 12 },
  containerNarrow: { padding: 12 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  label: {
    fontSize: 12, fontWeight: '600', color: '#666',
    marginTop: 8, marginBottom: 3, textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6,
    padding: 8, fontSize: 14, color: '#333',
  },
  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText: { color: colors.danger, fontSize: 11, marginTop: 2 },

  // Title row with inline star
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleInput: { flex: 1 },
  starBtn: { padding: 4 },

  // Saved indicator
  savedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-end', marginBottom: 2,
  },
  savedText: { fontSize: 11, color: colors.success, fontWeight: '600' },

  // Two-column layout
  twoCol: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },

  chipRow: { flexDirection: 'row', gap: 5, marginBottom: 4, flexWrap: 'wrap' },

  priChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
    borderWidth: 1.5, backgroundColor: '#fff',
  },
  priChipText: { fontSize: 12, fontWeight: '600' },

  tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#f3e8ff' },
  tagChipOn: { backgroundColor: colors.violet },
  chipText: { fontSize: 12, color: '#555' },
  chipTextActive: { fontSize: 12, color: '#fff', fontWeight: '600' },

  newTagRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  newTagInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 6,
    fontSize: 12, color: '#333', backgroundColor: '#fafafa',
  },
  newTagBtn: {
    width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.violet, cursor: 'pointer' as any,
  },

  advancedToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
  },
  advancedToggleText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  advancedSummary: { color: colors.textMuted, fontSize: 11, flex: 1 },

  deleteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 12, padding: 10,
  },
  deleteText: { color: colors.danger, fontSize: 13 },
});
