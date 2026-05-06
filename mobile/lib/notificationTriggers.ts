/**
 * Trigger-shape builders for expo-notifications.
 *
 * Factored out of routineReminders.ts so the shape is testable without
 * the RN runtime — the file has no react-native or expo-notifications
 * import, so it lands in the `node-libs` jest project.
 *
 * The shape returned matches expo-notifications `WeeklyTriggerInput`:
 *   { type: 'weekly', weekday, hour, minute }
 *
 * `type` is required from SDK 53 / expo-notifications 0.30 onward and
 * accepted (coerced) under SDK 52 / 0.29. Adding the discriminator now
 * keeps the implementation forward-compatible for the SDK 52→53 bump
 * without depending on the SDK upgrade itself.
 *
 * iOS weekday convention: 1 = Sunday … 7 = Saturday.
 */

export type WeeklyTriggerShape = {
  type: 'weekly';
  weekday: number;
  hour: number;
  minute: number;
};

export function buildWeeklyTrigger(
  weekday: number,
  hour: number,
  minute: number,
): WeeklyTriggerShape {
  return { type: 'weekly', weekday, hour, minute };
}
