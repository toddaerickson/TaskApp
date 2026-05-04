import { colors } from "@/lib/colors";
import { spacing, type as ftype, radii, shadow, minHitTarget } from '@/lib/theme';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, TextInput, Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWorkoutStore, WorkoutSession, Routine } from '@/lib/stores';
import { SkeletonList } from '@/components/Skeleton';
import ReminderSheet from '@/components/ReminderSheet';
import { RoutineDurationPill } from '@/components/RoutineDurationPill';
import { MissedRemindersBanner } from '@/components/MissedRemindersBanner';
import SortPopover, { SortLevel } from '@/components/SortPopover';
import { Chip, ChipStrip } from '@/components/Chip';
import { Sheet } from '@/components/Sheet';
import * as api from '@/lib/api';
import { describeApiError } from '@/lib/apiErrors';
import { formatRel } from '@/lib/format';
import { syncRoutineReminders } from '@/lib/routineReminders';
import { formatReminder } from '@/lib/reminders';
import { bucketRoutines } from '@/lib/workoutGroupBy';

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

type GroupKey = 'none' | 'goal' | 'day' | 'lastPerformed';

const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'goal', label: 'Goal' },
  // A routine scheduled Mon + Wed appears under both Monday and Wednesday
  // buckets — the user's mental model is "what's on my plate today", so
  // duplication is the right call. Unscheduled routines trail in "No day".
  { key: 'day', label: 'Scheduled day' },
  // Recency bucket rather than an exact date — today / this week / this
  // month / older / never. "Last performed" sort already exists; this
  // groups the same signal by recency bin.
  { key: 'lastPerformed', label: 'Last performed' },
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
      .catch((e: any) => {
        // Ambient fetch — drives the "last performed" + streak badges.
        // Silent in the UI (the badges fall back to "—" / 0), telemetry
        // via Sentry so transient 5xx is visible to the operator. 401
        // suppressed because the axios interceptor handles session
        // expiry separately.
        const status = e?.response?.status;
        if (status !== 401) {
          const { reportError } = require('@/lib/errorReporter');
          reportError(e, {
            route: 'GET /sessions',
            status,
            tags: { feature: 'workouts_recent_streak' },
          });
        }
      });
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
    return bucketRoutines(sorted, groupBy, lastPerformedByRoutine, new Date());
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
        <ChipStrip
          ariaLabel="Filter by goal"
          value={goalFilter}
          onChange={handleGoalFilter}
          options={GOAL_FILTER_OPTIONS.map((g) => ({
            value: g.value,
            label: g.label,
            // Per-goal accent color when active — matches the goal dot on
            // each card so the filter state feels connected to the rows
            // it's narrowing.
            accentColor: g.value === 'all' ? colors.primary : (GOAL_COLORS[g.value] ?? colors.primary),
          }))}
        />

        <Chip
          icon="swap-vertical"
          label={sorts.length > 0 ? `Sort (${sorts.length})` : 'Sort'}
          selected={sorts.length > 0}
          onPress={() => setSortOpen(true)}
          accessibilityLabel={
            sorts.length > 0
              ? `Open sort, ${sorts.length} level${sorts.length === 1 ? '' : 's'} active`
              : 'Open sort'
          }
        />

        <View style={styles.groupByContainer}>
          <Chip
            icon="layers-outline"
            iconRight={groupDropdownOpen ? 'chevron-up' : 'chevron-down'}
            label={`Group: ${activeGroupLabel}`}
            selected={groupBy !== 'none'}
            onPress={() => setGroupDropdownOpen(!groupDropdownOpen)}
            accessibilityLabel={`Group by ${activeGroupLabel}. Tap to change.`}
          />
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
          ListHeaderComponent={<MissedRemindersBanner />}
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
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{r.name}</Text>
                    <RoutineDurationPill minutes={r.target_minutes} />
                  </View>
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

      <Sheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New routine"
      >
        <Text style={styles.modalLabel}>Name</Text>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="e.g. Morning mobility"
          accessibilityLabel="Routine name"
          placeholderTextColor={colors.placeholder}
          style={styles.modalInput}
          autoFocus
          autoCapitalize="sentences"
          onSubmitEditing={submitCreate}
          returnKeyType="done"
        />

        <Text style={styles.modalLabel}>Goal</Text>
        <ChipStrip
          ariaLabel="Goal"
          value={newGoal}
          onChange={setNewGoal}
          options={GOAL_OPTIONS.map((g) => ({
            value: g.value,
            label: g.label,
            accentColor: GOAL_COLORS[g.value],
          }))}
        />

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
            color={newTracksSymptoms ? colors.onColor : colors.textMuted}
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
          <Ionicons name="checkmark" size={16} color={colors.onColor} />
          <Text style={styles.modalSaveText}>{creating ? 'Creating…' : 'Create'}</Text>
        </Pressable>
      </Sheet>

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
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    alignItems: 'center', rowGap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  headerCount: { fontSize: ftype.caption, color: colors.textMuted },
  streakBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: '#fff5e6', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.md,
  },
  streakText: { fontWeight: '700', color: colors.warningText, fontSize: ftype.caption },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md - 2, paddingVertical: spacing.sm - 2, borderRadius: radii.lg,
    backgroundColor: colors.primary, cursor: 'pointer' as any,
  },
  newBtnText: { color: colors.onColor, fontSize: ftype.body - 1, fontWeight: '700' },
  iconBtn: {
    padding: spacing.sm - 2, borderRadius: radii.sm,
    backgroundColor: colors.primaryOnLight, cursor: 'pointer' as any,
  },

  // Search + filter + group row. Mirrors the Tasks tab for muscle-memory
  // parity — same chip radii, same input styling, same chevron behavior.
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft,
  },
  searchIcon: { marginLeft: 2 },
  searchInput: {
    flex: 1,
    // 16px to avoid iPhone Safari's input-zoom-on-focus. Anything
    // smaller and the page zooms in when the user taps. Token enforces.
    fontSize: ftype.input,
    paddingVertical: 2, color: colors.textStrong,
    // Cast via `any` — RN-web's TextInput accepts outlineStyle to
    // suppress the browser focus ring, but it's not in RN's TextStyle
    // type. Keeps web focus unobtrusive.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  filterBar: {
    flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm, gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
    alignItems: 'center',
    // Dropdowns on web need the bar to leak its children outside its
    // bounds; `overflow: visible` + high zIndex lets the Group-by
    // dropdown render above the card list.
    zIndex: 100, overflow: 'visible' as any,
  },

  groupByContainer: { position: 'relative' as any, zIndex: 9999, overflow: 'visible' as any },
  dropdown: {
    position: 'absolute' as any, top: 34, left: 0, zIndex: 9999,
    backgroundColor: colors.surface, borderRadius: radii.sm, padding: spacing.xs,
    shadowColor: colors.shadow, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 10, minWidth: 150, borderWidth: 1, borderColor: '#d0d0d0',
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.sm - 2,
    cursor: 'pointer' as any,
  },
  dropdownItemActive: { backgroundColor: '#f0f4ff' },
  dropdownText: { fontSize: ftype.body - 1, color: colors.text },
  dropdownTextActive: { fontSize: ftype.body - 1, color: colors.primary, fontWeight: '600' },

  groupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.xs, marginTop: spacing.xs,
    backgroundColor: '#e8eef7', borderRadius: radii.sm - 2,
  },
  groupHeaderText: { fontSize: ftype.caption, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  groupCount: {
    backgroundColor: '#d0ddf0', borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  groupCountText: { fontSize: ftype.caption - 1, color: colors.primary, fontWeight: '700' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm,
    ...shadow.card,
    cursor: 'pointer' as any,
  },
  goalDot: { width: 8, height: 40, borderRadius: radii.xs },
  cardTitle: { fontSize: ftype.title, fontWeight: '600', color: colors.textStrong, flexShrink: 1 },
  // Title + duration pill row. Duration pill stays right-adjacent to the
  // title so it reads as a property of the routine, not a separate badge.
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardMeta: { fontSize: ftype.caption - 1, color: colors.textMuted, marginTop: 2 },
  cardNotes: { fontSize: ftype.caption, color: colors.textMuted, marginTop: spacing.xs, fontStyle: 'italic' },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  reminderText: { fontSize: ftype.caption, color: colors.warningText, fontWeight: '600' },
  alarmBtn: {
    // 44×44 tap target above the WCAG minimum, separate from the
    // card-level press that navigates to detail.
    width: minHitTarget, height: minHitTarget, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },

  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: spacing.xxl },
  emptyTitle: { fontSize: ftype.title, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  emptyHint: { color: colors.textMuted, marginTop: spacing.xs + 2, fontSize: ftype.body - 1, textAlign: 'center', maxWidth: 300 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
    backgroundColor: colors.primary, borderRadius: radii.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, marginTop: spacing.lg + 2,
    cursor: 'pointer' as any,
  },
  emptyCtaText: { color: colors.onColor, fontWeight: '600', fontSize: ftype.body },

  modalLabel: { fontSize: ftype.caption, color: colors.textMuted, fontWeight: '700', marginTop: spacing.md + 2, marginBottom: spacing.xs + 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: {
    borderWidth: 1, borderColor: colors.borderInput, borderRadius: radii.sm, padding: spacing.sm + 2,
    fontSize: ftype.input, backgroundColor: colors.surfaceAlt,
  },
  rehabModalToggle: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2,
    padding: spacing.md, borderRadius: radii.md, marginTop: spacing.md + 2,
    borderWidth: 1, borderColor: colors.borderInput,
    backgroundColor: colors.surfaceAlt,
    cursor: 'pointer' as any,
  },
  rehabModalToggleOn: { backgroundColor: colors.warning, borderColor: colors.warning },
  rehabModalText: { fontSize: ftype.body, fontWeight: '700', color: colors.text },
  rehabModalTextOn: { color: colors.onColor },
  rehabModalHint: { fontSize: ftype.caption - 1, color: colors.textMuted, marginTop: 2 },
  rehabModalHintOn: { color: 'rgba(255,255,255,0.85)' },
  modalError: { color: colors.danger, fontSize: ftype.body - 1, marginTop: spacing.sm + 2 },
  modalSave: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2,
    backgroundColor: colors.primary, borderRadius: radii.sm,
    paddingVertical: spacing.md, marginTop: spacing.lg + 2,
    cursor: 'pointer' as any,
  },
  modalSaveText: { color: colors.onColor, fontWeight: '700', fontSize: ftype.bodyLg },
});
