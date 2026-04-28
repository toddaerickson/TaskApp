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

  // Semantic palette. The base hues (success/warning/danger) look right
  // on icons and AA-Large headings but they all fail AA-Normal body-text
  // contrast on every surface (see docs/a11y-audit-2026-04.md). When you
  // need short body text in these tones — "Set saved", "Symptom logged",
  // "Could not delete" — use the *Text variants below; they're hue-
  // preserving but darkened to clear 4.5:1 on #fff, #f5f6fa, and #e8f0fe.
  success: '#27ae60',
  successText: '#1a6e3a',    // ≥ 5.49:1 on every surface
  warning: '#e67e22',
  warningText: '#a05a00',    // ≥ 4.63:1 on every surface
  warningSoft: '#f0ad4e',
  danger: '#e74c3c',
  dangerText: '#a52a1a',     // ≥ 6.22:1 on every surface
  // Priority (was "keystone") + starred tasks. Warm dark gold — reads as
  // "important" without competing with the warning/danger oranges and
  // reds. Matches the gold-star intuition the UI already used. The
  // `accentText` variant is the AA-compliant darker hue used as the
  // *background* on the PRIORITY chip — `#d4a017` failed white-text
  // contrast at 2.2:1, `#7a5500` clears 7.8:1 on #fff. See PR-X2 +
  // docs/a11y-audit-2026-04.md.
  accent: '#d4a017',
  accentText: '#7a5500',     // ≥ 7.8:1 on every surface; chip-bg use
  violet: '#8e44ad',   // tag badges
  group: '#6c5ce7',    // group-by pill

  // Surface / text tokens.
  bg: '#f5f6fa',
  surface: '#fff',
  border: '#e0e0e0',
  borderSoft: '#eee',
  text: '#333',
  // Darkened from #999 (2.85:1 on #fff — AA Normal FAIL) to #595959
  // (~7:1 on #fff — AA Normal + Large PASS on every surface the app
  // uses). Applied at the token, so every consumer picks up the
  // change automatically. See docs/a11y-audit-2026-04.md.
  textMuted: '#595959',
  // Explicitly decorative — never body text. ~1.6:1 on #fff, so only
  // use for disabled backgrounds, placeholder chrome, or non-semantic
  // borders. If you need muted body text, use `textMuted`.
  textFaint: '#ccc',
} as const;

/** Priority → color. Tasks and folders both use this mapping. */
export const priorityColors: Record<number, string> = {
  0: colors.textMuted,
  1: colors.warningSoft,
  2: colors.warning,
  3: colors.danger,
};
