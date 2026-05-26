import { colors } from "@/lib/colors";
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import { describeApiError } from '@/lib/apiErrors';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const registerFn = useAuthStore((s) => s.register);
  const router = useRouter();

  // accessibilityLiveRegion isn't sufficient on its own (the Text node
  // doesn't re-announce when its content changes in place). Mirror the
  // explicit announce pattern from login.tsx so screen-reader users
  // hear validation failures.
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const handleRegister = async () => {
    setError('');
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    if (!trimmedEmail || !password) {
      setError('Email and password required');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await registerFn(trimmedEmail, password, trimmedName || undefined);
      router.replace('/(tabs)/tasks');
    } catch (e: unknown) {
      setError(describeApiError(e, 'Registration failed. Try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>TaskApp</Text>
        <Text style={styles.title}>Create account</Text>

        <Text style={styles.label}>Display name (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="How should we address you?"
          accessibilityLabel="Display name, optional"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholderTextColor={colors.placeholder}
        />

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
          placeholder="At least 8 characters"
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          placeholderTextColor={colors.placeholder}
          onSubmitEditing={handleRegister}
          returnKeyType="go"
        />

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.button, (loading || pressed) && { opacity: 0.7 }]}
          onPress={handleRegister}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{loading ? 'Creating account…' : 'Create account'}</Text>
        </Pressable>

        <Pressable onPress={() => router.back()} accessibilityRole="link">
          <Text style={styles.link}>Already have an account? <Text style={styles.linkStrong}>Sign in</Text></Text>
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
