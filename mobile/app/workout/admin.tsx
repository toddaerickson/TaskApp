import { colors } from "@/lib/colors";
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput, Image, ActivityIndicator, Platform, Modal,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Exercise } from '@/lib/stores';
import * as api from '@/lib/api';
import type { ImageCandidate } from '@/lib/api';

const SAMPLE = `# Paste one row per URL: slug<TAB>url
# Or multiple URLs per slug on one row: slug<TAB>url1<TAB>url2
# Lines starting with # are ignored.
wall_ankle_dorsiflexion\thttps://example.com/wall-stretch.jpg
single_leg_glute_bridge\thttps://example.com/sl-bridge.jpg`;

interface ParsedRow {
  slug: string;
  urls: string[];
  line: number;
  error?: string;
}

function parsePaste(text: string, knownSlugs: Set<string>): ParsedRow[] {
  const out: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);
  const merged = new Map<string, { urls: string[]; line: number }>();
  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split(/\t|,/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      out.push({ slug: trimmed, urls: [], line: idx + 1, error: 'no url on this line' });
      return;
    }
    const [slug, ...urls] = parts;
    const existing = merged.get(slug);
    if (existing) {
      existing.urls.push(...urls);
    } else {
      merged.set(slug, { urls: [...urls], line: idx + 1 });
    }
  });
  for (const [slug, { urls, line }] of merged) {
    const error = knownSlugs.has(slug) ? undefined : `unknown slug`;
    out.push({ slug, urls, line, error });
  }
  return [...out].sort((a, b) => a.line - b.line);
}

