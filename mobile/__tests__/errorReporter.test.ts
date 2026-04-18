/**
 * Client-side PII denylist. The backend has its own scrubber; this is
 * the belt-and-braces check for any case where a caller stuffs a token
 * into the reporter context. Locks the exact denylist in so we notice
 * if someone extends `ReportContext` without extending `DENYLIST`.
 */
import { __private } from '@/lib/errorReporter';

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
