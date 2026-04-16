import type { AxiosError } from 'axios';

type FastApiValidationItem = { msg?: string; loc?: string[] };
type ErrorBody = { detail?: string | FastApiValidationItem[] };

/**
 * Convert an axios error (or anything we might throw) into a message safe
 * to show in an Alert / inline error banner. Distinguishes the three cases
 * users care about:
 *
 *   - Network / CORS / DNS / server-unreachable: no `response`.
 *   - FastAPI validation error: `response.data.detail` is an array.
 *   - FastAPI HTTPException: `response.data.detail` is a string.
 */
export function describeApiError(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  const err = e as AxiosError<ErrorBody>;

  if (!err?.response) {
    return "Can't reach the server. Check your internet connection or try again shortly.";
  }

  const detail = err.response.data?.detail;
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