export default function AdminScreen() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [paste, setPaste] = useState('');
  const [replace, setReplace] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Filter state. Query matches name OR slug, case-insensitive.
  // `categoryFilter === null` means "All". `needsImage` shows only
  // exercises with zero images — most useful for finishing the library.
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [needsImage, setNeedsImage] = useState(false);

  const reload = () => {
    setLoading(true);
    api.getExercises()
      .then(setExercises)
      .catch((e) => console.warn('[admin] getExercises failed:', e))
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const knownSlugs = useMemo(
    () => new Set(exercises.filter((e) => e.slug).map((e) => e.slug as string)),
    [exercises]
  );
  const parsed = useMemo(() => parsePaste(paste, knownSlugs), [paste, knownSlugs]);

  const applyable = parsed.filter((r) => !r.error && r.urls.length > 0);

  // Unique categories across the current library, alphabetized. Recomputed
  // whenever the list reloads so new categories show up without a refresh.
  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const e of exercises) if (e.category) s.add(e.category);
    return [...s].sort();
  }, [exercises]);

  const filteredExercises = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((e) => {
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (needsImage && e.images.length > 0) return false;
      if (q) {
        const hay = `${e.name} ${e.slug || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [exercises, query, categoryFilter, needsImage]);

  const handleApply = async () => {
    if (applyable.length === 0) return;
    setApplying(true);
    setResult(null);
    try {
      const res = await api.bulkExerciseImages(
        applyable.map((r) => ({ slug: r.slug, urls: r.urls, replace }))
      );
      const addedTotal = res.reduce((s, r) => s + r.added, 0);
      const replacedTotal = res.reduce((s, r) => s + r.replaced, 0);
      const notFound = res.filter((r) => r.status === 'not_found').map((r) => r.slug);
      setResult(
        `Added ${addedTotal} image${addedTotal === 1 ? '' : 's'}`
        + (replacedTotal ? ` (replaced ${replacedTotal})` : '')
        + (notFound.length ? `. Not found: ${notFound.join(', ')}` : '.')
      );
      setPaste('');
      reload();
    } catch (e: any) {
      setResult(`Error: ${e?.response?.data?.detail || e?.message || 'unknown'}`);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.primary} />;
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Image Admin' }} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
        {/* Paste panel */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bulk paste URLs</Text>
          <Text style={styles.hint}>
            Tab- or comma-separated. One row per URL or multiple URLs per row. Copy-pastable from a spreadsheet.
          </Text>
          <TextInput
            style={styles.pasteBox}
            placeholder={SAMPLE}
            placeholderTextColor="#bbb"
            value={paste}
            onChangeText={setPaste}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />

          {parsed.length > 0 && (
            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>Preview ({parsed.length} row{parsed.length === 1 ? '' : 's'})</Text>
              {parsed.map((r, i) => (
                <View key={`${r.slug}-${i}`} style={styles.previewRow}>
                  <Text style={[styles.previewSlug, r.error && { color: colors.danger }]}>{r.slug}</Text>
                  <Text style={styles.previewUrls} numberOfLines={2}>
                    {r.error ? `⚠ ${r.error}` : `${r.urls.length} url${r.urls.length === 1 ? '' : 's'}`}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.applyRow}>
            <Pressable style={styles.checkRow} onPress={() => setReplace(!replace)}>
              <Ionicons
                name={replace ? 'checkbox' : 'square-outline'}
                size={18} color={replace ? colors.warning : '#999'}
              />
              <Text style={styles.checkLabel}>Replace existing (instead of append)</Text>
            </Pressable>
            <Pressable
              style={[
                styles.applyBtn,
                (applying || applyable.length === 0) && { opacity: 0.5 },
              ]}
              onPress={handleApply}
              disabled={applying || applyable.length === 0}
            >
              <Ionicons name="cloud-upload" size={16} color="#fff" />
              <Text style={styles.applyBtnText}>
                {applying ? 'Applying…' : `Apply ${applyable.length}`}
              </Text>
            </Pressable>
          </View>

          {result && <Text style={styles.resultText}>{result}</Text>}
        </View>

        {/* Filter bar */}
        <View style={styles.filterBar}>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={14} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInputMain}
              placeholder="Search by name or slug…"
              placeholderTextColor="#aaa"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search exercises"
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={16} color="#aaa" />
              </Pressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catChipRow}
          >
            <FilterChip
              label="All"
              active={categoryFilter === null}
              onPress={() => setCategoryFilter(null)}
            />
            {categories.map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={categoryFilter === c}
                onPress={() => setCategoryFilter(categoryFilter === c ? null : c)}
              />
            ))}
            <FilterChip
              label="Needs image"
              active={needsImage}
              onPress={() => setNeedsImage(!needsImage)}
              tone="warn"
            />
          </ScrollView>
        </View>

        <Text style={styles.sectionTitle}>
          Exercises ({filteredExercises.length}
          {filteredExercises.length !== exercises.length ? ` of ${exercises.length}` : ''})
        </Text>
        {filteredExercises.length === 0 ? (
          <View style={styles.emptyResults}>
            <Ionicons name="search-outline" size={32} color="#ccc" />
            <Text style={styles.emptyResultsText}>No exercises match these filters.</Text>
          </View>
        ) : (
          filteredExercises.map((ex) => (
            <ExerciseRow key={ex.id} exercise={ex} onChange={reload} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function FilterChip({ label, active, onPress, tone }: {
  label: string;
  active: boolean;
  onPress: () => void;
  tone?: 'warn';
}) {
  const activeBg = tone === 'warn' ? colors.warning : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.catChip,
        active && { backgroundColor: activeBg, borderColor: activeBg },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.catChipText, active && styles.catChipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ExerciseRow({ exercise, onChange }: { exercise: Exercise; onChange: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [searchQ, setSearchQ] = useState(exercise.name);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState(exercise.name);
  const [instructions, setInstructions] = useState(exercise.instructions || '');
  const [cue, setCue] = useState(exercise.cue || '');
  const [primaryMuscle, setPrimaryMuscle] = useState(exercise.primary_muscle || '');
  const [equipment, setEquipment] = useState(exercise.equipment || '');
  const dirty = name !== exercise.name
    || instructions !== (exercise.instructions || '')
    || cue !== (exercise.cue || '')
    || primaryMuscle !== (exercise.primary_muscle || '')
    || equipment !== (exercise.equipment || '');

  const handleSaveEdit = async () => {
    setBusy(true);
    try {
      await api.updateExercise(exercise.id, {
        name, instructions, cue,
        primary_muscle: primaryMuscle,
        equipment,
      });
      onChange();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await api.addExerciseImage(exercise.id, url.trim());
      setUrl('');
      onChange();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (imageId: number) => {
    if (Platform.OS === 'web' && !window.confirm('Remove image?')) return;
    setBusy(true);
    try {
      await api.deleteExerciseImage(imageId);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async (q: string) => {
    setSearching(true);
    setCandidates([]);
    setSelected(new Set());
    try {
      const results = await api.searchExerciseImages(exercise.id, q || undefined, 8);
      setCandidates(results);
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const openPicker = () => {
    setSearchQ(exercise.name);
    setPickerOpen(true);
    runSearch(exercise.name);
  };

  const saveSelected = async () => {
    if (selected.size === 0) { setPickerOpen(false); return; }
    setBusy(true);
    try {
      for (const u of selected) {
        await api.addExerciseImage(exercise.id, u);
      }
      setPickerOpen(false);
      onChange();
    } catch (e: any) {
      if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.exRow}>
      <Pressable style={styles.exHeader} onPress={() => setExpanded(!expanded)}>
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={16} color="#999"
        />
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Text style={styles.exName}>{exercise.name}</Text>
          <Text style={styles.exSlug}>{exercise.slug || '—'}</Text>
        </View>
        <Text style={styles.exCount}>{exercise.images.length}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.editPanel}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput value={name} onChangeText={setName} style={styles.fieldInput} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Primary muscle</Text>
              <TextInput value={primaryMuscle} onChangeText={setPrimaryMuscle} style={styles.fieldInput} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Equipment</Text>
              <TextInput value={equipment} onChangeText={setEquipment} style={styles.fieldInput} />
            </View>
          </View>
          <Text style={styles.fieldLabel}>Instructions</Text>
          <TextInput
            value={instructions}
            onChangeText={setInstructions}
            multiline
            style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top' }]}
          />
          <Text style={styles.fieldLabel}>Cue</Text>
          <TextInput
            value={cue}
            onChangeText={setCue}
            multiline
            style={[styles.fieldInput, { minHeight: 40, textAlignVertical: 'top' }]}
          />
          <Pressable
            style={[styles.saveEditBtn, (!dirty || busy) && { opacity: 0.5 }]}
            onPress={handleSaveEdit}
            disabled={!dirty || busy}
          >
            <Ionicons name="save-outline" size={14} color="#fff" />
            <Text style={styles.saveEditText}>{busy ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}</Text>
          </Pressable>
        </View>
      )}

      {exercise.images.length > 0 && (
        <ScrollView horizontal style={styles.imgRow} showsHorizontalScrollIndicator={false}>
          {exercise.images.map((img) => (
            <View key={img.id} style={styles.imgWrap}>
              <Image source={{ uri: img.url }} style={styles.img} resizeMode="cover" />
              <Pressable
                style={styles.imgDelete}
                onPress={() => handleDelete(img.id)}
                accessibilityRole="button"
                accessibilityLabel="Remove this image"
              >
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.addImgRow}>
        <TextInput
          style={styles.addImgInput}
          placeholder="Paste image URL…"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleAdd}
        />
        <Pressable
          style={[styles.addImgBtn, (!url.trim() || busy) && { opacity: 0.5 }]}
          onPress={handleAdd}
          disabled={!url.trim() || busy}
        >
          <Ionicons name="add" size={18} color="#fff" />
        </Pressable>
        <Pressable style={styles.searchBtn} onPress={openPicker}>
          <Ionicons name="sparkles" size={14} color="#fff" />
          <Text style={styles.searchBtnText}>Find</Text>
        </Pressable>
        <Pressable
          style={styles.searchBtnAlt}
          onPress={() => openImageSearch(exercise.name)}
          accessibilityRole="link"
          accessibilityLabel={`Open Google Images search for ${exercise.name}`}
        >
          <Ionicons name="open-outline" size={14} color="#666" />
        </Pressable>
      </View>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Find image for {exercise.name}</Text>
              <Pressable
                onPress={() => setPickerOpen(false)}
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
                autoCapitalize="none"
                onSubmitEditing={() => runSearch(searchQ)}
              />
              <Pressable
                style={styles.searchGoBtn}
                onPress={() => runSearch(searchQ)}
                disabled={searching}
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
                    >
                      <Image
                        source={{ uri: c.thumb || c.url }}
                        style={styles.candidateImg}
                        resizeMode="cover"
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
              >
                <Ionicons name="cloud-download" size={14} color="#fff" />
                <Text style={styles.saveSelText}>{busy ? 'Saving…' : `Save ${selected.size}`}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function openImageSearch(query: string) {
  const q = encodeURIComponent(query);
  const url = `https://www.google.com/search?tbm=isch&q=${q}`;
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    // Native: lazy-require Linking so web bundler doesn't complain.
    const { Linking } = require('react-native');
    Linking.openURL(url).catch((e: unknown) => console.warn('[admin] openURL failed:', e));
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },

  card: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#222' },
  hint: { fontSize: 12, color: '#888', marginTop: 4, marginBottom: 10 },
  pasteBox: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10,
    fontSize: 13, minHeight: 120, textAlignVertical: 'top',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    backgroundColor: '#fafafa',
  },
  previewBox: {
    marginTop: 10, backgroundColor: '#f5f6fa', borderRadius: 6, padding: 10,
  },
  previewTitle: { fontSize: 12, color: '#666', fontWeight: '700', marginBottom: 6 },
  previewRow: { flexDirection: 'row', paddingVertical: 3 },
  previewSlug: { flex: 1, fontSize: 12, color: '#222', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  previewUrls: { flex: 1, fontSize: 12, color: '#666', textAlign: 'right' },

  applyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, cursor: 'pointer' as any },
  checkLabel: { fontSize: 12, color: '#666' },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8,
    cursor: 'pointer' as any,
  },
  applyBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  resultText: { marginTop: 10, fontSize: 13, color: colors.success },

  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: '#999', textTransform: 'uppercase',
    letterSpacing: 1, paddingVertical: 8,
  },

  filterBar: { marginBottom: 4 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: '#e3e7ee',
  },
  searchIcon: { width: 14 },
  searchInputMain: {
    flex: 1, fontSize: 14, color: '#222',
    paddingVertical: Platform.OS === 'web' ? 0 : 2,
  },
  catChipRow: { gap: 6, paddingTop: 10, paddingBottom: 2, paddingRight: 12 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee',
    cursor: 'pointer' as any,
  },
  catChipText: { fontSize: 12, color: '#555', fontWeight: '600' },
  catChipTextActive: { color: '#fff' },
  emptyResults: {
    alignItems: 'center', paddingVertical: 30, gap: 8,
  },
  emptyResultsText: { color: '#999', fontSize: 13 },


  exRow: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
  },
  exHeader: { flexDirection: 'row', alignItems: 'center' },
  exName: { fontSize: 14, fontWeight: '600', color: '#222' },
  exSlug: { fontSize: 11, color: '#999', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  exCount: {
    fontSize: 11, color: '#666', backgroundColor: '#eee',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  imgRow: { marginTop: 8 },
  imgWrap: { marginRight: 6, position: 'relative' },
  img: { width: 80, height: 80, borderRadius: 6, backgroundColor: '#f0f0f0' },
  imgDelete: {
    position: 'absolute', top: 2, right: 2,
    backgroundColor: 'rgba(231,76,60,0.9)', borderRadius: 10, padding: 2,
    cursor: 'pointer' as any,
  },
  addImgRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  addImgInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8,
    fontSize: 12, backgroundColor: '#fafafa',
  },
  addImgBtn: {
    backgroundColor: colors.success, borderRadius: 6, width: 34, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  searchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, borderRadius: 6, backgroundColor: colors.primary,
    cursor: 'pointer' as any,
  },
  searchBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  searchBtnAlt: {
    paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#f5f6fa',
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16,
    maxWidth: 700, maxHeight: '90%', alignSelf: 'center', width: '100%',
  },
  modalHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#222', flex: 1 },
  searchRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  searchInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8,
    fontSize: 13, backgroundColor: '#fafafa',
  },
  searchGoBtn: {
    backgroundColor: colors.primary, borderRadius: 6,
    paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer' as any,
  },
  modalEmpty: { textAlign: 'center', color: '#999', padding: 30 },
  candidateGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  candidateCard: {
    width: 150, borderRadius: 8, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
    cursor: 'pointer' as any,
  },
  candidateCardSel: { borderColor: colors.success },
  candidateImg: { width: '100%', height: 120, backgroundColor: '#f0f0f0' },
  candidateCheck: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(39, 174, 96, 0.95)', borderRadius: 12, padding: 1,
  },
  candidateSource: {
    fontSize: 10, color: '#666', padding: 4, backgroundColor: '#f5f6fa',
  },
  modalFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#eee',
  },
  selCount: { fontSize: 13, color: '#666' },
  saveSelBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.success, borderRadius: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    cursor: 'pointer' as any,
  },
  saveSelText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  editPanel: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
  },
  fieldLabel: { fontSize: 11, color: '#888', fontWeight: '600', marginTop: 8, marginBottom: 4 },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8,
    fontSize: 13, backgroundColor: '#fafafa',
  },
  saveEditBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: 6, padding: 8, marginTop: 10,
    cursor: 'pointer' as any,
  },
  saveEditText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
