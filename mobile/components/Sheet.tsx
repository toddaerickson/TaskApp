/**
 * Modal sheet wrapper. Replaces the modalOverlay/modalCard/modalHead
 * triplet that was duplicated in workouts.tsx, exercises.tsx,
 * ReminderSheet, track.tsx, and session/[id].tsx — same shape, same
 * spacing, slight drift in colors and padding.
 *
 * Usage:
 *   <Sheet visible={open} onClose={() => setOpen(false)} title="New routine">
 *     <Text>…body…</Text>
 *     <Pressable …>Save</Pressable>
 *   </Sheet>
 *
 * Behavior:
 *  - Centered card, max-width 480, full-bleed dim backdrop, slide-up
 *    animation. Tap-outside-to-dismiss is opt-in via `dismissOnBackdrop`
 *    (default false — text inputs in the body should not get destroyed
 *    by a stray tap).
 *  - Wraps content in `KeyboardAvoidingView` on iOS so the keyboard
 *    doesn't cover the save button on small devices.
 *  - `title` is announced as a heading by VoiceOver via the `accessibility-
 *    Role="header"` on the title Text.
 */
import { ReactNode } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import { spacing, type, radii, shadow, minHitTarget } from '@/lib/theme';

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  dismissOnBackdrop?: boolean;
  scrollable?: boolean;
};

export function Sheet({
  visible,
  onClose,
  title,
  children,
  dismissOnBackdrop = false,
  scrollable = false,
}: SheetProps) {
  const Body = scrollable ? ScrollView : View;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismissOnBackdrop ? onClose : undefined}
          accessible={false}
        />
        <View style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title} dialog`}
              hitSlop={spacing.sm}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <Body
            {...(scrollable
              ? { contentContainerStyle: { paddingBottom: spacing.md } }
              : {})}
          >
            {children}
          </Body>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
    ...shadow.card,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: type.titleLg,
    fontWeight: '700',
    color: colors.textStrong,
  },
  closeBtn: {
    minWidth: minHitTarget,
    minHeight: minHitTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
