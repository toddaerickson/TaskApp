/**
 * Local-device PIN gate.
 *
 * Storage:
 *  - Native: expo-secure-store (keychain/keystore-backed).
 *  - Web: localStorage (best-effort; obviously not real security on web).
 *
 * Layout:
 *  - pin.salt    — random per-install hex string.
 *  - pin.hash    — sha256(salt || pin), hex.
 *  - pin.attempts — count of consecutive wrong entries (persists across reload).
 *  - pin.unlockAt — ms epoch the app was last unlocked (for timeout gating).
 */
import { Platform } from 'react-native';

// Lazy-load native-only modules. expo-crypto@55 is paired with SDK 55's
// expo-modules-core; we're on SDK 52, so its top-level import triggers
// registerWebModule with an incompatible class on web.
const SecureStore: typeof import('expo-secure-store') =
  Platform.OS === 'web' ? (null as any) : require('expo-secure-store');

const storage = Platform.OS === 'web'
  ? {
      getItemAsync: async (k: string) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
      setItemAsync: async (k: string, v: string) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
      deleteItemAsync: async (k: string) => { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); },
    }
  : SecureStore;

const K_SALT = 'pin.salt';
const K_HASH = 'pin.hash';
const K_ATTEMPTS = 'pin.attempts';
const K_UNLOCK_AT = 'pin.unlockAt';

export const MAX_ATTEMPTS = 5;
/** Re-gate after this many minutes of no activity. CLAUDE.md spec is
 *  15 min — short enough that a phone left briefly unattended doesn't
 *  expose the app, long enough that intended-use context-switches
 *  (open-app → check-something-elsewhere → return) don't trigger
 *  re-entry. Face ID / Touch ID is the soft escape: native biometric
 *  users see one-tap re-unlock, web users see the keypad. */
export const TIMEOUT_MIN = 15;

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && (crypto as any).getRandomValues) {
    (crypto as any).getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hash(pin: string, salt: string): Promise<string> {
  const input = `${salt}:${pin}`;
  if (Platform.OS === 'web') {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const Crypto = require('expo-crypto');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
}

export async function isPinSet(): Promise<boolean> {
  const h = await storage.getItemAsync(K_HASH);
  return !!h;
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits');
  const salt = randomSalt();
  const h = await hash(pin, salt);
  await storage.setItemAsync(K_SALT, salt);
  await storage.setItemAsync(K_HASH, h);
  await storage.setItemAsync(K_ATTEMPTS, '0');
  await storage.setItemAsync(K_UNLOCK_AT, String(Date.now()));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const salt = await storage.getItemAsync(K_SALT);
  const stored = await storage.getItemAsync(K_HASH);
  if (!salt || !stored) return false;
  const h = await hash(pin, salt);
  const ok = constantTimeEq(h, stored);
  if (ok) {
    await storage.setItemAsync(K_ATTEMPTS, '0');
    await storage.setItemAsync(K_UNLOCK_AT, String(Date.now()));
  } else {
    const n = (parseInt((await storage.getItemAsync(K_ATTEMPTS)) || '0', 10) || 0) + 1;
    await storage.setItemAsync(K_ATTEMPTS, String(n));
  }
  return ok;
}

export async function getFailedAttempts(): Promise<number> {
  return parseInt((await storage.getItemAsync(K_ATTEMPTS)) || '0', 10) || 0;
}

export async function isLockedOut(): Promise<boolean> {
  return (await getFailedAttempts()) >= MAX_ATTEMPTS;
}

export async function resetLockout(): Promise<void> {
  await storage.setItemAsync(K_ATTEMPTS, '0');
}

/** Returns true if the last unlock was recent enough to skip the gate. */
export async function isRecentlyUnlocked(): Promise<boolean> {
  const at = parseInt((await storage.getItemAsync(K_UNLOCK_AT)) || '0', 10) || 0;
  if (!at) return false;
  return Date.now() - at < TIMEOUT_MIN * 60 * 1000;
}

export async function touchUnlock(): Promise<void> {
  await storage.setItemAsync(K_UNLOCK_AT, String(Date.now()));
}

export async function clearPin(): Promise<void> {
  await storage.deleteItemAsync(K_SALT);
  await storage.deleteItemAsync(K_HASH);
  await storage.deleteItemAsync(K_ATTEMPTS);
  await storage.deleteItemAsync(K_UNLOCK_AT);
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
