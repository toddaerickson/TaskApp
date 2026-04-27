import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';

/**
 * Small pill that surfaces a routine's `target_minutes` estimate, used
 * on the routine card and on the routine-detail header. Hidden entirely
 * when `minutes` is null/undefined — pre-feature routines stay clean.
 *
 * Visual: outline `time-outline` icon + "{n} min" in the existing
 * muted-text token. Mirrors the meta pill style on the routine card so
 * it sits neatly next to the existing reminder / goal indicators.
 */
interface Props {
  minutes?: number | null;
}

export function RoutineDurationPill({ minutes }: Props) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  return (
    <View
      style={styles.pill}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${minutes} minute routine`}
    >
      <Ionicons name="time-outline" size={11} color={colors.textMuted} />
      <Text style={styles.label}>{minutes} min</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
});
