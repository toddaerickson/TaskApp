/**
 * Schedules local notifications for routines whose reminder_time is set.
 *
 * Strategy: one scheduled notification per (routine, weekday). On sync,
 * cancel all our prior notifications and re-create from scratch. Simple,
 * predictable, no drift.
 *
 * Web: no-op (Notifications API requires browser permission + service
 * workers; not worth the complexity for a personal app).
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Routine } from './stores';

// iOS weekday: 1 = Sunday ... 7 = Saturday. Matches Date.getDay() + 1.
const WEEKDAYS: Record<string, number> = {
  sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7,
};

const TAG_PREFIX = 'routine-reminder:';

function isNative(): boolean {
  return Platform.OS !== 'web';
}

export async function ensurePermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return !!req.granted;
  } catch {
    return false;
  }
}

function parseHHMM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}

function expandDays(csv: string | null | undefined): string[] {
  if (!csv) return [];
  const norm = csv.toLowerCase().trim();
  if (!norm || norm === 'daily') return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return norm.split(',').map((s) => s.trim()).filter((s) => s in WEEKDAYS);
}

export async function cancelAllRoutineReminders(): Promise<void> {
  if (!isNative()) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of scheduled) {
      if (typeof s.identifier === 'string' && s.identifier.startsWith(TAG_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(s.identifier);
      }
    }
  } catch {
    // Module unavailable (e.g. Expo Go in SDK versions that restrict this).
  }
}

/** Cancel any previously-scheduled routine reminders and re-schedule from
 *  the current set. Safe to call on every routine list refresh. */
export async function syncRoutineReminders(routines: Routine[]): Promise<{ scheduled: number }> {
  if (!isNative()) return { scheduled: 0 };
  const granted = await ensurePermission();
  if (!granted) return { scheduled: 0 };

  await cancelAllRoutineReminders();

  let scheduled = 0;
  for (const r of routines) {
    if (!r.reminder_time) continue;
    const t = parseHHMM(r.reminder_time);
    if (!t) continue;
    const days = expandDays(r.reminder_days);
    if (days.length === 0) continue;

    for (const day of days) {
      const weekday = WEEKDAYS[day];
      const id = `${TAG_PREFIX}${r.id}:${day}`;
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: {
            title: r.name,
            body: `${r.goal === 'rehab' ? 'Rehab' : 'Workout'} time — ~${estimateMinutes(r)} min`,
            data: { routineId: r.id, kind: 'routine-reminder' },
          },
          // Weekly repeating trigger.
          trigger: { weekday, hour: t.h, minute: t.m, repeats: true } as any,
        });
        scheduled++;
      } catch {
        // Swallow individual-schedule errors so one bad routine can't
        // block the rest.
      }
    }
  }
  return { scheduled };
}

function estimateMinutes(r: Routine): number {
  const total = (r.exercises || []).reduce((s, re) => {
    const work = (re.target_duration_sec ?? 30) * (re.target_sets ?? 1);
    const rest = (re.rest_sec ?? 30) * Math.max(0, (re.target_sets ?? 1) - 1);
    return s + work + rest;
  }, 0);
  return Math.max(1, Math.round(total / 60));
}
