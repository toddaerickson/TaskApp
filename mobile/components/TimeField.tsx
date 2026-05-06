/**
 * Time picker (PR-B3). Replaces the bare `HH:MM` TextInput in
 * `TaskReminderEditor` with a tap-to-open slot list + free-form
 * military-time input.
 *
 * UX (per multi-agent plan review):
 *   - Tap trigger → opens a slide-up sheet (native) or popover-style
 *     scroll list (web) anchored at the trigger.
 *   - Slot list: 30-minute steps from 06:00 to 21:30 (32 slots).
 *     Initial scroll positions on the current value if set, else
 *     09:00. Hard-bound 06:00–21:30 is the *default scroll range*,
 *     not a hard bound (UI agent I1 + silent-killer I3).
 *   - Free-form input at the top of the sheet: typing "2200" or
 *     "5:30" sets the value to 22:00 / 05:30 — outside the slot
 *     range, fully supported. Strict parser (silent-killer I1):
 *     rejects "30" / "900" with leading-zero confusion / "2400" /
 *     "2360".
 *   - iOS autocorrect / spellCheck disabled on the free-form input
 *     to keep "2100" from becoming "2,100" or worse.
 *
 * TZ note: emits a wall-clock `HH:MM` (24-hour, zero-padded). The
 * caller (`TaskReminderEditor`) combines this with a date and
 * `new Date(y, mo, d, h, mi)` to derive the ISO. That's a local-TZ
 * interpretation, which on the operator's home iPhone matches
 * TASKAPP_TZ. Cross-device same-user behavior (silent-killer S1)
 * is a pre-existing limitation NOT addressed in this PR.
 */
import { colors } from '@/lib/colors';
import { spacing, type as ftype, radii } from '@/lib/theme';
import {
  DEFAULT_SLOTS_06_TO_2130,
  findExactSlot,
  formatTime12,
  parseMilitaryTime,
} from '@/lib/timeParse';
import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  /** `HH:MM` (24-hour, zero-padded) or empty string. */
  value: string;
  onChange: (hhmm: string) => void;
  placeholder?: string;
  compact?: boolean;
  /** Wired from the parent's accessibilityLabel — TimeField surfaces
   *  it on the trigger Pressable so VoiceOver reads "Reminder time,
   *  9:00 PM" instead of just "9:00 PM". */
  accessibilityLabel?: string;
}

const SLOT_HEIGHT = 44; // matches WCAG 44pt min hit target

