import { parseBatch, titlesToText, MAX_BATCH } from '../lib/multiAdd';

describe('parseBatch', () => {
  it('returns empty for blank input', () => {
    expect(parseBatch('').titles).toEqual([]);
    expect(parseBatch('   ').titles).toEqual([]);
    expect(parseBatch('\n\n\n').titles).toEqual([]);
  });

  it('splits on LF and CRLF newlines', () => {
    expect(parseBatch('alpha\nbeta\r\ngamma').titles).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('trims each line', () => {
    expect(parseBatch('  a  \n\tb\t\nc').titles).toEqual(['a', 'b', 'c']);
  });

  it('drops empty lines', () => {
    expect(parseBatch('a\n\nb\n\n\nc').titles).toEqual(['a', 'b', 'c']);
  });

  it('drops lines starting with #', () => {
    const text = '# header\na\n# note: no colon after\nb';
    expect(parseBatch(text).titles).toEqual(['a', 'b']);
  });

  it('preserves inline # characters that are not at start of line', () => {
    expect(parseBatch('issue #42\nfollow up #later').titles).toEqual(['issue #42', 'follow up #later']);
  });

  it('caps at MAX_BATCH and sets truncated', () => {
    const text = Array.from({ length: MAX_BATCH + 5 }, (_, i) => `task ${i}`).join('\n');
    const r = parseBatch(text);
    expect(r.titles.length).toBe(MAX_BATCH);
    expect(r.truncated).toBe(true);
  });

  it('does not mark truncated when exactly at the cap', () => {
    const text = Array.from({ length: MAX_BATCH }, (_, i) => `task ${i}`).join('\n');
    expect(parseBatch(text).truncated).toBe(false);
  });
});

describe('titlesToText', () => {
  it('joins titles one per line', () => {
    expect(titlesToText(['alpha', 'beta', 'gamma'])).toBe('alpha\nbeta\ngamma');
  });

  it('returns empty string for no titles', () => {
    expect(titlesToText([])).toBe('');
  });

  it('round-trips with parseBatch (losing comments and blanks)', () => {
    const src = 'alpha\n# drop me\nbeta\n\n  gamma  ';
    const parsed = parseBatch(src);
    const rebuilt = titlesToText(parsed.titles);
    expect(rebuilt).toBe('alpha\nbeta\ngamma');
    // Re-parse round-trips clean.
    expect(parseBatch(rebuilt).titles).toEqual(['alpha', 'beta', 'gamma']);
  });
});
