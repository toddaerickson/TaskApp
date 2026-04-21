import { describeApiError, describeApiErrorDetailed } from '../lib/apiErrors';

// Minimal fakes that shape-match AxiosError without pulling axios into
// the node-libs jest project (which has no RN bootstrap).
function axiosLike(status: number, data: unknown = undefined, headers: Record<string, string> = {}): any {
  return { response: { status, data, headers } };
}

describe('describeApiError', () => {
  it('returns a network message when there is no response', () => {
    expect(describeApiError({} as unknown)).toMatch(/Can't reach the server/i);
  });

  it('maps a known backend code to the specific message', () => {
    expect(describeApiError(axiosLike(429, { code: 'rate_limited' }))).toMatch(/too fast/i);
    expect(describeApiError(axiosLike(500, { code: 'internal_error' }))).toMatch(/our end/i);
    expect(describeApiError(axiosLike(404, { code: 'not_found' }))).toMatch(/couldn't be found/i);
    expect(describeApiError(axiosLike(409, { code: 'conflict' }))).toMatch(/conflicts with a recent change/i);
    expect(describeApiError(axiosLike(422, { code: 'validation_error' }))).toMatch(/missing or invalid/i);
  });

  it('prefers a known code over the detail string', () => {
    const msg = describeApiError(axiosLike(429, {
      code: 'rate_limited',
      detail: 'Rate limit exceeded: 10 per 1 minute',
    }));
    expect(msg).toMatch(/too fast/i);
    expect(msg).not.toMatch(/10 per 1 minute/);
  });

  it('falls back to FastAPI validation first-item msg when no code match', () => {
    const msg = describeApiError(axiosLike(422, {
      code: 'some_future_code_we_dont_know',
      detail: [{ msg: 'email must be valid', loc: ['body', 'email'] }],
    }));
    expect(msg).toBe('email must be valid');
  });

  it('falls back to detail string when no code matches', () => {
    const msg = describeApiError(axiosLike(400, { detail: 'Email already registered' }));
    expect(msg).toBe('Email already registered');
  });

  it('uses status-based fallback when no code / detail present', () => {
    expect(describeApiError(axiosLike(401))).toMatch(/incorrect email or password/i);
    expect(describeApiError(axiosLike(429))).toMatch(/too many attempts/i);
    expect(describeApiError(axiosLike(503))).toMatch(/server error/i);
  });

  it('uses the caller-provided fallback when nothing else matches', () => {
    const msg = describeApiError(axiosLike(418), 'Keep calm');
    expect(msg).toBe('Keep calm');
  });
});

describe('describeApiErrorDetailed', () => {
  it('prepends HTTP status and appends request_id from the body', () => {
    const msg = describeApiErrorDetailed(
      axiosLike(500, { code: 'internal_error', request_id: 'abc123' }),
    );
    expect(msg).toMatch(/^HTTP 500:/);
    expect(msg).toMatch(/\(req abc123\)$/);
  });

  it('falls back to the X-Request-Id response header when body is silent', () => {
    const msg = describeApiErrorDetailed(
      axiosLike(502, { detail: 'upstream down' }, { 'x-request-id': 'hdr-only' }),
    );
    expect(msg).toMatch(/^HTTP 502:/);
    expect(msg).toContain('upstream down');
    expect(msg).toMatch(/\(req hdr-only\)$/);
  });

  it('omits the request-id parenthetical when neither source has one', () => {
    const msg = describeApiErrorDetailed(axiosLike(409, { detail: 'conflict' }));
    expect(msg).toMatch(/^HTTP 409:/);
    expect(msg).not.toMatch(/\(req /);
  });

  it('returns the plain network message when there is no response', () => {
    const msg = describeApiErrorDetailed({} as unknown);
    expect(msg).toMatch(/Can't reach the server/i);
    expect(msg).not.toMatch(/^HTTP /);
  });
});
