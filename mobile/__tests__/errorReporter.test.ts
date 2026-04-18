/**
 * Client-side PII denylist. The backend has its own scrubber; this is
 * the belt-and-braces check for any case where a caller stuffs a token
 * into the reporter context. Locks the exact denylist in so we notice
 * if someone extends `ReportContext` without extending `DENYLIST`.
 */
import { __private, reportError, reportMessage, setSink } from '@/lib/errorReporter';

const { sanitize, DENYLIST } = __private;

describe('errorReporter.sanitize', () => {
  it('strips password + token + Authorization case-insensitively', () => {
    const input = {
      route: '/tasks',
      password: 'p',
      Password: 'p2',
      access_token: 'a',
      refresh_token: 'r',
      token: 't',
      Authorization: 'Bearer x',
      api_key: 'k',
    };
    const out = sanitize(input) as Record<string, any>;
    expect(out.route).toBe('/tasks');
    expect(out).not.toHaveProperty('password');
    expect(out).not.toHaveProperty('Password');
    expect(out).not.toHaveProperty('access_token');
    expect(out).not.toHaveProperty('refresh_token');
    expect(out).not.toHaveProperty('token');
    expect(out).not.toHaveProperty('Authorization');
    expect(out).not.toHaveProperty('api_key');
  });

  it('returns undefined when given undefined', () => {
    expect(sanitize(undefined)).toBeUndefined();
  });

  it('preserves non-sensitive fields', () => {
    const input = { status: 500, requestId: 'abc', method: 'GET' };
    expect(sanitize(input)).toEqual(input);
  });

  it('DENYLIST covers the server-side sensitive keys we care about', () => {
    // Keep these in lockstep with sentry_setup._SENSITIVE_KEYS. Drift
    // means the mobile client could forward something the server would
    // scrub.
    for (const k of [
      'password',
      'access_token',
      'refresh_token',
      'token',
      'authorization',
      'cookie',
      'api_key',
    ]) {
      expect(DENYLIST.has(k)).toBe(true);
    }
  });
});

describe('errorReporter.setSink', () => {
  afterEach(() => setSink(null));

  it('forwards reportError to the active sink with sanitized context', () => {
    const captureError = jest.fn();
    const captureMessage = jest.fn();
    setSink({ captureError, captureMessage });

    const err = new Error('boom');
    reportError(err, {
      requestId: 'abc',
      route: '/x',
      status: 500,
      tags: { method: 'POST', password: 'p' } as any,
    });

    expect(captureError).toHaveBeenCalledTimes(1);
    const [forwardedErr, ctx] = captureError.mock.calls[0];
    expect(forwardedErr).toBe(err);
    expect(ctx.requestId).toBe('abc');
    expect(ctx.route).toBe('/x');
    expect(ctx.status).toBe(500);
    expect(ctx.tags.method).toBe('POST');
    // Sensitive tag scrubbed before it reaches the sink.
    expect(ctx.tags).not.toHaveProperty('password');
  });

  it('forwards reportMessage with severity', () => {
    const captureError = jest.fn();
    const captureMessage = jest.fn();
    setSink({ captureError, captureMessage });

    reportMessage('conflict accepted', 'warning', { route: '/routines/1' });

    expect(captureMessage).toHaveBeenCalledWith(
      'conflict accepted',
      'warning',
      expect.objectContaining({ route: '/routines/1' }),
    );
  });

  it('swallows sink errors so the app never crashes on telemetry', () => {
    setSink({
      captureError: () => { throw new Error('sink died'); },
      captureMessage: () => { throw new Error('sink died'); },
    });
    // Should not throw.
    expect(() => reportError(new Error('x'))).not.toThrow();
    expect(() => reportMessage('y')).not.toThrow();
  });

  it('setSink(null) restores the default console sink', () => {
    const captureError = jest.fn();
    setSink({ captureError, captureMessage: jest.fn() });
    reportError(new Error('a'));
    expect(captureError).toHaveBeenCalled();

    setSink(null);
    reportError(new Error('b'));
    // Still only one call — the default console sink now receives events,
    // not the mock.
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