export default function TimeField({
  value,
  onChange,
  placeholder = 'Pick a time',
  compact,
  accessibilityLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [freeError, setFreeError] = useState<string | null>(null);
  const listRef = useRef<FlatList<string>>(null);

  // Find the slot to scroll to on open. Centers on the current value
  // if it's an exact slot, else 09:00 (typical first-task-of-day).
  const initialIndex = useMemo(() => {
    const slot = findExactSlot(value, DEFAULT_SLOTS_06_TO_2130);
    if (slot) return DEFAULT_SLOTS_06_TO_2130.indexOf(slot);
    return DEFAULT_SLOTS_06_TO_2130.indexOf('09:00');
  }, [value]);

  const triggerLabel = value ? formatTime12(value) : placeholder;

  const handleOpen = () => {
    setFreeText('');
    setFreeError(null);
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const pickSlot = (hhmm: string) => {
    onChange(hhmm);
    setOpen(false);
  };

  const submitFree = () => {
    const parsed = parseMilitaryTime(freeText);
    if (!parsed) {
      setFreeError(
        "Use 4-digit military time (e.g. 2100 for 9 PM) or HH:MM.",
      );
      return;
    }
    onChange(parsed);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        style={[styles.trigger, compact && styles.triggerCompact]}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={
          value
            ? `${accessibilityLabel ?? 'Time'}: ${formatTime12(value)}`
            : (accessibilityLabel ?? placeholder)
        }
      >
        <Text
          style={[
            styles.text,
            compact && styles.textCompact,
            !value && { color: colors.textMuted },
          ]}
        >
          {triggerLabel}
        </Text>
        {value ? (
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); onChange(''); }}
            accessibilityRole="button"
            accessibilityLabel="Clear time"
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={colors.placeholder} />
          </Pressable>
        ) : (
          <Ionicons name="time-outline" size={18} color={colors.textMuted} />
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={handleClose}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Pressable
            style={styles.sheet}
            // The inner Pressable absorbs taps so they don't bubble to
            // the backdrop's onPress. RN doesn't ship a `View
            // pointerEvents` shortcut for "swallow tap, ignore"; this
            // is the canonical workaround.
            onPress={() => { /* swallow */ }}
          >
            <View style={styles.head}>
              <Text style={styles.title} accessibilityRole="header">
                Pick a time
              </Text>
              <Pressable
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Close time picker"
                hitSlop={8}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            {/* Free-form military-time input. Surfaced at the TOP of
                the sheet so an operator who knows what they want can
                avoid the slot scroll entirely. */}
            <Text style={styles.label}>Type a custom time</Text>
            <View style={styles.freeRow}>
              <TextInput
                style={styles.freeInput}
                value={freeText}
                onChangeText={(t) => { setFreeText(t); if (freeError) setFreeError(null); }}
                onSubmitEditing={submitFree}
                placeholder="e.g. 2200 or 5:30"
                placeholderTextColor={colors.placeholder}
                keyboardType="numbers-and-punctuation"
                // iOS-Safari autocorrect / spellCheck off so "2100"
                // doesn't become "2,100" or "21:00:00" mid-typing.
                autoCorrect={false}
                spellCheck={false}
                autoCapitalize="none"
                returnKeyType="done"
                accessibilityLabel="Custom time, military format"
              />
              <Pressable
                onPress={submitFree}
                style={[styles.freeSubmit, !freeText.trim() && { opacity: 0.5 }]}
                disabled={!freeText.trim()}
                accessibilityRole="button"
                accessibilityLabel="Apply custom time"
              >
                <Ionicons name="checkmark" size={18} color={colors.onColor} />
              </Pressable>
            </View>
            {freeError && <Text style={styles.freeError}>{freeError}</Text>}

            {/* Slot list. FlatList for the 32 slots — already paginated
                cleanly; getItemLayout enables initialScrollIndex without
                a measurement pass. */}
            <Text style={styles.label}>Or pick a slot</Text>
            <FlatList
              ref={listRef}
              data={DEFAULT_SLOTS_06_TO_2130 as string[]}
              keyExtractor={(s) => s}
              initialScrollIndex={initialIndex}
              getItemLayout={(_, index) => ({
                length: SLOT_HEIGHT,
                offset: SLOT_HEIGHT * index,
                index,
              })}
              style={styles.slotList}
              renderItem={({ item }) => {
                const active = item === value;
                return (
                  <Pressable
                    onPress={() => pickSlot(item)}
                    style={[styles.slot, active && styles.slotActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={formatTime12(item)}
                  >
                    <Text style={[styles.slotText, active && styles.slotTextActive]}>
                      {formatTime12(item)}
                    </Text>
                    {active && (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    )}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  triggerCompact: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.sm - 2,
  },
  text: { fontSize: ftype.bodyLg, color: colors.text },
  textCompact: { fontSize: ftype.body - 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '70%',
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm + 2,
  },
  title: { fontSize: ftype.titleLg, fontWeight: '700', color: colors.textStrong },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  label: {
    fontSize: ftype.caption,
    color: colors.textMuted,
    fontWeight: '700',
    marginTop: spacing.sm + 2,
    marginBottom: spacing.xs + 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  freeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'stretch',
  },
  freeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderInput,
    borderRadius: radii.sm - 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    fontSize: ftype.input,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    // RN-web focus-ring suppression — same trick as the search inputs
    // elsewhere in the codebase.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  freeSubmit: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm - 2,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  freeError: {
    color: colors.danger,
    fontSize: ftype.caption,
    marginTop: spacing.xs,
  },
  slotList: {
    marginTop: spacing.xs + 2,
  },
  slot: {
    height: SLOT_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm - 2,
  },
  slotActive: { backgroundColor: colors.primaryOnLight },
  slotText: { fontSize: ftype.bodyLg, color: colors.text },
  slotTextActive: { color: colors.primary, fontWeight: '700' },
});
