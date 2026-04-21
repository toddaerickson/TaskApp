/**
 * GitHub-style session heatmap. 53 weekly columns × 7 weekday rows,
 * cells colored by daily session count. Always anchored to "today" in
 * the right-most column so the most-recent activity is easy to spot.
 *
 * Props scope to the parent's global `rangeDays` so the same date-range
 * selector that drives the bar chart + stat cards also truncates the
 * heatmap. rangeDays === 0 means "all"; we render 365 cells either way
 * and let empty days stay empty (background color).
 */
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors } from '@/lib/colors';
import type { WorkoutSession } from '@/lib/stores';

const CELL = 11;        // px per cell square
const GAP = 2;
const COLS = 53;        // ~1 year of weeks
const ROWS = 7;
const PADDING = 6;

// Count → color ramp. 0 → empty background, 1–3 escalate in green.
// Keeps the palette narrow so a single high-activity day doesn't
// wash out the rest.
function cellColor(count: number): string {
  if (count <= 0) return '#eaecef';
  if (count === 1) return '#c6e6ff';
  if (count === 2) return '#7cc1f2';
  if (count === 3) return '#3a89d4';
  return colors.primary;
}

export default function StreakHeatmap({
  sessions,
  rangeDays = 0,
  now = new Date(),
}: {
  sessions: WorkoutSession[];
  /** 0 = render the full 365-day window; N>0 clamps colored days to
   *  the last N. Empty days still render as background cells so the
   *  grid stays a rectangle. */
  rangeDays?: number;
  now?: Date;
}) {
  // Count sessions per day (YYYY-MM-DD UTC slice, matches progress.ts).
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const day = s.started_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  // Anchor: today → bottom-right corner of the grid. Walk back 371 days
  // (53 weeks × 7). Align the rightmost column to the current weekday so
  // the heatmap doesn't look crooked.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayRow = (today.getDay() + 6) % 7; // Monday = 0
  // First cell = top-left. Days on the grid = COLS*ROWS - (6 - todayRow).
  // Compute start date.
  const cells: { date: string; count: number; row: number; col: number }[] = [];
  const totalSlots = COLS * ROWS;
  const emptyAtEnd = ROWS - 1 - todayRow; // cells after "today" in the last column
  const start = new Date(today);
  start.setDate(start.getDate() - (totalSlots - 1 - emptyAtEnd));

  // Cutoff for range-filtering the color. rangeDays=0 → no cutoff.
  const cutoffStr = rangeDays > 0
    ? (() => {
        const c = new Date(today);
        c.setDate(c.getDate() - rangeDays);
        return c.toISOString().slice(0, 10);
      })()
    : null;

  for (let i = 0; i < totalSlots - emptyAtEnd; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const date = d.toISOString().slice(0, 10);
    const inRange = cutoffStr == null || date >= cutoffStr;
    const count = inRange ? (byDay.get(date) ?? 0) : 0;
    cells.push({
      date,
      count,
      row: i % ROWS,
      col: Math.floor(i / ROWS),
    });
  }

  const width = PADDING * 2 + COLS * (CELL + GAP) - GAP;
  const height = PADDING * 2 + ROWS * (CELL + GAP) - GAP;

  // Totals for the caption. Count only within-range days so the number
  // matches what's colored on the grid.
  const total = cells.reduce((n, c) => n + c.count, 0);
  const activeDays = cells.reduce((n, c) => n + (c.count > 0 ? 1 : 0), 0);

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Session heatmap: ${total} sessions across ${activeDays} days.`}
    >
      <Svg width={width} height={height}>
        {cells.map((c, i) => (
          <Rect
            key={i}
            x={PADDING + c.col * (CELL + GAP)}
            y={PADDING + c.row * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={2}
            fill={cellColor(c.count)}
          />
        ))}
      </Svg>
      <Text style={styles.caption}>
        {total} session{total === 1 ? '' : 's'} across {activeDays} day{activeDays === 1 ? '' : 's'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
});
