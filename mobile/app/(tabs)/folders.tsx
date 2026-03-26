import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFolderStore, useTaskStore } from '@/lib/stores';
import * as api from '@/lib/api';

export default function FoldersScreen() {
  const { folders, load, selectFolder } = useFolderStore();
  const setFilters = useTaskStore((s) => s.setFilters);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await api.createFolder(newName.trim(), folders.length);
      setNewName('');
      setAdding(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to create folder');
    }
  };

  const handleDelete = (id: number, name: string) => {
    Alert.alert('Delete Folder', `Delete "${name}"? Tasks in this folder will become unassigned.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await api.deleteFolder(id);
          load();
        }
      },
    ]);
  };

  const handleSelect = (folderId: number) => {
    selectFolder(folderId);
    setFilters({ folder_id: folderId });
  };

  return (
    <View style={styles.container}>
      {/* All tasks option */}
      <TouchableOpacity style={styles.row} onPress={() => { selectFolder(null); setFilters({ folder_id: undefined }); }}>
        <Ionicons name="list" size={20} color="#1a73e8" />
        <Text style={styles.folderName}>All Tasks</Text>
      </TouchableOpacity>

      <FlatList
        data={folders}
        keyExtractor={(f) => String(f.id)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => handleSelect(item.id)} onLongPress={() => handleDelete(item.id, item.name)}>
            <Ionicons name="folder-outline" size={20} color="#1a73e8" />
            <Text style={styles.folderName}>{item.name}</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{item.task_count}</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {adding ? (
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder="Folder name"
            value={newName}
            onChangeText={setNewName}
            autoFocus
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity onPress={handleAdd}>
            <Ionicons name="checkmark-circle" size={28} color="#27ae60" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAdding(false)}>
            <Ionicons name="close-circle" size={28} color="#e74c3c" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.addButton} onPress={() => setAdding(true)}>
          <Ionicons name="add-circle-outline" size={20} color="#1a73e8" />
          <Text style={styles.addText}>Add Folder</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee', gap: 12 },
  folderName: { flex: 1, fontSize: 16, color: '#333' },
  countBadge: { backgroundColor: '#e8f0fe', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2 },
  countText: { fontSize: 13, color: '#1a73e8', fontWeight: '600' },
  addRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  addInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 15 },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  addText: { color: '#1a73e8', fontSize: 15 },
});
