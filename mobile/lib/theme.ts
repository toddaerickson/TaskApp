/**
 * Layout primitives — spacing, typography, radii, elevation. Pair with
 * `lib/colors.ts` (which owns hue tokens). Import together:
 *
 *   import { colors } from '@/lib/colors';
 *   import { spacing, type, radii, shadow } from '@/lib/theme';
 *
 * Why a separate module: colors.ts already has audit history + AA
 * contrast notes; mixing layout values in would dilute that. Two
 * focused modules > one combined.
 */
import { Platform } from 'react-native';

/**
 * 4-pt spacing grid. Use these instead of magic numbers.
 *
 * The pre-token codebase used every value from 2 to 24 in 1-pt
 * increments depending on which screen the dev was in. Snapping to a
 * single scale gives the eye a rhythm that hardcoded values never
 * achieve. Keep additions rare — if you need 18, you almost certainly
 * meant 16 or 24.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Typography scale. Sizes only — pair with explicit `fontWeight` at
 * the call site so weight stays under designer control.
 *
 * `input: 16` is non-negotiable — anything smaller triggers iPhone
 * Safari's input-zoom-on-focus and the page jumps when the user taps a
 * field. Don't "save space" by dropping inputs to 15.
 */
export const type = {
  caption: 12, // chip labels, meta lines, group headers
  body: 14, // default body text
  bodyLg: 15, // primary buttons, prominent body (e.g. exercise names)
  input: 16, // form inputs — REQUIRED minimum for iOS Safari
  title: 17, // card titles, sheet labels
  titleLg: 22, // sheet titles, page-level headers
} as const;

/**
 * Corner radii. Pre-token code mixed 4/6/8/10/12/14/16/18 across one
 * screen. Pick from this set; if a bespoke value seems needed, the
 * design probably needs adjustment, not a new token.
 *
 * `pill` is for fully-rounded chips and badges; everything else is a
 * normal rounded rect.
 */
export const radii = {
  sm: 8, // rows, inputs, secondary buttons
  md: 12, // cards (small), elevated chips
  lg: 16, // sheets, primary cards, modals
  pill: 999, // chips, badges, capsule buttons
} as const;

/**
 * Card elevation. Subtle by design — heavy shadows compete with the
 * content. Web (RN-web) ignores `elevation`; native ignores `shadow*`
 * unless wrapped, so we declare both.
 *
 * `card` is the only elevation level the workout module needs today.
 * Add `modal` / `popover` later if real demand appears — premature
 * elevations encourage stacking issues.
 */
export const shadow = {
  card: Platform.select({
    web: {
      // RN-web maps shadow* to box-shadow; this combination reads as
      // "lifted by ~2pt" on a white surface.
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2, // Android
    },
  }),
} as const;

/** Hit-target floor — WCAG 2.2 SC 2.5.8 minimum. Tap surfaces below
 * this fail a11y audits. Apply via `minWidth` + `minHeight` on
 * Pressables that don't otherwise meet the bar. */
export const minHitTarget = 44;
