import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore, useFolderStore, useTagStore } from '@/lib/stores';

const PRIORITIES = [
  { value: 0, label: 'Low', color: '#999' },
  { value: 1, label: 'Medium', color: '#f0ad4e' },
  { value: 2, label: 'High', color: '#e67e22' },
  { value: 3, label: 'Top', color: '#e74c3c' },
];

const STATUSES = ['none', 'next_action', 'active', 'waiting', 'hold', 'postponed', 'someday', 'cancelled'];

const REPEAT_TYPES = ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly'];

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

  useEffect(() => { loadFolders(); loadTags(); }, []);

  const parseDate = (input: string): string | undefined => {
    if (!input) return undefined;
    const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (!match) return input;
    const [, mm, dd, yy] = match;
    const year = 2000 + parseInt(yy, 10);
    return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  };

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
        start_date: parseDate(startDate),
        due_date: parseDate(dueDate),
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

  return (
    <ScrollView style={styles.container}>
      {/* Title */}
      <Text style={styles.label}>Task</Text>
      <TextInput
        style={styles.input}
        placeholder="What needs to be done?"
        value={title}
        onChangeText={setTitle}
        autoFocus
        placeholderTextColor="#999"
      />

      {/* Folder */}
      <Text style={styles.label}>Folder</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        <TouchableOpacity
          style={[styles.chip, folderId === null && styles.chipActive]}
          onPress={() => setFolderId(null)}
        >
          <Text style={folderId === null ? styles.chipTextActive : styles.chipText}>None</Text>
        </TouchableOpacity>
        {folders.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.chip, folderId === f.id && styles.chipActive]}
            onPress={() => setFolderId(f.id)}
          >
            <Text style={folderId === f.id ? styles.chipTextActive : styles.chipText}>{f.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Priority */}
      <Text style={styles.label}>Priority</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[styles.chip, priority === p.value && { backgroundColor: p.color }]}
            onPress={() => setPriority(p.value)}
          >
            <Text style={priority === p.value ? styles.chipTextActive : styles.chipText}>
              {p.value} {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Status */}
      <Text style={styles.label}>Status</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {STATUSES.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, status === s && styles.chipActive]}
            onPress={() => setStatus(s)}
          >
            <Text style={status === s ? styles.chipTextActive : styles.chipText}>
              {s.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Starred */}
      <View style={styles.switchRow}>
        <Text style={styles.label}>Starred</Text>
        <Switch value={starred} onValueChange={setStarred} trackColor={{ true: '#f39c12' }} />
      </View>

      {/* Start Date */}
      <Text style={styles.label}>Start Date (MM/DD/YY)</Text>
      <TextInput
        style={styles.input}
        placeholder="03/28/26"
        value={startDate}
        onChangeText={setStartDate}
        placeholderTextColor="#999"
      />

      {/* Due Date */}
      <Text style={styles.label}>Due Date (MM/DD/YY)</Text>
      <TextInput
        style={styles.input}
        placeholder="04/15/26"
        value={dueDate}
        onChangeText={setDueDate}
        placeholderTextColor="#999"
      />

      {/* Repeat */}
      <Text style={styles.label}>Repeat</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {REPEAT_TYPES.map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.chip, repeatType === r && styles.chipActive]}
            onPress={() => setRepeatType(r)}
          >
            <Text style={repeatType === r ? styles.chipTextActive : styles.chipText}>{r}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Tags */}
      {tags.length > 0 && (
        <>
          <Text style={styles.label}>Tags</Text>
          <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>
            {tags.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.chip, selectedTagIds.includes(t.id) && styles.tagActive]}
                onPress={() => toggleTag(t.id)}
              >
                <Text style={selectedTagIds.includes(t.id) ? styles.chipTextActive : styles.chipText}>
                  {t.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Note */}
      <Text style={styles.label}>Note</Text>
      <TextInput
        style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
        placeholder="Additional details..."
        value={note}
        onChangeText={setNote}
        multiline
        placeholderTextColor="#999"
      />

      {/* Save Button */}
      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
        <Ionicons name="checkmark" size={20} color="#fff" />
        <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Task'}</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#666', marginTop: 16, marginBottom: 6, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, color: '#333' },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f0f0f0' },
  chipActive: { backgroundColor: '#1a73e8' },
  tagActive: { backgroundColor: '#8e44ad' },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { fontSize: 13, color: '#fff', fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  saveButton: { flexDirection: 'row', backgroundColor: '#27ae60', borderRadius: 8, padding: 16, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
