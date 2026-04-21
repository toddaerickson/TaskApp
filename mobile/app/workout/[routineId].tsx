import { colors } from "@/lib/colors";
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Image, Pressable, StyleSheet, ActivityIndicator, Platform, TextInput, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Routine, RoutineExercise, Exercise } from '@/lib/stores';
import { DAYS, parseDays, daysCsv, DayCode } from '@/lib/reminders';
import { getActivePhaseInfo, filterExercisesForPhase } from '@/lib/phases';
import { PhaseEditor } from '@/components/PhaseEditor';
import { ExercisePhaseChip } from '@/components/ExercisePhaseChip';
import { ExercisePickerModal } from '@/components/ExercisePickerModal';
import { EditField } from '@/components/EditField';
import { useUndoSnackbar } from '@/components/UndoSnackbar';
import ImageSearchModal from '@/components/ImageSearchModal';
import ErrorCard from '@/components/ErrorCard';
import * as api from '@/lib/api';
import { describeApiErrorDetailed } from '@/lib/apiErrors';
import { tokenizeDose, DoseTokenKind } from '@/lib/doseTokens';

/** Two-choice conflict prompt. Resolves with the user's decision rather
 *  than blocking state. Web uses confirm() because there's no native
 *  modal affordance we share; iOS/Android get a proper destructive
 *  Alert.alert with distinct labels. */
function askConflict(label: string): Promise<'overwrite' | 'reload'> {
  return new Promise((resolve) => {
    const msg = `The ${label} changed since you loaded it. Overwrite your changes would replace the newer version. Reload discards yours.`;
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      const overwrite = window.confirm(`${msg}\n\nOK = Overwrite anyway. Cancel = Discard & reload.`);
      resolve(overwrite ? 'overwrite' : 'reload');
    } else {
      Alert.alert(`This ${label} changed`, msg, [
        { text: 'Discard & reload', style: 'cancel', onPress: () => resolve('reload') },
        { text: 'Overwrite anyway', style: 'destructive', onPress: () => resolve('overwrite') },
      ]);
    }
  });
}

function isConflict(err: unknown): err is { response: { status: 409 } } {
  const e = err as { response?: { status?: number } };
  return e?.response?.status === 409;
}

/** Yes/no confirm dialog for destructive actions. Mirrors the shape in
 *  PhaseEditor.tsx — same web-vs-native split — kept inline here
 *  instead of importing because the two consumers have different
 *  button labels and a shared util would need extra params. */
