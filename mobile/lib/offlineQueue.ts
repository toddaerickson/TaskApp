/**
 * Persistent queue for set-log payloads that couldn't reach the server.
 *
 * Why: sessions on flaky wifi or in a gym basement were silently dropping
 * logged sets — the POST failed, the user got a "Set not saved" alert,
 * and the attempt was gone. Now a network error (no response) enqueues
 * the payload and a subsequent successful call drains the queue.
 *
 * Why "no response" only: a 4xx / 5xx means the server got the request
 * and rejected it; retrying would likely fail the same way and could
 * double-post if the server succeeded but the client timed out reading
 * the response. Only retry when we know nothing was accepted.
 *
 * Pure functions + an injectable KV make the queue testable without the
 * RN runtime.
 */

export interface SetPayload {
  exercise_id: number;
  reps?: number;
  weight?: number;
  duration_sec?: number;
  rpe?: number;
}

export interface QueuedSet {
  /** Client-generated id — stable across retries so the UI can key rows. */
  id: string;
  session_id: number;
  enqueued_at: number;
  payload: SetPayload;
}

export interface KV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const QUEUE_KEY = 'taskapp.offline_set_queue';

async function loadQueue(store: KV): Promise<QueuedSet[]> {
  const raw = await store.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(store: KV, queue: QueuedSet[]): Promise<void> {
  await store.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function rid(): string {
  // Not a security token — collision resistance here is for UI keying.
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
}

export async function enqueueSet(
  store: KV,
  session_id: number,
  payload: SetPayload,
): Promise<QueuedSet> {
  const entry: QueuedSet = {
    id: rid(),
    session_id,
    enqueued_at: Date.now(),
    payload,
  };
  const queue = await loadQueue(store);
  queue.push(entry);
  await saveQueue(store, queue);
  return entry;
}

export async function pendingCount(store: KV, session_id?: number): Promise<number> {
  const queue = await loadQueue(store);
  if (session_id === undefined) return queue.length;
  return queue.filter((q) => q.session_id === session_id).length;
}

export async function listPending(store: KV, session_id?: number): Promise<QueuedSet[]> {
  const queue = await loadQueue(store);
  if (session_id === undefined) return queue;
  return queue.filter((q) => q.session_id === session_id);
}

export interface DrainResult {
  sent: number;
  remaining: number;
  /** Truthy when the last attempt hit another network error — caller can
   *  decide to back off vs. re-drain immediately. */
  stoppedOnNetworkError: boolean;
}

/**
 * Walk the queue in insertion order, calling `sendOne` for each entry.
 * Remove on success. Keep on failure AND stop the drain — a single
 * network error means we're offline again; don't hammer the queue with
 * calls that are all going to fail. A 4xx / 5xx response error, on the
 * other hand, means the server was reachable but rejected the payload;
 * drop that entry (it would never succeed on retry) and continue.
 */
export async function drainQueue(
  store: KV,
  sendOne: (q: QueuedSet) => Promise<void>,
): Promise<DrainResult> {
  const queue = await loadQueue(store);
  const startLen = queue.length;
  let stoppedOnNetworkError = false;
  let droppedOnServerReject = 0;
  while (queue.length > 0) {
    const entry = queue[0];
    try {
      await sendOne(entry);
      queue.shift(); // accepted — drop from the head
    } catch (err) {
      const hasResponse = Boolean((err as { response?: unknown })?.response);
      if (!hasResponse) {
        stoppedOnNetworkError = true;
        break;
      }
      // Server rejected — drop so we don't loop on a permanently bad entry.
      queue.shift();
      droppedOnServerReject++;
    }
  }
  const remaining = queue.length;
  await saveQueue(store, queue);
  const sent = startLen - remaining - droppedOnServerReject;
  return { sent, remaining, stoppedOnNetworkError };
}
