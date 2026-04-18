import { Platform } from 'react-native';
import type { KV } from './offlineQueue';

// expo-secure-store on native, localStorage on web. Mirrors the token
// storage shim in lib/stores.ts — same reason (SecureStore module isn't
// available at module-eval on web).

const webKV: KV = {
  getItem: async (k) => {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null; }
    catch { return null; }
  },
  setItem: async (k, v) => {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); }
    catch { /* quota / private mode — best effort */ }
  },
};

function nativeKV(): KV {
  const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  return {
    getItem: (k) => SecureStore.getItemAsync(k),
    setItem: (k, v) => SecureStore.setItemAsync(k, v),
  };
}

export const kv: KV = Platform.OS === 'web' ? webKV : nativeKV();
