import { colors } from "@/lib/colors";
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/lib/stores';
import { describeApiError } from '@/lib/apiErrors';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
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
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => emailRef.current?.focus()}
          placeholderTextColor={colors.placeholder}
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          ref={emailRef}
          style={styles.input}
          placeholder="you@example.com"
          accessibilityLabel="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          keyboardType="email-address"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
          placeholderTextColor={colors.placeholder}
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            ref={passwordRef}
            style={[styles.input, styles.passwordInput]}
            placeholder="At least 8 characters"
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            placeholderTextColor={colors.placeholder}
            onSubmitEditing={handleRegister}
            returnKeyType="go"
          />
          <Pressable
            onPress={() => setShowPassword((s) => !s)}
            style={styles.eyeToggle}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            hitSlop={8}
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textMuted} />
          </Pressable>
        </View>

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
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 44 },
  eyeToggle: {
    position: 'absolute', right: 8, top: 0, bottom: 0,
    width: 36, justifyContent: 'center', alignItems: 'center',
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
