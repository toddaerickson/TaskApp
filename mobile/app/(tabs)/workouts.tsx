import { colors } from "@/lib/colors";
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, Modal, TextInput, Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWorkoutStore, WorkoutSession, Routine } from '@/lib/stores';
import { SkeletonList } from '@/components/Skeleton';
import ReminderSheet from '@/components/ReminderSheet';
import SortPopover, { SortLevel } from '@/components/SortPopover';
import * as api from '@/lib/api';
import { describeApiError } from '@/lib/apiErrors';
import { formatRel } from '@/lib/format';
import { syncRoutineReminders } from '@/lib/routineReminders';
import { formatReminder } from '@/lib/reminders';

const GOAL_COLORS: Record<string, string> = {
  rehab: colors.warning, strength: colors.primary, mobility: colors.success,
  cardio: colors.danger, general: '#7f8c8d',
};

const GOAL_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'strength', label: 'Strength' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'rehab', label: 'Rehab' },
  { value: 'cardio', label: 'Cardio' },
];

// The filter-chip row mirrors the Tasks tab: "All" plus one chip per goal.
// Keeping the value "all" off the Routine.goal enum so a goal mis-match
// on the server side (new goal added without an update here) never hides
// the row — we only filter when the user picks a concrete goal chip.
const GOAL_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  ...GOAL_OPTIONS,
];

type SortKey = 'name' | 'goal' | 'last_performed' | 'created';

const SORT_OPTIONS: { key: SortKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'name', label: 'Name', icon: 'text' },
  { key: 'goal', label: 'Goal', icon: 'flag-outline' },
  { key: 'last_performed', label: 'Last performed', icon: 'calendar' },
  { key: 'created', label: 'Created', icon: 'calendar-outline' },
];

type GroupKey = 'none' | 'goal';

const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'goal', label: 'Goal' },
];

// localStorage keys. Web-only persistence; native always falls back to
// the default sort (name asc) on cold start. Separate keys from the
// Tasks tab so the two lists can diverge (e.g. group-by=goal on
// routines, group-by=folder on tasks).
const STORAGE_KEY_SORTS = 'taskapp_routine_sorts';
const STORAGE_KEY_GROUP = 'taskapp_routine_groupBy';
const STORAGE_KEY_GOAL = 'taskapp_routine_goalFilter';

function loadPref<T>(key: string, fallback: T): T {
  if (Platform.OS !== 'web') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function savePref(key: string, value: unknown) {
  if (Platform.OS !== 'web') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota/full */ }
}

function getSortValue(
  r: Routine,
  lastPerformedByRoutine: Map<number, string>,
  key: SortKey,
): string {
  switch (key) {
    case 'name': return r.name.toLowerCase();
    case 'goal': return r.goal;
    // Never-performed routines sort to the end. ISO strings compare
    // lexically so "zzz" beats any real timestamp.
    case 'last_performed': return lastPerformedByRoutine.get(r.id) || 'zzz';
    case 'created': return r.created_at || 'zzz';
    default: return '';
  }
}

