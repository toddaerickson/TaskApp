/** Shared optimistic-concurrency conflict helpers (PR-Y5).
 *
 *  Both `workout/[routineId].tsx` and `ReminderSheet.tsx` reacted to the
 *  same backend 409 shape (`{code: 'conflict', current: {...}}`) with
 *  duplicate copies of `isConflict()` + `askConflict()`. Now they live
 *  here so a third PUT screen doesn't fork a third variant.
 *
 *  Web uses `window.confirm()` because Modal+Pressable for a destructive
 *  dialog is more friction than blocking is; iOS/Android get a native
 *  `Alert.alert` with distinct destructive vs cancel labels.
 */
import { Platform, Alert } from 'react-native';

export function isConflict(err: unknown): err is { response: { status: 409 } } {
  const e = err as { response?: { status?: number } };
  return e?.response?.status === 409;
}

export function askConflict(label: string): Promise<'overwrite' | 'reload'> {
  return new Promise((resolve) => {
    const msg = `The ${label} changed since you loaded it. Overwrite replaces the newer version; Reload discards your edits.`;
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      const overwrite = window.confirm(`${msg}\n\nOK = Overwrite. Cancel = Reload.`);
      resolve(overwrite ? 'overwrite' : 'reload');
    } else {
      Alert.alert(`This ${label} changed`, msg, [
        { text: 'Discard & reload', style: 'cancel', onPress: () => resolve('reload') },
        { text: 'Overwrite', style: 'destructive', onPress: () => resolve('overwrite') },
      ]);
    }
  });
}
