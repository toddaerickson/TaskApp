// Tiny pub/sub for "your token was rejected mid-request". The axios 401
// response interceptor publishes here; the root layout subscribes to show
// a modal and route back to /login. Kept dependency-free so both the API
// layer (no RN imports) and the UI can use it.
type Listener = () => void;

const listeners = new Set<Listener>();

export function onSessionExpired(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitSessionExpired(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* isolate listeners */ }
  }
}
