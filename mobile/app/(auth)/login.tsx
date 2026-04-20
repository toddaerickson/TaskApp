import { colors } from "@/lib/colors";
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import { describeApiError } from '@/lib/apiErrors';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Inline error banner — matches the Register screen's pattern so users
  // get consistent feedback. Previously login surfaced errors via Alert
  // which obscured the form and took an extra tap to dismiss.
  const [error, setError] = useState<string | null>(null);
  const loginFn = useAuthStore((s) => s.login);
  const router = useRouter();

  const handleLogin = async () => {
    if (!email || !password) { setError('Fill in all fields.'); return; }
    setLoading(true);
    setError(null);
    try {
      await loginFn(email.trim().toLowerCase(), password);
      router.replace('/(tabs)/tasks');
    } catch (e: unknown) {
      setError(describeApiError(e, 'Check your credentials.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>TaskApp</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          accessibilityLabel="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholderTextColor="#bbb"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor="#bbb"
          onSubmitEditing={handleLogin}
          returnKeyType="go"
        />

        {error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
        )}

        <Pressable style={styles.button} onPress={handleLogin} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/(auth)/register')}>
          <Text style={styles.link}>Don't have an account? Register</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 24, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 3 },
  title: { fontSize: 28, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 12, color: '#333' },
  button: { backgroundColor: colors.primary, borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: colors.primary, textAlign: 'center', marginTop: 16, fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 8 },
});
