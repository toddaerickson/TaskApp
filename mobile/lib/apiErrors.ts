import type { AxiosError } from 'axios';

type FastApiValidationItem = { msg?: string; loc?: string[] };
type ErrorBody = {
  detail?: string | FastApiValidationItem[];
  /** Structured machine-readable error code emitted by the backend's
   *  exception handlers. See `_STATUS_TO_CODE` in backend/main.py. */
  code?: string;
  /** Short id echoed back on X-Request-Id; paired with server logs. */
  request_id?: string;
};

/**
 * Backend-code → user-facing message. Extending this lets a route raise
 * `HTTPException(..., detail={"detail": "...", "code": "x"})` to opt a
 * specific failure mode into a targeted UX message without relying on
 * English-detail parsing.
 */
const CODE_MESSAGES: Record<string, string> = {
  rate_limited: "You're sending requests too fast. Wait a moment and try again.",
  validation_error: "Some required information is missing or invalid.",
  not_found: "That item couldn't be found. It may have been removed.",
  conflict: "This action conflicts with a recent change. Refresh and try again.",
  internal_error: "Something went wrong on our end. Please try again.",
};

/**
 * Convert an axios error (or anything we might throw) into a message safe
 * to show in an Alert / inline error banner. Priority order:
 *
 *   1. No `response` at all → network / CORS / DNS failure.
 *   2. Backend `code` matches a known entry → targeted message.
 *   3. FastAPI validation error (detail is an array) → first item's msg.
 *   4. FastAPI HTTPException (detail is a string) → pass through.
 *   5. Status-based fallback (401 / 429 / 5xx).
 *   6. Caller's `fallback` string.
 */
export function describeApiError(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  const err = e as AxiosError<ErrorBody>;

  if (!err?.response) {
    // Distinguish between timeout, DNS, connection refused, and generic
    // network failures so the error message actually helps diagnose.
    const code = (err as any)?.code as string | undefined;
    const msg = err?.message ?? '';
    if (code === 'ECONNABORTED' || msg.includes('timeout')) {
      return 'Request timed out. The server may be waking up — try again in a few seconds.';
    }
    if (code === 'ECONNREFUSED') {
      return 'Connection refused. The server may be restarting.';
    }
    if (code === 'ERR_NETWORK' || msg.includes('Network Error')) {
      return 'Network error — check your internet connection or try again shortly.';
    }
    return `Can't reach the server (${code || msg || 'unknown'}). Check your connection or try again.`;
  }

  const body = err.response.data;
  const code = typeof body?.code === 'string' ? body.code : undefined;
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }

  const detail = body?.detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (first?.msg) return first.msg;
  }
  if (typeof detail === 'string' && detail) return detail;

  const status = err.response.status;
  if (status === 401) return 'Incorrect email or password.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status >= 500) return 'Server error. Try again in a moment.';
  return fallback;
}

/**
 * Diagnostic variant: append the HTTP status + request id so bug reports
 * carry enough context to correlate with server logs. Use on Start-workout
 * / session-create / other privileged mutations where a bare "Something
 * went wrong" doesn't help the user (or us) figure out what to do next.
 *
 * Example output: "HTTP 500: CORS blocked (req abc123)".
 * Falls back to the plain describeApiError string for network failures
 * (no response → no status/rid to append).
 */
export function describeApiErrorDetailed(e: unknown, fallback?: string): string {
  const base = describeApiError(e, fallback);
  const err = e as AxiosError<ErrorBody>;
  if (!err?.response) return base; // network error, nothing to append
  const status = err.response.status;
  // Prefer the body's request_id (emitted by backend main.py's exception
  // handlers); fall back to the X-Request-Id response header; skip the
  // parenthetical entirely if neither is present.
  const rid =
    (err.response.data && (err.response.data as ErrorBody).request_id) ||
    (err.response.headers &&
      ((err.response.headers as Record<string, string>)['x-request-id'] ||
        (err.response.headers as Record<string, string>)['X-Request-Id']));
  const suffix = rid ? ` (req ${rid})` : '';
  return `HTTP ${status}: ${base}${suffix}`;
}
