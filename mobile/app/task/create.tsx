import { colors } from "@/lib/colors";
import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Switch, Pressable, KeyboardAvoidingView, Platform,
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
// default. The register flow seeds a folder literally named "1. Capture";
// if the user has renamed or removed it, we fall through to the first
// folder whose name starts with "capture" (case-insensitive), and then
// to no folder at all. Intentional: brain-dumped tasks should NOT inherit
// the currently-filtered folder context — that's the GTD "capture now,
// clarify later" rule.
function pickCaptureFolderId(folders: { id: number; name: string }[]): number | null {
  const exact = folders.find((f) => f.name === '1. Capture');
  if (exact) return exact.id;
  const fuzzy = folders.find((f) => /^\s*(\d+\.\s*)?capture\b/i.test(f.name));
  return fuzzy?.id ?? null;
}

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

export default function CreateTaskScreen() {
  const router = useRouter();
  const createTask = useTaskStore((s) => s.create);
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
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  // Inline title-error state. Replaces Alert.alert which is a silent
  // no-op on Expo web (the reported "empty title silently fails" bug).
  const [titleError, setTitleError] = useState<string | null>(null);

  // GTD brain-dump mode. Toggles the header between "One task" and
  // "Add multiple"; the latter swaps the title field for a multiline
  // textarea and the action metadata for a "goes to Capture folder"
  // hint. Batch text persists across toggles so accidental flips don't
  // wipe a 30-line dump.
  const [mode, setMode] = useState<'one' | 'many'>('one');
  const [batchText, setBatchText] = useState('');
  const [batchStatus, setBatchStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { loadFolders(); loadTags(); }, []);

  const parsedBatch = useMemo(() => parseBatch(batchText), [batchText]);
  const captureFolderId = useMemo(() => pickCaptureFolderId(folders), [folders]);

  const handleCreateTag = async () => {
    const name = newTag.trim();
    if (!name || addingTag) return;
    setAddingTag(true);
    try {
      const created = await api.createTag(name);
      await loadTags();
      setNewTag('');
      // Auto-select the tag the user just created — almost always what they want.
      if (created?.id) setSelectedTagIds((prev) => [...prev, created.id]);
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

  const handleSave = async () => {
    if (!title.trim()) {
      setTitleError('Title is required.');
      return;
    }
    setTitleError(null);
    setSaving(true);
    try {
      await createTask({
        title: title.trim(),
        folder_id: folderId,
        note: note || undefined,
        priority,
        status,
        starred,
        start_date: startDate || undefined,
        due_date: dueDate || undefined,
        repeat_type: repeatType,
        tag_ids: selectedTagIds,
      });
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Failed to create task';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleBatchSave = async () => {
    const { titles, truncated } = parsedBatch;
    if (titles.length === 0) {
      setBatchStatus({ kind: 'err', text: 'Nothing to add — paste one task per line.' });
      return;
    }
    setSaving(true);
    setBatchStatus(null);
    // Best-effort loop. Record per-index outcomes so failed titles can
    // be surfaced back into the textarea for a retry without re-typing.
    // Sequential (not parallel) to keep server-side rate / validation
    // errors attributable to a specific title.
    const failed: string[] = [];
    let added = 0;
    for (const t of titles) {
      try {
        await api.createTask({
          title: t,
          // GTD capture rule: brand-new tasks don't inherit the
          // currently-filtered folder/priority/status. Everything goes
          // to the Capture inbox; clarification happens later.
          folder_id: captureFolderId,
          status: 'none',
          priority: 0,
        });
        added += 1;
      } catch {
        failed.push(t);
      }
    }
    setSaving(false);
    if (failed.length === 0) {
      const msg = truncated
        ? `Added ${added} tasks (capped at ${MAX_BATCH}). Trim the list and submit again for the rest.`
        : `Added ${added} task${added === 1 ? '' : 's'}.`;
      setBatchStatus({ kind: 'ok', text: msg });
      // Clear text and bounce back — a full success is a clean finish.
      setBatchText('');
      // Nudge the task store so the list reflects the new entries.
      useTaskStore.getState().load();
      // Small delay so the success banner is visible before we leave.
      setTimeout(() => router.back(), 700);
    } else {
      // Partial failure: keep the failing lines in the textarea for retry.
      setBatchText(titlesToText(failed));
      setBatchStatus({
        kind: 'err',
        text: `Added ${added}. ${failed.length} failed — remaining titles kept below.`,
      });
      useTaskStore.getState().load();
    }
  };

  const toggleTag = (id: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  // Summary of hidden advanced values so user knows something's set.
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
      // Small inset so the submit button doesn't collide with the iOS
      // keyboard's autofill suggestions bar.
      keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Mode toggle — segmented control. "Add multiple" is the GTD
          brain-dump channel: one task per line, everything lands in
          Capture, metadata is clarified later. */}
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
          saving={saving}
          status={batchStatus}
          count={parsedBatch.titles.length}
          truncated={parsedBatch.truncated}
          captureFolderName={
            folders.find((f) => f.id === captureFolderId)?.name ?? null
          }
        />
      ) : (
      <>
      {/* Title */}
      <Text style={styles.label}>Task</Text>
      <TextInput
        style={[styles.input, titleError && styles.inputError]}
        placeholder="What needs to be done?"
        accessibilityLabel="Task title"
        value={title}
        onChangeText={(v) => { setTitle(v); if (titleError) setTitleError(null); }}
        autoFocus
        placeholderTextColor="#bbb"
      />
      {titleError && <Text style={styles.errorText}>{titleError}</Text>}

      {/* Folder — dropdown replaces the chip strip */}
      <Text style={styles.label}>Folder</Text>
      <Dropdown
        value={folderId}
        options={folderOptions}
        onChange={setFolderId}
        placeholder="Pick a folder"
      />

      {/* Priority — small set, color-coded chips */}
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

      {/* Tags — always visible so a first-run user can create their first tag
          without leaving this screen. Previously this section only rendered
          when tags.length > 0, which hid the affordance entirely. */}
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

      {/* Advanced collapse — status + dates + repeat + note live here */}
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
            placeholder="Additional details…"
            accessibilityLabel="Task note"
            value={note}
            onChangeText={setNote}
            multiline
            // Light gray so placeholder reads as a hint, not pre-filled
            // text. colors.textMuted (#595959) is darkened for body-text
            // a11y — too close to real input to be a placeholder.
            placeholderTextColor="#bbb"
          />

          {/* Pre-save stub: renders a "save first" hint because the
              task has no id yet. Once created the detail screen has
              the real editor. */}
          <TaskReminderEditor
            taskId={null}
            reminders={[]}
            onChanged={() => {}}
          />
        </View>
      )}

      {/* Save */}
      <TouchableOpacity
        style={[styles.saveButton, (!title.trim() || saving) && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={!title.trim() || saving}
        accessibilityRole="button"
      >
        <Ionicons name="checkmark" size={20} color="#fff" />
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save Task'}</Text>
      </TouchableOpacity>
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
        style={[styles.saveButton, (count === 0 || saving) && { opacity: 0.6 }]}
        onPress={onSubmit}
        disabled={count === 0 || saving}
        accessibilityRole="button"
        accessibilityLabel={`Add ${count} tasks`}
      >
        <Ionicons name="checkmark" size={20} color="#fff" />
        <Text style={styles.saveText}>
          {saving ? 'Adding…' : count > 0 ? `Add ${count} task${count === 1 ? '' : 's'}` : 'Add tasks'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
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

  modeSegment: {
    flexDirection: 'row', gap: 0,
    borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 6,
  },
  modeBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, backgroundColor: '#fff',
    cursor: 'pointer' as any,
    minHeight: 44,
  },
  modeBtnActive: { backgroundColor: colors.primary },
  modeBtnText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  modeBtnTextActive: { color: '#fff' },

  batchHint: { fontSize: 12, color: colors.textMuted, marginTop: -2, marginBottom: 8 },
  batchArea: {
    minHeight: 200, textAlignVertical: 'top',
    // iOS Safari zooms on <16px inputs; our base `input` is 16 already,
    // but the textarea line-height benefits from a slight bump for the
    // long-form feel of a brain dump.
    lineHeight: 22,
  },
  batchMetaHint: {
    fontSize: 12, color: colors.textMuted,
    marginTop: 8, marginBottom: 4,
  },
  batchOk: {
    fontSize: 13, color: colors.success, fontWeight: '600',
    marginTop: 6,
  },
  batchErr: {
    fontSize: 13, color: colors.danger, fontWeight: '600',
    marginTop: 6,
  },
});
