import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';

/**
 * Small pill that surfaces an exercise's evidence quality tier. Hidden
 * entirely when `tier` is null/undefined/unrecognized — most of the
 * 25 pre-existing seed exercises ship without a tier and we don't want
 * an "unclassified" placeholder cluttering their cards.
 *
 * Visual: filled-primary background (~5.4:1 contrast on white text,
 * AA-Normal pass) plus a leading per-tier Ionicon so the chip stays
 * intelligible under deuteranopia / protanopia where the four colors
 * could otherwise collapse to the same hue.
 *
 * The PRACTITIONER label truncates to "PRACT." because the row
 * doesn't have horizontal slack on iPhone SE / 320pt widths.
 */

type Tier = 'RCT' | 'MECHANISM' | 'PRACTITIONER' | 'THEORETICAL';

interface Props {
  tier?: string | null;
}

const TIERS: Record<Tier, {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  hint: string;
  fullName: string;
}> = {
  RCT: {
    label: 'RCT',
    icon: 'flask-outline',
    fullName: 'Randomized controlled trial',
    hint: 'Backed by one or more randomized controlled trials.',
  },
  MECHANISM: {
    label: 'MECH',
    icon: 'git-branch-outline',
    fullName: 'Mechanism-supported',
    hint: 'Mechanistic / EMG / biomechanical evidence; no direct outcome RCT.',
  },
  PRACTITIONER: {
    label: 'PRACT.',
    icon: 'people-outline',
    fullName: 'Practitioner consensus',
    hint: 'Practitioner consensus or popular framework; no peer-reviewed outcome data.',
  },
  THEORETICAL: {
    label: 'THEORY',
    icon: 'bulb-outline',
    fullName: 'Theoretical',
    hint: 'First-principles inference; not yet tested.',
  },
};

export function EvidenceTierChip({ tier }: Props) {
  if (!tier || !(tier in TIERS)) return null;
  const meta = TIERS[tier as Tier];
  return (
    <View
      style={styles.chip}
      accessible
      accessibilityRole="text"
      accessibilityLabel={meta.fullName}
      accessibilityHint={meta.hint}
    >
      <Ionicons name={meta.icon} size={11} color="#fff" />
      <Text style={styles.label}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  label: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
