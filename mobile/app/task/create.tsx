import { colors } from "@/lib/colors";
import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Switch, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore, useFolderStore, useTagStore } from '@/lib/stores';
import Dropdown from '@/components/Dropdown';
import DateField from '@/components/DateField';
import * as api from '@/lib/api';

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

  useEffect(() => { loadFolders(); loadTags(); }, []);

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
    if (!title.trim()) return Alert.alert('Error', 'Title is required');
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
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to create task');
    } finally {
      setSaving(false);
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
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Title */}
      <Text style={styles.label}>Task</Text>
      <TextInput
        style={styles.input}
        placeholder="What needs to be done?"
        accessibilityLabel="Task title"
        value={title}
        onChangeText={setTitle}
        autoFocus
        placeholderTextColor="#bbb"
      />

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#666', marginTop: 16, marginBottom: 6, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, color: '#333' },

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
});
