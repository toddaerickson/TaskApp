import { formatTime, severityColor, prettyPart, formatRel } from '../lib/format';

describe('formatTime', () => {
  it.each([
    [0, '0s'],
    [5, '5s'],
    [59, '59s'],
    [60, '1:00'],
    [90, '1:30'],
    [125, '2:05'],
    [3599, '59:59'],
  ])('formatTime(%i) = %s', (secs, expected) => {
    expect(formatTime(secs)).toBe(expected);
  });
});

describe('severityColor', () => {
  it('returns green for 0-2', () => {
    expect(severityColor(0)).toBe('#27ae60');
    expect(severityColor(2)).toBe('#27ae60');
  });
  it('returns amber for 3-5', () => {
    expect(severityColor(3)).toBe('#f0ad4e');
    expect(severityColor(5)).toBe('#f0ad4e');
  });
  it('returns orange for 6-7', () => {
    expect(severityColor(6)).toBe('#e67e22');
    expect(severityColor(7)).toBe('#e67e22');
  });
  it('returns red for 8-10', () => {
    expect(severityColor(8)).toBe('#e74c3c');
    expect(severityColor(10)).toBe('#e74c3c');
  });
});

describe('prettyPart', () => {
  it('replaces underscores and title-cases', () => {
    expect(prettyPart('right_big_toe')).toBe('Right Big Toe');
    expect(prettyPart('lower_back')).toBe('Lower Back');
  });
  it('leaves single words title-cased', () => {
    expect(prettyPart('ankle')).toBe('Ankle');
  });
  it('handles empty string', () => {
    expect(prettyPart('')).toBe('');
  });
});

describe('formatRel', () => {
  const NOW = new Date('2026-04-15T12:00:00Z').getTime();
  beforeAll(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterAll(() => jest.restoreAllMocks());

  it('returns minutes for times under an hour', () => {
    const t = new Date(NOW - 15 * 60 * 1000).toISOString();
    expect(formatRel(t)).toBe('15m ago');
  });
  it('returns hours for times under a day', () => {
    const t = new Date(NOW - 5 * 3600 * 1000).toISOString();
    expect(formatRel(t)).toBe('5h ago');
  });
  it('returns days for older times', () => {
    const t = new Date(NOW - 3 * 86400 * 1000).toISOString();
    expect(formatRel(t)).toBe('3d ago');
  });
});
