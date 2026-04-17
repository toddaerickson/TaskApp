// Short request-id generator. Pairs the mobile side with the backend's
// X-Request-Id middleware so a client-observed failure can be matched
// against the server log line that produced it.
//
// Kept dependency-free: prefers the platform crypto when available and
// falls back to Math.random, which is plenty for correlation — this is
// not a security token.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function fallback(): string {
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

export function newRequestId(): string {
  try {
    const g: any = globalThis as any;
    if (g.crypto?.randomUUID) {
      return String(g.crypto.randomUUID()).replace(/-/g, '').slice(0, 12);
    }
  } catch {
    // ignore — fall through to Math.random
  }
  return fallback();
}

/** Extract the server-assigned (or echo'd back) request id from an error
 *  response so loggers / debug toasts can quote it. */
export function requestIdFromError(error: unknown): string | null {
  const e = error as { response?: { headers?: Record<string, string>; data?: { request_id?: unknown } } };
  const headerId = e?.response?.headers?.['x-request-id'] ?? e?.response?.headers?.['X-Request-Id'];
  if (typeof headerId === 'string' && headerId) return headerId;
  const bodyId = e?.response?.data?.request_id;
  if (typeof bodyId === 'string' && bodyId) return bodyId;
  return null;
}
