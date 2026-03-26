import { useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore, Task } from '@/lib/stores';

const PRIORITY_COLORS: Record<number, string> = {
  0: '#999', // Low
  1: '#f0ad4e', // Medium
  2: '#e67e22', // High
  3: '#e74c3c', // Top
};

const PRIORITY_LABELS: Record<number, string> = {
  0: 'Low', 1: 'Med', 2: 'High', 3: 'Top',
};

function TaskRow({ task, onPress, onStar, onComplete }: {
  task: Task;
  onPress: () => void;
  onStar: () => void;
  onComplete: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.6}>
      <TouchableOpacity onPress={onComplete} style={styles.checkBox}>
        <Ionicons
          name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={task.completed ? '#27ae60' : '#ccc'}
        />
      </TouchableOpacity>

      <TouchableOpacity onPress={onStar} style={{ marginRight: 8 }}>
        <Ionicons
          name={task.starred ? 'star' : 'star-outline'}
          size={20}
          color={task.starred ? '#f39c12' : '#ccc'}
        />
      </TouchableOpacity>

      <View style={styles.taskContent}>
        <Text style={[styles.taskTitle, task.completed && styles.completedText]} numberOfLines={1}>
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          {task.folder_name && (
            <Text style={styles.folderBadge}>{task.folder_name}</Text>
          )}
          {task.tags.map((t) => (
            <Text key={t.id} style={styles.tagBadge}>{t.name}</Text>
          ))}
          {task.due_date && (
            <Text style={styles.dueDateText}>{task.due_date}</Text>
          )}
        </View>
      </View>

      <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[task.priority] }]}>
        <Text style={styles.priorityText}>{PRIORITY_LABELS[task.priority]}</Text>
      </View>

      {task.status !== 'none' && (
        <Text style={styles.statusText}>{task.status.replace('_', ' ')}</Text>
      )}
    </TouchableOpacity>
  );
}

// Section header for folder grouping
function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name="folder" size={16} color="#1a73e8" />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

export default function TasksScreen() {
  const { tasks, isLoading, load, complete, toggleStar, filters, setFilters } = useTaskStore();
  const router = useRouter();

  useEffect(() => { load(); }, []);

  const onRefresh = useCallback(() => { load(); }, []);

  // Group tasks by folder
  const grouped = tasks.reduce<{ folder: string; data: Task[] }[]>((acc, task) => {
    const folder = task.folder_name || 'No Folder';
    const existing = acc.find((g) => g.folder === folder);
    if (existing) {
      existing.data.push(task);
    } else {
      acc.push({ folder, data: [task] });
    }
    return acc;
  }, []);

  // Flatten for FlatList with headers
  type ListItem = { type: 'header'; folder: string } | { type: 'task'; task: Task };
  const listData: ListItem[] = [];
  for (const group of grouped) {
    listData.push({ type: 'header', folder: group.folder });
    for (const task of group.data) {
      listData.push({ type: 'task', task });
    }
  }

  return (
    <View style={styles.container}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        <TouchableOpacity
          style={[styles.filterChip, !filters.completed && styles.filterChipActive]}
          onPress={() => setFilters({ completed: false })}
        >
          <Text style={!filters.completed ? styles.filterTextActive : styles.filterText}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filters.completed === true && styles.filterChipActive]}
          onPress={() => setFilters({ completed: true })}
        >
          <Text style={filters.completed === true ? styles.filterTextActive : styles.filterText}>Completed</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filters.starred === true && styles.filterChipActive]}
          onPress={() => setFilters({ starred: filters.starred ? undefined : true })}
        >
          <Ionicons name="star" size={14} color={filters.starred ? '#fff' : '#666'} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item, idx) => item.type === 'header' ? `h-${item.folder}` : `t-${item.task.id}`}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return <SectionHeader title={item.folder} />;
          }
          return (
            <TaskRow
              task={item.task}
              onPress={() => router.push(`/task/${item.task.id}`)}
              onStar={() => toggleStar(item.task.id, item.task.starred)}
              onComplete={() => complete(item.task.id)}
            />
          );
        }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor="#1a73e8" />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>No tasks</Text>
            </View>
          ) : null
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/task/create')}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  filterBar: { flexDirection: 'row', padding: 8, gap: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f0f0f0', flexDirection: 'row', alignItems: 'center', gap: 4 },
  filterChipActive: { backgroundColor: '#1a73e8' },
  filterText: { fontSize: 13, color: '#666' },
  filterTextActive: { fontSize: 13, color: '#fff' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, paddingLeft: 16, backgroundColor: '#e8eef7' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#1a73e8' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  checkBox: { marginRight: 8 },
  taskContent: { flex: 1 },
  taskTitle: { fontSize: 15, color: '#333' },
  completedText: { textDecorationLine: 'line-through', color: '#999' },
  taskMeta: { flexDirection: 'row', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  folderBadge: { fontSize: 11, color: '#1a73e8', backgroundColor: '#e8f0fe', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  tagBadge: { fontSize: 11, color: '#8e44ad', backgroundColor: '#f3e8ff', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  dueDateText: { fontSize: 11, color: '#e67e22' },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginLeft: 8 },
  priorityText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  statusText: { fontSize: 11, color: '#888', marginLeft: 6, textTransform: 'capitalize' },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: '#999', marginTop: 8 },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#1a73e8', justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
});
