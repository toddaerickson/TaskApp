/**
 * Toodledo-style 3-level sort popover. Three tabs (FIRST / SECOND /
 * THIRD) over the same vertical list of sort fields; each row has ↓ /
 * ↑ arrows to pick direction. Resolves at runtime as:
 *
 *   Apply FIRST → group by value; within each group, apply SECOND;
 *   within each tie, apply THIRD.
 *
 * This is a straight UI shell over the existing `sorts: SortLevel[]`
 * state in tasks.tsx — the sort engine and localStorage persistence
 * stay where they are. Opening the popover on any level writes through
 * the same `onChange(sorts)` callback.
 */
import { useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';

export type SortDir = 'asc' | 'desc';
export interface SortLevel<K extends string> {
  key: K;
  dir: SortDir;
}

interface SortOption<K extends string> {
  key: K;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface Props<K extends string> {
  visible: boolean;
  onClose: () => void;
  options: readonly SortOption<K>[];
  /** Ordered array, length 0-3. Index 0 = primary, 1 = secondary, 2 = tertiary. */
  sorts: SortLevel<K>[];
  onChange: (next: SortLevel<K>[]) => void;
}

export default function SortPopover<K extends string>({
  visible, onClose, options, sorts, onChange,
}: Props<K>) {
  // Which level (0/1/2) the user is editing. FIRST opens by default.
  const [activeLevel, setActiveLevel] = useState<0 | 1 | 2>(0);

  const current: SortLevel<K> | undefined = sorts[activeLevel];

  const selectKey = (key: K, dir: SortDir) => {
    // Build the next sorts array. Three rules:
    //  1. Setting a key at level N replaces any existing entry for that
    //     key elsewhere in the stack (no duplicates).
    //  2. Writing to level N > current length fills the gap at level N
    //     without touching earlier levels (since they're blanks).
    //  3. Choosing the same key/dir that's already active at the level
    //     CLEARS that level (toggle-off semantics).
    const isSame =
      sorts[activeLevel] && sorts[activeLevel].key === key && sorts[activeLevel].dir === dir;

    // Strip any existing entry for this key (rule 1).
    let next = sorts.filter((_, i) => i === activeLevel || _.key !== key);

    if (isSame) {
      // Remove this level entirely (rule 3) and compact.
      next = next.filter((_, i) => i !== activeLevel);
    } else {
      // Set / replace the level.
      const slot: SortLevel<K> = { key, dir };
      const copy = [...next];
      // Pad to the target index with an empty slot so splice lands
      // where the user clicked (handles rule 2).
      while (copy.length < activeLevel) copy.push(slot);
      if (copy.length <= activeLevel) copy.push(slot);
      else copy[activeLevel] = slot;
      next = copy;
    }

    // Cap to 3 and drop any empty holes.
    next = next.filter(Boolean).slice(0, 3);
    onChange(next);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          // See FiltersSheet.tsx — same fix. The "swallow" no-op
          // doesn't actually swallow anything on RN Web; the press
          // bubbles to the overlay's onClose. stopPropagation is the
          // working pattern.
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.grabHandle} />
          <View style={styles.head}>
            <Text style={styles.title}>Sort</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close sort"
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color="#888" />
            </Pressable>
          </View>

          <View style={styles.tabs}>
            {(['FIRST', 'SECOND', 'THIRD'] as const).map((label, i) => {
              const active = activeLevel === i;
              const level = sorts[i];
              return (
                <Pressable
                  key={label}
                  onPress={() => setActiveLevel(i as 0 | 1 | 2)}
                  style={[styles.tab, active && styles.tabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
                  {level ? (
                    <Text style={[styles.tabSummary, active && styles.tabSummaryActive]} numberOfLines={1}>
                      {options.find((o) => o.key === level.key)?.label ?? String(level.key)}
                      {level.dir === 'asc' ? ' ↑' : ' ↓'}
                    </Text>
                  ) : (
                    <Text style={styles.tabSummaryEmpty}>—</Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <ScrollView style={styles.optList}>
            {options.map((opt) => {
              const isCurrent = current?.key === opt.key;
              return (
                <View key={opt.key} style={[styles.optRow, isCurrent && styles.optRowActive]}>
                  <View style={styles.optLabelWrap}>
                    {opt.icon && (
                      <Ionicons name={opt.icon} size={14} color={isCurrent ? colors.primary : colors.textMuted} />
                    )}
                    <Text style={[styles.optLabel, isCurrent && styles.optLabelActive]}>
                      {opt.label}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => selectKey(opt.key, 'desc')}
                    hitSlop={6}
                    style={[
                      styles.dirBtn,
                      isCurrent && current.dir === 'desc' && styles.dirBtnActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Sort ${opt.label} descending`}
                  >
                    <Ionicons
                      name="arrow-down"
                      size={16}
                      color={isCurrent && current.dir === 'desc' ? '#fff' : colors.textMuted}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => selectKey(opt.key, 'asc')}
                    hitSlop={6}
                    style={[
                      styles.dirBtn,
                      isCurrent && current.dir === 'asc' && styles.dirBtnActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Sort ${opt.label} ascending`}
                  >
                    <Ionicons
                      name="arrow-up"
                      size={16}
                      color={isCurrent && current.dir === 'asc' ? '#fff' : colors.textMuted}
                    />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={styles.clearBtn}
              onPress={() => { onChange([]); setActiveLevel(0); }}
              accessibilityRole="button"
              accessibilityLabel="Clear all sort"
            >
              <Ionicons name="refresh" size={14} color={colors.danger} />
              <Text style={styles.clearText}>Clear all</Text>
            </Pressable>
            <Pressable
              style={styles.doneBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, maxHeight: '85%',
    paddingBottom: Platform.OS === 'web' ? ('max(20px, env(safe-area-inset-bottom))' as any) : 28,
  },
  grabHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#d0d5dd', alignSelf: 'center', marginBottom: 12,
  },
  head: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222' },

  tabs: {
    flexDirection: 'row', gap: 6, marginBottom: 12,
  },
  tab: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8,
    backgroundColor: '#f5f6fa',
    alignItems: 'center',
    cursor: 'pointer' as any,
  },
  tabActive: { backgroundColor: colors.primary },
  tabLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  tabLabelActive: { color: '#fff' },
  tabSummary: { fontSize: 12, color: '#444', marginTop: 3 },
  tabSummaryActive: { color: '#fff' },
  tabSummaryEmpty: { fontSize: 12, color: '#bbb', marginTop: 3 },

  optList: { maxHeight: 340 },
  optRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
    minHeight: 44,
  },
  optRowActive: { backgroundColor: '#eef4ff' },
  optLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  optLabel: { fontSize: 14, color: '#222' },
  optLabelActive: { color: colors.primary, fontWeight: '700' },
  dirBtn: {
    width: 36, height: 36, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f5f6fa',
    borderWidth: 1, borderColor: colors.border,
    cursor: 'pointer' as any,
  },
  dirBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },

  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12,
  },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, cursor: 'pointer' as any,
  },
  clearText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  doneBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: colors.primary, cursor: 'pointer' as any,
  },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
