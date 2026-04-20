import { colors } from "@/lib/colors";
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput, Platform, Modal,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as api from '@/lib/api';
import { severityColor, prettyPart, formatRel } from '@/lib/format';
import { useUndoSnackbar } from '@/components/UndoSnackbar';

interface SymptomLog {
  id: number;
  body_part: string;
  severity: number;
  notes: string | null;
  logged_at: string;
  session_id: number | null;
}

const COMMON_PARTS = [
  'right_big_toe',
  'right_calf',
  'right_hip',
  'left_calf',
  'lower_back',
  'right_knee',
  'left_knee',
  'right_shoulder',
];

export default function TrackScreen() {
  const undo = useUndoSnackbar();
  const [logs, setLogs] = useState<SymptomLog[]>([]);
  const [bodyPart, setBodyPart] = useState<string>(COMMON_PARTS[0]);
  const [customPart, setCustomPart] = useState('');
  const [severity, setSeverity] = useState(3);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit-sheet state. `editing` is the full log being edited (includes id)
  // so Save can PATCH by id; the form fields are separate so the cancel
  // button can bail out without mutating the list.
  const [editing, setEditing] = useState<SymptomLog | null>(null);
  const [eSeverity, setESeverity] = useState(3);
  const [eNotes, setENotes] = useState('');
  const [eBodyPart, setEBodyPart] = useState('');
  const [eBusy, setEBusy] = useState(false);

  // IDs queued for delete. We hide them from the list immediately so the
  // undo window is a pure local operation; the server round-trip happens
  // only when the snackbar times out.
  const [pendingDelete, setPendingDelete] = useState<Set<number>>(new Set());

  const reload = () => {
    api.listSymptoms({ limit: 200 })
      .then(setLogs)
      .catch((e) => console.warn('[track] listSymptoms failed:', e));
  };

  useEffect(reload, []);

  const openEdit = (l: SymptomLog) => {
    setEditing(l);
    setESeverity(l.severity);
    setENotes(l.notes ?? '');
    setEBodyPart(l.body_part);
  };

  const submitEdit = async () => {
    if (!editing) return;
    setEBusy(true);
    try {
      await api.updateSymptom(editing.id, {
        body_part: eBodyPart,
        severity: eSeverity,
        notes: eNotes.trim() || null,
      });
      setEditing(null);
      reload();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Save failed');
    } finally {
      setEBusy(false);
    }
  };

  const deleteLog = (l: SymptomLog) => {
    setPendingDelete((prev) => new Set(prev).add(l.id));
    undo.show({
      message: 'Symptom log removed',
      onUndo: () => {
        setPendingDelete((prev) => {
          const next = new Set(prev);
          next.delete(l.id);
          return next;
        });
      },
      onTimeout: async () => {
        try {
          await api.deleteSymptom(l.id);
        } finally {
          setPendingDelete((prev) => {
            const next = new Set(prev);
            next.delete(l.id);
            return next;
          });
          reload();
        }
      },
    });
  };

  // Hide queued-for-delete logs from rendering without touching the
  // source `logs` state — the undo path reuses it.
  const visibleLogs = useMemo(
    () => logs.filter((l) => !pendingDelete.has(l.id)),
    [logs, pendingDelete],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, SymptomLog[]>();
    for (const l of visibleLogs) {
      const arr = m.get(l.body_part) || [];
      arr.push(l);
      m.set(l.body_part, arr);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [visibleLogs]);

  const handleSave = async () => {
    const part = (customPart.trim() || bodyPart).toLowerCase().replace(/\s+/g, '_');
    if (!part) return;
    setSaving(true);
    try {
      await api.logSymptom({ body_part: part, severity, notes: notes.trim() || undefined });
      setNotes('');
      setCustomPart('');
      setSeverity(3);
      reload();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Symptom Tracker' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Quick log */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log a symptom</Text>

          <Text style={styles.label}>Body part</Text>
          <View style={styles.partRow}>
            {COMMON_PARTS.map((p) => (
              <Pressable
                key={p}
                style={[styles.partChip, bodyPart === p && !customPart && styles.partChipActive]}
                onPress={() => { setBodyPart(p); setCustomPart(''); }}
              >
                <Text style={[styles.partChipText, bodyPart === p && !customPart && styles.partChipTextActive]}>
                  {prettyPart(p)}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            placeholder="…or type custom (e.g. left_achilles)"
            accessibilityLabel="Custom body part"
            value={customPart}
            onChangeText={setCustomPart}
            style={styles.input}
          />

          <Text style={styles.label}>Severity ({severity}/10)</Text>
          <View style={styles.sevRow}>
            {Array.from({ length: 11 }).map((_, n) => (
              <Pressable
                key={n}
                onPress={() => setSeverity(n)}
                style={[
                  styles.sevDot,
                  { backgroundColor: severity === n ? severityColor(n) : '#eee' },
                ]}
              >
                <Text style={[styles.sevNum, severity === n && { color: '#fff', fontWeight: '700' }]}>
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Notes</Text>
          <TextInput
            placeholder="What did it feel like? When?"
            accessibilityLabel="Symptom notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
          />

          <Pressable
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Ionicons name="add-circle" size={18} color="#fff" />
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Log symptom'}</Text>
          </Pressable>
        </View>

        {/* Trends */}
        <Text style={styles.sectionTitle}>Trends</Text>
        {grouped.length === 0 && (
          <Text style={styles.empty}>No symptom logs yet. Log one above to start tracking.</Text>
        )}
        {grouped.map(([part, items]) => {
          const recent = items.slice(0, 14); // up to last 14 logs for sparkline
          const avg = items.reduce((s, i) => s + i.severity, 0) / items.length;
          const latest = items[0];
          const oldest = items[items.length - 1];
          const trend = items.length > 1
            ? latest.severity - oldest.severity
            : 0;
          return (
            <View key={part} style={styles.trendCard}>
              <View style={styles.trendHead}>
                <Text style={styles.trendPart}>{prettyPart(part)}</Text>
                <View style={styles.trendStats}>
                  <Text style={styles.trendStat}>
                    avg <Text style={{ fontWeight: '700' }}>{avg.toFixed(1)}</Text>
                  </Text>
                  <Text style={styles.trendStat}>
                    latest <Text style={{ color: severityColor(latest.severity), fontWeight: '700' }}>
                      {latest.severity}
                    </Text>
                  </Text>
                  {items.length > 1 && (
                    <View style={[
                      styles.trendArrow,
                      { backgroundColor: trend < 0 ? colors.success : trend > 0 ? colors.danger : '#999' },
                    ]}>
                      <Ionicons
                        name={trend < 0 ? 'arrow-down' : trend > 0 ? 'arrow-up' : 'remove'}
                        size={11} color="#fff"
                      />
                      <Text style={styles.trendArrowText}>
                        {trend === 0 ? 'flat' : `${trend > 0 ? '+' : ''}${trend}`}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Sparkline as colored bars */}
              <View style={styles.sparkline}>
                {recent.slice().reverse().map((l) => (
                  <View
                    key={l.id}
                    style={[
                      styles.sparkBar,
                      {
                        height: 4 + l.severity * 3,
                        backgroundColor: severityColor(l.severity),
                      },
                    ]}
                  />
                ))}
              </View>

              {/* Recent entries */}
              {items.slice(0, 4).map((l) => (
                <Pressable
                  key={l.id}
                  style={styles.logRow}
                  onPress={() => openEdit(l)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit symptom log from ${formatRel(l.logged_at)}, severity ${l.severity}`}
                >
                  <View style={[styles.sevPill, { backgroundColor: severityColor(l.severity) }]}>
                    <Text style={styles.sevPillText}>{l.severity}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    {l.notes ? <Text style={styles.logNotes}>{l.notes}</Text> : null}
                    <Text style={styles.logTime}>
                      {formatRel(l.logged_at)}
                      {l.session_id ? ' · during workout' : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={(e) => { e.stopPropagation(); deleteLog(l); }}
                    hitSlop={8}
                    style={styles.trashBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Delete symptom log"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  </Pressable>
                </Pressable>
              ))}
              {items.length > 4 && (
                <Text style={styles.moreText}>+ {items.length - 4} more</Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Edit sheet */}
      <Modal
        visible={editing !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.editOverlay}>
          <View style={styles.editCard}>
            <View style={styles.editHead}>
              <Text style={styles.cardTitle}>Edit symptom</Text>
              <Pressable
                onPress={() => setEditing(null)}
                accessibilityRole="button"
                accessibilityLabel="Close edit sheet"
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color="#888" />
              </Pressable>
            </View>
            <Text style={styles.label}>Body part</Text>
            <TextInput
              style={styles.input}
              value={eBodyPart}
              onChangeText={setEBodyPart}
              accessibilityLabel="Body part"
              autoCapitalize="none"
            />
            <Text style={styles.label}>Severity ({eSeverity}/10)</Text>
            <View style={styles.sevRow}>
              {Array.from({ length: 11 }).map((_, n) => (
                <Pressable
                  key={n}
                  onPress={() => setESeverity(n)}
                  style={[
                    styles.sevDot,
                    { backgroundColor: eSeverity === n ? severityColor(n) : '#eee' },
                  ]}
                  accessibilityLabel={`Severity ${n}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: eSeverity === n }}
                >
                  <Text style={[styles.sevNum, eSeverity === n && { color: '#fff', fontWeight: '700' }]}>
                    {n}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              value={eNotes}
              onChangeText={setENotes}
              multiline
              accessibilityLabel="Symptom notes"
              placeholder="What did it feel like?"
              placeholderTextColor="#bbb"
            />
            <Pressable
              style={[styles.saveBtn, eBusy && { opacity: 0.6 }]}
              onPress={submitEdit}
              disabled={eBusy}
              accessibilityRole="button"
            >
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>{eBusy ? 'Saving…' : 'Save changes'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  card: {
    backgroundColor: '#fff', margin: 12, borderRadius: 10, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 12 },
  label: { fontSize: 12, color: colors.textMuted, marginTop: 12, marginBottom: 6, fontWeight: '600' },

  partRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  partChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#f5f6fa', borderWidth: 1, borderColor: '#eee',
    cursor: 'pointer' as any,
  },
  partChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  partChipText: { fontSize: 12, color: '#444' },
  partChipTextActive: { color: '#fff', fontWeight: '600' },

  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10,
    fontSize: 14, marginTop: 8, backgroundColor: '#fff',
  },

  sevRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  sevDot: {
    flex: 1, aspectRatio: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  sevNum: { fontSize: 12, color: '#666' },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8, padding: 12, marginTop: 16,
    cursor: 'pointer' as any,
  },
  saveBtnText: { color: '#fff', fontWeight: '700' },

  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
  },
  empty: { textAlign: 'center', color: '#aaa', padding: 20 },

  trendCard: {
    backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8,
    borderRadius: 10, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  trendHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trendPart: { fontSize: 15, fontWeight: '700', color: '#222' },
  trendStats: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trendStat: { fontSize: 12, color: '#666' },
  trendArrow: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10,
  },
  trendArrowText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  sparkline: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 3,
    height: 40, marginTop: 12, marginBottom: 4,
  },
  sparkBar: { flex: 1, borderRadius: 2, minHeight: 4 },

  logRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
  },
  sevPill: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  sevPillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  logNotes: { fontSize: 13, color: '#444' },
  logTime: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  moreText: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  trashBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },

  editOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 20,
  },
  editCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },
  editHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
});
