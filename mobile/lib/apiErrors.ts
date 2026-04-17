import type { AxiosError } from 'axios';

type FastApiValidationItem = { msg?: string; loc?: string[] };
type ErrorBody = {
  detail?: string | FastApiValidationItem[];
  /** Structured machine-readable error code emitted by the backend's
   *  exception handlers. See `_STATUS_TO_CODE` in backend/main.py. */
  code?: string;
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
    return "Can't reach the server. Check your internet connection or try again shortly.";
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
