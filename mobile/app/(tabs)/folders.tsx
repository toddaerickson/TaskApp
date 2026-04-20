import { colors } from "@/lib/colors";
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput,
  Platform, useWindowDimensions, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFolderStore, useTaskStore, Task } from '@/lib/stores';
import * as api from '@/lib/api';
import { SkeletonList } from '@/components/Skeleton';

const PRIORITY_COLORS: Record<number, string> = {
  0: '#999', 1: colors.warningSoft, 2: colors.warning, 3: colors.danger,
};
const PRIORITY_LABELS: Record<number, string> = {
  0: 'Low', 1: 'Med', 2: 'High', 3: 'Top',
};

function TaskRow({ task, onPress, onStar, onComplete }: {
  task: Task; onPress: () => void; onStar: () => void; onComplete: () => void;
}) {
  return (
    <Pressable
      style={styles.taskRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open task: ${task.title}`}
    >
      <Pressable
        onPress={onComplete}
        style={styles.checkBox}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.completed }}
        accessibilityLabel={task.completed ? 'Mark task incomplete' : 'Mark task complete'}
      >
        <Ionicons
          name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
          size={22} color={task.completed ? colors.success : '#ccc'}
        />
      </Pressable>
      <Pressable
        onPress={onStar}
        style={{ marginRight: 8 }}
        accessibilityRole="button"
        accessibilityLabel={task.starred ? 'Remove star' : 'Star this task'}
      >
        <Ionicons
          name={task.starred ? 'star' : 'star-outline'}
          size={18} color={task.starred ? colors.accent : '#ccc'}
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

  // Inline rename. Keeping it as row-level state (not per-row component)
  // so the input auto-focuses and Escape / Save close predictably.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameName, setRenameName] = useState('');
  // Below 700px (phones in portrait, narrow Safari) the master-detail layout
  // overflows. Render one pane at a time and toggle via tap / back button.
  const { width } = useWindowDimensions();
  const isNarrow = width < 700;
  const [showTasksPane, setShowTasksPane] = useState(false);

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
      const msg = e?.response?.data?.detail || 'Could not create folder.';
      // Previously this branch only ran on web; native users saw silent
      // failure. Fall back to Alert.alert on iOS / Android so the user
      // knows the button press didn't do anything.
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('Folder not created', msg);
      }
    }
  };

  const handleSelectFolder = (id: number | null) => {
    selectFolder(id);
    if (isNarrow) setShowTasksPane(true);
  };

  const startRename = (id: number, name: string) => {
    setRenamingId(id);
    setRenameName(name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameName('');
  };

  const submitRename = async () => {
    const id = renamingId;
    const name = renameName.trim();
    if (!id || !name) { cancelRename(); return; }
    try {
      await api.updateFolder(id, { name });
      cancelRename();
      loadFolders();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not rename folder.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Rename failed', msg);
    }
  };

  const selectedLabel = selectedFolderId === null
    ? 'All Tasks'
    : folders.find((f) => f.id === selectedFolderId)?.name || 'Tasks';

  const showSidebar = !isNarrow || !showTasksPane;
  const showMain = !isNarrow || showTasksPane;

  return (
    <View style={[styles.container, isNarrow && styles.containerNarrow]}>
      {/* Left panel: folder list */}
      {showSidebar && (
      <View style={[styles.sidebar, isNarrow && styles.sidebarNarrow]}>
        {/* No "Folders" title — the tab bar already labels this screen. */}
        <Pressable
          style={[styles.folderRow, selectedFolderId === null && styles.folderRowActive]}
          onPress={() => handleSelectFolder(null)}
        >
          <Ionicons name="list" size={18} color={selectedFolderId === null ? '#fff' : colors.primary} />
          <Text style={[styles.folderName, selectedFolderId === null && styles.folderNameActive]}>All Tasks</Text>
        </Pressable>

        <FlatList
          data={folders}
          keyExtractor={(f) => String(f.id)}
          renderItem={({ item }) => {
            if (renamingId === item.id) {
              return (
                <View style={styles.renameRow}>
                  <Ionicons name="folder-outline" size={18} color={colors.primary} />
                  <TextInput
                    style={styles.renameInput}
                    value={renameName}
                    onChangeText={setRenameName}
                    autoFocus
                    accessibilityLabel={`Rename folder ${item.name}`}
                    onSubmitEditing={submitRename}
                    returnKeyType="done"
                  />
                  <Pressable onPress={submitRename} accessibilityRole="button" accessibilityLabel="Save folder name">
                    <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  </Pressable>
                  <Pressable onPress={cancelRename} accessibilityRole="button" accessibilityLabel="Cancel rename">
                    <Ionicons name="close-circle" size={22} color={colors.danger} />
                  </Pressable>
                </View>
              );
            }
            const active = selectedFolderId === item.id;
            return (
              <Pressable
                style={[styles.folderRow, active && styles.folderRowActive]}
                onPress={() => handleSelectFolder(item.id)}
              >
                <Ionicons
                  name="folder-outline" size={18}
                  color={active ? '#fff' : colors.primary}
                />
                <Text style={[styles.folderName, active && styles.folderNameActive]} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={[styles.countBadge, active && styles.countBadgeActive]}>
                  <Text style={[styles.countText, active && styles.countTextActive]}>
                    {item.task_count}
                  </Text>
                </View>
                {/* Rename pencil — stops propagation so it doesn't also
                    select the folder. Tap-to-edit (not long-press) for
                    iOS / web parity; long-press is inconsistent on web. */}
                <Pressable
                  onPress={(e) => { e.stopPropagation(); startRename(item.id, item.name); }}
                  hitSlop={8}
                  style={styles.renameBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename folder ${item.name}`}
                >
                  <Ionicons
                    name="pencil"
                    size={14}
                    color={active ? '#fff' : '#9aa3b2'}
                  />
                </Pressable>
              </Pressable>
            );
          }}
        />

        {adding ? (
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              placeholder="Folder name"
              accessibilityLabel="New folder name"
              value={newName}
              onChangeText={setNewName}
              autoFocus
              onSubmitEditing={handleAdd}
            />
            <Pressable onPress={handleAdd} accessibilityRole="button" accessibilityLabel="Create folder">
              <Ionicons name="checkmark-circle" size={24} color={colors.success} />
            </Pressable>
            <Pressable onPress={() => setAdding(false)} accessibilityRole="button" accessibilityLabel="Cancel folder creation">
              <Ionicons name="close-circle" size={24} color={colors.danger} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={styles.addButton}
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a new folder"
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.addText}>Add Folder</Text>
          </Pressable>
        )}
      </View>
      )}

      {/* Right panel: tasks */}
      {showMain && (
      <View style={[styles.main, isNarrow && styles.mainNarrow]}>
        <View style={styles.mainHeader}>
          {isNarrow && (
            <Pressable
              onPress={() => setShowTasksPane(false)}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back to folder list"
            >
              <Ionicons name="chevron-back" size={22} color={colors.primary} />
            </Pressable>
          )}
          <Text style={styles.mainTitle} numberOfLines={1}>{selectedLabel}</Text>
          <Pressable style={styles.newTaskBtn} onPress={() => router.push('/task/create')}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.newTaskText}>New</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <SkeletonList count={6} variant="task" />
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
                <Ionicons name="document-outline" size={64} color="#d0d7e2" />
                <Text style={styles.emptyTitle}>No tasks here yet</Text>
                <Text style={styles.emptyHint}>
                  Add a task and assign it to this folder to see it listed.
                </Text>
                <Pressable
                  style={styles.emptyCta}
                  onPress={() => router.push('/task/create')}
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.emptyCtaText}>New task</Text>
                </Pressable>
              </View>
            }
          />
        )}
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#f5f6fa' },
  containerNarrow: { flexDirection: 'column' },

  // Left sidebar
  sidebar: {
    width: 260,
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#e0e0e0',
    paddingTop: 12,
  },
  sidebarNarrow: { width: '100%', flex: 1, borderRightWidth: 0 },
  mainNarrow: { width: '100%' },
  backBtn: { padding: 4, marginRight: 4, cursor: 'pointer' as any },
  folderRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16,
    gap: 10, cursor: 'pointer' as any,
  },
  folderRowActive: { backgroundColor: colors.primary },
  folderName: { flex: 1, fontSize: 14, color: '#333' },
  folderNameActive: { color: '#fff', fontWeight: '600' },
  countBadge: { backgroundColor: '#e8f0fe', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  countBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  countText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  countTextActive: { color: '#fff' },
  addRow: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 6, borderTopWidth: 1, borderTopColor: '#eee' },
  addInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8, fontSize: 13 },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 14, cursor: 'pointer' as any },
  addText: { color: colors.primary, fontSize: 13 },
  renameRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 12, gap: 8,
    backgroundColor: '#eef4ff',
  },
  renameInput: {
    flex: 1, borderWidth: 1, borderColor: '#c8d5ea', borderRadius: 6,
    padding: 6, fontSize: 13, backgroundColor: '#fff',
  },
  renameBtn: { marginLeft: 4, padding: 4, cursor: 'pointer' as any },

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
    backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
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
  completedText: { textDecorationLine: 'line-through', color: colors.textMuted },
  taskMeta: { flexDirection: 'row', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  tagBadge: { fontSize: 11, color: colors.violet, backgroundColor: '#f3e8ff', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  dueDateText: { fontSize: 11, color: colors.warning },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginLeft: 8 },
  priorityText: { fontSize: 11, color: '#fff', fontWeight: '600' },

  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 32 },
  emptyText: { color: colors.textMuted, marginTop: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#444', marginTop: 12 },
  emptyHint: { color: '#8a94a6', fontSize: 13, textAlign: 'center', marginTop: 6, maxWidth: 280 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 18,
    cursor: 'pointer' as any,
  },
  emptyCtaText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
