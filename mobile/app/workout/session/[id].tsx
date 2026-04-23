import { colors } from "@/lib/colors";
import { useEffect, useRef, useState } from 'react';
import { SessionSetEditSheet } from '@/components/SessionSetEditSheet';
import { useUndoSnackbar } from '@/components/UndoSnackbar';
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
import { computePRs, toBestsMap } from '@/lib/pr';
import { drainQueue, enqueueSet, pendingCount } from '@/lib/offlineQueue';
import { kv } from '@/lib/kvStorage';

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
  // Tap a logged set → sheet opens; null when no editor is open.
  const [editingSet, setEditingSet] = useState<SessionSet | null>(null);
  const undo = useUndoSnackbar();
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
  const [priorBests, setPriorBests] = useState<Record<number, { weight: number; reps: number; duration: number }>>({});
  // Offline queue: when a set log fails with a network error (no response)
  // we stash the payload locally and retry on the next successful call.
  const [pendingSync, setPendingSync] = useState(0);
  const [draining, setDraining] = useState(false);

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
        // PRs are a nice-to-have — don't block the screen if the endpoint
        // has a hiccup. Empty bests just means every new set looks like
        // a PR, which is the right "no history yet" UX anyway.
        api.getSessionPRs(Number(id))
          .then((bests) => { if (!cancelled) setPriorBests(toBestsMap(bests)); })
          .catch(() => { if (!cancelled) setPriorBests({}); });
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

  /** Optimistic set delete via the undo snackbar.
   *
   *  Drops the row from local state immediately, then fires a 5-second
   *  snackbar. The actual DELETE hits the server only when the snackbar
   *  times out — a user who taps Undo within the window gets their row
   *  back with zero round-trips. If the timeout DELETE fails we reload
   *  so the row reappears in its real state (rare; network blip).
   */
  const handleDeleteSet = (target: SessionSet) => {
    setSession((prev) => (
      prev ? { ...prev, sets: prev.sets.filter((s) => s.id !== target.id) } : prev
    ));
    undo.show({
      message: `Set ${target.set_number} deleted`,
      // Undo = put the row back. setSession adds it back at the end;
      // the session screen groups by exercise + sorts by set_number
      // at render time so ordering restores correctly.
      onUndo: () => setSession((prev) => (
        prev ? { ...prev, sets: [...prev.sets, target] } : prev
      )),
      // Timeout = commit the DELETE. If it fails we reload so the UI
      // matches server truth rather than leaving a ghost-deleted row.
      onTimeout: () => {
        api.deleteSet(target.id).catch(() => {
          reload();
        });
      },
    });
  };

  const logInFlight = useRef(false);

  // Load pending-sync count on mount so a session resumed after a
  // crash / reload still shows the queue.
  useEffect(() => {
    if (!session?.id) return;
    pendingCount(kv, session.id).then(setPendingSync).catch(() => {});
  }, [session?.id]);

  const drain = async () => {
    if (!session || draining) return;
    setDraining(true);
    try {
      const result = await drainQueue(kv, async (q) => {
        if (q.session_id !== session.id) return; // belongs to a different session
        await api.logSet(session.id, q.payload);
      });
      if (result.sent > 0) {
        await reload();
      }
      setPendingSync(await pendingCount(kv, session.id));
    } finally {
      setDraining(false);
    }
  };

  const handleLogSet = async (re: RoutineExercise, payload: Partial<SessionSet>) => {
    if (!session || logInFlight.current) return;
    logInFlight.current = true;
    const body = {
      exercise_id: re.exercise_id,
      reps: payload.reps,
      duration_sec: payload.duration_sec,
      weight: payload.weight,
      rpe: payload.rpe,
      // pain_score flows through only when the session tracks symptoms;
      // the server guards the insert against tracks_symptoms=false (see
      // session_routes.log_set) but we also drop it client-side so it
      // isn't sent for strength sessions.
      pain_score: session.tracks_symptoms ? (payload.pain_score ?? undefined) : undefined,
      side: payload.side ?? undefined,
      is_warmup: payload.is_warmup ?? undefined,
    };
    try {
      // Server assigns set_number atomically; don't send one from the client
      // to avoid stale-closure races on double-tap.
      await api.logSet(session.id, body);
      haptics.bump();
      await reload();
      // We're back online — flush anything that queued while offline.
      if (pendingSync > 0) drain();
    } catch (e) {
      const hasResponse = Boolean((e as { response?: unknown })?.response);
      if (!hasResponse) {
        // Network error: stash the set so it's not lost. The user gets
        // a subtle "N pending sync" chip instead of a failure alert.
        await enqueueSet(kv, session.id, body);
        setPendingSync(await pendingCount(kv, session.id));
        haptics.warning();
      } else {
        haptics.error();
        showError('Set not saved', describeApiError(e, 'Could not log that set.'));
      }
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

  const visibleExercises = routine.exercises;
  const totalSets = visibleExercises.reduce((sum, re) => sum + (re.target_sets ?? 1), 0);
  const doneSets = session.sets.length;
  const pct = totalSets > 0 ? Math.min(100, (doneSets / totalSets) * 100) : 0;

  // Running-best PR detection. Sort by id so the walk is chronological
  // regardless of how the API hydrates the set list.
  const chronologicalSets = [...session.sets].sort((a, b) => a.id - b.id);
  const prIds = computePRs(priorBests, chronologicalSets);
  const prCount = prIds.size;

  return (
    <View style={styles.container}>
      {/* The header back action doesn't discard the session — the server
          keeps it open until Finish. "Cancel" implied deletion; "Back"
          matches what actually happens. */}
      <Stack.Screen options={{ title: routine.name, headerBackTitle: 'Back' }} />

      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>{doneSets} / {totalSets} sets</Text>
        <View style={styles.progressRowRight}>
          {pendingSync > 0 && (
            <Pressable
              style={styles.pendingChip}
              onPress={drain}
              disabled={draining}
              accessibilityRole="button"
              accessibilityLabel={`${pendingSync} set${pendingSync === 1 ? '' : 's'} pending sync. Tap to retry.`}
            >
              <Ionicons
                name={draining ? 'sync' : 'cloud-offline-outline'}
                size={12} color={colors.danger}
              />
              <Text style={styles.pendingChipText}>
                {draining ? 'Syncing…' : `${pendingSync} pending`}
              </Text>
            </Pressable>
          )}
          {/* Only rehab sessions get the symptom logger. Strength
              sessions (the default) never see the button — cleaner UI
              and no stray symptom rows on non-rehab workouts. See
              PR #47 for the snapshot semantics. */}
          {session.tracks_symptoms && (
            <Pressable
              style={styles.symptomBtn}
              onPress={() => setSymptomOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Log symptom${symptomCount > 0 ? `, ${symptomCount} already logged` : ''}`}
            >
              <Ionicons name="pulse-outline" size={14} color={colors.warning} />
              <Text style={styles.symptomBtnText}>
                Log symptom{symptomCount > 0 ? ` (${symptomCount})` : ''}
              </Text>
            </Pressable>
          )}
        </View>
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
        {visibleExercises.map((re, idx) => (
          <ExerciseBlock
            key={re.id}
            re={re}
            idx={idx}
            isActive={idx === activeIdx}
            sets={session.sets.filter((s) => s.exercise_id === re.exercise_id)}
            suggestion={suggestions.find((sg) => sg.routine_exercise_id === re.id)}
            prIds={prIds}
            tracksSymptoms={Boolean(session.tracks_symptoms)}
            onActivate={() => setActiveIdx(idx)}
            onLog={(payload) => handleLogSet(re, payload)}
            onAdvance={() => setActiveIdx(Math.min(visibleExercises.length - 1, idx + 1))}
            onRestRequest={rest.start}
            restActive={rest.active}
            onEditSet={setEditingSet}
          />
        ))}

        {prCount > 0 && (
          <View style={styles.prSummary} accessibilityLabel={`${prCount} new personal records this workout`}>
            <Ionicons name="trophy" size={18} color={colors.success} />
            <Text style={styles.prSummaryText}>
              {prCount} new PR{prCount === 1 ? '' : 's'} this workout
            </Text>
          </View>
        )}

        <View style={styles.finishBox}>
          <Text style={styles.finishLabel}>Rate of Perceived Exertion (1–10)</Text>
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
              accessibilityLabel="Custom body part"
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
              accessibilityLabel="Symptom notes"
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

      {editingSet && (
        <SessionSetEditSheet
          set={editingSet}
          measurement={
            routine?.exercises.find((re) => re.exercise_id === editingSet.exercise_id)?.exercise?.measurement
              ?? 'reps'
          }
          tracksSymptoms={Boolean(session.tracks_symptoms)}
          onClose={() => setEditingSet(null)}
          onSaved={() => { reload(); }}
          onDeleted={handleDeleteSet}
        />
      )}
    </View>
  );
}

const SYMPTOM_PARTS = [
  'right_big_toe', 'right_calf', 'right_hip',
  'left_calf', 'lower_back', 'right_knee',
];

function ExerciseBlock({
  re, idx, isActive, sets, suggestion, prIds, tracksSymptoms,
  onActivate, onLog, onAdvance,
  onRestRequest, restActive, onEditSet,
}: {
  re: RoutineExercise;
  idx: number;
  isActive: boolean;
  sets: SessionSet[];
  suggestion?: api.RoutineSuggestion;
  prIds: Set<number>;
  /** When true (rehab session), a Pain input appears in the log row and
   *  its value is sent with each logged set. Otherwise the field stays
   *  hidden and pain_score is never collected at log time. */
  tracksSymptoms: boolean;
  onActivate: () => void;
  onLog: (payload: Partial<SessionSet>) => Promise<void>;
  onAdvance: () => void;
  onRestRequest: (seconds: number) => void;
  restActive: boolean;
  /** Tap-row-to-edit handler. Undefined = rows render non-tappable
   *  (parent screen's responsibility — e.g., a read-only finished
   *  session view). */
  onEditSet?: (set: SessionSet) => void;
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
  // RPE is always logged when the user taps one; pain is only logged
  // on rehab sessions (tracksSymptoms). null clears to undefined so
  // the server-side sparse-update semantics apply.
  const [rpe, setRpe] = useState<number | null>(null);
  const [pain, setPain] = useState('');
  // Per-set laterality. null = bilateral (historical default). A two-
  // state toggle rather than three buttons because the most common
  // flow is "left, log, right, log" — cycling through a single button
  // is one tap between sides.
  const [side, setSide] = useState<'left' | 'right' | null>(null);
  // Warmup toggle. When on, the set is excluded from progression +
  // volume. Resets to off after each log so a user who adds a warmup
  // at the start of an exercise doesn't accidentally tag real working
  // sets as warmup too.
  const [isWarmup, setIsWarmup] = useState(false);

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
      rpe: rpe ?? undefined,
      pain_score: tracksSymptoms && pain ? Number(pain) : undefined,
      side: side ?? undefined,
      is_warmup: isWarmup || undefined,
    });
    // Clear the once-per-set fields so the next set starts blank. Reps /
    // weight / duration are persistent across sets (they tend to repeat);
    // RPE + pain + warmup genuinely change set-to-set. Side is kept
    // sticky across logs because the "L then R" rhythm usually wants
    // the user to advance side themselves, not auto-flip on log.
    setRpe(null);
    setPain('');
    setIsWarmup(false);
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
              const isPR = !!(s && prIds.has(s.id));
              // Logged sets are tappable — whole row opens the edit
              // sheet (no pencil icon; the row itself is the affordance).
              // Pending placeholders stay as inert text.
              if (!s) {
                return (
                  <View key={i} style={styles.setRow}>
                    <Text style={styles.setNum}>Set {i + 1}</Text>
                    <Text style={styles.setPending}>pending</Text>
                  </View>
                );
              }
              return (
                <Pressable
                  key={i}
                  style={({ pressed }) => [
                    styles.setRow, styles.setRowDone,
                    isPR && styles.setRowPR,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => onEditSet?.(s)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `Edit set ${i + 1}: ${s.reps ? `${s.reps} reps` :
                      s.duration_sec ? `${s.duration_sec} seconds` : 'no result'}`
                  }
                >
                  <Text style={styles.setNum}>Set {i + 1}</Text>
                  <View style={styles.setRightCol}>
                    {isPR && (
                      <View style={styles.prBadge} accessibilityLabel="New personal record">
                        <Ionicons name="trophy" size={11} color="#fff" />
                        <Text style={styles.prBadgeText}>PR</Text>
                      </View>
                    )}
                    {s.side && (
                      <View style={styles.sideTag} accessibilityLabel={`${s.side} side`}>
                        <Text style={styles.sideTagText}>{s.side === 'left' ? 'L' : 'R'}</Text>
                      </View>
                    )}
                    {s.is_warmup && (
                      <View style={styles.warmupTag} accessibilityLabel="Warmup set">
                        <Ionicons name="flame" size={10} color="#fff" />
                        <Text style={styles.warmupTagText}>WU</Text>
                      </View>
                    )}
                    <Text style={styles.setDone}>
                      {s.reps ? `${s.reps} reps` : s.duration_sec ? `${s.duration_sec}s` : '—'}
                      {s.weight ? ` @${s.weight}` : ''}
                    </Text>
                  </View>
                </Pressable>
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

          {/* RPE tile picker — always shown. Pain text input only on rehab.
              Both clear after each set logged (unlike reps/weight which
              persist across sets since they tend to repeat). */}
          <View style={styles.setRpeSection}>
            <Text style={styles.setRpeLabel}>RPE</Text>
            <View style={styles.setRpeRow}>
              {[1,2,3,4,5,6,7,8,9,10].map((n) => (
                <Pressable
                  key={n}
                  style={[styles.setRpeBtn, rpe === n && styles.setRpeBtnActive]}
                  onPress={() => setRpe(rpe === n ? null : n)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: rpe === n }}
                  accessibilityLabel={`RPE ${n}`}
                >
                  <Text style={[styles.setRpeText, rpe === n && styles.setRpeTextActive]}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {tracksSymptoms && (
            <View style={styles.inputRow}>
              <LabeledInput label="Pain (0–10)" value={pain} onChange={setPain} />
            </View>
          )}

          {/* Per-set flags: L/R for unilateral work, warmup toggle. Both
              compact pills rather than full rows because they're
              occasional switches, not per-set entries like RPE. */}
          <View style={styles.flagsRow}>
            <View style={styles.sideGroup}>
              <Pressable
                style={[styles.sideBtn, side === 'left' && styles.sideBtnOn]}
                onPress={() => setSide(side === 'left' ? null : 'left')}
                accessibilityRole="button"
                accessibilityLabel={side === 'left' ? 'Left side selected. Tap to clear.' : 'Tag set as left side'}
                accessibilityState={{ selected: side === 'left' }}
                hitSlop={6}
              >
                <Text style={side === 'left' ? styles.sideTextOn : styles.sideText}>L</Text>
              </Pressable>
              <Pressable
                style={[styles.sideBtn, side === 'right' && styles.sideBtnOn]}
                onPress={() => setSide(side === 'right' ? null : 'right')}
                accessibilityRole="button"
                accessibilityLabel={side === 'right' ? 'Right side selected. Tap to clear.' : 'Tag set as right side'}
                accessibilityState={{ selected: side === 'right' }}
                hitSlop={6}
              >
                <Text style={side === 'right' ? styles.sideTextOn : styles.sideText}>R</Text>
              </Pressable>
            </View>
            <Pressable
              style={[styles.warmupChip, isWarmup && styles.warmupChipOn]}
              onPress={() => setIsWarmup((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: isWarmup }}
              accessibilityLabel="Mark next set as warmup"
              accessibilityHint="Warmup sets are excluded from volume and progression suggestions"
              hitSlop={6}
            >
              <Ionicons
                name={isWarmup ? 'flame' : 'flame-outline'}
                size={12}
                color={isWarmup ? '#fff' : colors.textMuted}
              />
              <Text style={isWarmup ? styles.warmupTextOn : styles.warmupText}>Warmup</Text>
            </Pressable>
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
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  progressBar: { height: 4, backgroundColor: '#e0e0e0' },
  progressFill: { height: 4, backgroundColor: colors.success },
  progressText: { fontSize: 11, color: colors.textMuted },
  progressRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  progressRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  symptomBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: '#fff5e6', cursor: 'pointer' as any,
  },
  symptomBtnText: { color: colors.warning, fontSize: 11, fontWeight: '600' },
  pendingChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: '#fdecea', borderWidth: 1, borderColor: colors.danger,
    cursor: 'pointer' as any,
  },
  pendingChipText: { color: colors.danger, fontSize: 11, fontWeight: '700' },

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
  modalLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginTop: 14, marginBottom: 6 },
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
  exHeadTarget: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

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
  inputLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8, fontSize: 14 },

  // Per-set flag row: L/R toggle + warmup pill. Sits between the
  // numeric inputs and the Log button so it's scanned with the set,
  // not the exercise.
  flagsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  sideGroup: {
    flexDirection: 'row', borderRadius: 6, overflow: 'hidden',
    borderWidth: 1, borderColor: '#ddd',
  },
  sideBtn: {
    minWidth: 36, paddingHorizontal: 10, paddingVertical: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fafafa', cursor: 'pointer' as any,
  },
  sideBtnOn: { backgroundColor: colors.primary },
  sideText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  sideTextOn: { fontSize: 13, fontWeight: '700', color: '#fff' },
  warmupChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#ddd',
    cursor: 'pointer' as any,
  },
  warmupChipOn: { backgroundColor: colors.warning, borderColor: colors.warning },
  warmupText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  warmupTextOn: { fontSize: 12, fontWeight: '700', color: '#fff' },

  // Tags on logged-set rows so the user can see at a glance which were
  // warmups and which were L/R. Small pills, muted on purpose — the
  // reps/weight value is still the dominant read.
  sideTag: {
    backgroundColor: '#dce4f4', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, marginRight: 4,
  },
  sideTagText: { fontSize: 10, fontWeight: '800', color: colors.primary },
  warmupTag: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: colors.warning, paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 4, marginRight: 4,
  },
  warmupTagText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },

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

  setRpeSection: { marginTop: 4, marginBottom: 4 },
  setRpeLabel: { fontSize: 11, color: '#888', fontWeight: '600', marginBottom: 4 },
  setRpeRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  setRpeBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  setRpeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  setRpeText: { fontSize: 12, color: '#666' },
  setRpeTextActive: { color: '#fff', fontWeight: '700' },

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

  setRowPR: { backgroundColor: '#fff7d6', borderWidth: 1, borderColor: '#f4c842' },
  setRightCol: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#e67e22',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  prBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  prSummary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 10, marginTop: 14, padding: 12,
    backgroundColor: '#e8f5e9', borderRadius: 10,
    borderWidth: 1, borderColor: colors.success,
  },
  prSummaryText: { color: colors.success, fontWeight: '700', fontSize: 14 },
});
