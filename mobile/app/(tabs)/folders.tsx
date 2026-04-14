import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput,
  ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFolderStore, useTaskStore, Task } from '@/lib/stores';
import * as api from '@/lib/api';

const PRIORITY_COLORS: Record<number, string> = {
  0: '#999', 1: '#f0ad4e', 2: '#e67e22', 3: '#e74c3c',
};
const PRIORITY_LABELS: Record<number, string> = {
  0: 'Low', 1: 'Med', 2: 'High', 3: 'Top',
};

function TaskRow({ task, onPress, onStar, onComplete }: {
  task: Task; onPress: () => void; onStar: () => void; onComplete: () => void;
}) {
  return (
    <Pressable style={styles.taskRow} onPress={onPress}>
      <Pressable onPress={onComplete} style={styles.checkBox}>
        <Ionicons
          name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
          size={22} color={task.completed ? '#27ae60' : '#ccc'}
        />
      </Pressable>
      <Pressable onPress={onStar} style={{ marginRight: 8 }}>
        <Ionicons
          name={task.starred ? 'star' : 'star-outline'}
          size={18} color={task.starred ? '#f39c12' : '#ccc'}
        />
      </Pressable>
      <View style={styles.taskContent}>
        <Text style={[styles.taskTitle, task.completed && styles.completedText]} numberOfLines={1}>
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          {task.due_date && <Text style={styles.dueDateText}>{task.due_date}</Text>}
          {task.tags.map((t) => (
            <Text key={t.id} style={styles.tagBadge}>{t.name}</Text>
          ))}
        </View>
      </View>
      <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[task.priority] }]}>
        <Text style={styles.priorityText}>{PRIORITY_LABELS[task.priority]}</Text>
      </View>
    </Pressable>
  );
}

export default function FoldersScreen() {
  const router = useRouter();
  const { folders, load: loadFolders, selectedFolderId, selectFolder } = useFolderStore();
  const { tasks, isLoading, load: loadTasks, complete, toggleStar, setFilters } = useTaskStore();
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => { loadFolders(); }, []);

  // Load tasks when selected folder changes
  useEffect(() => {
    setFilters({ folder_id: selectedFolderId ?? undefined });
  }, [selectedFolderId]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await api.createFolder(newName.trim(), folders.length);
      setNewName('');
      setAdding(false);
      loadFolders();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Failed');
    }
  };

  const handleSelectFolder = (id: number | null) => {
    selectFolder(id);
  };

  const selectedLabel = selectedFolderId === null
    ? 'All Tasks'
    : folders.find((f) => f.id === selectedFolderId)?.name || 'Tasks';

  return (
    <View style={styles.container}>
      {/* Left panel: folder list */}
      <View style={styles.sidebar}>
        <Text style={styles.sidebarTitle}>Folders</Text>

        <Pressable
          style={[styles.folderRow, selectedFolderId === null && styles.folderRowActive]}
          onPress={() => handleSelectFolder(null)}
        >
          <Ionicons name="list" size={18} color={selectedFolderId === null ? '#fff' : '#1a73e8'} />
          <Text style={[styles.folderName, selectedFolderId === null && styles.folderNameActive]}>All Tasks</Text>
        </Pressable>

        <FlatList
          data={folders}
          keyExtractor={(f) => String(f.id)}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.folderRow, selectedFolderId === item.id && styles.folderRowActive]}
              onPress={() => handleSelectFolder(item.id)}
            >
              <Ionicons
                name="folder-outline" size={18}
                color={selectedFolderId === item.id ? '#fff' : '#1a73e8'}
              />
              <Text style={[styles.folderName, selectedFolderId === item.id && styles.folderNameActive]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.countBadge, selectedFolderId === item.id && styles.countBadgeActive]}>
                <Text style={[styles.countText, selectedFolderId === item.id && styles.countTextActive]}>
                  {item.task_count}
                </Text>
              </View>
            </Pressable>
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
            <Pressable onPress={handleAdd}>
              <Ionicons name="checkmark-circle" size={24} color="#27ae60" />
            </Pressable>
            <Pressable onPress={() => setAdding(false)}>
              <Ionicons name="close-circle" size={24} color="#e74c3c" />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.addButton} onPress={() => setAdding(true)}>
            <Ionicons name="add-circle-outline" size={18} color="#1a73e8" />
            <Text style={styles.addText}>Add Folder</Text>
          </Pressable>
        )}
      </View>

      {/* Right panel: tasks */}
      <View style={styles.main}>
        <View style={styles.mainHeader}>
          <Text style={styles.mainTitle}>{selectedLabel}</Text>
          <Pressable style={styles.newTaskBtn} onPress={() => router.push('/task/create')}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.newTaskText}>New Task</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#1a73e8" />
        ) : (
          <FlatList
            data={tasks}
            keyExtractor={(t) => String(t.id)}
            renderItem={({ item }) => (
              <TaskRow
                task={item}
                onPress={() => router.push(`/task/${item.id}`)}
                onStar={() => toggleStar(item.id, item.starred)}
                onComplete={() => complete(item.id)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="document-outline" size={48} color="#ccc" />
                <Text style={styles.emptyText}>No tasks in this folder</Text>
              </View>
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#f5f6fa' },

  // Left sidebar
  sidebar: {
    width: 260,
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#e0e0e0',
    paddingTop: 12,
  },
  sidebarTitle: {
    fontSize: 13, fontWeight: '700', color: '#999', textTransform: 'uppercase',
    letterSpacing: 1, paddingHorizontal: 16, paddingBottom: 8,
  },
  folderRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16,
    gap: 10, cursor: 'pointer' as any,
  },
  folderRowActive: { backgroundColor: '#1a73e8' },
  folderName: { flex: 1, fontSize: 14, color: '#333' },
  folderNameActive: { color: '#fff', fontWeight: '600' },
  countBadge: { backgroundColor: '#e8f0fe', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  countBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  countText: { fontSize: 12, color: '#1a73e8', fontWeight: '600' },
  countTextActive: { color: '#fff' },
  addRow: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 6, borderTopWidth: 1, borderTopColor: '#eee' },
  addInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8, fontSize: 13 },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 14, cursor: 'pointer' as any },
  addText: { color: '#1a73e8', fontSize: 13 },

  // Right main panel
  main: { flex: 1, paddingTop: 4 },
  mainHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  mainTitle: { fontSize: 20, fontWeight: '700', color: '#333' },
  newTaskBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1a73e8', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
    cursor: 'pointer' as any,
  },
  newTaskText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Task rows
  taskRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    paddingVertical: 10, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
    cursor: 'pointer' as any,
  },
  checkBox: { marginRight: 8 },
  taskContent: { flex: 1 },
  taskTitle: { fontSize: 14, color: '#333' },
  completedText: { textDecorationLine: 'line-through', color: '#999' },
  taskMeta: { flexDirection: 'row', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  tagBadge: { fontSize: 11, color: '#8e44ad', backgroundColor: '#f3e8ff', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  dueDateText: { fontSize: 11, color: '#e67e22' },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginLeft: 8 },
  priorityText: { fontSize: 11, color: '#fff', fontWeight: '600' },

  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: '#999', marginTop: 8 },
});
