import { colors } from "@/lib/colors";
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/lib/stores';
import { useRouter } from 'expo-router';
import * as api from '@/lib/api';

export default function SettingsScreen() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
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
    <View style={styles.container}>
      <View style={styles.profileCard}>
        <Ionicons name="person-circle" size={48} color={colors.primary} />
        <View style={{ marginLeft: 12 }}>
          <Text style={styles.name}>{user?.display_name || 'User'}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
      </View>

      <Text style={styles.sectionHeader}>Workout Data</Text>

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

      <TouchableOpacity style={styles.row} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={22} color={colors.danger} />
        <Text style={[styles.rowText, { color: '#e74c3c' }]}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 20, marginBottom: 12 },
  name: { fontSize: 18, fontWeight: '600', color: '#333' },
  email: { fontSize: 14, color: colors.textMuted },
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
