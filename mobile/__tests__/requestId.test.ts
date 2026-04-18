import { newRequestId, requestIdFromError } from '../lib/requestId';

describe('newRequestId', () => {
  it('returns a non-empty string', () => {
    const id = newRequestId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns a different id on repeated calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
    // 50 calls of a 12-char random id — collision is statistically zero.
    expect(ids.size).toBe(50);
  });

  it('produces an id that is short enough to paste and log', () => {
    const id = newRequestId();
    expect(id.length).toBeLessThanOrEqual(32);
  });
});

describe('requestIdFromError', () => {
  it('prefers the response header (lowercase axios convention)', () => {
    const err = { response: { headers: { 'x-request-id': 'abc-1' }, data: { request_id: 'ignored' } } };
    expect(requestIdFromError(err)).toBe('abc-1');
  });

  it('accepts the canonical-cased header', () => {
    const err = { response: { headers: { 'X-Request-Id': 'canon' }, data: {} } };
    expect(requestIdFromError(err)).toBe('canon');
  });

  it('falls back to the body request_id when no header is set', () => {
    const err = { response: { headers: {}, data: { request_id: 'body-only' } } };
    expect(requestIdFromError(err)).toBe('body-only');
  });

  it('returns null for a plain Error', () => {
    expect(requestIdFromError(new Error('boom'))).toBeNull();
  });

  it('returns null when headers and body both lack a request id', () => {
    expect(requestIdFromError({ response: { headers: {}, data: {} } })).toBeNull();
  });
});
