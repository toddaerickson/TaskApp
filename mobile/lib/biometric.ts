/**
 * Thin wrapper over expo-local-authentication. Biometric unlock is an
 * optional shortcut that sits on top of the PIN gate — the PIN is still
 * the source of truth (you had to set it first, and the lockout counter
 * still applies when PIN entry is used).
 *
 * A per-device opt-in flag is stored in secure storage: once the user
 * authenticates with biometrics successfully a single time after setting
 * their PIN, we remember the preference and auto-prompt on subsequent
 * launches.
 */
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const K_BIOMETRIC_OPT_IN = 'pin.biometricOptIn';

const storage = Platform.OS === 'web'
  ? {
      getItemAsync: async (k: string) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
      setItemAsync: async (k: string, v: string) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
      deleteItemAsync: async (k: string) => { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); },
    }
  : SecureStore;

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export async function biometricKind(): Promise<BiometricKind> {
  if (Platform.OS === 'web') return 'none';
  try {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHw || !enrolled) return 'none';
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
    return 'none';
  } catch {
    return 'none';
  }
}

export async function isBiometricAvailable(): Promise<boolean> {
  return (await biometricKind()) !== 'none';
}

export async function isBiometricEnabled(): Promise<boolean> {
  return (await storage.getItemAsync(K_BIOMETRIC_OPT_IN)) === '1';
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  if (on) await storage.setItemAsync(K_BIOMETRIC_OPT_IN, '1');
  else await storage.deleteItemAsync(K_BIOMETRIC_OPT_IN);
}

/**
 * Prompt the OS biometric dialog. Returns true on success.
 * iOS Face ID requires NSFaceIDUsageDescription in app.json/Info.plist.
 */
export async function authenticateBiometric(reason = 'Unlock TaskApp'): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel: 'Enter PIN',
      disableDeviceFallback: true, // we have our own PIN fallback
    });
    return res.success;
  } catch {
    return false;
  }
}
