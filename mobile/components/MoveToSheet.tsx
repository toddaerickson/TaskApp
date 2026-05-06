/**
 * Generic "Move to..." action sheet. Wraps `Sheet` with a vertical
 * list of options, a checkmark next to the current value, and a
 * single-tap select that calls `onSelect(value)`.
 *
 * Why generic over T: the same UX serves task folder (number),
 * priority (number 0-4), status (string enum), starred (boolean),
 * and routine goal (string enum). One renderer = one set of a11y
 * fixes.
 *
 * Why this exists: the drag-and-drop feature (PR-D2+) cannot be the
 * ONLY path to regrouping — that fails WCAG 2.5.7 (Dragging
 * Movements, Level AA). The "Move to..." sheet ships first as the
 * accessible baseline, and drag becomes the convenience layer.
 *
 * The component does NOT call the API; the parent passes
 * `onSelect(value)`. This keeps the sheet pure-render and lets the
 * parent handle optimistic update + rollback + UndoSnackbar.
 */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from './Sheet';
import { colors } from '@/lib/colors';
import { spacing, type as ftype, radii, minHitTarget } from '@/lib/theme';
import type { MoveToOption } from '@/lib/moveToOptions';

type MoveToSheetProps<T> = {
  visible: boolean;
  onClose: () => void;
  /** Sheet title — e.g. "Move task to folder" or "Set goal". */
  title: string;
  options: MoveToOption<T>[];
  /** Current value of the field on the row being moved. Rendered with
   *  a checkmark; tapping it is a no-op (the sheet just closes). */
  currentValue: T;
  /** Async so the parent can await the API + rollback before
   *  re-enabling the sheet. Errors propagate; the sheet shows a
   *  generic error in the row that was tapped, but the parent should
   *  surface the proper toast/snackbar. */
  onSelect: (value: T) => Promise<void>;
};

export function MoveToSheet<T>({
  visible,
  onClose,
  title,
  options,
  currentValue,
  onSelect,
}: MoveToSheetProps<T>) {
  // Disable all rows during the in-flight call so a frantic double-tap
  // doesn't fire two PATCHes with the same expected_updated_at (the
  // second one would 409, but the UI would briefly show two
  // outstanding operations).
  const [busy, setBusy] = useState<T | null>(null);

  const handlePress = async (value: T) => {
    if (busy !== null) return;
    if (value === currentValue) {
      onClose();
      return;
    }
    setBusy(value);
    try {
      await onSelect(value);
      onClose();
    } catch {
      // Parent owns user-facing error UX. Just clear busy state so
      // the user can retry.
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} dismissOnBackdrop scrollable>
      <View style={styles.list} accessibilityRole="radiogroup">
        {options.map((opt) => {
          const selected = opt.value === currentValue;
          const isBusy = busy !== null && opt.value === busy;
          return (
            <Pressable
              key={String(opt.value)}
              style={({ pressed }) => [
                styles.row,
                selected && styles.rowSelected,
                pressed && styles.rowPressed,
                busy !== null && !isBusy && styles.rowDisabled,
              ]}
              onPress={() => handlePress(opt.value)}
              disabled={busy !== null && !isBusy}
              accessibilityRole="radio"
              accessibilityState={{ selected, busy: isBusy }}
              accessibilityLabel={
                selected ? `${opt.label}, current value` : `Move to ${opt.label}`
              }
            >
              {opt.icon ? (
                <Ionicons
                  name={opt.icon as any}
                  size={18}
                  color={selected ? colors.primary : colors.textMuted}
                />
              ) : (
                <View style={styles.iconSpacer} />
              )}
              <Text
                style={[styles.rowLabel, selected && styles.rowLabelSelected]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
              {selected && (
                <Ionicons name="checkmark" size={18} color={colors.primary} />
              )}
              {isBusy && !selected && (
                <Ionicons name="hourglass-outline" size={18} color={colors.textMuted} />
              )}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: minHitTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  rowSelected: {
    backgroundColor: colors.surfaceAlt,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  iconSpacer: {
    width: 18,
  },
  rowLabel: {
    flex: 1,
    fontSize: ftype.body,
    color: colors.text,
  },
  rowLabelSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
});
