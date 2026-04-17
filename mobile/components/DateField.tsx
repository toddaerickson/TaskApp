import { colors } from "@/lib/colors";
import { useState } from 'react';
import {
  View, Text, Pressable, Platform, StyleSheet, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Lazy native picker import so web bundlers don't pull it in.
let NativePicker: any = null;
if (Platform.OS !== 'web') {
  try { NativePicker = require('@react-native-community/datetimepicker').default; }
  catch { NativePicker = null; }
}

interface Props {
  /** ISO date string "YYYY-MM-DD" or empty. */
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
}

function pretty(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

export default function DateField({ value, onChange, placeholder = 'Pick a date' }: Props) {
  const [open, setOpen] = useState(false);
  const [webText, setWebText] = useState(value);

  // ---- Web: use the HTML5 <input type="date"> ----
  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrap}>
        {/*
         * RN-web renders TextInput as an input — we still need type="date".
         * Easiest: reach for the raw input via a thin view.
         */}
        <View style={styles.webInputWrap}>
          {/* Raw <input type="date"> is the simplest date UX on web. */}
          {(() => {
            const InputAny = 'input' as any;
            return (
              <InputAny
                type="date"
                value={webText}
                onChange={(e: any) => { setWebText(e.target.value); onChange(e.target.value); }}
                style={{
                  flex: 1, border: 'none', outline: 'none', fontSize: 15,
                  backgroundColor: 'transparent', color: '#333', padding: 0,
                }}
              />
            );
          })()}
          {webText ? (
            <Pressable onPress={() => { setWebText(''); onChange(''); }} accessibilityLabel="Clear date">
              <Ionicons name="close-circle" size={18} color="#bbb" />
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  // ---- Native: tap to open the platform picker ----
  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setOpen(true)}>
        <Text style={[styles.text, !value && { color: '#999' }]}>
          {value ? pretty(value) : placeholder}
        </Text>
        {value ? (
          <Pressable onPress={(e) => { e.stopPropagation?.(); onChange(''); }}>
            <Ionicons name="close-circle" size={18} color="#bbb" />
          </Pressable>
        ) : (
          <Ionicons name="calendar-outline" size={18} color="#666" />
        )}
      </Pressable>

      {open && NativePicker && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
            <View style={styles.sheet}>
              <NativePicker
                value={value ? new Date(value) : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(event: any, d?: Date) => {
                  // Android fires once and auto-dismisses. iOS stays open.
                  if (Platform.OS === 'android') setOpen(false);
                  if (d && event?.type !== 'dismissed') {
                    onChange(d.toISOString().slice(0, 10));
                  }
                }}
              />
              {Platform.OS === 'ios' && (
                <Pressable style={styles.doneBtn} onPress={() => setOpen(false)}>
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  webInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff',
  },
  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff',
  },
  text: { fontSize: 15, color: '#333' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 12, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  doneBtn: { padding: 12, alignItems: 'center' },
  doneText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
});
