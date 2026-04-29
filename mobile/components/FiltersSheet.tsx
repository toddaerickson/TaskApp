/**
 * Bottom-sheet filter panel for the Tasks tab. Hosts secondary filters
 * that would otherwise bloat the top-level chip bar past a usable width
 * on a phone.
 *
 * GTD rationale: the chip bar stays reserved for "do I care right now"
 * verbs (Active / Completed / Starred / Next). Everything else that
 * narrows the list further — Hide future, Hide deferred, eventually
 * Context multi-select — lives here so the bar doesn't grow each time a
 * new filter ships.
 *
 *   <FiltersSheet
 *     visible={filtersOpen}
 *     onClose={() => setFiltersOpen(false)}
 *     hideFuture={hideFuture} onHideFutureChange={setHideFuture}
 *     hideDeferred={hideDeferred} onHideDeferredChange={setHideDeferred}
 *     onClearAll={clearAll}
 *   />
 */
import { View, Text, Modal, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  hideFuture: boolean;
  onHideFutureChange: (v: boolean) => void;
  hideDeferred: boolean;
  onHideDeferredChange: (v: boolean) => void;
  onClearAll: () => void;
}

export default function FiltersSheet({
  visible, onClose,
  hideFuture, onHideFutureChange,
  hideDeferred, onHideDeferredChange,
  onClearAll,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Tap-to-dismiss backdrop. Keep the sheet itself inside a separate
          Pressable so taps on controls don't bubble up and close. */}
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          // PR #128 / sheet-dismiss fix. The earlier "swallow" comment
          // was misleading: on RN Web the inner press still bubbles to
          // the overlay's onPress={onClose} unless we call
          // e.stopPropagation(), so any non-Pressable tap inside the
          // sheet would silently dismiss it.
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.grabHandle} />

          <View style={styles.head}>
            <Text style={styles.title}>Filters</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color="#888" />
            </Pressable>
          </View>

          <ToggleRow
            label="Hide future tasks"
            hint="Hides tasks whose start date is after today."
            value={hideFuture}
            onChange={onHideFutureChange}
          />
          <ToggleRow
            label="Hide deferred"
            hint="Hides tasks with status hold, someday, postponed, or cancelled."
            value={hideDeferred}
            onChange={onHideDeferredChange}
          />

          <View style={styles.footerRow}>
            <Pressable
              style={styles.clearBtn}
              onPress={onClearAll}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
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

function ToggleRow({
  label, hint, value, onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      style={styles.toggleRow}
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    // iOS Safari needs room for the home indicator; env(safe-area...) is
    // only honored on web so the native padding stays a hardcoded floor.
    paddingBottom: Platform.OS === 'web' ? ('max(20px, env(safe-area-inset-bottom))' as any) : 28,
  },
  grabHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#d0d5dd',
    alignSelf: 'center', marginBottom: 12,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
    minHeight: 44,
  },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: '#222' },
  toggleHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  toggleTrack: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: '#d0d5dd',
    padding: 2,
  },
  toggleTrackOn: { backgroundColor: colors.primary },
  toggleThumb: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    cursor: 'pointer' as any,
  },
  clearText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  doneBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: colors.primary,
    cursor: 'pointer' as any,
  },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
