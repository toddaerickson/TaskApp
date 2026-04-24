import { colors } from "@/lib/colors";
import { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Platform, ScrollView,
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
  compact?: boolean;
}

export default function Dropdown<T = any>({
  value, options, onChange, placeholder = 'Select…', disabled, compact,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <View style={styles.wrapper}>
      <Pressable
        style={[styles.trigger, compact && styles.triggerCompact, disabled && { opacity: 0.5 }]}
        onPress={() => !disabled && setOpen(!open)}
        accessibilityRole="combobox"
        accessibilityLabel={`${placeholder}, ${current?.label ?? 'not set'}`}
        accessibilityState={{ expanded: open }}
      >
        <Text
          style={[styles.triggerText, compact && styles.triggerTextCompact, !current && { color: colors.textMuted }]}
          numberOfLines={1}
        >
          {current?.label ?? placeholder}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={compact ? 14 : 18} color="#666" />
      </Pressable>

      {open && (
        <View style={styles.listContainer}>
          <ScrollView style={styles.list} nestedScrollEnabled>
            {options.map((item) => {
              const selected = item.value === value;
              return (
                <Pressable
                  key={String(item.value)}
                  style={[styles.row, selected && styles.rowSel]}
                  onPress={() => { onChange(item.value); setOpen(false); }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.rowText, selected && styles.rowTextSel]}>{item.label}</Text>
                  {selected && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' as any, zIndex: 100 },
  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: '#fff',
    cursor: Platform.OS === 'web' ? ('pointer' as any) : undefined,
  },
  triggerText: { fontSize: 15, color: '#333', flex: 1 },
  triggerCompact: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6 },
  triggerTextCompact: { fontSize: 13 },

  listContainer: {
    position: 'absolute' as any, top: '100%', left: 0, right: 0,
    zIndex: 9999, marginTop: 2,
    backgroundColor: '#fff', borderRadius: 8,
    borderWidth: 1, borderColor: '#ddd',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  list: { maxHeight: 200 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f3f3f3',
    cursor: Platform.OS === 'web' ? ('pointer' as any) : undefined,
  },
  rowSel: { backgroundColor: '#e8f0fe' },
  rowText: { fontSize: 14, color: '#333', flex: 1 },
  rowTextSel: { color: colors.primary, fontWeight: '600' },
});
