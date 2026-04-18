import { colors } from "@/lib/colors";
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Image, Pressable, StyleSheet, ActivityIndicator, Platform, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Routine, RoutineExercise } from '@/lib/stores';
import * as api from '@/lib/api';

export default function RoutineDetailScreen() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  const router = useRouter();
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [starting, setStarting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [suggestions, setSuggestions] = useState<api.RoutineSuggestion[]>([]);

  const reload = useCallback(() => {
    if (!routineId) return;
    const id = Number(routineId);
    api.getRoutine(id)
      .then(setRoutine)
      .catch((e) => console.warn('[routine] getRoutine failed:', e));
    api.getRoutineSuggestions(id).then(setSuggestions).catch(() => setSuggestions([]));
  }, [routineId]);
  // Reload on focus so returning from a finished session picks up the new
  // suggestion immediately, not the pre-workout one.
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const moveExercise = async (idx: number, dir: -1 | 1) => {
    if (!routine) return;
    const next = [...routine.exercises];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setRoutine({ ...routine, exercises: next });
    try {
      await api.reorderRoutineExercises(routine.id, next.map((re) => re.id));
    } catch {
      reload();
    }
  };

  const deleteRoutineExercise = async (reId: number) => {
    if (Platform.OS === 'web' && !window.confirm('Remove this exercise from the routine?')) return;
    await api.removeExerciseFromRoutine(reId);
    reload();
  };

  const handleStart = async () => {
    if (!routine || starting) return;
    setStarting(true);
    try {
      const session = await api.startSession(routine.id);
      router.replace(`/workout/session/${session.id}`);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Failed to start';
      if (Platform.OS === 'web') window.alert(msg);
    } finally {
      setStarting(false);
    }
  };

  if (!routine) {
    return <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />;
  }

  const totalMins = Math.round(
    routine.exercises.reduce((sum, re) => {
      const work = (re.target_duration_sec ?? 30) * (re.target_sets ?? 1);
      const rest = (re.rest_sec ?? 30) * Math.max(0, (re.target_sets ?? 1) - 1);
      return sum + work + rest;
    }, 0) / 60
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: routine.name,
          headerRight: () => (
            <Pressable
              onPress={() => setEditMode(!editMode)}
              // Explicit 44×44 target; the earlier 22px icon sat in a
              // ~30px box which is below WCAG minimum.
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
              accessibilityRole="button"
              accessibilityLabel={editMode ? 'Exit edit mode' : 'Edit routine'}
              hitSlop={8}
            >
              <Ionicons
                name={editMode ? 'checkmark' : 'create-outline'}
                size={22} color="#fff"
              />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {editMode ? (
          <RoutineHeaderEdit routine={routine} onSaved={reload} />
        ) : (
          <View style={styles.header}>
            <Text style={styles.title}>{routine.name}</Text>
            <Text style={styles.meta}>
              {routine.exercises.length} exercises · ~{totalMins} min · {routine.goal}
            </Text>
            {routine.reminder_time ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <Ionicons name="alarm-outline" size={13} color={colors.warning} />
                <Text style={{ fontSize: 12, color: colors.warning }}>
                  {routine.reminder_time} · {routine.reminder_days || 'daily'}
                </Text>
              </View>
            ) : null}
            {routine.notes ? <Text style={styles.notes}>{routine.notes}</Text> : null}
          </View>
        )}

        {routine.exercises.map((re, idx) => {
          const ex = re.exercise;
          if (!ex) return null;
          return (
            <View key={re.id} style={[styles.exCard, re.keystone && styles.keystoneCard]}>
              <View style={styles.exHeader}>
                <Text style={styles.exNum}>{idx + 1}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.exName}>{ex.name}</Text>
                    {re.keystone && (
                      <View style={styles.keystoneBadge}>
                        <Ionicons name="star" size={11} color="#fff" />
                        <Text style={styles.keystoneBadgeText}>KEY</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.exTarget}>{formatTarget(re)}</Text>
                  {(() => {
                    const sg = suggestions.find((s) => s.routine_exercise_id === re.id);
                    if (!sg || !sg.reason || sg.reason.startsWith('No prior')) return null;
                    return (
                      <View
                        style={styles.suggestBox}
                        accessibilityLabel={`Suggestion: ${formatSuggest(sg)}. ${sg.reason}`}
                      >
                        <Ionicons name="sparkles-outline" size={11} color={colors.success} />
                        <Text style={styles.suggestText}>
                          Next: <Text style={{ fontWeight: '700' }}>{formatSuggest(sg)}</Text>
                          {' · '}
                          <Text style={styles.suggestReason}>{sg.reason}</Text>
                        </Text>
                      </View>
                    );
                  })()}
                </View>
                {editMode && (
                  <View style={styles.editControls}>
                    <Pressable onPress={() => moveExercise(idx, -1)} disabled={idx === 0} style={styles.ctrlBtn}>
                      <Ionicons name="chevron-up" size={18} color={idx === 0 ? '#ccc' : colors.primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => moveExercise(idx, 1)}
                      disabled={idx === routine.exercises.length - 1}
                      style={styles.ctrlBtn}
                    >
                      <Ionicons
                        name="chevron-down" size={18}
                        color={idx === routine.exercises.length - 1 ? '#ccc' : colors.primary}
                      />
                    </Pressable>
                    <Pressable onPress={() => deleteRoutineExercise(re.id)} style={styles.ctrlBtn}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </Pressable>
                  </View>
                )}
              </View>

              {editMode && <RoutineExerciseEdit re={re} onSaved={reload} />}

              {ex.images.length > 0 && (
                <ScrollView horizontal style={styles.imageRow} showsHorizontalScrollIndicator={false}>
                  {ex.images.map((img) => (
                    <Image
                      key={img.id}
                      source={{ uri: img.url }}
                      style={styles.exImage}
                      resizeMode="cover"
                    />
                  ))}
                </ScrollView>
              )}

              {ex.instructions ? (
                <Text style={styles.exInstr}>{ex.instructions}</Text>
              ) : null}
              {ex.cue ? (
                <View style={styles.cueBox}>
                  <Ionicons name="bulb-outline" size={14} color={colors.warning} />
                  <Text style={styles.cueText}>{ex.cue}</Text>
                </View>
              ) : null}
              {re.notes ? <Text style={styles.reNotes}>{re.notes}</Text> : null}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.startBtn, starting && { opacity: 0.6 }]}
          onPress={handleStart}
          disabled={starting}
        >
          <Ionicons name="play" size={20} color="#fff" />
          <Text style={styles.startText}>{starting ? 'Starting…' : 'Start workout'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function parseDays(csv: string | null | undefined): Set<string> {
  if (!csv) return new Set();
  const norm = csv.toLowerCase().trim();
  if (norm === 'daily') return new Set(DAYS);
  return new Set(norm.split(',').map((s) => s.trim()).filter((s) => (DAYS as readonly string[]).includes(s)));
}

function daysCsv(set: Set<string>): string | null {
  if (set.size === 0) return null;
  if (set.size === 7) return 'daily';
  return DAYS.filter((d) => set.has(d)).join(',');
}

function RoutineHeaderEdit({ routine, onSaved }: { routine: Routine; onSaved: () => void }) {
  const [name, setName] = useState(routine.name);
  const [notes, setNotes] = useState(routine.notes || '');
  const [time, setTime] = useState(routine.reminder_time || '');
  const [days, setDays] = useState<Set<string>>(parseDays(routine.reminder_days));
  const [busy, setBusy] = useState(false);

  const dirty = name !== routine.name
    || notes !== (routine.notes || '')
    || time !== (routine.reminder_time || '')
    || daysCsv(days) !== (routine.reminder_days || null);

  const toggleDay = (d: string) => {
    const next = new Set(days);
    if (next.has(d)) next.delete(d); else next.add(d);
    setDays(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.updateRoutine(routine.id, {
        name, notes,
        reminder_time: time.trim() || null,
        reminder_days: time.trim() ? daysCsv(days) : null,
      });
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.header}>
      <Text style={styles.fieldLabel}>Routine name</Text>
      <TextInput value={name} onChangeText={setName} style={styles.fieldInput} />
      <Text style={styles.fieldLabel}>Notes</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top' }]}
      />
      <Text style={styles.fieldLabel}>Reminder time (HH:MM, blank = off)</Text>
      <TextInput
        value={time}
        onChangeText={setTime}
        placeholder="07:00"
        autoCapitalize="none"
        style={styles.fieldInput}
      />
      {!!time && (
        <>
          <Text style={styles.fieldLabel}>Days</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {DAYS.map((d) => {
              const on = days.has(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  style={[styles.dayChip, on && styles.dayChipOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${d} ${on ? 'selected' : 'off'}`}
                >
                  <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      <Pressable
        style={[styles.saveBtn, (!dirty || busy) && { opacity: 0.5 }]}
        onPress={save}
        disabled={!dirty || busy}
      >
        <Ionicons name="save-outline" size={14} color="#fff" />
        <Text style={styles.saveText}>{busy ? 'Saving…' : dirty ? 'Save' : 'No changes'}</Text>
      </Pressable>
    </View>
  );
}

function RoutineExerciseEdit({ re, onSaved }: { re: RoutineExercise; onSaved: () => void }) {
  const [sets, setSets] = useState(String(re.target_sets ?? ''));
  const [reps, setReps] = useState(String(re.target_reps ?? ''));
  const [dur, setDur] = useState(String(re.target_duration_sec ?? ''));
  const [rest, setRest] = useState(String(re.rest_sec ?? ''));
  const [tempo, setTempo] = useState(re.tempo ?? '');
  const [notes, setNotes] = useState(re.notes ?? '');
  const [keystone, setKeystone] = useState(!!re.keystone);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateRoutineExercise(re.id, {
        target_sets: sets ? Number(sets) : null,
        target_reps: reps ? Number(reps) : null,
        target_duration_sec: dur ? Number(dur) : null,
        rest_sec: rest ? Number(rest) : null,
        tempo: tempo || null,
        notes: notes || null,
        keystone,
      });
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.editPanel}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <EditField label="Sets" value={sets} onChange={setSets} numeric />
        <EditField label="Reps" value={reps} onChange={setReps} numeric />
        <EditField label="Seconds" value={dur} onChange={setDur} numeric />
        <EditField label="Rest (s)" value={rest} onChange={setRest} numeric />
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <EditField label="Tempo" value={tempo} onChange={setTempo} />
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Keystone</Text>
          <Pressable style={styles.keystoneToggle} onPress={() => setKeystone(!keystone)}>
            <Ionicons
              name={keystone ? 'star' : 'star-outline'}
              size={18} color={keystone ? colors.accent : '#999'}
            />
            <Text style={{ fontSize: 12, color: keystone ? colors.accent : '#999' }}>
              {keystone ? 'yes' : 'no'}
            </Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.fieldLabel}>Notes</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        style={[styles.fieldInput, { minHeight: 40, textAlignVertical: 'top' }]}
      />
      <Pressable
        style={[styles.saveBtn, busy && { opacity: 0.5 }]}
        onPress={save}
        disabled={busy}
      >
        <Ionicons name="save-outline" size={14} color="#fff" />
        <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </View>
  );
}

function EditField({ label, value, onChange, numeric }: {
  label: string; value: string; onChange: (v: string) => void; numeric?: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        style={styles.fieldInput}
      />
    </View>
  );
}

function formatSuggest(sg: api.RoutineSuggestion): string {
  const parts: string[] = [];
  if (sg.reps) parts.push(`${sg.reps} reps`);
  if (sg.weight) parts.push(`@${sg.weight} lb`);
  if (sg.duration_sec) parts.push(`${sg.duration_sec}s`);
  return parts.join(' ') || '—';
}

function formatTarget(re: RoutineExercise): string {
  const parts: string[] = [];
  if (re.target_sets) parts.push(`${re.target_sets}×`);
  if (re.target_reps) parts[parts.length - 1] += `${re.target_reps}`;
  else if (re.target_duration_sec) parts[parts.length - 1] += `${re.target_duration_sec}s`;
  if (re.target_weight) parts.push(`@${re.target_weight}lb`);
  if (re.tempo) parts.push(`tempo ${re.tempo}`);
  if (re.rest_sec) parts.push(`rest ${re.rest_sec}s`);
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 22, fontWeight: '700', color: '#222' },
  meta: { fontSize: 13, color: '#888', marginTop: 4 },
  notes: { fontSize: 13, color: '#555', marginTop: 8, fontStyle: 'italic' },

  exCard: {
    backgroundColor: '#fff', margin: 10, marginBottom: 0, borderRadius: 10, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  keystoneCard: { borderLeftWidth: 4, borderLeftColor: colors.accent },
  exHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  exNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary,
    color: '#fff', textAlign: 'center', lineHeight: 28, fontWeight: '700',
  },
  exName: { fontSize: 16, fontWeight: '600', color: '#222' },
  exTarget: { fontSize: 12, color: colors.primary, marginTop: 2, fontWeight: '600' },
  suggestBox: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
    backgroundColor: '#e8f5e9', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 4, alignSelf: 'flex-start',
  },
  suggestText: { fontSize: 11, color: '#1b5e20', flexShrink: 1 },
  suggestReason: { fontStyle: 'italic', color: '#2e7d32' },
  keystoneBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  keystoneBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },

  imageRow: { marginTop: 10 },
  exImage: { width: 180, height: 120, marginRight: 8, borderRadius: 6, backgroundColor: '#eee' },

  exInstr: { fontSize: 13, color: '#444', marginTop: 10, lineHeight: 18 },
  cueBox: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    backgroundColor: '#fff5e6', padding: 8, borderRadius: 6, marginTop: 8,
  },
  cueText: { flex: 1, fontSize: 12, color: '#a67c00' },
  reNotes: { fontSize: 12, color: '#666', marginTop: 8, fontStyle: 'italic' },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee',
  },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.success, borderRadius: 10, padding: 14,
    cursor: 'pointer' as any,
  },
  startText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  editControls: { flexDirection: 'row', gap: 4 },
  // 44×44 tap targets to meet the WCAG 2.2 minimum — the old 18px icon
  // inside padding:6 was ~30px, below the minimum.
  ctrlBtn: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: 6, cursor: 'pointer' as any,
  },
  editPanel: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
  },
  fieldLabel: { fontSize: 11, color: '#888', fontWeight: '600', marginTop: 8, marginBottom: 4 },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8,
    fontSize: 13, backgroundColor: '#fafafa',
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 6, padding: 8, marginTop: 10,
    cursor: 'pointer' as any,
  },
  saveText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  keystoneToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8,
    backgroundColor: '#fafafa', cursor: 'pointer' as any,
  },
  dayChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#ddd',
    cursor: 'pointer' as any,
  },
  dayChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { fontSize: 12, color: '#555', textTransform: 'uppercase' },
  dayChipTextOn: { color: '#fff', fontWeight: '700' },
});
