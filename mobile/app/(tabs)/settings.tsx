import { colors } from "@/lib/colors";
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/lib/stores';
import { useRouter } from 'expo-router';
import * as api from '@/lib/api';
import { loadHomeTab, saveHomeTab, HomeTab } from '@/lib/homeTab';

const HOME_TAB_OPTIONS: { value: HomeTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'tasks', label: 'Tasks', icon: 'checkmark-circle-outline' },
  { value: 'folders', label: 'Folders', icon: 'folder-outline' },
  { value: 'workouts', label: 'Workouts', icon: 'barbell-outline' },
];

export default function SettingsScreen() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [homeTab, setHomeTab] = useState<HomeTab>(() => loadHomeTab());

  const changeHomeTab = (tab: HomeTab) => {
    setHomeTab(tab);
    saveHomeTab(tab);
  };

  const handleLogout = async () => {
    // Alert.alert on RN Web doesn't reliably fire onPress callbacks —
    // logging out from the home-screen PWA was a silent no-op. Mirror
    // the platform-aware confirm pattern used by task / routine delete:
    // window.confirm on web, native Alert.alert elsewhere. Keeps the
    // destructive-confirmation UX consistent and actually invokes the
    // logout call.
    const confirmed: boolean = await new Promise((resolve) => {
      if (Platform.OS === 'web') {
        resolve(window.confirm('Logout?\n\nAre you sure?'));
        return;
      }
      Alert.alert('Logout', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Logout', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;
    await logout();
    router.replace('/(auth)/login');
  };

  const handleExport = async () => {
    setExporting(true);
    setLastResult(null);
    try {
      const data = await api.exportWorkouts();
      const json = JSON.stringify(data, null, 2);
      const filename = `taskapp-workouts-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        setLastResult(`Downloaded ${filename}`);
      } else {
        // Native fallback: copy to clipboard via expo-clipboard isn't installed;
        // for now, alert the size and let the user know to use web for now.
        setLastResult(`Export ready (${json.length} bytes). Use web to download.`);
      }
    } catch (e: any) {
      setLastResult(`Export failed: ${e?.response?.data?.detail || e?.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (Platform.OS !== 'web') {
      Alert.alert('Import', 'Import is currently web-only. Open this app in a browser to import a backup.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setLastResult(null);
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        // Dry-run first so the user sees counts before the actual write.
        const dry = await api.importWorkouts(payload, 'merge', true);
        const proceed = window.confirm(
          `Import plan (merge mode):\n` +
          `  Exercises: +${dry.exercises_added} (skip ${dry.exercises_skipped})\n` +
          `  Routines: +${dry.routines_added} (skip ${dry.routines_skipped})\n` +
          `  Sessions: +${dry.sessions_added}\n` +
          `  Symptoms: +${dry.symptoms_added}\n` +
          (dry.warnings.length ? `  Warnings: ${dry.warnings.length}\n` : '') +
          `\nProceed?`
        );
        if (!proceed) { setLastResult('Import cancelled.'); return; }
        const res = await api.importWorkouts(payload, 'merge', false);
        setLastResult(
          `Imported: ${res.exercises_added} ex, ${res.routines_added} routines, ` +
          `${res.sessions_added} sessions, ${res.symptoms_added} symptoms.` +
          (res.warnings.length ? ` ${res.warnings.length} warning(s).` : '')
        );
      } catch (e: any) {
        setLastResult(`Import failed: ${e?.response?.data?.detail || e?.message}`);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  return (
    <ScrollView
      style={styles.container}
      // Reserve bottom padding so the last row (Logout) isn't hidden
      // behind the floating tab bar on narrow screens. The previous
      // plain <View> had no scroll and clipped content below the
      // viewport entirely on iPhone heights.
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={styles.profileCard}>
        <Ionicons name="person-circle" size={48} color={colors.primary} />
        <View style={{ marginLeft: 12 }}>
          <Text style={styles.name}>{user?.display_name || 'User'}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
      </View>

      <Text style={styles.sectionHeader}>Preferences</Text>

      <View style={styles.prefCard}>
        <Text style={styles.prefLabel}>Home tab</Text>
        <Text style={styles.prefHint}>
          Which tab opens first when you launch the app.
        </Text>
        <View style={styles.prefChipRow}>
          {HOME_TAB_OPTIONS.map((opt) => {
            const active = homeTab === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={[styles.prefChip, active && styles.prefChipActive]}
                onPress={() => changeHomeTab(opt.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Home tab: ${opt.label}`}
              >
                <Ionicons
                  name={opt.icon}
                  size={16}
                  color={active ? '#fff' : colors.primary}
                />
                <Text style={[styles.prefChipText, active && styles.prefChipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text style={styles.sectionHeader}>Workout Data</Text>

      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push('/workout/exercises')}
        accessibilityRole="button"
        accessibilityLabel="Exercise library: edit or delete user-created exercises"
      >
        <Ionicons name="barbell-outline" size={22} color={colors.primary} />
        <Text style={styles.rowText}>Exercise library</Text>
        <Ionicons name="chevron-forward" size={18} color="#bbb" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={handleExport} disabled={exporting}>
        <Ionicons name="download-outline" size={22} color={colors.primary} />
        <Text style={styles.rowText}>Export workouts as JSON</Text>
        {exporting && <ActivityIndicator size="small" color={colors.primary} />}
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={handleImport} disabled={importing}>
        <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
        <Text style={styles.rowText}>Import from JSON backup</Text>
        {importing && <ActivityIndicator size="small" color={colors.primary} />}
      </TouchableOpacity>

      {lastResult && <Text style={styles.resultText}>{lastResult}</Text>}

      <Text style={styles.sectionHeader}>Account</Text>

      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push('/settings/account')}
        accessibilityRole="button"
        accessibilityLabel="Account: password, PIN, display name"
      >
        <Ionicons name="person-outline" size={22} color={colors.primary} />
        <Text style={styles.rowText}>Password, PIN, display name</Text>
        <Ionicons name="chevron-forward" size={18} color="#bbb" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={22} color={colors.danger} />
        <Text style={[styles.rowText, { color: '#e74c3c' }]}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 20, marginBottom: 12 },
  name: { fontSize: 18, fontWeight: '600', color: '#333' },
  email: { fontSize: 14, color: colors.textMuted },
  prefCard: {
    backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 6,
    borderRadius: 10, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  prefLabel: { fontSize: 14, fontWeight: '600', color: '#222' },
  prefHint: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 10 },
  prefChipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  prefChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: '#f5f6fa', borderWidth: 1, borderColor: '#e3e7ee',
    cursor: 'pointer' as any,
  },
  prefChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  prefChipText: { fontSize: 13, color: '#444', fontWeight: '600' },
  prefChipTextActive: { color: '#fff' },
  sectionHeader: {
    fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  rowText: { fontSize: 16, flex: 1 },
  resultText: {
    fontSize: 13, color: '#555', padding: 12, backgroundColor: '#eaf2fe',
    margin: 12, borderRadius: 6,
  },
});
