/**
 * Error telemetry shim. Thin wrapper so we can wire reporting hooks into
 * the app (axios 5xx interceptor, ErrorBoundary, auth store) without
 * locking the bundle to a specific SDK.
 *
 * The default sink is a console.warn so anything reported is visible in
 * __DEV__. A concrete sink (Sentry) registers itself via `setSink()` at
 * app startup; see `lib/sentry.ts`. Keeping the SDK import out of this
 * module keeps the `node-libs` jest project from having to resolve
 * `@sentry/react-native` at test time.
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

export interface ReportSink {
  captureError(err: unknown, context: ReportContext): void;
  captureMessage(message: string, severity: Severity, context: ReportContext): void;
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

const consoleSink: ReportSink = {
  captureError(err, context) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[errorReporter]', err, context);
    }
  },
  captureMessage(message, severity, context) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[errorReporter]', severity, message, context);
    }
  },
};

let activeSink: ReportSink = consoleSink;

/**
 * Swap the active sink. `lib/sentry.ts` calls this once at startup to
 * wire Sentry in when `EXPO_PUBLIC_SENTRY_DSN` is set. Tests can call
 * this to install an assertion sink and restore the default afterward.
 */
export function setSink(sink: ReportSink | null): void {
  activeSink = sink || consoleSink;
}

/** Record that an error happened. */
export function reportError(err: unknown, context: ReportContext = {}): void {
  const ctx: ReportContext = {
    ...sanitize(context),
    tags: sanitize(context.tags),
  };
  try {
    activeSink.captureError(err, ctx);
  } catch {
    // A misbehaving sink must never crash the caller.
  }
}

/** Record a lower-severity event (e.g. session expired, conflict resolved). */
export function reportMessage(
  message: string,
  severity: Severity = 'info',
  context: ReportContext = {},
): void {
  const ctx: ReportContext = {
    ...sanitize(context),
    tags: sanitize(context.tags),
  };
  try {
    activeSink.captureMessage(message, severity, ctx);
  } catch {
    // See setSink comment.
  }
}

// Exported for tests only.
export const __private = { sanitize, DENYLIST };