function confirmDestructive(title: string, message: string, destructiveLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: destructiveLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function RoutineDetailScreen() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  const router = useRouter();
  const undo = useUndoSnackbar();
  const [routine, setRoutine] = useState<Routine | null>(null);
  // Tri-state fetch: null + no error = still loading; string = fetch failed;
  // set routine = loaded. Previous single-state logic left a spinner
  // running forever on direct-URL / refresh when getRoutine rejected
  // (404 for a stale id, 401 after token expiry, network blip on mobile).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<api.RoutineSuggestion[]>([]);

  const reload = useCallback(() => {
    if (!routineId) return;
    const id = Number(routineId);
    setLoadError(null);
    api.getRoutine(id)
      .then(setRoutine)
      .catch((e) => {
        console.warn('[routine] getRoutine failed:', e);
        setLoadError(describeApiErrorDetailed(e, 'Could not load this routine.'));
      });
    // Suggestions are best-effort — a failure here is not a screen-level
    // error, it just means the "Next: …" hint row doesn't render.
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

  const deleteRoutineExercise = (reId: number) => {
    if (!routine) return;
    const idx = routine.exercises.findIndex((re) => re.id === reId);
    if (idx === -1) return;
    const target = routine.exercises[idx];
    const name = target.exercise?.name ?? 'Exercise';
    // Optimistic drop. We filter the row out of the local list so the
    // user sees it disappear immediately; the real DELETE fires only if
    // the 5-second undo window elapses without a tap. Undo reinserts
    // at the original index so ordering is lossless.
    setRoutine((prev) => (
      prev ? { ...prev, exercises: prev.exercises.filter((re) => re.id !== reId) } : prev
    ));
    undo.show({
      message: `${name} removed`,
      onUndo: () => setRoutine((prev) => {
        if (!prev) return prev;
        const next = [...prev.exercises];
        // Clamp the insert index in case exercises shifted after remove
        // (e.g. a reorder raced with the undo window). Worst case the
        // row lands at the end — still preserves presence.
        const pos = Math.min(idx, next.length);
        next.splice(pos, 0, target);
        return { ...prev, exercises: next };
      }),
      onTimeout: () => {
        api.removeExerciseFromRoutine(reId).catch(() => reload());
      },
    });
  };

  const handlePickExercise = async (exercise: Exercise) => {
    if (!routine) return;
    // Close the picker before the network call so the spinner that
    // re-fetches the routine is visible immediately; the modal's own
    // state resets on close.
    setPickerOpen(false);
    try {
      await api.addExerciseToRoutine(routine.id, {
        exercise_id: exercise.id,
        sort_order: routine.exercises.length,
      });
      reload();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Failed to add exercise';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Could not add exercise', msg);
    }
  };

  const handleDeleteRoutine = async () => {
    if (!routine) return;
    const exCount = routine.exercises.length;
    const body = `This removes "${routine.name}", its phases${
      exCount ? `, and detaches ${exCount} exercise${exCount === 1 ? '' : 's'}` : ''
    }. Session history stays; exercises themselves remain in your library.`;
    // Keep the hard confirm — deleting a whole routine is a bigger
    // blast radius than dropping one exercise, and an accidental tap
    // on the red "Delete routine" button at the bottom of the edit
    // panel should still require an explicit yes.
    const ok = await confirmDestructive(`Delete "${routine.name}"?`, body, 'Delete');
    if (!ok) return;
    // Capture locals before we navigate away: `routine` is about to go
    // out of scope for the snackbar callbacks because this screen
    // unmounts on router.replace(). Rename to avoid shadowing the
    // useLocalSearchParams binding above.
    const deletedRoutineId = routine.id;
    const deletedRoutineName = routine.name;
    // Navigate back to the list immediately so the user sees the
    // routine disappear from the tab. We have NOT hit the DELETE API
    // yet — the snackbar's onTimeout is the actual commit point.
    // Undo = do nothing on the server; the workouts tab's
    // useFocusEffect refetch will pick the routine back up on its
    // next focus cycle. If the timeout-commit fails the workouts tab
    // refetches on focus anyway, so the row reappears in its real
    // state rather than being a ghost.
    router.replace('/(tabs)/workouts');
    undo.show({
      message: `"${deletedRoutineName}" deleted`,
      onTimeout: () => {
        api.deleteRoutine(deletedRoutineId).catch((e: any) => {
          const msg = e?.response?.data?.detail || e?.message || 'Failed to delete routine';
          if (Platform.OS === 'web') window.alert(msg);
          else Alert.alert('Could not delete', msg);
        });
      },
    });
  };

  const handleStart = async () => {
    if (!routine || starting) return;
    setStarting(true);
    try {
      const session = await api.startSession(routine.id);
      router.replace(`/workout/session/${session.id}`);
    } catch (e) {
      // Previously this catch surfaced only a generic "Failed to start"
      // when the server response had no `detail`, which threw away the
      // HTTP status and the request_id the backend emits (see main.py's
      // uniform error shape). The resulting Safari alert told the user
      // nothing and gave us nothing to correlate with server logs.
      // describeApiErrorDetailed prepends "HTTP {status}" and appends
      // "(req {id})" when either is present, so the next failure mode
      // report is actionable — CORS, 5xx, or EXPO_PUBLIC_API_URL misconfig.
      const msg = describeApiErrorDetailed(e, 'Failed to start session.');
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Could not start', msg);
    } finally {
      setStarting(false);
    }
  };

  const handleClone = async () => {
    if (!routine) return;
    try {
      const clone = await api.cloneRoutine(routine.id);
      // Navigate straight into the clone in edit mode so the user can
      // rename it without an extra tap. Use replace so the back button
      // jumps to the list, not back to the source routine.
      router.replace(`/workout/${clone.id}`);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Failed to clone routine';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Could not clone', msg);
    }
  };

  if (loadError) {
    // Previously a failed getRoutine left `routine` null and rendered the
    // spinner below forever — direct URL + stale / revoked / bad-id paths
    // all looked like an infinite loading state. ErrorCard gives the
    // user a retry affordance and surfaces the server's status + request
    // id for debugging.
    return (
      <>
        <Stack.Screen options={{ title: 'Routine' }} />
        <ErrorCard
          title="Couldn't load this routine"
          msg={loadError}
          retry={reload}
        />
      </>
    );
  }
  if (!routine) {
    return <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />;
  }

  // Phase-aware view. On a flat routine (no phases or no start date) this
  // reduces to routine.exercises and activePhase is null — the banner
  // isn't rendered and nothing about the old behavior changes.
  const activePhase = getActivePhaseInfo(routine);
  // In edit mode we show every exercise — otherwise the user couldn't see
  // or reassign an exercise that belongs to a different (non-active)
  // phase. Run mode keeps the phase filter for the banner-matched view.
  const visibleExercises = editMode
    ? routine.exercises
    : filterExercisesForPhase(routine.exercises, routine.current_phase_id ?? null);

  const totalMins = Math.round(
    visibleExercises.reduce((sum, re) => {
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
              // Labeled pill replaces the previous icon-only pencil. Users
              // who tapped a "Quick start" template and landed here couldn't
              // find where to customize the routine — the unlabeled 22px
              // icon on the colored header didn't read as a button. 44×44
              // minimum tap target is met via padding + hitSlop.
              style={({ pressed }) => [
                styles.headerEditBtn,
                editMode && styles.headerEditBtnActive,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={editMode ? 'Done editing routine' : 'Edit routine'}
              hitSlop={8}
            >
              <Ionicons
                name={editMode ? 'checkmark' : 'create-outline'}
                size={16} color="#fff"
              />
              <Text style={styles.headerEditText}>{editMode ? 'Done' : 'Edit'}</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={
          // The absolute-positioned footer's CTA is ~82px tall; add the iOS
          // home-indicator inset on web so the last exercise card stays
          // scrollable past the green Start button on iPhones. Cast through
          // any because RN types reject the CSS string, but RN-web forwards
          // it to the DOM verbatim.
          Platform.OS === 'web'
            ? ({ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' } as any)
            : { paddingBottom: 120 }
        }
      >
        {editMode ? (
          <RoutineHeaderEdit routine={routine} onSaved={reload} />
        ) : (
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{routine.name}</Text>
              {routine.tracks_symptoms && (
                <View
                  style={styles.rehabBadge}
                  accessibilityLabel="Rehab routine: tracking pain and symptoms"
                >
                  <Ionicons name="pulse-outline" size={10} color="#fff" />
                  <Text style={styles.rehabBadgeText}>REHAB</Text>
                </View>
              )}
            </View>
            <Text style={styles.meta}>
              {visibleExercises.length} exercises · ~{totalMins} min · {routine.goal}
            </Text>
            {activePhase && (
              <View style={styles.phaseBanner}>
                <Ionicons name="flag" size={13} color={colors.primary} />
                <Text style={styles.phaseBannerText}>
                  Phase {activePhase.position}/{activePhase.total}: {activePhase.phase.label}
                  {' · '}
                  <Text style={styles.phaseBannerDays}>
                    {activePhase.daysLeft === 0
                      ? 'final day'
                      : `${activePhase.daysLeft} day${activePhase.daysLeft === 1 ? '' : 's'} left`}
                  </Text>
                </Text>
              </View>
            )}
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

        {visibleExercises.map((re, idx) => {
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
                        <Text style={styles.keystoneBadgeText}>PRIORITY</Text>
                      </View>
                    )}
                  </View>
                  <InlineDoseRow re={re} readOnly={editMode} onSaved={reload} />
                  {editMode && (routine.phases?.length ?? 0) > 0 && (
                    <View style={{ marginTop: 6 }}>
                      <ExercisePhaseChip
                        routineExerciseId={re.id}
                        currentPhaseId={re.phase_id ?? null}
                        phases={routine.phases ?? []}
                        onChanged={reload}
                      />
                    </View>
                  )}
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
                    <Pressable
                      onPress={() => moveExercise(idx, -1)}
                      disabled={idx === 0}
                      style={styles.ctrlBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${re.exercise?.name ?? 'exercise'} up`}
                      accessibilityState={{ disabled: idx === 0 }}
                    >
                      <Ionicons name="chevron-up" size={18} color={idx === 0 ? '#ccc' : colors.primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => moveExercise(idx, 1)}
                      disabled={idx === routine.exercises.length - 1}
                      style={styles.ctrlBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${re.exercise?.name ?? 'exercise'} down`}
                      accessibilityState={{ disabled: idx === routine.exercises.length - 1 }}
                    >
                      <Ionicons
                        name="chevron-down" size={18}
                        color={idx === routine.exercises.length - 1 ? '#ccc' : colors.primary}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => deleteRoutineExercise(re.id)}
                      style={styles.ctrlBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${re.exercise?.name ?? 'exercise'} from routine`}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </Pressable>
                  </View>
                )}
              </View>

              {editMode && <RoutineExerciseEdit re={re} ex={ex} onSaved={reload} />}

              {/* Read-mode only: edit mode renders its own managed image
                  row (with trash + Add/Change button) inside the panel. */}
              {!editMode && ex.images.length > 0 && (
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

        {editMode && (
          <>
            <Pressable
              style={({ pressed }) => [styles.addExerciseBtn, pressed && { opacity: 0.7 }]}
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add exercise to routine"
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.addExerciseText}>Add exercise</Text>
            </Pressable>
            {/* Clone: deep-copies this routine into a fresh "(copy)"
                template. Navigates straight into the clone in edit mode
                so the user can rename it without an extra tap. Lives
                above Delete to separate additive actions from the
                destructive one. */}
            <Pressable
              style={({ pressed }) => [styles.cloneRoutineBtn, pressed && { opacity: 0.7 }]}
              onPress={handleClone}
              accessibilityRole="button"
              accessibilityLabel={`Duplicate routine ${routine.name}`}
            >
              <Ionicons name="copy-outline" size={18} color={colors.primary} />
              <Text style={styles.cloneRoutineText}>Duplicate routine</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.deleteRoutineBtn, pressed && { opacity: 0.7 }]}
              onPress={handleDeleteRoutine}
              accessibilityRole="button"
              accessibilityLabel={`Delete routine ${routine.name}`}
            >
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={styles.deleteRoutineText}>Delete routine</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <ExercisePickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePickExercise}
      />

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

function RoutineHeaderEdit({ routine, onSaved }: { routine: Routine; onSaved: () => void }) {
  const [name, setName] = useState(routine.name);
  const [notes, setNotes] = useState(routine.notes || '');
  const [time, setTime] = useState(routine.reminder_time || '');
  const [days, setDays] = useState<Set<DayCode>>(parseDays(routine.reminder_days));
  const [startDate, setStartDate] = useState(routine.phase_start_date || '');
  // Per-routine rehab flag. Sessions started from this routine snapshot
  // the value at POST time (see PR #47) — flipping it in-flight doesn't
  // mutate running sessions. Future sessions honor the new state.
  const [tracksSymptoms, setTracksSymptoms] = useState(!!routine.tracks_symptoms);
  const [busy, setBusy] = useState(false);

  const dirty = name !== routine.name
    || notes !== (routine.notes || '')
    || time !== (routine.reminder_time || '')
    || daysCsv(days) !== (routine.reminder_days || null)
    || (startDate || null) !== (routine.phase_start_date || null)
    || tracksSymptoms !== !!routine.tracks_symptoms;

  const toggleDay = (d: DayCode) => {
    const next = new Set(days);
    if (next.has(d)) next.delete(d); else next.add(d);
    setDays(next);
  };

  const save = async (overwrite = false) => {
    setBusy(true);
    try {
      const body: api.RoutineUpdatePayload = {
        name, notes,
        reminder_time: time.trim() || null,
        reminder_days: time.trim() ? daysCsv(days) : null,
        phase_start_date: startDate.trim() || null,
        tracks_symptoms: tracksSymptoms,
      };
      // Pass the token we read with the routine. Omit when `overwrite`
      // is true so the server drops the check — this is the "overwrite
      // anyway" branch of the conflict modal.
      if (!overwrite && routine.updated_at) body.expected_updated_at = routine.updated_at;
      await api.updateRoutine(routine.id, body);
      onSaved();
    } catch (e) {
      if (isConflict(e)) {
        const choice = await askConflict('routine');
        if (choice === 'reload') {
          onSaved();
        } else {
          await save(true);
        }
      } else {
        throw e;
      }
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.header}>
      <Text style={styles.fieldLabel}>Routine name</Text>
      <TextInput value={name} onChangeText={setName} style={styles.fieldInput} accessibilityLabel="Routine name" />
      <Text style={styles.fieldLabel}>Notes</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top' }]}
        accessibilityLabel="Routine notes"
      />
      <Text style={styles.fieldLabel}>Reminder time (HH:MM, blank = off)</Text>
      <TextInput
        value={time}
        onChangeText={setTime}
        placeholder="07:00"
        accessibilityLabel="Reminder time, HH colon MM format"
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
      <Text style={styles.fieldLabel}>Phase start date (YYYY-MM-DD, blank = not phased)</Text>
      <TextInput
        value={startDate}
        onChangeText={setStartDate}
        placeholder="2026-04-20"
        accessibilityLabel="Phase start date in ISO YYYY-MM-DD format"
        autoCapitalize="none"
        style={styles.fieldInput}
      />
      {/* Rehab-mode switch. Two-state Pressable chip (matches the
          day-of-week chips above) rather than a native Switch to stay
          platform-consistent and skip a new dep. The save body
          includes tracks_symptoms in every PUT so the server picks
          up either flip. */}
      <Text style={styles.fieldLabel}>Rehab routine</Text>
      <Pressable
        onPress={() => setTracksSymptoms((v) => !v)}
        style={[styles.rehabToggle, tracksSymptoms && styles.rehabToggleOn]}
        accessibilityRole="switch"
        accessibilityState={{ checked: tracksSymptoms }}
        accessibilityLabel="Track pain and symptoms in this routine"
        accessibilityHint="When on, sessions started from this routine show the symptom logger and Silbernagel-style advance/hold/back-off suggestions"
      >
        <Ionicons
          name={tracksSymptoms ? 'checkmark-circle' : 'ellipse-outline'}
          size={18}
          color={tracksSymptoms ? '#fff' : colors.textMuted}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rehabToggleText, tracksSymptoms && styles.rehabToggleTextOn]}>
            {tracksSymptoms ? 'Tracking pain and symptoms' : 'Track pain and symptoms'}
          </Text>
          <Text style={[styles.rehabToggleHint, tracksSymptoms && styles.rehabToggleHintOn]}>
            Pain chip per set · pain-monitored advance/hold/back-off
          </Text>
        </View>
      </Pressable>
      <Pressable
        style={[styles.saveBtn, (!dirty || busy) && { opacity: 0.5 }]}
        onPress={() => save()}
        disabled={!dirty || busy}
      >
        <Ionicons name="save-outline" size={14} color="#fff" />
        <Text style={styles.saveText}>{busy ? 'Saving…' : dirty ? 'Save' : 'No changes'}</Text>
      </Pressable>
      {/* Phase editor lives below the main save button because its
          operations hit the phase CRUD endpoints directly (each add /
          edit / reorder / delete is its own round trip), so it doesn't
          participate in the routine-level Save flow above. */}
      <PhaseEditor routine={routine} onChanged={onSaved} />
    </View>
  );
}

function RoutineExerciseEdit({
  re, ex, onSaved,
}: {
  re: RoutineExercise;
  ex: Exercise;
  onSaved: () => void;
}) {
  const [sets, setSets] = useState(String(re.target_sets ?? ''));
  const [reps, setReps] = useState(String(re.target_reps ?? ''));
  const [dur, setDur] = useState(String(re.target_duration_sec ?? ''));
  const [rest, setRest] = useState(String(re.rest_sec ?? ''));
  const [tempo, setTempo] = useState(re.tempo ?? '');
  const [notes, setNotes] = useState(re.notes ?? '');
  const [keystone, setKeystone] = useState(!!re.keystone);
  const [busy, setBusy] = useState(false);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);

  const deleteImage = async (imageId: number) => {
    if (Platform.OS === 'web' && !window.confirm('Remove image?')) return;
    try {
      await api.deleteExerciseImage(imageId);
      onSaved();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Failed to delete image');
    }
  };

  const save = async (overwrite = false) => {
    setBusy(true);
    try {
      const body: api.RoutineExerciseUpdatePayload = {
        target_sets: sets ? Number(sets) : null,
        target_reps: reps ? Number(reps) : null,
        target_duration_sec: dur ? Number(dur) : null,
        rest_sec: rest ? Number(rest) : null,
        tempo: tempo || null,
        notes: notes || null,
        keystone,
      };
      if (!overwrite && re.updated_at) body.expected_updated_at = re.updated_at;
      await api.updateRoutineExercise(re.id, body);
      onSaved();
    } catch (e) {
      if (isConflict(e)) {
        const choice = await askConflict('exercise');
        if (choice === 'reload') {
          onSaved();
        } else {
          await save(true);
        }
      } else {
        throw e;
      }
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
          <Text style={styles.fieldLabel}>Priority</Text>
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
        accessibilityLabel="Exercise notes"
      />
      <Pressable
        style={[styles.saveBtn, busy && { opacity: 0.5 }]}
        onPress={() => save()}
        disabled={busy}
      >
        <Ionicons name="save-outline" size={14} color="#fff" />
        <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text>
      </Pressable>

      {/* Image management. In edit mode the user expects inline affordances
          for everything about the exercise, including its images. Previously
          this required detouring through Settings → Exercise library. */}
      <Text style={styles.fieldLabel}>Images</Text>
      {ex.images.length > 0 ? (
        <ScrollView horizontal style={styles.editImageRow} showsHorizontalScrollIndicator={false}>
          {ex.images.map((img) => (
            <View key={img.id} style={styles.editImageWrap}>
              <Image source={{ uri: img.url }} style={styles.editImageThumb} resizeMode="cover" />
              <Pressable
                style={styles.editImageTrash}
                onPress={() => deleteImage(img.id)}
                accessibilityRole="button"
                accessibilityLabel="Remove this image"
                hitSlop={6}
              >
                <Ionicons name="close" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.editImageEmpty}>No image yet.</Text>
      )}
      <Pressable
        style={[
          styles.editImageFindBtn,
          ex.images.length === 0 && styles.editImageFindBtnEmpty,
        ]}
        onPress={() => setImageSearchOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={ex.images.length === 0 ? 'Add image' : 'Find another image'}
      >
        <Ionicons
          name="sparkles"
          size={14}
          color={ex.images.length === 0 ? '#fff' : colors.primary}
        />
        <Text
          style={[
            styles.editImageFindText,
            ex.images.length === 0 && styles.editImageFindTextEmpty,
          ]}
        >
          {ex.images.length === 0 ? 'Add image' : 'Find another image'}
        </Text>
      </Pressable>

      <ImageSearchModal
        visible={imageSearchOpen}
        exerciseId={ex.id}
        exerciseName={ex.name}
        onClose={() => setImageSearchOpen(false)}
        onSaved={onSaved}
      />
    </View>
  );
}

// EditField was extracted to components/EditField.tsx — see the import
// at the top of this file. The local copy is gone; the shared one has
// identical shape plus an optional `placeholder` prop for new call
// sites.

function formatSuggest(sg: api.RoutineSuggestion): string {
  const parts: string[] = [];
  if (sg.reps) parts.push(`${sg.reps} reps`);
  if (sg.weight) parts.push(`@${sg.weight} lb`);
  if (sg.duration_sec) parts.push(`${sg.duration_sec}s`);
  return parts.join(' ') || '—';
}

function InlineDoseRow({ re, readOnly, onSaved }: {
  re: RoutineExercise; readOnly: boolean; onSaved: () => void;
}) {
  const tokens = tokenizeDose(re);
  const [editing, setEditing] = useState<DoseTokenKind | null>(null);

  if (tokens.length === 0) {
    // Nothing seeded yet. Give the user a way in without forcing edit mode.
    if (readOnly) return null;
    return (
      <Pressable
        style={styles.doseAdd}
        onPress={() => setEditing('work')}
        accessibilityRole="button"
        accessibilityLabel="Set dose"
        accessibilityHint="Opens inline editor for sets, reps, and duration"
      >
        <Ionicons name="add" size={12} color={colors.primary} />
        <Text style={styles.doseAddText}>Set dose</Text>
      </Pressable>
    );
  }

  return (
    <>
      <View style={styles.doseRow}>
        {tokens.map((t, i) => (
          <Fragment key={`${t.kind}-${i}`}>
            {i > 0 && <Text style={styles.doseSep}>·</Text>}
            {readOnly ? (
              <Text style={styles.doseText}>{t.label}</Text>
            ) : (
              <Pressable
                onPress={() => setEditing(t.kind)}
                style={({ pressed }) => [styles.doseChip, pressed && styles.doseChipPressed]}
                hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${t.kind}: ${t.label}`}
                accessibilityHint="Opens inline editor for this value"
              >
                <Text style={styles.doseChipText}>{t.label}</Text>
              </Pressable>
            )}
          </Fragment>
        ))}
      </View>
      {editing && (
        <InlineDoseEditor
          kind={editing}
          re={re}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onSaved(); }}
        />
      )}
    </>
  );
}

function InlineDoseEditor({ kind, re, onClose, onSaved }: {
  kind: DoseTokenKind;
  re: RoutineExercise;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sets, setSets] = useState(String(re.target_sets ?? ''));
  const [reps, setReps] = useState(String(re.target_reps ?? ''));
  const [dur, setDur] = useState(String(re.target_duration_sec ?? ''));
  const [weight, setWeight] = useState(String(re.target_weight ?? ''));
  const [tempo, setTempo] = useState(re.tempo ?? '');
  const [rest, setRest] = useState(String(re.rest_sec ?? ''));
  // Snapshot the initial stringified values so the save body can diff
  // against them and only send fields the user actually changed. The
  // prior "dirty flag" approach stayed set after a revert-to-original —
  // user types "20" then backspaces to "15" sent target_reps=15 over
  // itself and bumped updated_at, 409-ing every other tab for a no-op
  // write. Ref (not state) because initial never changes across
  // renders.
  const initial = useRef({
    sets: String(re.target_sets ?? ''),
    reps: String(re.target_reps ?? ''),
    dur: String(re.target_duration_sec ?? ''),
    weight: String(re.target_weight ?? ''),
    tempo: re.tempo ?? '',
    rest: String(re.rest_sec ?? ''),
  }).current;
  const [busy, setBusy] = useState(false);

  const save = async (overwrite = false) => {
    setBusy(true);
    try {
      const body: api.RoutineExerciseUpdatePayload = {};
      if (kind === 'work') {
        // Reps and duration are mutually exclusive at display time. Let
        // the user decide which to fill; blank → null clears the field.
        if (sets !== initial.sets) body.target_sets = sets ? Number(sets) : null;
        if (reps !== initial.reps) body.target_reps = reps ? Number(reps) : null;
        if (dur !== initial.dur) body.target_duration_sec = dur ? Number(dur) : null;
      } else if (kind === 'weight' && weight !== initial.weight) {
        body.target_weight = weight ? Number(weight) : null;
      } else if (kind === 'tempo' && tempo !== initial.tempo) {
        body.tempo = tempo || null;
      } else if (kind === 'rest' && rest !== initial.rest) {
        body.rest_sec = rest ? Number(rest) : null;
      }
      // No-op save when the user didn't change anything (or typed and
      // reverted): skip the request so we don't bump updated_at and
      // create spurious 409s for other clients.
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      if (!overwrite && re.updated_at) body.expected_updated_at = re.updated_at;
      await api.updateRoutineExercise(re.id, body);
      onSaved();
    } catch (e) {
      if (isConflict(e)) {
        const choice = await askConflict('exercise');
        if (choice === 'reload') {
          onSaved();
        } else {
          await save(true);
        }
      } else {
        throw e;
      }
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.inlinePanel}>
      {kind === 'work' && (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <EditField label="Sets" value={sets} onChange={setSets} numeric />
          <EditField label="Reps" value={reps} onChange={setReps} numeric />
          <EditField label="Seconds" value={dur} onChange={setDur} numeric />
        </View>
      )}
      {kind === 'weight' && (
        <EditField label="Weight (lb)" value={weight} onChange={setWeight} numeric />
      )}
      {kind === 'tempo' && (
        <EditField label="Tempo (e.g. 3-1-3)" value={tempo} onChange={setTempo} />
      )}
      {kind === 'rest' && (
        <EditField label="Rest (s)" value={rest} onChange={setRest} numeric />
      )}
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
        <Pressable
          style={[styles.saveBtn, { flex: 1 }, busy && { opacity: 0.5 }]}
          onPress={() => save()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Save"
        >
          <Ionicons name="checkmark" size={14} color="#fff" />
          <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save'}</Text>
        </Pressable>
        <Pressable
          style={[styles.cancelBtn, { flex: 1 }]}
          onPress={onClose}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  addExerciseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    margin: 10, marginTop: 6, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  addExerciseText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  cloneRoutineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    margin: 10, marginTop: 4,
    paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  cloneRoutineText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  deleteRoutineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    margin: 10, marginTop: 4, marginBottom: 20,
    paddingVertical: 12, borderRadius: 10,
    backgroundColor: colors.danger,
  },
  deleteRoutineText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  title: { fontSize: 22, fontWeight: '700', color: '#222' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rehabBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.warning,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  rehabBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  headerEditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    // 44×44 via explicit minHeight + horizontal padding. The visual pill
    // is shorter than the tap target — the outline/fill is the "button".
    minHeight: 44, minWidth: 44,
    paddingHorizontal: 12,
    marginRight: 8,
    borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
  },
  headerEditBtnActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  headerEditText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  notes: { fontSize: 13, color: '#555', marginTop: 8, fontStyle: 'italic' },
  phaseBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: '#eef4ff',
    borderLeftWidth: 3, borderLeftColor: colors.primary,
    borderRadius: 6,
  },
  phaseBannerText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  phaseBannerDays: { color: colors.primary, fontWeight: '400' },

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
  doseRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: 4, marginTop: 2,
  },
  doseSep: { fontSize: 12, color: '#bbb' },
  doseText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  // WCAG 2.2 target size: the chip is ~22px tall, so we extend the tap
  // area with hitSlop on the Pressable rather than inflating the chip.
  doseChip: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: '#eef2fb', cursor: 'pointer' as any,
  },
  doseChipPressed: { backgroundColor: '#dce4f4' },
  doseChipText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  doseAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary,
    borderStyle: 'dashed', cursor: 'pointer' as any,
  },
  doseAddText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  inlinePanel: {
    marginTop: 8, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
  },
  cancelBtn: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f0f0f0', borderRadius: 6, padding: 8,
    cursor: 'pointer' as any,
  },
  cancelText: { color: '#555', fontSize: 12, fontWeight: '600' },
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
    padding: 16,
    // Keep the Start-workout button above the iPhone home indicator on web
    // by reserving the safe-area inset at the bottom. max(16, inset) so
    // devices without a home bar still get the original 16px padding.
    ...(Platform.OS === 'web'
      ? ({ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' } as any)
      : null),
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee',
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
  fieldLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 8, marginBottom: 4 },
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

  editImageRow: { marginTop: 6, marginBottom: 4 },
  editImageWrap: {
    width: 72, height: 72, borderRadius: 8, marginRight: 6,
    backgroundColor: '#f0f0f0', overflow: 'hidden', position: 'relative' as any,
  },
  editImageThumb: { width: '100%', height: '100%' },
  editImageTrash: {
    position: 'absolute' as any, top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(231,76,60,0.9)',
    alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  editImageEmpty: {
    color: colors.textMuted, fontSize: 12, fontStyle: 'italic',
    paddingVertical: 6,
  },
  editImageFindBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.primary, borderRadius: 8,
    paddingVertical: 8, marginTop: 6,
    backgroundColor: '#fff', cursor: 'pointer' as any,
  },
  editImageFindBtnEmpty: {
    backgroundColor: colors.primary, borderColor: colors.primary,
  },
  editImageFindText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  editImageFindTextEmpty: { color: '#fff' },
  dayChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#ddd',
    cursor: 'pointer' as any,
  },
  dayChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { fontSize: 12, color: '#555', textTransform: 'uppercase' },
  dayChipTextOn: { color: '#fff', fontWeight: '700' },
  rehabToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#ddd',
    backgroundColor: '#fafafa',
    cursor: 'pointer' as any,
  },
  rehabToggleOn: {
    backgroundColor: colors.warning,
    borderColor: colors.warning,
  },
  rehabToggleText: { fontSize: 14, fontWeight: '700', color: '#333' },
  rehabToggleTextOn: { color: '#fff' },
  rehabToggleHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  rehabToggleHintOn: { color: 'rgba(255,255,255,0.85)' },
});
