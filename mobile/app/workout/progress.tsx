import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import Svg, { Line, Path, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as api from '@/lib/api';
import type { Exercise, WorkoutSession } from '@/lib/stores';
import { aggregateByExercise, weeklyCounts, ExerciseStat } from '@/lib/progress';

export default function ProgressScreen() {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExId, setSelectedExId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      api.listSessions({ limit: 200 }),
      api.getExercises(),
    ]).then(([s, e]) => {
      setSessions(s);
      setExercises(e);
    }).finally(() => setLoading(false));
  }, []);

  const stats = useMemo(
    () => aggregateByExercise(sessions, exercises),
    [sessions, exercises],
  );
  const weekly = useMemo(() => weeklyCounts(sessions, 12), [sessions]);
  const totalSets = useMemo(() => sessions.reduce((n, s) => n + (s.sets?.length ?? 0), 0), [sessions]);

  useEffect(() => {
    if (selectedExId === null && stats.length > 0) setSelectedExId(stats[0].exercise_id);
  }, [stats]);

  const selectedStat = stats.find((s) => s.exercise_id === selectedExId);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1a73e8" /></View>;
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Stack.Screen options={{ title: 'Progress' }} />

      <View style={styles.statRow}>
        <StatCard label="Sessions" value={String(sessions.length)} />
        <StatCard label="Sets logged" value={String(totalSets)} />
        <StatCard label="Exercises used" value={String(stats.length)} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">Sessions per week</Text>
        <Text style={styles.cardSub}>Last 12 weeks</Text>
        <BarChart data={weekly} height={140} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">Per-exercise trend</Text>
        <Text style={styles.cardSub}>Best per-day result</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pickerRow}
          accessibilityRole="tablist"
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
        {selectedStat && <LineChart stat={selectedStat} height={200} />}
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
              fill={d.count > 0 ? '#1a73e8' : '#e8e8e8'}
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
                fontSize={9} fill="#1a73e8" textAnchor="middle" fontWeight="700"
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

function LineChart({ stat, height }: { stat: ExerciseStat; height: number }) {
  const { width: winW } = useWindowDimensions();
  const w = Math.min(winW - 56, 600);
  const padL = 36, padR = 12, padB = 28, padT = 10;
  const chartW = w - padL - padR;
  const chartH = height - padT - padB;

  const pts = stat.points;
  if (pts.length === 0) {
    return <Text style={{ textAlign: 'center', color: '#999', padding: 20 }}>No data.</Text>;
  }
  if (pts.length === 1) {
    return (
      <Text style={{ textAlign: 'center', color: '#666', padding: 20 }}>
        Only one session so far — do another to see a trend.
      </Text>
    );
  }

  const values = pts.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1, maxV - minV);

  const x = (i: number) => padL + (i / Math.max(1, pts.length - 1)) * chartW;
  const y = (v: number) => padT + chartH * (1 - (v - minV) / range);

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const unit = stat.measurement === 'duration' ? 's'
    : stat.measurement === 'distance' ? 'm' : '';

  return (
    <Svg width={w} height={height} accessibilityLabel={`Trend chart for ${stat.name}`}>
      <Line x1={padL} x2={w - padR} y1={padT} y2={padT} stroke="#eee" />
      <Line x1={padL} x2={w - padR} y1={padT + chartH / 2} y2={padT + chartH / 2} stroke="#f5f5f5" />
      <Line x1={padL} x2={w - padR} y1={padT + chartH} y2={padT + chartH} stroke="#eee" />
      <SvgText x={4} y={padT + 4} fontSize={10} fill="#999">{maxV}{unit}</SvgText>
      <SvgText x={4} y={padT + chartH + 4} fontSize={10} fill="#999">{minV}{unit}</SvgText>
      <Path d={pathD} stroke="#1a73e8" strokeWidth={2} fill="none" />
      {pts.map((p, i) => (
        <Circle key={i} cx={x(i)} cy={y(p.value)} r={3} fill="#1a73e8" />
      ))}
      {/* X-axis: first + last date */}
      <SvgText x={padL} y={height - 8} fontSize={9} fill="#999">{pts[0].date.slice(5)}</SvgText>
      <SvgText x={w - padR} y={height - 8} fontSize={9} fill="#999" textAnchor="end">
        {pts[pts.length - 1].date.slice(5)}
      </SvgText>
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f6fa' },
  emptyTitle: { fontSize: 16, color: '#666', marginTop: 10 },
  emptyHint: { fontSize: 13, color: '#aaa', marginTop: 4 },

  statRow: { flexDirection: 'row', padding: 12, gap: 8 },
  stat: {
    flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  statValue: { fontSize: 22, fontWeight: '700', color: '#1a73e8' },
  statLabel: { fontSize: 11, color: '#666', marginTop: 4 },

  card: {
    backgroundColor: '#fff', margin: 12, marginTop: 0, borderRadius: 10, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#222' },
  cardSub: { fontSize: 12, color: '#888', marginTop: 2, marginBottom: 10 },

  pickerRow: { paddingVertical: 8, gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#f5f6fa', borderWidth: 1, borderColor: '#eee',
  },
  chipActive: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  chipText: { fontSize: 12, color: '#444' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipCount: { backgroundColor: '#fff', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1 },
  chipCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  chipCountText: { fontSize: 10, color: '#666' },
  chipCountTextActive: { color: '#fff', fontWeight: '700' },
});
