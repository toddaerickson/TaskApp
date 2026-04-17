import { colors } from "@/lib/colors";
import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, Platform, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore, Task } from '@/lib/stores';

const PRIORITY_LABELS: Record<number, string> = {
  0: 'Low', 1: 'Med', 2: 'High', 3: 'Top',
};
const PRIORITY_COLORS: Record<number, string> = {
  0: '#999', 1: colors.warningSoft, 2: colors.warning, 3: colors.danger,
};

type SortKey = 'folder' | 'title' | 'priority' | 'status' | 'start_date' | 'due_date' | 'starred' | 'repeat_type';
type SortDir = 'asc' | 'desc';
type GroupKey = 'none' | 'folder' | 'priority' | 'status' | 'due_date' | 'starred';

interface SortLevel {
  key: SortKey;
  dir: SortDir;
}

const COLUMNS: { key: SortKey; label: string; flex: number }[] = [
  { key: 'folder', label: 'Folder', flex: 1.1 },
  { key: 'title', label: 'Task', flex: 1.8 },
  { key: 'priority', label: 'Priority', flex: 0.6 },
  { key: 'status', label: 'Status', flex: 0.8 },
  { key: 'start_date', label: 'Start', flex: 0.7 },
  { key: 'due_date', label: 'Due', flex: 0.7 },
  { key: 'starred', label: 'Star', flex: 0.4 },
  { key: 'repeat_type', label: 'Repeat', flex: 0.6 },
];

const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'folder', label: 'Folder' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'starred', label: 'Starred' },
];

const STORAGE_KEY_SORTS = 'taskapp_sorts';
const STORAGE_KEY_GROUP = 'taskapp_groupBy';

