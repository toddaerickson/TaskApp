import {
  QUEUE_KEY, drainQueue, enqueueSet, listPending, pendingCount,
  type KV, type QueuedSet,
} from '../lib/offlineQueue';

// In-memory KV for tests. Shape-matches SecureStore / localStorage.
function makeKV(initial?: Record<string, string>): KV {
  const mem = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: async (k) => (mem.has(k) ? (mem.get(k) as string) : null),
    setItem: async (k, v) => { mem.set(k, v); },
  };
}

function networkError(): Error {
  // Axios network errors have no `response` field.
  return new Error('Network Error');
}

function serverError(status: number): Error {
  const err = new Error(`HTTP ${status}`) as Error & { response: { status: number } };
  err.response = { status };
  return err;
}

describe('offlineQueue', () => {
  describe('enqueueSet + pendingCount', () => {
    it('persists an entry and increments the count', async () => {
      const kv = makeKV();
      expect(await pendingCount(kv)).toBe(0);

      await enqueueSet(kv, 42, { exercise_id: 1, reps: 10 });
      expect(await pendingCount(kv)).toBe(1);
      expect(await pendingCount(kv, 42)).toBe(1);
      // Different session is not counted.
      expect(await pendingCount(kv, 99)).toBe(0);
    });

    it('round-trips across a fresh KV handle with the same backing storage', async () => {
      // This is what happens on app restart: the KV facade is new but the
      // underlying store (SecureStore / localStorage) persisted the JSON.
      const backing = new Map<string, string>();
      const kvA: KV = {
        getItem: async (k) => backing.get(k) ?? null,
        setItem: async (k, v) => { backing.set(k, v); },
      };
      await enqueueSet(kvA, 1, { exercise_id: 5 });
      const kvB: KV = {
        getItem: async (k) => backing.get(k) ?? null,
        setItem: async (k, v) => { backing.set(k, v); },
      };
      expect(await pendingCount(kvB)).toBe(1);
    });

    it('tolerates a corrupted queue blob', async () => {
      const kv = makeKV({ [QUEUE_KEY]: 'not-json' });
      expect(await pendingCount(kv)).toBe(0);
      // And writing on top of corruption recovers cleanly.
      await enqueueSet(kv, 1, { exercise_id: 2 });
      expect(await pendingCount(kv)).toBe(1);
    });
  });

  describe('drainQueue', () => {
    it('sends every entry and clears the queue when the server accepts all', async () => {
      const kv = makeKV();
      await enqueueSet(kv, 1, { exercise_id: 1, reps: 10 });
      await enqueueSet(kv, 1, { exercise_id: 2, reps: 8 });
      const sent: QueuedSet[] = [];
      const result = await drainQueue(kv, async (q) => { sent.push(q); });
      expect(result).toEqual({ sent: 2, remaining: 0, stoppedOnNetworkError: false });
      expect(sent.map((s) => s.payload.exercise_id)).toEqual([1, 2]);
      expect(await pendingCount(kv)).toBe(0);
    });

    it('stops on a network error and keeps the failed entry AT THE HEAD', async () => {
      // The ordering matters: if the network drops mid-drain, the next
      // drain should start with the same entry. Otherwise successful
      // entries after the failure would never be attempted.
      const kv = makeKV();
      await enqueueSet(kv, 1, { exercise_id: 1 });
      await enqueueSet(kv, 1, { exercise_id: 2 });
      await enqueueSet(kv, 1, { exercise_id: 3 });

      let attempt = 0;
      const result = await drainQueue(kv, async () => {
        attempt++;
        if (attempt === 2) throw networkError();
      });
      expect(result.sent).toBe(1);
      expect(result.remaining).toBe(2);
      expect(result.stoppedOnNetworkError).toBe(true);

      // Next drain resumes from the failed entry.
      const remaining = await listPending(kv);
      expect(remaining.map((r) => r.payload.exercise_id)).toEqual([2, 3]);
    });

    it('drops entries that hit a server-side error (no point retrying a 4xx)', async () => {
      const kv = makeKV();
      await enqueueSet(kv, 1, { exercise_id: 1 });
      await enqueueSet(kv, 1, { exercise_id: 2 });
      let attempt = 0;
      const result = await drainQueue(kv, async () => {
        attempt++;
        if (attempt === 1) throw serverError(400);
      });
      expect(result.sent).toBe(1);       // only ex-2 succeeded
      expect(result.remaining).toBe(0);  // ex-1 was dropped despite failing
      expect(result.stoppedOnNetworkError).toBe(false);
      expect(await pendingCount(kv)).toBe(0);
    });

    it('no-op on an empty queue', async () => {
      const kv = makeKV();
      const result = await drainQueue(kv, async () => {
        throw new Error('should not be called');
      });
      expect(result).toEqual({ sent: 0, remaining: 0, stoppedOnNetworkError: false });
    });
  });
});
