/**
 * Tests for lib/pin.ts. Mocks expo-secure-store (in-memory map) and
 * expo-crypto (deterministic hash so the test isn't flaky) before the
 * module under test imports them.
 */

// In-memory store reused across calls within a test.
const store: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => (store[k] ?? null),
  setItemAsync: async (k: string, v: string) => { store[k] = v; },
  deleteItemAsync: async (k: string) => { delete store[k]; },
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_algo: string, text: string) => {
    // A deterministic non-cryptographic hash is enough here — we only need
    // "different input → different output" and "same input → same output".
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return `hash:${h.toString(16)}`;
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// Import AFTER the mocks so pin.ts picks them up.
import * as pin from '../lib/pin';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('setPin / isPinSet / verifyPin', () => {
  it('rejects non-4-digit PINs', async () => {
    await expect(pin.setPin('abc')).rejects.toThrow(/4 digits/);
    await expect(pin.setPin('12345')).rejects.toThrow(/4 digits/);
    await expect(pin.setPin('')).rejects.toThrow(/4 digits/);
  });

  it('isPinSet is false before setPin and true after', async () => {
    expect(await pin.isPinSet()).toBe(false);
    await pin.setPin('2507');
    expect(await pin.isPinSet()).toBe(true);
  });

  it('verifyPin returns true only for the correct PIN', async () => {
    await pin.setPin('2507');
    expect(await pin.verifyPin('2507')).toBe(true);
    expect(await pin.verifyPin('0000')).toBe(false);
    expect(await pin.verifyPin('2508')).toBe(false);
  });

  it('verifyPin returns false when no PIN has been set', async () => {
    expect(await pin.verifyPin('2507')).toBe(false);
  });
});

describe('lockout behavior', () => {
  it('failed attempts accumulate', async () => {
    await pin.setPin('2507');
    await pin.verifyPin('0000');
    await pin.verifyPin('0000');
    await pin.verifyPin('0000');
    expect(await pin.getFailedAttempts()).toBe(3);
  });

  it('successful verify resets the counter', async () => {
    await pin.setPin('2507');
    await pin.verifyPin('0000');
    await pin.verifyPin('0000');
    await pin.verifyPin('2507');
    expect(await pin.getFailedAttempts()).toBe(0);
  });

  it('isLockedOut flips at MAX_ATTEMPTS', async () => {
    await pin.setPin('2507');
    for (let i = 0; i < pin.MAX_ATTEMPTS; i++) await pin.verifyPin('0000');
    expect(await pin.isLockedOut()).toBe(true);
  });

  it('resetLockout clears the counter', async () => {
    await pin.setPin('2507');
    for (let i = 0; i < pin.MAX_ATTEMPTS; i++) await pin.verifyPin('0000');
    await pin.resetLockout();
    expect(await pin.getFailedAttempts()).toBe(0);
    expect(await pin.isLockedOut()).toBe(false);
  });
});

describe('timeout window', () => {
  it('isRecentlyUnlocked is true right after setPin', async () => {
    await pin.setPin('2507');
    expect(await pin.isRecentlyUnlocked()).toBe(true);
  });

  it('isRecentlyUnlocked is false when unlockAt is stale', async () => {
    await pin.setPin('2507');
    // Push unlockAt back just beyond the timeout window.
    const old = Date.now() - (pin.TIMEOUT_MIN + 1) * 60 * 1000;
    store['pin.unlockAt'] = String(old);
    expect(await pin.isRecentlyUnlocked()).toBe(false);
  });

  it('touchUnlock refreshes the timestamp', async () => {
    await pin.setPin('2507');
    store['pin.unlockAt'] = String(Date.now() - 9999999);
    expect(await pin.isRecentlyUnlocked()).toBe(false);
    await pin.touchUnlock();
    expect(await pin.isRecentlyUnlocked()).toBe(true);
  });

  it('isRecentlyUnlocked is false before any pin is set', async () => {
    expect(await pin.isRecentlyUnlocked()).toBe(false);
  });
});

describe('clearPin', () => {
  it('removes all pin.* keys from storage', async () => {
    await pin.setPin('2507');
    expect(store['pin.hash']).toBeTruthy();
    expect(store['pin.salt']).toBeTruthy();
    await pin.clearPin();
    expect(store['pin.hash']).toBeUndefined();
    expect(store['pin.salt']).toBeUndefined();
    expect(store['pin.attempts']).toBeUndefined();
    expect(store['pin.unlockAt']).toBeUndefined();
  });
});

describe('salt uniqueness', () => {
  it('two setPin calls produce different salts', async () => {
    await pin.setPin('2507');
    const salt1 = store['pin.salt'];
    await pin.setPin('2507');
    const salt2 = store['pin.salt'];
    expect(salt1).not.toBe(salt2);
  });

  it('same PIN + different salt → different hash', async () => {
    await pin.setPin('2507');
    const hash1 = store['pin.hash'];
    await pin.setPin('2507');
    const hash2 = store['pin.hash'];
    expect(hash1).not.toBe(hash2);
  });
});
