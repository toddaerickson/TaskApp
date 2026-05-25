import { colors } from "@/lib/colors";
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import { describeApiError } from '@/lib/apiErrors';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginFn = useAuthStore((s) => s.login);
  const router = useRouter();

  // accessibilityLiveRegion="polite" doesn't re-fire when the same Text
  // node re-renders with new content — VoiceOver / TalkBack stay silent.
  // Announce explicitly on every error change.
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>TaskApp</Text>
        <Text style={styles.title}>Sign in</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          accessibilityLabel="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholderTextColor={colors.placeholder}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Your password"
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          placeholderTextColor={colors.placeholder}
          onSubmitEditing={handleLogin}
          returnKeyType="go"
        />

        {error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
        )}

        <Pressable
          style={({ pressed }) => [styles.button, (loading || pressed) && { opacity: 0.7 }]}
          onPress={handleLogin}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/(auth)/register')} accessibilityRole="link">
          <Text style={styles.link}>Don't have an account? <Text style={styles.linkStrong}>Register</Text></Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 64, paddingBottom: 40, gap: 8 },
  eyebrow: { fontSize: 13, fontWeight: '600', color: colors.primary, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 34, fontWeight: '700', color: colors.textStrong, marginBottom: 28 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 14 },
  input: {
    borderWidth: 1, borderColor: colors.borderInput, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { color: colors.dangerText, fontSize: 13, marginTop: 8 },
  button: {
    backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14,
    alignItems: 'center', marginTop: 20,
  },
  buttonText: { color: colors.onColor, fontSize: 16, fontWeight: '600' },
  link: { color: colors.textMuted, textAlign: 'center', marginTop: 20, fontSize: 14 },
  linkStrong: { color: colors.primary, fontWeight: '600' },
});
