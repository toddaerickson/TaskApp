/**
 * Sentry wiring. Split from `errorReporter.ts` so the SDK import only
 * lives in one place and the rest of the app (including jest tests)
 * never has to resolve `@sentry/react-native`.
 *
 * Initialization is opt-in: `initSentry()` is a no-op unless
 * `EXPO_PUBLIC_SENTRY_DSN` is set. Matches the backend's gate behavior.
 *
 * `sentryWrap` re-exports `Sentry.wrap` so `app/_layout.tsx` can wrap its
 * default export and pick up routing breadcrumbs + auto-instrumentation.
 */
import * as Sentry from '@sentry/react-native';
import { setSink, type ReportContext, type ReportSink } from './errorReporter';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';
const ENV = process.env.EXPO_PUBLIC_SENTRY_ENV || (__DEV__ ? 'development' : 'production');
const TRACES_RATE = Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1');

// Keep in sync with backend `_SENSITIVE_KEYS` + errorReporter DENYLIST.
// Belt-and-braces scrub on top of the server's own before_send. Sentry
// auto-attaches request headers from axios on native, so this also
// strips Authorization before it leaves the device.
const SENSITIVE = new Set([
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
const SCRUBBED = '[scrubbed]';

function scrub(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.has(k.toLowerCase()) ? SCRUBBED : scrub(v);
  }
  return out;
}

function sentryBeforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request) {
    if (event.request.headers) event.request.headers = scrub(event.request.headers) as any;
    if (event.request.data) event.request.data = scrub(event.request.data);
    if (event.request.cookies) event.request.cookies = SCRUBBED as any;
  }
  if (event.extra) event.extra = scrub(event.extra);
  return event;
}

const sentrySink: ReportSink = {
  captureError(err, context) {
    Sentry.captureException(err, (scope) => {
      applyContext(scope, context);
      return scope;
    });
  },
  captureMessage(message, severity, context) {
    Sentry.captureMessage(message, (scope) => {
      scope.setLevel(severity as any);
      applyContext(scope, context);
      return scope;
    });
  },
};

function applyContext(scope: Sentry.Scope, context: ReportContext): void {
  if (context.requestId) scope.setTag('request_id', context.requestId);
  if (context.route) scope.setTag('route', context.route);
  if (context.status !== undefined) scope.setTag('status', String(context.status));
  if (context.tags) {
    for (const [k, v] of Object.entries(context.tags)) {
      if (v !== undefined) scope.setTag(k, String(v));
    }
  }
}

let initialized = false;

/**
 * Idempotently initialize Sentry + register the error-reporter sink.
 * No-op when `EXPO_PUBLIC_SENTRY_DSN` is unset (dev / CI stays quiet).
 * Returns true if Sentry was actually initialized.
 */
export function initSentry(): boolean {
  if (initialized) return true;
  if (!DSN) return false;
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    // Don't let the SDK auto-enable PII. We scrub ourselves.
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(TRACES_RATE) ? TRACES_RATE : 0.1,
    beforeSend: sentryBeforeSend,
    debug: __DEV__,
  });
  setSink(sentrySink);
  initialized = true;
  return true;
}

/**
 * Convenience wrapper so `app/_layout.tsx` can opt into Sentry's
 * navigation/instrumentation by exporting `sentryWrap(RootLayout)`. When
 * Sentry wasn't initialized it's a pass-through — the wrap does nothing
 * harmful but also adds no instrumentation.
 */
export const sentryWrap: typeof Sentry.wrap = Sentry.wrap;
