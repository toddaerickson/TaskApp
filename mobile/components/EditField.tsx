/**
 * Small labeled numeric/text input used throughout the workout editors.
 *
 * Extracted from [routineId].tsx where the inline RoutineExerciseEdit
 * and InlineDoseEditor both composed it inline. Now also used by the
 * SessionSetEditSheet tap-to-edit flow. Keeping one component means
 * padding / border / label styling stay synchronized across every
 * editor without the team having to remember to tweak three files.
 *
 * The label doubles as the accessibilityLabel so screen readers
 * announce a meaningful name for the otherwise-bare TextInput.
 */
import { View, Text, TextInput, StyleSheet } from 'react-native';


export function EditField({
  label, value, onChange, numeric, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        placeholder={placeholder}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: '#888', fontWeight: '600', marginTop: 8, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8,
    fontSize: 13, backgroundColor: '#fafafa',
  },
});
