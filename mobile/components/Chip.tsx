/**
 * Pill-shaped tappable chip. Replaces ~7 nearly-identical chip
 * StyleSheets that drifted across workout/tasks screens (catChip,
 * goalChip, measurementChip, filterChip, partChip, archivedToggle,
 * etc.) — same shape, same spacing, slightly different colors.
 *
 * Usage:
 *   <Chip label="All" selected={value === 'all'} onPress={…} />
 *   <Chip label="Rehab" selected={…} accentColor={GOAL_COLORS.rehab} />
 *   <Chip label="Sort" icon="swap-vertical" onPress={…} />
 *
 * `accentColor` lets a chip override the primary tint when selected
 * (used by goal-color filter chips that show goal-specific hue).
 */
import { Pressable, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import { spacing, type, radii } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  iconRight?: IconName;
  accentColor?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  iconRight,
  accentColor,
  accessibilityLabel,
  accessibilityHint,
}: ChipProps) {
  const bg = selected ? (accentColor ?? colors.primary) : colors.surface;
  const border = selected ? (accentColor ?? colors.primary) : colors.border;
  const fg = selected ? colors.onColor : colors.textMuted;
  const iconColor = selected ? colors.onColor : colors.textMuted;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: bg, borderColor: border }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
    >
      {icon && <Ionicons name={icon} size={14} color={iconColor} />}
      <Text style={[styles.label, { color: fg, fontWeight: selected ? '700' : '600' }]}>
        {label}
      </Text>
      {iconRight && <Ionicons name={iconRight} size={12} color={iconColor} />}
    </Pressable>
  );
}

/**
 * Strip of chips with a leading "All" sentinel + per-value chips. Used
 * by goal/category/measurement filter rows — captures the
 * map-then-render-Pressable pattern that appeared verbatim 4 times in
 * the workout module.
 */
type ChipStripProps<T extends string> = {
  options: { value: T; label: string; accentColor?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
};

export function ChipStrip<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: ChipStripProps<T>) {
  return (
    <View
      style={styles.strip}
      accessibilityRole="tablist"
      accessibilityLabel={ariaLabel}
    >
      {options.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          selected={value === opt.value}
          onPress={() => onChange(opt.value)}
          accentColor={opt.accentColor}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  label: {
    fontSize: type.caption,
  },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm - 2,
  },
});
