/**
 * Compact sheet for setting a routine reminder. Opens from the alarm
 * icon on each card in the Workouts home tab.
 *
 * Design goals:
 *   - One tap to reach. No deep-nav, no Edit-mode toggle hunt.
 *   - Current reminder is pre-filled; save is disabled until the user
 *     actually changes something.
 *   - Turn off = clear the time field (mirrors the detail-screen
 *     editor's "blank time means no reminder" convention).
 *   - Optimistic concurrency matches the detail editor: send
 *     expected_updated_at; on 409 offer overwrite/discard via the same
 *     askConflict() prompt used on the detail screen.
 */
import { useEffect, useState } from 'react';
import {
  View, Text, Pressable, Modal, TextInput, StyleSheet, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import { Routine } from '@/lib/stores';
import * as api from '@/lib/api';
import {
  DAYS, DayCode, parseDays, daysCsv, formatTime12h,
} from '@/lib/reminders';

interface Props {
  routine: Routine;
  onClose: () => void;
  onSaved: () => void;
}

function isConflict(err: unknown): err is { response: { status: 409 } } {
  const e = err as { response?: { status?: number } };
  return e?.response?.status === 409;
}

function askConflict(): Promise<'overwrite' | 'reload'> {
  return new Promise((resolve) => {
    const msg = 'This routine changed since you opened it. Overwrite replaces the newer version; Reload discards your edits.';
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      resolve(window.confirm(`${msg}\n\nOK = Overwrite. Cancel = Reload.`) ? 'overwrite' : 'reload');
    } else {
      Alert.alert('This routine changed', msg, [
        { text: 'Discard & reload', style: 'cancel', onPress: () => resolve('reload') },
        { text: 'Overwrite', style: 'destructive', onPress: () => resolve('overwrite') },
      ]);
    }
  });
}

const DAY_LABEL: Record<DayCode, string> = {
  mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S',
};
const DAY_FULL: Record<DayCode, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

export default function ReminderSheet({ routine, onClose, onSaved }: Props) {
  const [time, setTime] = useState(routine.reminder_time || '');
  const [days, setDays] = useState<Set<DayCode>>(parseDays(routine.reminder_days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the routine prop changes (i.e. different card tapped
  // while the sheet is still mounted).
  useEffect(() => {
    setTime(routine.reminder_time || '');
    setDays(parseDays(routine.reminder_days));
    setError(null);
  }, [routine.id, routine.reminder_time, routine.reminder_days]);

  const toggleDay = (d: DayCode) => {
    const next = new Set(days);
    if (next.has(d)) next.delete(d); else next.add(d);
    setDays(next);
  };

  const trimmedTime = time.trim();
  const validTime = /^([01]?\d|2[0-3]):[0-5]\d$/.test(trimmedTime);
  const currentCsv = daysCsv(days);
  const dirty =
    (trimmedTime || '') !== (routine.reminder_time || '') ||
    currentCsv !== (routine.reminder_days || null);
  // Needs either a valid time + ≥1 day, OR an empty time (turning off).
  const valid = (!trimmedTime) || (validTime && days.size > 0);

  const save = async (overwrite = false) => {
    setBusy(true);
    setError(null);
    try {
      const body: api.RoutineUpdatePayload = {
        reminder_time: trimmedTime || null,
        reminder_days: trimmedTime ? currentCsv : null,
      };
      if (!overwrite && routine.updated_at) {
        body.expected_updated_at = routine.updated_at;
      }
      await api.updateRoutine(routine.id, body);
      onSaved();
      onClose();
    } catch (e) {
      if (isConflict(e)) {
        const choice = await askConflict();
        if (choice === 'reload') {
          onSaved();
          onClose();
        } else {
          await save(true);
          return;
        }
      } else {
        setError('Could not save. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setTime('');
    setDays(new Set());
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Reminder</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close reminder sheet"
              hitSlop={8}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color="#888" />
            </Pressable>
          </View>

          <Text style={styles.routineName} numberOfLines={1}>{routine.name}</Text>

          <Text style={styles.label}>Time</Text>
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="07:00 (24h)"
            placeholderTextColor="#bbb"
            accessibilityLabel="Reminder time, HH colon MM in 24-hour format"
            autoCapitalize="none"
            keyboardType={Platform.OS === 'web' ? 'default' : 'numbers-and-punctuation'}
            style={styles.input}
          />
          {trimmedTime && validTime ? (
            <Text style={styles.timePreview}>{formatTime12h(trimmedTime)}</Text>
          ) : trimmedTime ? (
            <Text style={styles.timeHint}>Use HH:MM, e.g. 07:00 or 18:30.</Text>
          ) : (
            <Text style={styles.timeHint}>Leave blank to turn the reminder off.</Text>
          )}

          {!!trimmedTime && (
            <>
              <Text style={styles.label}>Days</Text>
              <View style={styles.dayRow}>
                {DAYS.map((d) => {
                  const on = days.has(d);
                  return (
                    <Pressable
                      key={d}
                      style={[styles.dayChip, on && styles.dayChipOn]}
                      onPress={() => toggleDay(d)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${DAY_FULL[d]}, ${on ? 'selected' : 'not selected'}`}
                    >
                      <Text style={[styles.dayText, on && styles.dayTextOn]}>
                        {DAY_LABEL[d]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {days.size === 0 && (
                <Text style={styles.timeHint}>Pick at least one day.</Text>
              )}
            </>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            {!!(routine.reminder_time || routine.reminder_days) && (
              <Pressable
                onPress={clear}
                style={styles.clearBtn}
                accessibilityRole="button"
                accessibilityLabel="Turn reminder off"
              >
                <Text style={styles.clearText}>Turn off</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.saveBtn, (!dirty || !valid || busy) && { opacity: 0.5 }]}
              disabled={!dirty || !valid || busy}
              onPress={() => save()}
              accessibilityRole="button"
              accessibilityLabel="Save reminder"
              accessibilityState={{ disabled: !dirty || !valid || busy, busy }}
            >
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', padding: 20,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: '#222' },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  routineName: { fontSize: 14, color: colors.textMuted, marginTop: 2, marginBottom: 4 },
  label: {
    fontSize: 12, color: '#666', fontWeight: '700',
    marginTop: 14, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10,
    fontSize: 15, backgroundColor: '#fafafa',
  },
  timePreview: { fontSize: 12, color: colors.success, marginTop: 4 },
  timeHint: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  dayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  dayChip: {
    // 44×44 floor — keep the tap target above the a11y minimum.
    minWidth: 44, minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: 22,
    backgroundColor: '#f5f6fa',
    borderWidth: 1, borderColor: '#e3e7ee',
  },
  dayChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { fontSize: 14, color: '#444', fontWeight: '600' },
  dayTextOn: { color: '#fff' },
  error: { color: colors.danger, fontSize: 13, marginTop: 10 },
  actions: {
    flexDirection: 'row', gap: 10, marginTop: 20, alignItems: 'center',
  },
  clearBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#e3e7ee', alignItems: 'center',
  },
  clearText: { color: '#666', fontWeight: '600', fontSize: 14 },
  saveBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 8,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