function compareRoutines(
  a: Routine,
  b: Routine,
  sorts: SortLevel<SortKey>[],
  lastPerformedByRoutine: Map<number, string>,
): number {
  for (const { key, dir } of sorts) {
    const av = getSortValue(a, lastPerformedByRoutine, key);
    const bv = getSortValue(b, lastPerformedByRoutine, key);
    let cmp = av.localeCompare(bv);
    if (dir === 'desc') cmp = -cmp;
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export default function WorkoutsScreen() {
  const router = useRouter();
  const { routines, isLoading, loadRoutines } = useWorkoutStore();
  const [recent, setRecent] = useState<WorkoutSession[]>([]);

  // Search / filter / sort / group state. Search is client-side because
  // routine counts are small (<30 typical) and the pagination path from
  // the store already fetches everything. The other three mirror the
  // Tasks tab so the two list screens feel parallel.
  const [search, setSearch] = useState('');
  const [goalFilter, setGoalFilter] = useState<string>(() =>
    loadPref(STORAGE_KEY_GOAL, 'all')
  );
  const [sorts, setSorts] = useState<SortLevel<SortKey>[]>(() =>
    loadPref(STORAGE_KEY_SORTS, [{ key: 'name' as SortKey, dir: 'asc' as const }])
  );
  const [groupBy, setGroupBy] = useState<GroupKey>(() =>
    loadPref(STORAGE_KEY_GROUP, 'none' as GroupKey)
  );
  const [sortOpen, setSortOpen] = useState(false);
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);

  // "New routine" mini-modal. The previous empty state pointed users at
  // the seed script / Track symptoms; neither made sense for a self-
  // hosted solo user who just wants to build their first routine.
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('general');
  // Rehab-routine flag at creation time. Complements the in-detail toggle
  // from #51 so users can declare intent before the first session — no
  // need to create then immediately flip. Default off keeps strength
  // creations untouched.
  const [newTracksSymptoms, setNewTracksSymptoms] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Reminder sheet: null when closed, the target routine when open. Kept
  // here (not per-card) so exactly one sheet can be open at a time.
  const [reminderTarget, setReminderTarget] = useState<Routine | null>(null);

  // Refetch every time the tab regains focus. `useEffect([])` only fires
  // on mount, which meant mutations to a routine from the detail screen
  // (add / remove exercise, rename, change reminder) were invisible here
  // until a full app restart — the card would still show the stale
  // "{n} exercises" count after the user navigated back. `useFocusEffect`
  // matches expo-router's focus lifecycle and mirrors the pattern used
  // on the routine detail screen for the same reason.
  useFocusEffect(useCallback(() => {
    loadRoutines();
    api.listSessions({ limit: 10 })
      .then(setRecent)
      .catch((e) => console.warn('[workouts] listSessions failed:', e));
  }, [loadRoutines]));

  // Re-sync local notifications whenever the routine list (and therefore
  // its reminder_time / reminder_days) changes. No-op on web.
  useEffect(() => {
    if (routines.length > 0) {
      syncRoutineReminders(routines)
        .catch((e) => console.warn('[workouts] syncRoutineReminders failed:', e));
    }
  }, [routines]);

  const streak = computeStreak(recent);

  // Map routine_id → most recent started_at across the fetched recents
  // window. Used by the "Last performed" sort and by the card meta line.
  // Rebuild whenever the recents list changes, not every render.
  const lastPerformedByRoutine = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of recent) {
      if (!s.routine_id) continue;
      const prev = m.get(s.routine_id);
      if (!prev || s.started_at > prev) m.set(s.routine_id, s.started_at);
    }
    return m;
  }, [recent]);

  // Apply search + goal filter + sort, then bucket into groups. Groups is
  // always an array of { key, label, items }. When groupBy is 'none' we
  // emit a single unlabeled bucket so the renderer has one code path.
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = routines.filter((r) => {
      if (goalFilter !== 'all' && r.goal !== goalFilter) return false;
      if (!q) return true;
      // Search hits name + notes. Case-insensitive substring, no fancy
      // tokenization — a 10-item list doesn't need it.
      return (
        r.name.toLowerCase().includes(q)
        || (r.notes ?? '').toLowerCase().includes(q)
      );
    });

    const sorted = sorts.length === 0
      ? filtered
      : [...filtered].sort((a, b) => compareRoutines(a, b, sorts, lastPerformedByRoutine));

    if (groupBy === 'none') {
      return [{ key: 'all', label: '', items: sorted }];
    }
    const buckets = new Map<string, { label: string; items: Routine[] }>();
    for (const r of sorted) {
      const key = r.goal || 'general';
      const label = (GOAL_OPTIONS.find((g) => g.value === key)?.label) ?? key;
      if (!buckets.has(key)) buckets.set(key, { label, items: [] });
      buckets.get(key)!.items.push(r);
    }
    // Preserve GOAL_OPTIONS order for deterministic group ordering; any
    // unrecognized goal (shouldn't happen today, but defensive) trails.
    const ordered: { key: string; label: string; items: Routine[] }[] = [];
    for (const g of GOAL_OPTIONS) {
      const b = buckets.get(g.value);
      if (b) { ordered.push({ key: g.value, ...b }); buckets.delete(g.value); }
    }
    for (const [key, b] of buckets) ordered.push({ key, ...b });
    return ordered;
  }, [routines, search, goalFilter, sorts, groupBy, lastPerformedByRoutine]);

  // Flatten groups into a FlatList-friendly row array so one FlatList can
  // render both group headers and routine cards. Alternative (SectionList)
  // would also work but changes keying + the empty-state branch below.
  type Row =
    | { type: 'header'; key: string; label: string; count: number }
    | { type: 'card'; key: string; routine: Routine };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const g of visibleGroups) {
      if (groupBy !== 'none') {
        out.push({ type: 'header', key: `h-${g.key}`, label: g.label, count: g.items.length });
      }
      for (const r of g.items) out.push({ type: 'card', key: `r-${r.id}`, routine: r });
    }
    return out;
  }, [visibleGroups, groupBy]);

  const handleGoalFilter = (value: string) => {
    setGoalFilter(value);
    savePref(STORAGE_KEY_GOAL, value);
  };
  const handleGroupChange = (value: GroupKey) => {
    setGroupBy(value);
    savePref(STORAGE_KEY_GROUP, value);
    setGroupDropdownOpen(false);
  };
  const handleSortsChange = (next: SortLevel<SortKey>[]) => {
    setSorts(next);
    savePref(STORAGE_KEY_SORTS, next);
  };

  const activeGroupLabel = GROUP_OPTIONS.find((g) => g.key === groupBy)?.label ?? 'None';
  const totalVisible = rows.reduce((n, r) => n + (r.type === 'card' ? 1 : 0), 0);
  const filtersActive = search.trim().length > 0 || goalFilter !== 'all';

  const openCreate = () => {
    setNewName('');
    setNewGoal('general');
    setNewTracksSymptoms(false);
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) { setCreateError('Name is required.'); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const routine = await api.createRoutine({
        name, goal: newGoal, tracks_symptoms: newTracksSymptoms,
      });
      setCreateOpen(false);
      await loadRoutines();
      // Deep-link into the freshly-made routine so the user can add
      // exercises immediately — otherwise we dump them back on a list
      // with a routine that has zero moves.
      router.push(`/workout/${routine.id}`);
    } catch (e) {
      setCreateError(describeApiError(e, 'Could not create routine.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Tab bar below already labels this as "Workouts"; skip the big title
          to free vertical space. The primary action (New routine) stays
          prominent; secondary tools are collapsed into icon-only buttons
          so they don't out-shout the create/choose flow. */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.newBtn} onPress={openCreate} accessibilityRole="button" accessibilityLabel="New routine">
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.newBtnText}>New routine</Text>
          </Pressable>
          <Text style={styles.headerCount}>
            {filtersActive
              ? `${totalVisible} / ${routines.length}`
              : `${routines.length} routine${routines.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.streakBox}>
            <Ionicons name="flame" size={14} color={colors.warning} />
            <Text style={styles.streakText}>{streak}</Text>
          </View>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/workout/progress')}
            accessibilityRole="button"
            accessibilityLabel="Progress"
          >
            <Ionicons name="stats-chart-outline" size={18} color={colors.primary} />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/workout/admin')}
            accessibilityRole="button"
            accessibilityLabel="Exercise image admin"
          >
            <Ionicons name="images-outline" size={18} color={colors.primary} />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/workout/track')}
            accessibilityRole="button"
            accessibilityLabel="Track symptoms"
          >
            <Ionicons name="pulse-outline" size={18} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {/* Search row. Matches the Tasks tab shape — single input with a
          magnifier icon. 16px font to avoid iPhone Safari's zoom-on-
          focus. */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color="#888" style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search routines…"
          placeholderTextColor="#bbb"
          style={styles.searchInput}
          accessibilityLabel="Search routines"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color="#bbb" />
          </Pressable>
        )}
      </View>

      {/* Filter + sort + group bar. Wraps on narrow screens so chips don't
          squeeze into a vertical column. Order: goal chips, Sort, Group
          by — same rhythm as the Tasks tab. */}
      <View style={styles.filterBar}>
        {GOAL_FILTER_OPTIONS.map((g) => {
          const active = goalFilter === g.value;
          // Per-goal accent color when active — matches the goal dot on
          // each card so the filter state feels connected to the rows
          // it's narrowing.
          const bg = g.value === 'all' ? colors.primary : (GOAL_COLORS[g.value] ?? colors.primary);
          return (
            <Pressable
              key={g.value}
              onPress={() => handleGoalFilter(g.value)}
              style={[
                styles.filterChip,
                active && { backgroundColor: bg, borderColor: bg },
              ]}
              accessibilityRole="button"
              accessibilityLabel={active ? `Goal filter: ${g.label} (active)` : `Filter by goal: ${g.label}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={active ? styles.filterTextActive : styles.filterText}>{g.label}</Text>
            </Pressable>
          );
        })}

        <Pressable
          style={[styles.filterChip, sorts.length > 0 && { backgroundColor: colors.primary, borderColor: colors.primary }]}
          onPress={() => setSortOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            sorts.length > 0
              ? `Open sort, ${sorts.length} level${sorts.length === 1 ? '' : 's'} active`
              : 'Open sort'
          }
        >
          <Ionicons name="swap-vertical" size={14} color={sorts.length > 0 ? '#fff' : '#666'} />
          <Text style={sorts.length > 0 ? styles.filterTextActive : styles.filterText}>
            {sorts.length > 0 ? `Sort (${sorts.length})` : 'Sort'}
          </Text>
        </Pressable>

        <View style={styles.groupByContainer}>
          <Pressable
            style={[styles.filterChip, groupBy !== 'none' && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => setGroupDropdownOpen(!groupDropdownOpen)}
            accessibilityRole="button"
            accessibilityLabel={`Group by ${activeGroupLabel}. Tap to change.`}
          >
            <Ionicons name="layers-outline" size={14} color={groupBy !== 'none' ? '#fff' : '#666'} />
            <Text style={groupBy !== 'none' ? styles.filterTextActive : styles.filterText}>
              Group: {activeGroupLabel}
            </Text>
            <Ionicons
              name={groupDropdownOpen ? 'chevron-up' : 'chevron-down'}
              size={12}
              color={groupBy !== 'none' ? '#fff' : '#666'}
            />
          </Pressable>
          {groupDropdownOpen && (
            <View style={styles.dropdown}>
              {GROUP_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  style={[styles.dropdownItem, groupBy === opt.key && styles.dropdownItemActive]}
                  onPress={() => handleGroupChange(opt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: groupBy === opt.key }}
                >
                  <Text style={[styles.dropdownText, groupBy === opt.key && styles.dropdownTextActive]}>
                    {opt.label}
                  </Text>
                  {groupBy === opt.key && <Ionicons name="checkmark" size={14} color={colors.primary} />}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={{ padding: 12 }}>
          <SkeletonList count={4} variant="card" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <View style={styles.groupHeader}>
                  <Text style={styles.groupHeaderText}>{item.label}</Text>
                  <View style={styles.groupCount}>
                    <Text style={styles.groupCountText}>{item.count}</Text>
                  </View>
                </View>
              );
            }
            const r = item.routine;
            const lastStarted = lastPerformedByRoutine.get(r.id);
            const reminderLabel = formatReminder(r.reminder_time, r.reminder_days);
            const scheduled = Boolean(reminderLabel);
            return (
              <Pressable
                style={styles.card}
                onPress={() => router.push(`/workout/${r.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open routine ${r.name}`}
              >
                <View style={[styles.goalDot, { backgroundColor: GOAL_COLORS[r.goal] || '#999' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{r.name}</Text>
                  <Text style={styles.cardMeta}>
                    {r.exercises.length} exercises · {r.goal}
                    {lastStarted && ` · last ${formatRel(lastStarted)}`}
                  </Text>
                  {reminderLabel && (
                    <View style={styles.reminderRow}>
                      <Ionicons name="alarm" size={12} color={colors.warning} />
                      <Text style={styles.reminderText} numberOfLines={1}>{reminderLabel}</Text>
                    </View>
                  )}
                  {r.notes ? <Text style={styles.cardNotes} numberOfLines={2}>{r.notes}</Text> : null}
                </View>
                <Pressable
                  // Swallow the tap so it doesn't bubble to the card's
                  // onPress (which would navigate instead of opening
                  // the sheet).
                  onPress={(e) => { e.stopPropagation(); setReminderTarget(r); }}
                  style={styles.alarmBtn}
                  accessibilityRole="button"
                  accessibilityLabel={
                    scheduled
                      ? `Edit reminder for ${r.name}: ${reminderLabel}`
                      : `Set reminder for ${r.name}`
                  }
                  hitSlop={8}
                >
                  <Ionicons
                    name={scheduled ? 'alarm' : 'alarm-outline'}
                    size={20}
                    color={scheduled ? colors.warning : '#999'}
                  />
                </Pressable>
                <Ionicons name="chevron-forward" size={20} color="#bbb" />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            // Split the empty state: filters-zero vs real-zero. "No
            // routines yet" + CTA is encouraging on first visit, but
            // misleading when a user is staring at 20 real routines
            // filtered down to 0 by a search. Mirrors the Tasks tab.
            filtersActive ? (
              <View style={styles.empty}>
                <Ionicons name="funnel-outline" size={56} color="#d0d7e2" />
                <Text style={styles.emptyTitle}>No matches</Text>
                <Text style={styles.emptyHint}>
                  Nothing fits your current search or goal filter.
                </Text>
                <Pressable
                  style={styles.emptyCta}
                  onPress={() => { setSearch(''); handleGoalFilter('all'); }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear filters"
                >
                  <Ionicons name="refresh" size={16} color="#fff" />
                  <Text style={styles.emptyCtaText}>Clear filters</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="barbell-outline" size={64} color="#d0d7e2" />
                <Text style={styles.emptyTitle}>No routines yet</Text>
                <Text style={styles.emptyHint}>
                  Routines group exercises you do together. Create one and add moves from the library.
                </Text>
                <Pressable
                  style={styles.emptyCta}
                  onPress={openCreate}
                  accessibilityRole="button"
                  accessibilityLabel="Create your first routine"
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.emptyCtaText}>Create routine</Text>
                </Pressable>
              </View>
            )
          }
        />
      )}

      <SortPopover
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        options={SORT_OPTIONS}
        sorts={sorts}
        onChange={handleSortsChange}
      />

      <Modal
        visible={createOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>New routine</Text>
              <Pressable
                onPress={() => setCreateOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close new-routine dialog"
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color="#888" />
              </Pressable>
            </View>

            <Text style={styles.modalLabel}>Name</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Morning mobility"
              accessibilityLabel="Routine name"
              placeholderTextColor="#bbb"
              style={styles.modalInput}
              autoFocus
              autoCapitalize="sentences"
              onSubmitEditing={submitCreate}
              returnKeyType="done"
            />

            <Text style={styles.modalLabel}>Goal</Text>
            <View style={styles.goalRow}>
              {GOAL_OPTIONS.map((g) => (
                <Pressable
                  key={g.value}
                  onPress={() => setNewGoal(g.value)}
                  style={[
                    styles.goalChip,
                    newGoal === g.value && {
                      backgroundColor: GOAL_COLORS[g.value],
                      borderColor: GOAL_COLORS[g.value],
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: newGoal === g.value }}
                >
                  <Text style={[
                    styles.goalChipText,
                    newGoal === g.value && { color: '#fff', fontWeight: '700' },
                  ]}>
                    {g.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Rehab toggle — mirrors the in-detail chip from #51. Declared
                at creation so the first session honors the flag without a
                round-trip flip. */}
            <Pressable
              onPress={() => setNewTracksSymptoms((v) => !v)}
              style={[styles.rehabModalToggle, newTracksSymptoms && styles.rehabModalToggleOn]}
              accessibilityRole="switch"
              accessibilityState={{ checked: newTracksSymptoms }}
              accessibilityLabel="Track pain and symptoms in this routine"
              accessibilityHint="When on, sessions render a per-set pain chip and use Silbernagel-style advance/hold/back-off suggestions"
            >
              <Ionicons
                name={newTracksSymptoms ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={newTracksSymptoms ? '#fff' : '#888'}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rehabModalText, newTracksSymptoms && styles.rehabModalTextOn]}>
                  {newTracksSymptoms ? 'Tracking pain and symptoms' : 'Track pain and symptoms'}
                </Text>
                <Text style={[styles.rehabModalHint, newTracksSymptoms && styles.rehabModalHintOn]}>
                  Pain chip per set · pain-monitored progression
                </Text>
              </View>
            </Pressable>

            {createError && <Text style={styles.modalError}>{createError}</Text>}

            <Pressable
              style={[styles.modalSave, (!newName.trim() || creating) && { opacity: 0.5 }]}
              onPress={submitCreate}
              disabled={!newName.trim() || creating}
              accessibilityRole="button"
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.modalSaveText}>{creating ? 'Creating…' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {reminderTarget && (
        <ReminderSheet
          routine={reminderTarget}
          onClose={() => setReminderTarget(null)}
          onSaved={loadRoutines}
        />
      )}
    </View>
  );
}

function computeStreak(sessions: WorkoutSession[]): number {
  if (sessions.length === 0) return 0;
  const days = new Set(
    sessions.map((s) => new Date(s.started_at).toISOString().slice(0, 10))
  );
  let streak = 0;
  const cur = new Date();
  while (days.has(cur.toISOString().slice(0, 10))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  header: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    alignItems: 'center', rowGap: 8,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerCount: { fontSize: 12, color: colors.textMuted },
  streakBox: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff5e6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  streakText: { fontWeight: '700', color: colors.warning, fontSize: 12 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: colors.primary, cursor: 'pointer' as any,
  },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  iconBtn: {
    padding: 6, borderRadius: 8,
    backgroundColor: '#e8f0fe', cursor: 'pointer' as any,
  },

  // Search + filter + group row. Mirrors the Tasks tab for muscle-memory
  // parity — same chip radii, same input styling, same chevron behavior.
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  searchIcon: { marginLeft: 2 },
  searchInput: {
    flex: 1,
    // 16px to avoid iPhone Safari's input-zoom-on-focus. Anything
    // smaller and the page zooms in when the user taps.
    fontSize: 16,
    paddingVertical: 2, color: '#222',
    // Cast via `any` — RN-web's TextInput accepts outlineStyle to
    // suppress the browser focus ring, but it's not in RN's TextStyle
    // type. Keeps web focus unobtrusive.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  filterBar: {
    flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
    alignItems: 'center',
    // Dropdowns on web need the bar to leak its children outside its
    // bounds; `overflow: visible` + high zIndex lets the Group-by
    // dropdown render above the card list.
    zIndex: 100, overflow: 'visible' as any,
  },
  filterChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee',
    flexDirection: 'row', alignItems: 'center', gap: 4,
    cursor: 'pointer' as any,
  },
  filterText: { fontSize: 12, color: '#555', fontWeight: '600' },
  filterTextActive: { fontSize: 12, color: '#fff', fontWeight: '700' },

  groupByContainer: { position: 'relative' as any, zIndex: 9999, overflow: 'visible' as any },
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

  groupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, paddingHorizontal: 12, marginBottom: 4, marginTop: 4,
    backgroundColor: '#e8eef7', borderRadius: 6,
  },
  groupHeaderText: { fontSize: 12, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  groupCount: {
    backgroundColor: '#d0ddf0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
  },
  groupCountText: { fontSize: 11, color: colors.primary, fontWeight: '700' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    cursor: 'pointer' as any,
  },
  goalDot: { width: 8, height: 40, borderRadius: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#222' },
  cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  cardNotes: { fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic' },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  reminderText: { fontSize: 12, color: colors.warning, fontWeight: '600' },
  alarmBtn: {
    // 44×44 tap target above the WCAG minimum, separate from the
    // card-level press that navigates to detail.
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },

  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 32 },
  emptyText: { color: colors.textMuted, marginTop: 8, fontSize: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#444', marginTop: 12 },
  emptyHint: { color: '#8a94a6', marginTop: 6, fontSize: 13, textAlign: 'center', maxWidth: 300 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 18,
    cursor: 'pointer' as any,
  },
  emptyCtaText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },
  modalHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  modalLabel: { fontSize: 12, color: '#666', fontWeight: '700', marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10,
    fontSize: 15, backgroundColor: '#fafafa',
  },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  goalChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee',
    cursor: 'pointer' as any,
  },
  goalChipText: { fontSize: 13, color: '#555', fontWeight: '600' },
  rehabModalToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10, marginTop: 14,
    borderWidth: 1, borderColor: '#ddd',
    backgroundColor: '#fafafa',
    cursor: 'pointer' as any,
  },
  rehabModalToggleOn: { backgroundColor: colors.warning, borderColor: colors.warning },
  rehabModalText: { fontSize: 14, fontWeight: '700', color: '#333' },
  rehabModalTextOn: { color: '#fff' },
  rehabModalHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  rehabModalHintOn: { color: 'rgba(255,255,255,0.85)' },
  modalError: { color: colors.danger, fontSize: 13, marginTop: 10 },
  modalSave: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingVertical: 12, marginTop: 18,
    cursor: 'pointer' as any,
  },
  modalSaveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
