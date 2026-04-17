import { colors } from "@/lib/colors";
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator,
  TextInput, Image, Platform, Alert, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Routine, RoutineExercise, WorkoutSession, SessionSet } from '@/lib/stores';
import * as api from '@/lib/api';
import { beep } from '@/lib/timer';
import { formatTime, severityColor as sevColor } from '@/lib/format';
import { describeApiError } from '@/lib/apiErrors';
import { haptics } from '@/lib/haptics';
import { useRestTimer } from '@/lib/useRestTimer';

function showError(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(`${title}: ${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function ActiveSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [rpe, setRpe] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [symptomOpen, setSymptomOpen] = useState(false);
  const [symptomPart, setSymptomPart] = useState('right_big_toe');
  const [symptomCustom, setSymptomCustom] = useState('');
  const [symptomSeverity, setSymptomSeverity] = useState(3);
  const [symptomNotes, setSymptomNotes] = useState('');
  const [symptomSaving, setSymptomSaving] = useState(false);
  const [symptomCount, setSymptomCount] = useState(0);
  const [suggestions, setSuggestions] = useState<api.RoutineSuggestion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  // Rest countdown lives at the session level so the user can tap
  // other exercise blocks (peek cues / check images) without killing it.
  // onComplete fires once the clock hits zero — feedback only, no
  // state side-effects so a re-render from the stop() inside the hook
  // doesn't fight with another setState here.
  const rest = useRestTimer(() => {
    beep(2);
    haptics.success();
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const s = await api.getSession(Number(id));
        if (cancelled) return;
        setSession(s);
        if (s.routine_id) {
          const r = await api.getRoutine(s.routine_id);
          if (cancelled) return;
          setRoutine(r);
          api.getRoutineSuggestions(s.routine_id)
            .then((sg) => { if (!cancelled) setSuggestions(sg); })
            .catch(() => { if (!cancelled) setSuggestions([]); });
        }
      } catch (e) {
        if (!cancelled) setLoadError(describeApiError(e, 'Could not load session.'));
      }
    })();
    return () => { cancelled = true; };
  }, [id, loadNonce]);

  const reload = async () => {
    if (!id) return;
    try {
      const s = await api.getSession(Number(id));
      setSession(s);
    } catch (e) {
      showError('Sync failed', describeApiError(e, 'Could not refresh session.'));
    }
  };

  const logInFlight = useRef(false);

  const handleLogSet = async (re: RoutineExercise, payload: Partial<SessionSet>) => {
    if (!session || logInFlight.current) return;
    logInFlight.current = true;
    try {
      // Server assigns set_number atomically; don't send one from the client
      // to avoid stale-closure races on double-tap.
      await api.logSet(session.id, {
        exercise_id: re.exercise_id,
        reps: payload.reps,
        duration_sec: payload.duration_sec,
        weight: payload.weight,
        rpe: payload.rpe,
      });
      haptics.bump();
      await reload();
    } catch (e) {
      haptics.error();
      showError('Set not saved', describeApiError(e, 'Could not log that set.'));
    } finally {
      logInFlight.current = false;
    }
  };

  const handleFinish = async () => {
    if (!session || finishing) return;
    setFinishing(true);
    try {
      await api.endSession(session.id, { rpe: rpe ?? undefined });
      haptics.success();
      router.replace('/(tabs)/workouts');
    } catch (e) {
      haptics.error();
      showError('Could not finish', describeApiError(e, 'Session did not close. Try again.'));
    } finally {
      setFinishing(false);
    }
  };

  const handleLogSymptom = async () => {
    if (!session) return;
    const part = (symptomCustom.trim() || symptomPart).toLowerCase().replace(/\s+/g, '_');
    if (!part) return;
    setSymptomSaving(true);
    try {
      await api.logSymptom({
        body_part: part,
        severity: symptomSeverity,
        notes: symptomNotes.trim() || undefined,
        session_id: session.id,
      });
      setSymptomCount((n) => n + 1);
      setSymptomNotes('');
      setSymptomCustom('');
      setSymptomSeverity(3);
      setSymptomOpen(false);
    } catch (e) {
      showError('Symptom not saved', describeApiError(e, 'Could not log symptom.'));
    } finally {
      setSymptomSaving(false);
    }
  };

  const confirmFinish = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Finish this workout?')) handleFinish();
    } else {
      Alert.alert('Finish workout?', 'End this session.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Finish', onPress: handleFinish },
      ]);
    }
  };

  if (loadError) {
    return (
      <View style={styles.errorBox}>
        <Ionicons name="alert-circle-outline" size={36} color={colors.danger} />
        <Text style={styles.errorTitle}>Could not load session</Text>
        <Text style={styles.errorMsg}>{loadError}</Text>
        <Pressable
          style={styles.errorRetryBtn}
          onPress={() => { setLoadError(null); setLoadNonce((n) => n + 1); }}
          accessibilityRole="button"
        >
          <Text style={styles.errorRetryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!session || !routine) {
    return <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />;
  }

  const totalSets = routine.exercises.reduce((sum, re) => sum + (re.target_sets ?? 1), 0);
  const doneSets = session.sets.length;
  const pct = totalSets > 0 ? Math.min(100, (doneSets / totalSets) * 100) : 0;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: routine.name, headerBackTitle: 'Cancel' }} />

      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>{doneSets} / {totalSets} sets</Text>
        <Pressable style={styles.symptomBtn} onPress={() => setSymptomOpen(true)}>
          <Ionicons name="pulse-outline" size={14} color={colors.warning} />
          <Text style={styles.symptomBtnText}>
            Log symptom{symptomCount > 0 ? ` (${symptomCount})` : ''}
          </Text>
        </Pressable>
      </View>

      {rest.active && (
        <View
          style={styles.restBanner}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Rest timer, ${rest.remaining} seconds remaining`}
        >
          <View style={styles.restTopRow}>
            <Text style={styles.restLabel}>Rest</Text>
            <Text style={styles.restValue}>{formatTime(rest.remaining)}</Text>
          </View>
          <View style={styles.restBar}>
            <View
              style={[
                styles.restBarFill,
                { width: `${rest.total > 0 ? Math.min(100, (rest.remaining / rest.total) * 100) : 0}%` },
              ]}
            />
          </View>
          <View style={styles.restBtnRow}>
            <Pressable
              style={styles.restBtn}
              onPress={() => rest.adjust(-15)}
              accessibilityRole="button"
              accessibilityLabel="Subtract 15 seconds"
            >
              <Text style={styles.restBtnText}>−15s</Text>
            </Pressable>
            <Pressable
              style={[styles.restBtn, styles.restBtnStop]}
              onPress={rest.stop}
              accessibilityRole="button"
              accessibilityLabel="Stop rest timer"
            >
              <Text style={[styles.restBtnText, { color: '#fff' }]}>Stop</Text>
            </Pressable>
            <Pressable
              style={styles.restBtn}
              onPress={() => rest.adjust(15)}
              accessibilityRole="button"
              accessibilityLabel="Add 15 seconds"
            >
              <Text style={styles.restBtnText}>+15s</Text>
            </Pressable>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: 200 }}>
        {routine.exercises.map((re, idx) => (
          <ExerciseBlock
            key={re.id}
            re={re}
            idx={idx}
            isActive={idx === activeIdx}
            sets={session.sets.filter((s) => s.exercise_id === re.exercise_id)}
            suggestion={suggestions.find((sg) => sg.routine_exercise_id === re.id)}
            onActivate={() => setActiveIdx(idx)}
            onLog={(payload) => handleLogSet(re, payload)}
            onAdvance={() => setActiveIdx(Math.min(routine.exercises.length - 1, idx + 1))}
            onRestRequest={rest.start}
            restActive={rest.active}
          />
        ))}

        <View style={styles.finishBox}>
          <Text style={styles.finishLabel}>How hard was that? (RPE 1-10)</Text>
          <View style={styles.rpeRow}>
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <Pressable
                key={n}
                style={[styles.rpeBtn, rpe === n && styles.rpeBtnActive]}
                onPress={() => setRpe(n)}
              >
                <Text style={[styles.rpeText, rpe === n && styles.rpeTextActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.finishBtn, finishing && { opacity: 0.6 }]}
          onPress={confirmFinish}
          disabled={finishing}
        >
          <Ionicons name="checkmark-circle" size={20} color="#fff" />
          <Text style={styles.finishBtnText}>{finishing ? 'Saving…' : 'Finish workout'}</Text>
        </Pressable>
      </View>

      <Modal visible={symptomOpen} transparent animationType="slide" onRequestClose={() => setSymptomOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Log symptom</Text>
              <Pressable
                onPress={() => setSymptomOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close symptom log"
              >
                <Ionicons name="close" size={22} color="#888" />
              </Pressable>
            </View>

            <Text style={styles.modalLabel}>Body part</Text>
            <View style={styles.partRow}>
              {SYMPTOM_PARTS.map((p) => (
                <Pressable
                  key={p}
                  style={[styles.partChip, symptomPart === p && !symptomCustom && styles.partChipActive]}
                  onPress={() => { setSymptomPart(p); setSymptomCustom(''); }}
                >
                  <Text style={[styles.partChipText, symptomPart === p && !symptomCustom && styles.partChipTextActive]}>
                    {p.replace(/_/g, ' ')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              placeholder="custom (e.g. left_achilles)"
              value={symptomCustom}
              onChangeText={setSymptomCustom}
              style={styles.modalInput}
            />

            <Text style={styles.modalLabel}>Severity: {symptomSeverity}/10</Text>
            <View style={styles.sevRow}>
              {Array.from({ length: 11 }).map((_, n) => (
                <Pressable
                  key={n}
                  onPress={() => setSymptomSeverity(n)}
                  style={[styles.sevDot, { backgroundColor: symptomSeverity === n ? sevColor(n) : '#eee' }]}
                >
                  <Text style={[styles.sevNum, symptomSeverity === n && { color: '#fff', fontWeight: '700' }]}>
                    {n}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.modalLabel}>Notes</Text>
            <TextInput
              placeholder="e.g. sharp at toe-off during set 2"
              value={symptomNotes}
              onChangeText={setSymptomNotes}
              multiline
              style={[styles.modalInput, { minHeight: 60, textAlignVertical: 'top' }]}
            />

            <Pressable
              style={[styles.modalSaveBtn, symptomSaving && { opacity: 0.6 }]}
              onPress={handleLogSymptom}
              disabled={symptomSaving}
            >
              <Text style={styles.modalSaveText}>{symptomSaving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const SYMPTOM_PARTS = [
  'right_big_toe', 'right_calf', 'right_hip',
  'left_calf', 'lower_back', 'right_knee',
];

function ExerciseBlock({
  re, idx, isActive, sets, suggestion, onActivate, onLog, onAdvance,
  onRestRequest, restActive,
}: {
  re: RoutineExercise;
  idx: number;
  isActive: boolean;
  sets: SessionSet[];
  suggestion?: api.RoutineSuggestion;
  onActivate: () => void;
  onLog: (payload: Partial<SessionSet>) => Promise<void>;
  onAdvance: () => void;
  onRestRequest: (seconds: number) => void;
  restActive: boolean;
}) {
  const ex = re.exercise!;
  const targetSets = re.target_sets ?? 1;
  const isDone = sets.length >= targetSets;
  // Pre-fill from the progression suggestion when one exists, else the routine target.
  const initReps = suggestion?.reps ?? re.target_reps ?? '';
  const initDur = suggestion?.duration_sec ?? re.target_duration_sec ?? '';
  const initW = suggestion?.weight ?? re.target_weight ?? '';
  const [reps, setReps] = useState(String(initReps));
  const [duration, setDuration] = useState(String(initDur));
  const [weight, setWeight] = useState(String(initW));

  // When the suggestion arrives after the block rendered, update inputs —
  // but only if the user hasn't typed anything yet (compare against the
  // route target as the "untouched" signal).
  const suggestKey = suggestion ? `${suggestion.reps ?? ''}|${suggestion.duration_sec ?? ''}|${suggestion.weight ?? ''}` : '';
  useEffect(() => {
    if (!suggestion) return;
    if (reps === String(re.target_reps ?? '') && suggestion.reps != null) setReps(String(suggestion.reps));
    if (duration === String(re.target_duration_sec ?? '') && suggestion.duration_sec != null) setDuration(String(suggestion.duration_sec));
    if (weight === String(re.target_weight ?? '') && suggestion.weight != null) setWeight(String(suggestion.weight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestKey]);

  const isDuration = ex.measurement === 'duration';

  // Per-block timer is now for the *active hold* only (isometric exercises
  // that count down a target duration). Rest between sets is managed by
  // the session-level useRestTimer above.
  const [holdRemaining, setHoldRemaining] = useState(0);
  const [holdActive, setHoldActive] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep sets in a ref so the timer's onDone closure reads fresh values,
  // not the length captured when the timer started.
  const setsRef = useRef(sets);
  useEffect(() => { setsRef.current = sets; }, [sets]);

  const stopHold = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setHoldActive(false);
    setHoldRemaining(0);
  };

  // Clear the interval when this block is deactivated OR unmounted. Prevents
  // ghost beeps/logs firing for an exercise the user has left.
  useEffect(() => {
    if (!isActive && tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
      setHoldActive(false);
      setHoldRemaining(0);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [isActive]);

  const startHoldTimer = (seconds: number, onDone?: () => void) => {
    if (tickRef.current) clearInterval(tickRef.current);
    setHoldActive(true);
    setHoldRemaining(seconds);
    const endAt = Date.now() + seconds * 1000;
    tickRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setHoldRemaining(left);
      if (left <= 0) {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setHoldActive(false);
        beep(3);
        onDone?.();
      }
    }, 200);
  };

  const handleQuickLog = async () => {
    await onLog({
      reps: !isDuration && reps ? Number(reps) : undefined,
      duration_sec: isDuration && duration ? Number(duration) : undefined,
      weight: weight ? Number(weight) : undefined,
    });
    // Read fresh length AFTER onLog's reload so we don't miss sets logged
    // concurrently elsewhere in the session.
    if (setsRef.current.length >= targetSets) {
      onAdvance();
    } else if (re.rest_sec && re.rest_sec > 0) {
      onRestRequest(re.rest_sec);
    }
  };

  const startDurationTimer = () => {
    const secs = Number(duration) || re.target_duration_sec || 30;
    startHoldTimer(secs, async () => {
      await onLog({ duration_sec: secs });
      if (setsRef.current.length >= targetSets) {
        onAdvance();
      } else if (re.rest_sec && re.rest_sec > 0) {
        onRestRequest(re.rest_sec);
      }
    });
  };

  return (
    <Pressable
      onPress={onActivate}
      style={[styles.exBlock, isActive && styles.exBlockActive, isDone && styles.exBlockDone]}
    >
      <View style={styles.exHead}>
        <Text style={[styles.exHeadNum, isDone && { backgroundColor: colors.success }]}>{idx + 1}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.exHeadName}>{ex.name}</Text>
          <Text style={styles.exHeadTarget}>
            {targetSets}×{isDuration ? `${re.target_duration_sec}s` : re.target_reps}
            {re.target_weight ? ` @${re.target_weight}` : ''}
          </Text>
        </View>
        {isDone && <Ionicons name="checkmark-circle" size={24} color={colors.success} />}
      </View>

      {isActive && (
        <>
          {ex.images.length > 0 && (
            <Image source={{ uri: ex.images[0].url }} style={styles.activeImage} resizeMode="cover" />
          )}
          {ex.cue ? (
            <View style={styles.cueBox}>
              <Ionicons name="bulb-outline" size={14} color={colors.warning} />
              <Text style={styles.cueText}>{ex.cue}</Text>
            </View>
          ) : null}

          <View style={styles.setList}>
            {Array.from({ length: targetSets }).map((_, i) => {
              const s = sets[i];
              return (
                <View key={i} style={[styles.setRow, s && styles.setRowDone]}>
                  <Text style={styles.setNum}>Set {i + 1}</Text>
                  {s ? (
                    <Text style={styles.setDone}>
                      {s.reps ? `${s.reps} reps` : s.duration_sec ? `${s.duration_sec}s` : '—'}
                      {s.weight ? ` @${s.weight}` : ''}
                    </Text>
                  ) : (
                    <Text style={styles.setPending}>pending</Text>
                  )}
                </View>
              );
            })}
          </View>

          {holdActive && (
            <View
              style={styles.timerBox}
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Hold timer, ${holdRemaining} seconds remaining`}
            >
              <Text style={styles.timerLabel}>Hold</Text>
              <Text style={styles.timerValue}>{formatTime(holdRemaining)}</Text>
              <Pressable style={styles.timerStopBtn} onPress={stopHold} accessibilityRole="button">
                <Text style={styles.timerStopText}>Stop</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.inputRow}>
            {isDuration ? (
              <LabeledInput label="Seconds" value={duration} onChange={setDuration} />
            ) : (
              <LabeledInput label="Reps" value={reps} onChange={setReps} />
            )}
            {!ex.is_bodyweight && (
              <LabeledInput label="Weight" value={weight} onChange={setWeight} />
            )}
          </View>

          {isDuration && !holdActive && (
            <Pressable style={styles.timerBtn} onPress={startDurationTimer}>
              <Ionicons name="timer-outline" size={18} color="#fff" />
              <Text style={styles.logBtnText}>
                Start {duration || re.target_duration_sec || 30}s timer
              </Text>
            </Pressable>
          )}

          <Pressable
            style={[styles.logBtn, restActive && { opacity: 0.9 }]}
            onPress={handleQuickLog}
          >
            <Ionicons name="add-circle" size={18} color="#fff" />
            <Text style={styles.logBtnText}>Log set {sets.length + 1}</Text>
          </Pressable>
        </>
      )}
    </Pressable>
  );
}

function LabeledInput({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        style={styles.input}
        placeholder="—"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  progressBar: { height: 4, backgroundColor: '#e0e0e0' },
  progressFill: { height: 4, backgroundColor: colors.success },
  progressText: { fontSize: 11, color: '#888' },
  progressRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  symptomBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: '#fff5e6', cursor: 'pointer' as any,
  },
  symptomBtnText: { color: colors.warning, fontSize: 11, fontWeight: '600' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    maxWidth: 500, alignSelf: 'center', width: '100%',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  modalLabel: { fontSize: 12, color: '#888', fontWeight: '600', marginTop: 14, marginBottom: 6 },
  modalInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10,
    fontSize: 14, marginTop: 6, backgroundColor: '#fff',
  },
  partRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  partChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#f5f6fa', borderWidth: 1, borderColor: '#eee',
    cursor: 'pointer' as any,
  },
  partChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  partChipText: { fontSize: 12, color: '#444' },
  partChipTextActive: { color: '#fff', fontWeight: '600' },
  sevRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  sevDot: {
    flex: 1, aspectRatio: 1, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer' as any,
  },
  sevNum: { fontSize: 12, color: '#666' },
  modalSaveBtn: {
    backgroundColor: colors.warning, borderRadius: 8, padding: 12,
    alignItems: 'center', marginTop: 16, cursor: 'pointer' as any,
  },
  modalSaveText: { color: '#fff', fontWeight: '700' },

  exBlock: {
    backgroundColor: '#fff', margin: 10, marginBottom: 0, borderRadius: 10, padding: 14,
    borderWidth: 2, borderColor: 'transparent',
    cursor: 'pointer' as any,
  },
  exBlockActive: { borderColor: colors.primary },
  exBlockDone: { opacity: 0.7 },

  exHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  exHeadNum: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary,
    color: '#fff', textAlign: 'center', lineHeight: 30, fontWeight: '700',
  },
  exHeadName: { fontSize: 15, fontWeight: '600', color: '#222' },
  exHeadTarget: { fontSize: 12, color: '#888', marginTop: 1 },

  activeImage: { width: '100%', height: 160, borderRadius: 6, marginTop: 12, backgroundColor: '#eee' },

  cueBox: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    backgroundColor: '#fff5e6', padding: 8, borderRadius: 6, marginTop: 10,
  },
  cueText: { flex: 1, fontSize: 12, color: '#a67c00' },

  setList: { marginTop: 12, gap: 4 },
  setRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    padding: 8, backgroundColor: '#f5f6fa', borderRadius: 6,
  },
  setRowDone: { backgroundColor: '#e8f5e9' },
  setNum: { fontSize: 13, fontWeight: '600', color: '#444' },
  setDone: { fontSize: 13, color: colors.success, fontWeight: '600' },
  setPending: { fontSize: 13, color: '#bbb' },

  inputRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  inputLabel: { fontSize: 11, color: '#888', marginBottom: 2 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8, fontSize: 14 },

  logBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8, padding: 10, marginTop: 10,
    cursor: 'pointer' as any,
  },
  logBtnText: { color: '#fff', fontWeight: '600' },
  timerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.warning, borderRadius: 8, padding: 10, marginTop: 10,
    cursor: 'pointer' as any,
  },
  timerBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff5e6', borderColor: colors.warning, borderWidth: 1,
    padding: 12, borderRadius: 8, marginTop: 12,
  },
  timerLabel: { fontSize: 11, color: colors.warning, fontWeight: '700', textTransform: 'uppercase' },
  timerValue: { flex: 1, fontSize: 28, fontWeight: '800', color: colors.warning,
    fontVariant: ['tabular-nums'] as any },
  timerStopBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ccc', cursor: 'pointer' as any },
  timerStopText: { fontSize: 12, color: '#666', fontWeight: '600' },

  finishBox: { padding: 16, marginTop: 12 },
  finishLabel: { fontSize: 13, color: '#666', marginBottom: 8, textAlign: 'center' },
  rpeRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 6 },
  rpeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  rpeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  rpeText: { fontSize: 13, color: '#666' },
  rpeTextActive: { color: '#fff', fontWeight: '700' },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee',
  },
  finishBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.success, borderRadius: 10, padding: 14,
    cursor: 'pointer' as any,
  },
  finishBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  errorBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 10, backgroundColor: '#f5f6fa',
  },
  errorTitle: { fontSize: 17, fontWeight: '700', color: '#333' },
  errorMsg: { fontSize: 14, color: '#666', textAlign: 'center', maxWidth: 320 },
  errorRetryBtn: {
    marginTop: 8, backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 20, paddingVertical: 10, cursor: 'pointer' as any,
  },
  errorRetryText: { color: '#fff', fontWeight: '700' },

  restBanner: {
    margin: 10, marginBottom: 0,
    backgroundColor: '#e3f2fd', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: colors.primary,
  },
  restTopRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  restLabel: {
    fontSize: 12, fontWeight: '700', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  restValue: {
    fontSize: 32, fontWeight: '800', color: colors.primary,
    fontVariant: ['tabular-nums'] as any,
  },
  restBar: {
    height: 4, backgroundColor: '#cfe0f7', borderRadius: 2,
    marginTop: 8, overflow: 'hidden',
  },
  restBarFill: { height: 4, backgroundColor: colors.primary },
  restBtnRow: {
    flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'space-between',
  },
  restBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: colors.primary,
    cursor: 'pointer' as any,
  },
  restBtnStop: { backgroundColor: colors.primary },
  restBtnText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
