import { colors } from '@/lib/colors';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Shared inline error state with a retry affordance. Renders in place of
 * a screen's main content when a fetch fails — replaces the previous
 * pattern of "leave the spinner rendering forever and log to console,"
 * which hangs the user on /workout/:id direct URLs after a 401 or a
 * network blip.
 *
 * Keep minimal: title + body + retry button. Consumers pass the body
 * text (server detail + request id when available) so the next bug
 * report is actionable.
 */
export default function ErrorCard({
  title = 'Something went wrong',
  msg,
  retry,
}: {
  title?: string;
  msg: string;
  retry: () => void;
}) {
  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={42} color={colors.danger} />
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.msg} accessibilityLabel={`Error: ${msg}`}>{msg}</Text>
      <Pressable
        onPress={retry}
        style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        hitSlop={8}
      >
        <Ionicons name="refresh" size={16} color="#fff" />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center', justifyContent: 'center',
    padding: 24, marginTop: 40,
  },
  title: {
    fontSize: 17, fontWeight: '700', color: '#444',
    marginTop: 12, textAlign: 'center',
  },
  msg: {
    fontSize: 13, color: '#666', textAlign: 'center',
    marginTop: 6, maxWidth: 320, lineHeight: 19,
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 18, paddingVertical: 10,
    marginTop: 18,
    minHeight: 44, minWidth: 44,
    cursor: 'pointer' as any,
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
