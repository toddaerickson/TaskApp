import { colors } from "@/lib/colors";
import { useState } from 'react';
import {
  View, Text, Pressable, Modal, FlatList, StyleSheet, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface DropdownOption<T = any> {
  value: T;
  label: string;
}

interface Props<T = any> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function Dropdown<T = any>({
  value, options, onChange, placeholder = 'Select…', disabled,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        style={[styles.trigger, disabled && { opacity: 0.5 }]}
        onPress={() => !disabled && setOpen(true)}
        accessibilityRole="combobox"
        accessibilityLabel={`${placeholder}, ${current?.label ?? 'not set'}`}
      >
        <Text style={[styles.triggerText, !current && { color: colors.textMuted }]}>
          {current?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color="#666" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{placeholder}</Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color="#888" />
              </Pressable>
            </View>
            <FlatList
              data={options}
              keyExtractor={(o) => String(o.value)}
              renderItem={({ item }) => {
                const selected = item.value === value;
                return (
                  <Pressable
                    style={[styles.row, selected && styles.rowSel]}
                    onPress={() => { onChange(item.value); setOpen(false); }}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.rowText, selected && styles.rowTextSel]}>{item.label}</Text>
                    {selected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </Pressable>
                );
              }}
              style={{ maxHeight: 380 }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: '#fff',
    cursor: Platform.OS === 'web' ? ('pointer' as any) : undefined,
  },
  triggerText: { fontSize: 15, color: '#333' },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', padding: 20,
  },
  sheet: {
    backgroundColor: '#fff', borderRadius: 10, maxWidth: 500, width: '100%',
    alignSelf: 'center', overflow: 'hidden',
  },
  sheetHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  sheetTitle: { fontSize: 14, fontWeight: '700', color: '#666', textTransform: 'uppercase' },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f3f3f3',
    cursor: Platform.OS === 'web' ? ('pointer' as any) : undefined,
  },
  rowSel: { backgroundColor: '#e8f0fe' },
  rowText: { fontSize: 15, color: '#333', flex: 1 },
  rowTextSel: { color: colors.primary, fontWeight: '600' },
});
