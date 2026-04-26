/**
 * Reusable image-search modal: multi-provider (Pixabay + DuckDuckGo +
 * Wikimedia Commons) thumbnail grid with multi-select → batch-attach via
 * api.addExerciseImage. Extracted from app/workout/admin.tsx so the
 * exercise-picker post-create flow can use the same UX.
 *
 *   <ImageSearchModal
 *     visible={open}
 *     exerciseId={ex.id}
 *     exerciseName={ex.name}
 *     onClose={() => setOpen(false)}
 *     onSaved={() => reload()}
 *   />
 */
import { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, TextInput, ScrollView, Image,
  ActivityIndicator, StyleSheet, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/lib/colors';
import * as api from '@/lib/api';
import type { ImageCandidate } from '@/lib/api';


interface Props {
  visible: boolean;
  exerciseId: number;
  exerciseName: string;
  onClose: () => void;
  onSaved?: () => void;
}

export default function ImageSearchModal({
  visible, exerciseId, exerciseName, onClose, onSaved,
}: Props) {
  const [searchQ, setSearchQ] = useState(exerciseName);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Reset + auto-run on open so the user lands on results instead of
  // a blank modal. Closing clears state so the next open is fresh.
  useEffect(() => {
    if (!visible) {
      setCandidates([]);
      setSelected(new Set());
      setBusy(false);
      return;
    }
    setSearchQ(exerciseName);
    runSearch(exerciseName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, exerciseId, exerciseName]);

  const runSearch = async (q: string) => {
    setSearching(true);
    setCandidates([]);
    setSelected(new Set());
    try {
      const results = await api.searchExerciseImages(exerciseId, q || undefined, 8);
      setCandidates(results);
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const saveSelected = async () => {
    if (selected.size === 0) { onClose(); return; }
    setBusy(true);
    try {
      for (const u of selected) {
        await api.addExerciseImage(exerciseId, u);
      }
      onSaved?.();
      onClose();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Find image for {exerciseName}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close image picker"
            >
              <Ionicons name="close" size={22} color="#888" />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              value={searchQ}
              onChangeText={setSearchQ}
              style={styles.searchInput}
              placeholder="Search query"
              accessibilityLabel="Image search query"
              autoCapitalize="none"
              onSubmitEditing={() => runSearch(searchQ)}
            />
            <Pressable
              style={styles.searchGoBtn}
              onPress={() => runSearch(searchQ)}
              disabled={searching}
              accessibilityRole="button"
              accessibilityLabel="Run image search"
            >
              <Ionicons name="search" size={16} color="#fff" />
            </Pressable>
          </View>

          {searching ? (
            <ActivityIndicator style={{ marginTop: 30 }} size="large" color={colors.primary} />
          ) : candidates.length === 0 ? (
            <Text style={styles.modalEmpty}>No results. Try a different query.</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.candidateGrid}>
              {candidates.map((c) => {
                const isSel = selected.has(c.url);
                return (
                  <Pressable
                    key={c.url}
                    style={[styles.candidateCard, isSel && styles.candidateCardSel]}
                    onPress={() => {
                      const next = new Set(selected);
                      if (isSel) next.delete(c.url); else next.add(c.url);
                      setSelected(next);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSel }}
                    accessibilityLabel={`Image candidate${c.source ? ` from ${c.source}` : ''}`}
                  >
                    <Image
                      source={{ uri: c.thumb || c.url }}
                      style={styles.candidateImg}
                      resizeMode="cover"
                      // accessibilityElementsHidden = iOS, importantForAccessibility = Android,
                      // aria-hidden via spread = react-native-web. Without all three, the inner
                      // image announces twice on top of the parent Pressable's checkbox role.
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      {...({ 'aria-hidden': true } as any)}
                    />
                    {isSel && (
                      <View style={styles.candidateCheck}>
                        <Ionicons name="checkmark-circle" size={24} color="#fff" />
                      </View>
                    )}
                    {c.source && (
                      <Text style={styles.candidateSource} numberOfLines={1}>{c.source}</Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.modalFooter}>
            <Text style={styles.selCount}>
              {selected.size} selected
            </Text>
            <Pressable
              style={[styles.saveSelBtn, (selected.size === 0 || busy) && { opacity: 0.5 }]}
              onPress={saveSelected}
              disabled={selected.size === 0 || busy}
              accessibilityRole="button"
            >
              <Ionicons name="cloud-download" size={14} color="#fff" />
              <Text style={styles.saveSelText}>{busy ? 'Saving…' : `Save ${selected.size}`}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    maxWidth: 480, alignSelf: 'center', width: '100%',
    maxHeight: '90%',
  },
  modalHead: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#222', flex: 1 },
  searchRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  searchInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: '#fafafa',
  },
  searchGoBtn: {
    width: 44, height: 40, borderRadius: 8,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  modalEmpty: {
    textAlign: 'center', color: colors.textMuted, marginTop: 30, fontSize: 13,
  },
  candidateGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start',
  },
  candidateCard: {
    width: '32%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden',
    backgroundColor: '#f0f0f0',
    borderWidth: 2, borderColor: 'transparent',
    cursor: 'pointer' as any,
  },
  candidateCardSel: { borderColor: colors.primary },
  candidateImg: { width: '100%', height: '100%' },
  candidateCheck: {
    position: 'absolute' as any, top: 4, right: 4,
    backgroundColor: colors.primary, borderRadius: 12,
  },
  candidateSource: {
    position: 'absolute' as any, bottom: 0, left: 0, right: 0,
    fontSize: 9, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 4, paddingVertical: 2,
  },
  modalFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 10,
  },
  selCount: { fontSize: 12, color: colors.textMuted },
  saveSelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    cursor: 'pointer' as any,
  },
  saveSelText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
