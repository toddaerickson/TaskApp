import { colors } from "@/lib/colors";
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import Svg, { Line, Path, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import * as api from '@/lib/api';
import type { Exercise, WorkoutSession } from '@/lib/stores';
import {
  aggregateByExercise, weeklyCounts,
  metricSeries, availableMetrics, filterByRange, sessionsToCsv,
  ExerciseStat, StatPoint, Metric,
} from '@/lib/progress';
import StreakHeatmap from '@/components/StreakHeatmap';

const RANGE_OPTIONS: { days: number; label: string }[] = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 180, label: '180d' },
  { days: 365, label: '1y' },
  { days: 0, label: 'All' },
];

const METRIC_LABELS: Record<Metric, string> = {
  reps: 'Reps',
  weight: 'Weight',
  duration: 'Duration',
  pain: 'Pain',
  volume: 'Volume',
};

const METRIC_UNITS: Record<Metric, string> = {
  reps: '',
  weight: '',
  duration: 's',
  pain: '/10',
  // Volume units match the weight units of the source rows (lb in this
  // app). No suffix so the chart tick labels stay compact — the
  // card-subheading "Total volume per day" tells the user what they're
  // reading.
  volume: '',
};

export default function ProgressScreen() {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExId, setSelectedExId] = useState<number | null>(null);
  const [rangeDays, setRangeDays] = useState(90);
  const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null);

  useEffect(() => {
    Promise.all([
      api.listSessions({ limit: 200 }),
      api.getExercises(),
    ]).then(([s, e]) => {
      setSessions(s);
      setExercises(e);
    }).finally(() => setLoading(false));
  }, []);

  // Sessions windowed by the screen-scoped `rangeDays` selector. All
  // three summary widgets below (stat cards, weekly bar, heatmap) work
  // off this subset so the range selector at the top drives the whole
  // screen, not just the per-exercise chart. rangeDays=0 means "All"
  // and sessionsInRange === sessions.
  const sessionsInRange = useMemo(() => {
    if (!rangeDays || rangeDays <= 0) return sessions;
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - rangeDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return sessions.filter((s) => s.started_at.slice(0, 10) >= cutoffStr);
  }, [sessions, rangeDays]);

  const stats = useMemo(
    () => aggregateByExercise(sessions, exercises),
    [sessions, exercises],
  );
  // Weekly chart shows 12 bars when the range is >= 12w, otherwise it
  // compresses to the range width (rounded up to whole weeks) so the
  // chart doesn't show empty weeks outside the selected window.
  const weeks = rangeDays > 0 ? Math.max(4, Math.min(12, Math.ceil(rangeDays / 7))) : 12;
  const weekly = useMemo(() => weeklyCounts(sessionsInRange, weeks), [sessionsInRange, weeks]);
  const totalSets = useMemo(
    () => sessionsInRange.reduce((n, s) => n + (s.sets?.length ?? 0), 0),
    [sessionsInRange],
  );

  useEffect(() => {
    if (selectedExId === null && stats.length > 0) setSelectedExId(stats[0].exercise_id);
  }, [stats]);

  // Which metrics have data for the currently-selected exercise. Hides
  // toggle chips that would render an empty chart.
  const metricsForExercise = useMemo(
    () => (selectedExId ? availableMetrics(sessions, selectedExId) : []),
    [sessions, selectedExId],
  );

  // Default-select the first available metric when the user changes
  // exercise, or when the current metric isn't valid for the new one.
  useEffect(() => {
    if (metricsForExercise.length === 0) {
      setSelectedMetric(null);
      return;
    }
    if (!selectedMetric || !metricsForExercise.includes(selectedMetric)) {
      setSelectedMetric(metricsForExercise[0]);
    }
  }, [metricsForExercise, selectedMetric]);

  // Build the series the chart renders from: per-metric daily maxes
  // (or pain mins), then truncated to the selected date range.
  const chartSeries = useMemo(() => {
    if (!selectedExId || !selectedMetric) return [];
    const full = metricSeries(sessions, selectedExId, selectedMetric);
    return filterByRange(full, rangeDays);
  }, [sessions, selectedExId, selectedMetric, rangeDays]);

  const selectedStat = stats.find((s) => s.exercise_id === selectedExId);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  if (sessions.length === 0) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Progress' }} />
        <Ionicons name="stats-chart-outline" size={48} color="#ccc" accessibilityElementsHidden />
        <Text style={styles.emptyTitle}>No data yet</Text>
        <Text style={styles.emptyHint}>Finish a workout and come back.</Text>
      </View>
    );
  }

  const handleExportCsv = () => {
    const csv = sessionsToCsv(sessions, exercises);
    if (Platform.OS === 'web') {
      // Browser download: create a one-shot Blob URL, attach it to a
      // hidden anchor, click, then revoke to free memory. Same dance
      // every "export CSV from a SPA" uses — no extra deps.
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `taskapp-progress-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // A 1-second defer gives the download dialog time to latch onto
      // the URL on slower browsers before we revoke it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      // Native requires expo-sharing + FileSystem for a true save flow.
      // Deferred — the user's primary surface is Safari. A future PR can
      // wire this up if we add a native build.
      // eslint-disable-next-line no-alert
      window?.alert?.('CSV export is available from the web build.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Stack.Screen
        options={{
          title: 'Progress',
          headerRight: () => (
            <Pressable
              onPress={handleExportCsv}
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Export progress as CSV"
              hitSlop={8}
            >
              <Ionicons name="download-outline" size={16} color="#fff" />
              <Text style={styles.headerBtnText}>CSV</Text>
            </Pressable>
          ),
        }}
      />

      {/* Global date-range selector. Drives the stat cards, weekly bar,
          heatmap, and per-exercise chart below. The per-exercise card
          has its own metric toggle but no longer its own date range —
          everything shares this window so the story on the page is
          consistent. */}
      <View
        style={[styles.metricRow, styles.globalRangeRow]}
        accessibilityRole="radiogroup"
        accessibilityLabel="Date range"
      >
        {RANGE_OPTIONS.map((r) => {
          const active = rangeDays === r.days;
          return (
            <Pressable
              key={r.days}
              style={[styles.rangeChip, active && styles.rangeChipActive]}
              onPress={() => setRangeDays(r.days)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={r.label === '1y' ? '1 year' : r.label === 'All' ? 'All time' : `${r.days} days`}
            >
              <Text style={[styles.rangeChipText, active && styles.rangeChipTextActive]}>
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.statRow}>
        <StatCard label="Sessions" value={String(sessionsInRange.length)} />
        <StatCard label="Sets logged" value={String(totalSets)} />
        <StatCard label="Exercises used" value={String(stats.length)} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">Sessions per week</Text>
        <Text style={styles.cardSub}>Last {weeks} weeks</Text>
        <BarChart data={weekly} height={140} />
      </View>

      {/* Streak heatmap. Always renders a 365-day grid anchored to
          today; the selected rangeDays greys out everything older than
          the cutoff so the visual focus matches the stat cards above. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">Streak heatmap</Text>
        <Text style={styles.cardSub}>
          Daily session count · {rangeDays > 0 ? `last ${rangeDays}d highlighted` : 'full year'}
        </Text>
        <StreakHeatmap sessions={sessions} rangeDays={rangeDays} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">Per-exercise trend</Text>
        <Text style={styles.cardSub}>
          {selectedMetric === 'volume'
            ? 'Total volume (weight × reps) per day'
            : selectedMetric
              ? `Best ${METRIC_LABELS[selectedMetric].toLowerCase()} per day`
              : 'Best per-day result'}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pickerRow}
          accessibilityRole="tablist"
          accessibilityLabel="Exercise picker"
        >
          {stats.map((s) => {
            const active = s.exercise_id === selectedExId;
            return (
              <Pressable
                key={s.exercise_id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedExId(s.exercise_id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${s.name}, ${s.sessions} session${s.sessions === 1 ? '' : 's'}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {s.name}
                </Text>
                <View style={[styles.chipCount, active && styles.chipCountActive]}>
                  <Text style={[styles.chipCountText, active && styles.chipCountTextActive]}>
                    {s.sessions}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Metric toggle — only shows metrics that have data for the
            currently-selected exercise. Hidden entirely when only one
            metric applies (e.g. a bodyweight-reps-only routine). */}
        {metricsForExercise.length > 1 && (
          <View
            style={styles.metricRow}
            accessibilityRole="radiogroup"
            accessibilityLabel="Chart metric"
          >
            {metricsForExercise.map((m) => {
              const active = selectedMetric === m;
              return (
                <Pressable
                  key={m}
                  style={[styles.metricChip, active && styles.metricChipActive]}
                  onPress={() => setSelectedMetric(m)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={METRIC_LABELS[m]}
                >
                  <Text style={[styles.metricChipText, active && styles.metricChipTextActive]}>
                    {METRIC_LABELS[m]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Date-range selector moved to screen scope at the top; the
            global one drives this chart too via the `rangeDays` state. */}

        {selectedStat && selectedMetric && (
          <LineChart
            points={chartSeries}
            height={200}
            unit={METRIC_UNITS[selectedMetric]}
            label={`${selectedStat.name} · ${METRIC_LABELS[selectedMetric]}`}
          />
        )}
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={styles.stat}
      accessibilityRole="summary"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BarChart({ data, height }: { data: { label: string; count: number }[]; height: number }) {
  const { width: winW } = useWindowDimensions();
  const w = Math.min(winW - 56, 600);
  const padL = 28, padR = 12, padB = 24, padT = 8;
  const chartW = w - padL - padR;
  const chartH = height - padT - padB;
  const max = Math.max(1, ...data.map((d) => d.count));
  const barW = chartW / data.length * 0.7;
  const gap = chartW / data.length * 0.3;

  return (
    <Svg width={w} height={height} accessibilityLabel="Sessions per week bar chart">
      {/* Y gridlines at 25/50/75/100% of max */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <Line
          key={f}
          x1={padL} x2={w - padR}
          y1={padT + chartH * (1 - f)} y2={padT + chartH * (1 - f)}
          stroke="#eee" strokeWidth={1}
        />
      ))}
      <SvgText x={4} y={padT + 8} fontSize={10} fill="#999">{max}</SvgText>
      <SvgText x={4} y={padT + chartH} fontSize={10} fill="#999">0</SvgText>
      {data.map((d, i) => {
        const h = (d.count / max) * chartH;
        const x = padL + i * (chartW / data.length) + gap / 2;
        const y = padT + chartH - h;
        return (
          <>
            <Rect
              key={`b${i}`}
              x={x} y={y} width={barW} height={h}
              fill={d.count > 0 ? colors.primary : '#e8e8e8'}
              rx={2}
            />
            <SvgText
              key={`l${i}`}
              x={x + barW / 2} y={height - 6}
              fontSize={9} fill="#999" textAnchor="middle"
            >
              {d.label}
            </SvgText>
            {d.count > 0 && (
              <SvgText
                key={`c${i}`}
                x={x + barW / 2} y={y - 3}
                fontSize={9} fill={colors.primary} textAnchor="middle" fontWeight="700"
              >
                {d.count}
              </SvgText>
            )}
          </>
        );
      })}
    </Svg>
  );
}

function LineChart({
  points, height, unit, label,
}: {
  points: StatPoint[];
  height: number;
  unit: string;
  label: string;
}) {
  const { width: winW } = useWindowDimensions();
  const w = Math.min(winW - 56, 600);
  const padL = 36, padR = 12, padB = 28, padT = 10;
  const chartW = w - padL - padR;
  const chartH = height - padT - padB;

  if (points.length === 0) {
    return <Text style={{ textAlign: 'center', color: colors.textMuted, padding: 20 }}>No data in this range.</Text>;
  }
  if (points.length === 1) {
    return (
      <Text style={{ textAlign: 'center', color: '#666', padding: 20 }}>
        Only one data point in this range — log another to see a trend.
      </Text>
    );
  }

  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1, maxV - minV);

  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * chartW;
  const y = (v: number) => padT + chartH * (1 - (v - minV) / range);

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');

  return (
    <Svg width={w} height={height} accessibilityLabel={`Trend chart for ${label}`}>
      <Line x1={padL} x2={w - padR} y1={padT} y2={padT} stroke="#eee" />
      <Line x1={padL} x2={w - padR} y1={padT + chartH / 2} y2={padT + chartH / 2} stroke="#f5f5f5" />
      <Line x1={padL} x2={w - padR} y1={padT + chartH} y2={padT + chartH} stroke="#eee" />
      <SvgText x={4} y={padT + 4} fontSize={10} fill="#999">{maxV}{unit}</SvgText>
      <SvgText x={4} y={padT + chartH + 4} fontSize={10} fill="#999">{minV}{unit}</SvgText>
      <Path d={pathD} stroke={colors.primary} strokeWidth={2} fill="none" />
      {points.map((p, i) => (
        // Larger + highlighted circle on PR days. A filled accent ring
        // makes the record visible at a glance without a legend.
        p.pr ? (
          <Circle
            key={`pr${i}`}
            cx={x(i)} cy={y(p.value)} r={5}
            fill={colors.accent} stroke="#fff" strokeWidth={1.5}
          />
        ) : (
          <Circle key={i} cx={x(i)} cy={y(p.value)} r={3} fill={colors.primary} />
        )
      ))}
      {/* X-axis: first + last date */}
      <SvgText x={padL} y={height - 8} fontSize={9} fill="#999">{points[0].date.slice(5)}</SvgText>
      <SvgText x={w - padR} y={height - 8} fontSize={9} fill="#999" textAnchor="end">
        {points[points.length - 1].date.slice(5)}
      </SvgText>
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f6fa' },
  emptyTitle: { fontSize: 16, color: '#666', marginTop: 10 },
  emptyHint: { fontSize: 13, color: '#aaa', marginTop: 4 },

  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    marginRight: 8, borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
  },
  headerBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  statRow: { flexDirection: 'row', padding: 12, gap: 8 },
  stat: {
    flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  statValue: { fontSize: 22, fontWeight: '700', color: colors.primary },
  statLabel: { fontSize: 11, color: '#666', marginTop: 4 },

  card: {
    backgroundColor: '#fff', margin: 12, marginTop: 0, borderRadius: 10, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#222' },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 10 },

  pickerRow: { paddingVertical: 8, gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#f5f6fa', borderWidth: 1, borderColor: '#eee',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: '#444' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipCount: { backgroundColor: '#fff', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1 },
  chipCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  chipCountText: { fontSize: 10, color: '#666' },
  chipCountTextActive: { color: '#fff', fontWeight: '700' },

  metricRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    marginTop: 8,
  },
  // Screen-scoped date-range selector sits outside a card, anchored to
  // the top of the scroll view so it reads as "drives the whole page"
  // rather than "scoped to the card below."
  globalRangeRow: {
    paddingHorizontal: 12, paddingTop: 12, marginTop: 0,
  },
  metricChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#f5f6fa', borderWidth: 1, borderColor: '#e3e7ee',
    cursor: 'pointer' as any,
  },
  metricChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  metricChipText: { fontSize: 12, color: '#444' },
  metricChipTextActive: { color: '#fff', fontWeight: '700' },
  rangeChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#eee',
    cursor: 'pointer' as any,
  },
  rangeChipActive: { backgroundColor: '#eef4ff', borderColor: colors.primary },
  rangeChipText: { fontSize: 11, color: '#666' },
  rangeChipTextActive: { color: colors.primary, fontWeight: '700' },
});
