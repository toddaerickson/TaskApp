/**
 * Semantic color tokens. Import as `import { colors } from '@/lib/colors'`.
 *
 * The brand blue used to be hard-coded in ~22 places as `#1a73e8`, plus a
 * handful of semantic colors (success/warning/danger) that showed up in
 * different hex casings across files. Changing the palette meant hunting
 * through every StyleSheet. This module is the single source of truth.
 *
 * Values preserved exactly as they were in the StyleSheets so this module
 * is a drop-in rename — no visual regression intended.
 */
export const colors = {
  // Brand / primary — Google-style blue. Used for tab tint, headers,
  // primary buttons, focused states, active folder rows, etc.
  primary: '#1a73e8',
  primaryDim: '#ccc',
  primaryOnLight: '#e8f0fe',
  primaryOnLightActive: 'rgba(255,255,255,0.25)',

  // Semantic palette.
  success: '#27ae60',
  warning: '#e67e22',
  warningSoft: '#f0ad4e',
  danger: '#e74c3c',
  accent: '#f39c12',   // keystone / starred
  violet: '#8e44ad',   // tag badges
  group: '#6c5ce7',    // group-by pill

  // Surface / text tokens.
  bg: '#f5f6fa',
  surface: '#fff',
  border: '#e0e0e0',
  borderSoft: '#eee',
  text: '#333',
  textMuted: '#999',
  textFaint: '#ccc',
} as const;

/** Priority → color. Tasks and folders both use this mapping. */
export const priorityColors: Record<number, string> = {
  0: colors.textMuted,
  1: colors.warningSoft,
  2: colors.warning,
  3: colors.danger,
};