function loadPref<T>(key: string, fallback: T): T {
  if (Platform.OS !== 'web') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function savePref(key: string, value: any) {
  if (Platform.OS === 'web') {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
}

function getSortValue(task: Task, key: SortKey): string | number {
  switch (key) {
    case 'folder': return task.folder_name || 'zzz';
    case 'title': return task.title.toLowerCase();
    case 'priority': return task.priority;
    case 'status': return task.status;
    case 'start_date': return task.start_date || 'zzz';
    case 'due_date': return task.due_date || 'zzz';
    case 'starred': return task.starred ? 0 : 1;
    case 'repeat_type': return task.repeat_type || 'zzz';
    default: return '';
  }
}

function compareTasks(a: Task, b: Task, sorts: SortLevel[]): number {
  for (const { key, dir } of sorts) {
    const av = getSortValue(a, key);
    const bv = getSortValue(b, key);
    let cmp = 0;
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv));
    }
    if (dir === 'desc') cmp = -cmp;
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function formatDate(d: string | null): string {
  if (!d) return '';
  const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return d;
  const [, yyyy, mm, dd] = match;
  const yy = yyyy.slice(2);
  return `${mm}/${dd}/${yy}`;
}

function getGroupLabel(task: Task, groupBy: GroupKey): string {
  switch (groupBy) {
    case 'folder': return task.folder_name || 'No Folder';
    case 'priority': return `${PRIORITY_LABELS[task.priority] || 'Unknown'} Priority`;
    case 'status': return task.status === 'none' ? 'No Status' : task.status.replace(/_/g, ' ');
    case 'due_date':
      if (!task.due_date) return 'No Due Date';
      return formatDate(task.due_date);
    case 'starred': return task.starred ? 'Starred' : 'Not Starred';
    default: return '';
  }
}

function getGroupSortKey(task: Task, groupBy: GroupKey): string | number {
  switch (groupBy) {
    case 'folder': return task.folder_name || 'zzz';
    case 'priority': return task.priority;
    case 'status': return task.status;
    case 'due_date': return task.due_date || 'zzz';
    case 'starred': return task.starred ? 0 : 1;
    default: return 0;
  }
}

export default function TasksScreen() {
  const { tasks, isLoading, load, complete, toggleStar, filters, setFilters } = useTaskStore();
  const router = useRouter();
  // Below 700px the 8-column desktop table becomes unreadable; render
  // a stacked card list instead.
  const { width } = useWindowDimensions();
  const isNarrow = width < 700;

  const [sorts, setSorts] = useState<SortLevel[]>(() =>
    loadPref(STORAGE_KEY_SORTS, [{ key: 'folder' as SortKey, dir: 'asc' as SortDir }])
  );
  const [groupBy, setGroupBy] = useState<GroupKey>(() =>
    loadPref(STORAGE_KEY_GROUP, 'folder' as GroupKey)
  );
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);

  useEffect(() => { load(); }, []);

  const handleColumnPress = (key: SortKey) => {
    setSorts((prev) => {
      let updated: SortLevel[];
      const idx = prev.findIndex((s) => s.key === key);
      if (idx === 0) {
        updated = [...prev];
        updated[0] = { key, dir: prev[0].dir === 'asc' ? 'desc' : 'asc' };
      } else if (idx > 0) {
        updated = prev.filter((s) => s.key !== key);
        updated.unshift({ key, dir: 'asc' });
        updated = updated.slice(0, 3);
      } else {
        updated = [{ key, dir: 'asc' as SortDir }, ...prev].slice(0, 3);
      }
      savePref(STORAGE_KEY_SORTS, updated);
      return updated;
    });
  };

  const handleGroupChange = (key: GroupKey) => {
    setGroupBy(key);
    savePref(STORAGE_KEY_GROUP, key);
    setGroupDropdownOpen(false);
  };

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => compareTasks(a, b, sorts));
  }, [tasks, sorts]);

  // Group tasks
  const groupedTasks = useMemo(() => {
    if (groupBy === 'none') return [{ label: '', tasks: sortedTasks }];

    const groups: Map<string, { label: string; sortKey: string | number; tasks: Task[] }> = new Map();
    for (const task of sortedTasks) {
      const label = getGroupLabel(task, groupBy);
      if (!groups.has(label)) {
        groups.set(label, { label, sortKey: getGroupSortKey(task, groupBy), tasks: [] });
      }
      groups.get(label)!.tasks.push(task);
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (typeof a.sortKey === 'number' && typeof b.sortKey === 'number') return a.sortKey - b.sortKey;
      return String(a.sortKey).localeCompare(String(b.sortKey));
    });
  }, [sortedTasks, groupBy]);

  const getSortIndicator = (key: SortKey): string => {
    const idx = sorts.findIndex((s) => s.key === key);
    if (idx === -1) return '';
    const arrow = sorts[idx].dir === 'asc' ? '\u25B2' : '\u25BC';
    const level = idx === 0 ? '\u2780' : idx === 1 ? '\u2781' : '\u2782';
    return ` ${arrow}${level}`;
  };

  const activeGroupLabel = GROUP_OPTIONS.find(g => g.key === groupBy)?.label || 'None';

  return (
    <View style={styles.container}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        <Pressable
          style={[styles.filterChip, !filters.completed && styles.filterChipActive]}
          onPress={() => setFilters({ completed: false })}
        >
          <Text style={!filters.completed ? styles.filterTextActive : styles.filterText}>Active</Text>
        </Pressable>
        <Pressable
          style={[styles.filterChip, filters.completed === true && styles.filterChipActive]}
          onPress={() => setFilters({ completed: true })}
        >
          <Text style={filters.completed === true ? styles.filterTextActive : styles.filterText}>Completed</Text>
        </Pressable>
        <Pressable
          style={[styles.filterChip, filters.starred === true && styles.filterChipActive]}
          onPress={() => setFilters({ starred: filters.starred ? undefined : true })}
        >
          <Ionicons name="star" size={14} color={filters.starred ? '#fff' : '#666'} />
        </Pressable>

        {/* Group By dropdown */}
        <View style={styles.groupByContainer}>
          <Pressable
            style={[styles.filterChip, groupBy !== 'none' && styles.groupByActive]}
            onPress={() => setGroupDropdownOpen(!groupDropdownOpen)}
          >
            <Ionicons name="layers-outline" size={14} color={groupBy !== 'none' ? '#fff' : '#666'} />
            <Text style={groupBy !== 'none' ? styles.filterTextActive : styles.filterText}>
              Group by: {activeGroupLabel}
            </Text>
            <Ionicons name={groupDropdownOpen ? 'chevron-up' : 'chevron-down'} size={12}
              color={groupBy !== 'none' ? '#fff' : '#666'} />
          </Pressable>

          {groupDropdownOpen && (
            <View style={styles.dropdown}>
              {GROUP_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  style={[styles.dropdownItem, groupBy === opt.key && styles.dropdownItemActive]}
                  onPress={() => handleGroupChange(opt.key)}
                >
                  <Text style={[styles.dropdownText, groupBy === opt.key && styles.dropdownTextActive]}>
                    {opt.label}
                  </Text>
                  {groupBy === opt.key && <Ionicons name="checkmark" size={14} color="#1a73e8" />}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {!isNarrow && (
          <View style={styles.sortInfo}>
            <Text style={styles.sortInfoText} numberOfLines={1}>
              Sort: {sorts.map((s, i) => `${i + 1}. ${COLUMNS.find(c => c.key === s.key)?.label}${s.dir === 'desc' ? ' \u25BC' : ''}`).join(' > ')}
            </Text>
          </View>
        )}

        <Pressable style={styles.newTaskBtn} onPress={() => router.push('/task/create')}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newTaskBtnText}>{isNarrow ? 'New' : 'New Task'}</Text>
        </Pressable>
      </View>

      {/* Column headers — desktop table only */}
      {!isNarrow && (
      <View style={styles.headerRow}>
        <View style={{ width: 36 }} />
        {COLUMNS.map((col) => {
          const sortIdx = sorts.findIndex((s) => s.key === col.key);
          const isActive = sortIdx !== -1;
          return (
            <Pressable
              key={col.key}
              style={[styles.headerCell, { flex: col.flex }]}
              onPress={() => handleColumnPress(col.key)}
            >
              <Text style={[styles.headerText, isActive && styles.headerTextActive]} numberOfLines={1}>
                {col.label}{getSortIndicator(col.key)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      )}

      {/* Task rows */}
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#1a73e8" />
      ) : sortedTasks.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-done-circle-outline" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No tasks</Text>
        </View>
      ) : (
        <ScrollView style={styles.tableBody}>
          {groupedTasks.map((group, gi) => (
            <View key={gi}>
              {/* Group header */}
              {groupBy !== 'none' && (
                <View style={styles.groupHeader}>
                  <Ionicons
                    name={groupBy === 'folder' ? 'folder' : groupBy === 'priority' ? 'flag' :
                          groupBy === 'starred' ? 'star' : groupBy === 'status' ? 'radio-button-on' : 'calendar'}
                    size={14} color="#1a73e8" />
                  <Text style={styles.groupHeaderText}>{group.label}</Text>
                  <Text style={styles.groupCount}>{group.tasks.length}</Text>
                </View>
              )}

              {/* Task rows in group */}
              {group.tasks.map((task) => isNarrow ? (
                <Pressable
                  key={task.id}
                  style={({ pressed }) => [styles.cardRow, pressed && { backgroundColor: '#f0f4ff' }]}
                  onPress={() => router.push(`/task/${task.id}`)}
                >
                  <Pressable onPress={() => complete(task.id)} style={styles.cardCheck}>
                    <Ionicons
                      name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22} color={task.completed ? colors.success : '#ccc'}
                    />
                  </Pressable>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.cardTitle, task.completed && styles.completedText]} numberOfLines={2}>
                      {task.subtasks && task.subtasks.length > 0 ? `${task.title} [${task.subtasks.length}]` : task.title}
                    </Text>
                    <View style={styles.cardMetaRow}>
                      <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[task.priority] }]}>
                        <Text style={styles.priorityText}>{PRIORITY_LABELS[task.priority]}</Text>
                      </View>
                      {task.folder_name && (
                        <Text style={styles.cardMetaText} numberOfLines={1}>{task.folder_name}</Text>
                      )}
                      {task.due_date && (
                        <Text style={[styles.cardMetaText, styles.dueDateText]}>Due {formatDate(task.due_date)}</Text>
                      )}
                      {task.status !== 'none' && (
                        <Text style={styles.cardMetaText} numberOfLines={1}>{task.status.replace(/_/g, ' ')}</Text>
                      )}
                    </View>
                  </View>
                  <Pressable onPress={() => toggleStar(task.id, task.starred)} style={styles.cardStar}>
                    <Ionicons
                      name={task.starred ? 'star' : 'star-outline'}
                      size={18} color={task.starred ? colors.accent : '#ddd'}
                    />
                  </Pressable>
                </Pressable>
              ) : (
                <Pressable
                  key={task.id}
                  style={({ pressed }) => [styles.dataRow, pressed && { backgroundColor: '#f0f4ff' }]}
                  onPress={() => router.push(`/task/${task.id}`)}
                >
                  <View style={styles.actionCell}>
                    <Pressable onPress={() => complete(task.id)}>
                      <Ionicons
                        name={task.completed ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20} color={task.completed ? colors.success : '#ccc'}
                      />
                    </Pressable>
                  </View>

                  <View style={[styles.cell, { flex: 1.1 }]}>
                    <Text style={styles.cellText} numberOfLines={1}>{task.folder_name || '—'}</Text>
                  </View>

                  <View style={[styles.cell, { flex: 1.8 }]}>
                    <Text style={[styles.cellText, styles.titleText, task.completed && styles.completedText]} numberOfLines={1}>
                      {task.subtasks && task.subtasks.length > 0 ? `${task.title} [${task.subtasks.length}]` : task.title}
                    </Text>
                  </View>

                  <View style={[styles.cell, { flex: 0.6 }]}>
                    <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[task.priority] }]}>
                      <Text style={styles.priorityText}>{PRIORITY_LABELS[task.priority]}</Text>
                    </View>
                  </View>

                  <View style={[styles.cell, { flex: 0.8 }]}>
                    <Text style={styles.cellText} numberOfLines={1}>
                      {task.status === 'none' ? '—' : task.status.replace(/_/g, ' ')}
                    </Text>
                  </View>

                  <View style={[styles.cell, { flex: 0.7 }]}>
                    <Text style={[styles.cellText, task.start_date && styles.startDateText]}>
                      {formatDate(task.start_date)}
                    </Text>
                  </View>

                  <View style={[styles.cell, { flex: 0.7 }]}>
                    <Text style={[styles.cellText, task.due_date && styles.dueDateText]}>
                      {formatDate(task.due_date)}
                    </Text>
                  </View>

                  <View style={[styles.cell, { flex: 0.4, alignItems: 'center' }]}>
                    <Pressable onPress={() => toggleStar(task.id, task.starred)}>
                      <Ionicons
                        name={task.starred ? 'star' : 'star-outline'}
                        size={16} color={task.starred ? colors.accent : '#ddd'}
                      />
                    </Pressable>
                  </View>

                  <View style={[styles.cell, { flex: 0.6 }]}>
                    <Text style={styles.cellText} numberOfLines={1}>
                      {task.repeat_type === 'none' ? '—' : task.repeat_type}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },

  // Filter bar — wraps on narrow screens so chips don't squeeze the
  // sort label into a one-letter-per-line vertical column.
  filterBar: {
    flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee', alignItems: 'center',
    zIndex: 100, overflow: 'visible' as any,
  },
  filterChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#f0f0f0', flexDirection: 'row', alignItems: 'center', gap: 4,
    cursor: 'pointer' as any,
  },
  filterChipActive: { backgroundColor: colors.primary },
  filterText: { fontSize: 12, color: '#666' },
  filterTextActive: { fontSize: 12, color: '#fff' },
  sortInfo: { flex: 1, marginLeft: 4 },
  sortInfoText: { fontSize: 10, color: '#888', fontStyle: 'italic' },
  newTaskBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
    cursor: 'pointer' as any,
  },
  newTaskBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Group By
  groupByContainer: { position: 'relative' as any, zIndex: 9999, overflow: 'visible' as any },
  groupByActive: { backgroundColor: colors.group },
  dropdown: {
    position: 'absolute' as any, top: 34, left: 0, zIndex: 9999,
    backgroundColor: '#fff', borderRadius: 8, padding: 4,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 10, minWidth: 150, borderWidth: 1, borderColor: '#d0d0d0',
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
    cursor: 'pointer' as any,
  },
  dropdownItemActive: { backgroundColor: '#f0f4ff' },
  dropdownText: { fontSize: 13, color: '#333' },
  dropdownTextActive: { fontSize: 13, color: colors.primary, fontWeight: '600' },

  // Group headers
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#e8eef7',
    borderBottomWidth: 1, borderBottomColor: '#d0d8e8',
  },
  groupHeaderText: { fontSize: 12, fontWeight: '700', color: colors.primary, textTransform: 'capitalize' },
  groupCount: {
    fontSize: 11, color: colors.primary, fontWeight: '600',
    backgroundColor: '#d0ddf0', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1,
  },

  // Column headers
  headerRow: {
    flexDirection: 'row', backgroundColor: '#e8eef7', paddingVertical: 8,
    paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#d0d8e8',
  },
  headerCell: {
    paddingHorizontal: 6, cursor: 'pointer' as any,
  },
  headerText: {
    fontSize: 12, fontWeight: '600', color: '#555', textTransform: 'uppercase',
  },
  headerTextActive: { color: colors.primary },

  // Table body
  tableBody: { flex: 1 },
  dataRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    paddingVertical: 8, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
    cursor: 'pointer' as any,
  },
  actionCell: {
    width: 36, alignItems: 'center', justifyContent: 'center',
  },
  cell: { paddingHorizontal: 6, justifyContent: 'center' },
  cellText: { fontSize: 13, color: '#444' },
  titleText: { fontWeight: '500' },
  completedText: { textDecorationLine: 'line-through', color: '#999' },
  startDateText: { color: colors.success },
  dueDateText: { color: colors.warning },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start' },
  priorityText: { fontSize: 11, color: '#fff', fontWeight: '600' },

  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: '#999', marginTop: 8 },

  // Mobile card row (replaces the desktop table on <700px viewports)
  cardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
    cursor: 'pointer' as any,
  },
  cardCheck: { padding: 2 },
  cardStar: { padding: 4 },
  cardTitle: { fontSize: 15, fontWeight: '500', color: '#222' },
  cardMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap',
  },
  cardMetaText: { fontSize: 12, color: '#777' },
});
