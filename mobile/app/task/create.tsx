import { colors } from "@/lib/colors";
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore, useFolderStore, useTagStore } from '@/lib/stores';
import Dropdown from '@/components/Dropdown';
import DateField from '@/components/DateField';
import TaskReminderEditor from '@/components/TaskReminderEditor';
import * as api from '@/lib/api';
import { parseBatch, titlesToText, MAX_BATCH } from '@/lib/multiAdd';

// GTD's "capture" inbox — the folder new brain-dump tasks land in by
// default. See original comments for the fuzzy matching rationale.
function pickCaptureFolderId(folders: { id: number; name: string }[]): number | null {
  const exact = folders.find((f) => f.name === '1. Capture');
  if (exact) return exact.id;
  const fuzzy = folders.find((f) => /^\s*(\d+\.\s*)?capture\b/i.test(f.name));
  return fuzzy?.id ?? null;
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

export default function CreateTaskScreen() {
  const router = useRouter();
  const { folders, load: loadFolders } = useFolderStore();
  const { tags, load: loadTags } = useTagStore();

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  // Auto-save state: taskId is null until the first save (title blur).
  const [taskId, setTaskId] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // GTD brain-dump mode
  const [mode, setMode] = useState<'one' | 'many'>('one');
  const [batchText, setBatchText] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchStatus, setBatchStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { loadFolders(); loadTags(); }, []);

  const parsedBatch = useMemo(() => parseBatch(batchText), [batchText]);
  const captureFolderId = useMemo(() => pickCaptureFolderId(folders), [folders]);

  // Note debounce: save 500ms after the user stops typing.
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 1200);
  }, []);

  // Auto-save a single field after the task has been created.
  const autoSave = useCallback(async (updates: Record<string, any>) => {
    if (!taskId) return;
    try {
      await api.updateTask(taskId, updates);
      useTaskStore.getState().load();
      flashSaved();
    } catch { /* silent — field reverts on next load */ }
  }, [taskId, flashSaved]);

  // Create the task on title blur (first save).
  const handleTitleBlur = async () => {
    const t = title.trim();
    if (!t) {
      if (title.length > 0) setTitleError('Title is required.');
      return;
    }
    setTitleError(null);
    if (taskId) {
      // Already created — just update the title.
      autoSave({ title: t });
      return;
    }
    try {
      const created = await api.createTask({
        title: t,
        folder_id: folderId,
        priority,
        status,
        starred,
        start_date: startDate || undefined,
        due_date: dueDate || undefined,
        repeat_type: repeatType,
        tag_ids: selectedTagIds,
        note: note || undefined,
      });
      setTaskId(created.id);
      useTaskStore.getState().load();
      flashSaved();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Failed to create task';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  };

  // Field change helpers — set local state + auto-save if task exists.
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

  const toggleTag = (id: number) => {
    setSelectedTagIds((prev) => {
      const next = prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id];
      if (taskId) autoSave({ tag_ids: next });
      return next;
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
          if (taskId) autoSave({ tag_ids: next });
          return next;
        });
      }
    } catch (e: any) {
      Alert.alert('Tag not created', e?.response?.data?.detail || 'Try again.');
    } finally {
      setAddingTag(false);
    }
  };

  const folderOptions = [
    { value: null as number | null, label: 'None' },
    ...folders.map((f) => ({ value: f.id as number | null, label: f.name })),
  ];

  const handleBatchSave = async () => {
    const { titles, truncated } = parsedBatch;
    if (titles.length === 0) {
      setBatchStatus({ kind: 'err', text: 'Nothing to add — paste one task per line.' });
      return;
    }
    setBatchSaving(true);
    setBatchStatus(null);
    const failed: string[] = [];
    let added = 0;
    for (const t of titles) {
      try {
        await api.createTask({
          title: t,
          folder_id: captureFolderId,
          status: 'none',
          priority: 0,
        });
        added += 1;
      } catch {
        failed.push(t);
      }
    }
    setBatchSaving(false);
    if (failed.length === 0) {
      const msg = truncated
        ? `Added ${added} tasks (capped at ${MAX_BATCH}). Trim the list and submit again for the rest.`
        : `Added ${added} task${added === 1 ? '' : 's'}.`;
      setBatchStatus({ kind: 'ok', text: msg });
      setBatchText('');
      useTaskStore.getState().load();
      setTimeout(() => router.back(), 700);
    } else {
      setBatchText(titlesToText(failed));
      setBatchStatus({
        kind: 'err',
        text: `Added ${added}. ${failed.length} failed — remaining titles kept below.`,
      });
      useTaskStore.getState().load();
    }
  };

  // Summary of hidden advanced values.
  const advancedSummary = (() => {
    const bits: string[] = [];
    if (status !== 'none') bits.push(status.replace('_', ' '));
    if (startDate) bits.push(`start ${startDate}`);
    if (dueDate) bits.push(`due ${dueDate}`);
    if (repeatType !== 'none') bits.push(repeatType);
    if (note) bits.push('note');
    return bits.join(' · ');
  })();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
    >
    <ScrollView
      style={styles.container}
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

      {/* Mode toggle */}
      <View style={styles.modeSegment} accessibilityRole="radiogroup" accessibilityLabel="Create mode">
        <Pressable
          style={[styles.modeBtn, mode === 'one' && styles.modeBtnActive]}
          onPress={() => setMode('one')}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === 'one' }}
        >
          <Text style={[styles.modeBtnText, mode === 'one' && styles.modeBtnTextActive]}>
            One task
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, mode === 'many' && styles.modeBtnActive]}
          onPress={() => setMode('many')}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === 'many' }}
        >
          <Text style={[styles.modeBtnText, mode === 'many' && styles.modeBtnTextActive]}>
            Add multiple
          </Text>
        </Pressable>
      </View>

      {mode === 'many' ? (
        <BatchMode
          text={batchText}
          onTextChange={setBatchText}
          onSubmit={handleBatchSave}
          saving={batchSaving}
          status={batchStatus}
          count={parsedBatch.titles.length}
          truncated={parsedBatch.truncated}
          captureFolderName={
            folders.find((f) => f.id === captureFolderId)?.name ?? null
          }
        />
      ) : (
      <>
      {/* Title + Star inline */}
      <Text style={styles.label}>Task</Text>
      <View style={styles.titleRow}>
        <TextInput
          style={[styles.input, styles.titleInput, titleError && styles.inputError]}
          placeholder="What needs to be done?"
          accessibilityLabel="Task title"
          value={title}
          onChangeText={(v) => { setTitle(v); if (titleError) setTitleError(null); }}
          onBlur={handleTitleBlur}
          autoFocus
          placeholderTextColor="#bbb"
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
            placeholder="Additional details…"
            accessibilityLabel="Task note"
            value={note}
            onChangeText={changeNote}
            multiline
            placeholderTextColor="#bbb"
          />

          <TaskReminderEditor
            taskId={taskId}
            reminders={[]}
            onChanged={() => {}}
          />
        </View>
      )}
      </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function BatchMode({
  text, onTextChange, onSubmit, saving, status, count, truncated, captureFolderName,
}: {
  text: string;
  onTextChange: (t: string) => void;
  onSubmit: () => void;
  saving: boolean;
  status: { kind: 'ok' | 'err'; text: string } | null;
  count: number;
  truncated: boolean;
  captureFolderName: string | null;
}) {
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={styles.label}>Brain dump</Text>
      <Text style={styles.batchHint}>
        One task per line. Lines starting with <Text style={{ fontWeight: '700' }}>#</Text> are ignored.
      </Text>
      <TextInput
        style={[styles.input, styles.batchArea]}
        placeholder={'Pick up laundry\nEmail Alex re: Q2 budget\n# these will go to your Capture inbox'}
        placeholderTextColor="#bbb"
        value={text}
        onChangeText={onTextChange}
        multiline
        autoFocus
        accessibilityLabel="Tasks, one per line"
        autoCapitalize="sentences"
      />
      <Text style={styles.batchMetaHint}>
        {count > 0
          ? `${count} task${count === 1 ? '' : 's'} ready${truncated ? ` (capped at ${MAX_BATCH})` : ''}`
          : 'Paste or type to get started.'}
        {captureFolderName
          ? `  ·  Destination: ${captureFolderName}`
          : '  ·  Destination: no folder (create a "1. Capture" folder to organize).'}
      </Text>
      {status && (
        <Text style={status.kind === 'ok' ? styles.batchOk : styles.batchErr}>
          {status.text}
        </Text>
      )}
      <TouchableOpacity
        style={[styles.batchSaveBtn, (count === 0 || saving) && { opacity: 0.6 }]}
        onPress={onSubmit}
        disabled={count === 0 || saving}
        accessibilityRole="button"
        accessibilityLabel={`Add ${count} tasks`}
      >
        <Ionicons name="checkmark" size={18} color="#fff" />
        <Text style={styles.batchSaveText}>
          {saving ? 'Adding…' : count > 0 ? `Add ${count} task${count === 1 ? '' : 's'}` : 'Add tasks'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 12 },
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

  modeSegment: {
    flexDirection: 'row', gap: 0,
    borderRadius: 8, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 4,
  },
  modeBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 6, backgroundColor: '#fff',
    cursor: 'pointer' as any,
    minHeight: 44,
  },
  modeBtnActive: { backgroundColor: colors.primary },
  modeBtnText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  modeBtnTextActive: { color: '#fff' },

  // Batch mode (brain dump) — keeps its own save button since it's
  // a multi-task submit, not an auto-save flow.
  batchHint: { fontSize: 12, color: colors.textMuted, marginTop: -2, marginBottom: 8 },
  batchArea: {
    minHeight: 200, textAlignVertical: 'top', lineHeight: 22,
  },
  batchMetaHint: {
    fontSize: 12, color: colors.textMuted, marginTop: 8, marginBottom: 4,
  },
  batchOk: { fontSize: 12, color: colors.success, fontWeight: '600', marginTop: 4 },
  batchErr: { fontSize: 12, color: colors.danger, fontWeight: '600', marginTop: 4 },
  batchSaveBtn: {
    flexDirection: 'row', backgroundColor: colors.success, borderRadius: 6, padding: 10,
    alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12,
  },
  batchSaveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
