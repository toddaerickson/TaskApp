/**
 * Per-exercise phase picker chip, rendered on each routine-exercise card
 * in edit mode when the routine has ≥1 phase. Tap opens a modal with
 * "All phases" + each phase label; selection calls
 * PUT /routines/{id}/exercises/{rid} with the new phase_id.
 *
 * "All phases" is stored as phase_id=NULL — matches the server default
 * for routine_exercises rows created before phases existed. Seen by the
 * exercise filter as "show in every phase" (mobile/lib/phases.ts).
 */
import { colors } from '@/lib/colors';
import { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RoutinePhase } from '@/lib/stores';
import * as api from '@/lib/api';

interface Props {
  routineExerciseId: number;
  currentPhaseId: number | null | undefined;
  phases: RoutinePhase[];
  onChanged: () => void;
}

export function ExercisePhaseChip({ routineExerciseId, currentPhaseId, phases, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const sorted = phases.slice().sort((a, b) => a.order_idx - b.order_idx);
  const current = sorted.find((p) => p.id === currentPhaseId);
  const label = current ? current.label : 'All phases';

  const pick = async (phaseId: number | null) => {
    if (phaseId === (currentPhaseId ?? null)) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await api.updateRoutineExercise(routineExerciseId, { phase_id: phaseId });
      onChanged();
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={saving}
        style={({ pressed }) => [
          styles.chip, current ? styles.chipActive : null, pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Phase: ${label}. Tap to change.`}
        hitSlop={8}
      >
        <Ionicons
          name="flag-outline" size={12}
          color={current ? colors.primary : colors.textMuted}
        />
        <Text style={[styles.chipText, current && styles.chipTextActive]}>
          {label}
        </Text>
        <Ionicons
          name="chevron-down" size={12}
          color={current ? colors.primary : colors.textMuted}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Assign to phase</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              <PhaseOption
                label="All phases"
                hint="Runs in every phase (e.g. warmups)"
                selected={currentPhaseId == null}
                onPress={() => pick(null)}
              />
              {sorted.map((p, idx) => (
                <PhaseOption
                  key={p.id}
                  label={`${idx + 1}. ${p.label}`}
                  hint={`${p.duration_weeks} week${p.duration_weeks === 1 ? '' : 's'}`}
                  selected={currentPhaseId === p.id}
                  onPress={() => pick(p.id)}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

interface OptionProps {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}

function PhaseOption({ label, hint, selected, onPress }: OptionProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.option, selected && styles.optionSelected, pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${hint}. ${selected ? 'Selected' : 'Not selected'}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionHint}>{hint}</Text>
      </View>
      {selected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
    minHeight: 28,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryOnLight,
  },
  chipText: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: colors.primary },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%', maxWidth: 420,
    backgroundColor: colors.surface, borderRadius: 10,
    padding: 16, gap: 4,
  },
  sheetTitle: {
    fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 8,
  },
  option: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 8,
    borderRadius: 6,
    minHeight: 44,
  },
  optionSelected: { backgroundColor: colors.primaryOnLight },
  optionLabel: { fontSize: 14, color: colors.text, fontWeight: '600' },
  optionHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
