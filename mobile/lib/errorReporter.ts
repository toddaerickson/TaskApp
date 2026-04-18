/**
 * Error telemetry shim. Thin wrapper so we can wire reporting hooks into
 * the app (axios 5xx interceptor, ErrorBoundary, auth store) without
 * locking the bundle to a specific SDK. Installing `@sentry/react-native`
 * and initializing it is a follow-up; until then every call here is a
 * no-op, so the wire-up lives in code and needs only a SDK swap to go
 * live.
 *
 * The surface mirrors Sentry's minimal call shape so a later swap to
 * `import * as Sentry from '@sentry/react-native'` is mechanical.
 */

type Severity = 'error' | 'warning' | 'info';

export interface ReportContext {
  /** X-Request-Id of the failing request, if any. */
  requestId?: string;
  /** Route / screen name. */
  route?: string;
  /** HTTP status code. */
  status?: number;
  /** Arbitrary string tags keyed by name. */
  tags?: Record<string, string | number | boolean | undefined>;
}

// These are the keys we refuse to forward to any reporter, even if a
// caller accidentally stuffs them into the context. The server scrubs
// its own copy; this is the client-side belt-and-braces.
const DENYLIST: ReadonlySet<string> = new Set([
  'password',
  'current_password',
  'new_password',
  'access_token',
  'refresh_token',
  'token',
  'authorization',
  'cookie',
  'api_key',
]);

function sanitize<T extends Record<string, any> | undefined>(obj: T): T {
  if (!obj) return obj;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (DENYLIST.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out as T;
}

/**
 * Record that an error happened. When a concrete reporter (Sentry) is
 * wired up this forwards to `Sentry.captureException(err, { tags })`;
 * until then it just logs so the wire-up is visible in __DEV__.
 */
export function reportError(err: unknown, context: ReportContext = {}): void {
  const ctx = {
    ...sanitize(context),
    tags: sanitize(context.tags),
  };
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn('[errorReporter]', err, ctx);
  }
  // TODO(sentry): forward to Sentry.captureException when the SDK lands.
}

/**
 * Record a lower-severity event (e.g. "session expired", "conflict
 * resolved by accepting server copy"). Same no-op shape as reportError.
 */
export function reportMessage(message: string, severity: Severity = 'info', context: ReportContext = {}): void {
  const ctx = {
    severity,
    ...sanitize(context),
    tags: sanitize(context.tags),
  };
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[errorReporter]', message, ctx);
  }
  // TODO(sentry): forward to Sentry.captureMessage when the SDK lands.
}

// Exported for tests only.
export const __private = { sanitize, DENYLIST };
