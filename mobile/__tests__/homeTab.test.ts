/**
 * Unit tests for lib/homeTab.ts. Mocks react-native to pretend we're on
 * web + provides a localStorage shim since the pure-libs jest project
 * doesn't run in a DOM environment.
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

interface StorageLike {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear?: () => void;
}

function installLocalStorage(impl: StorageLike): void {
  (globalThis as any).localStorage = impl;
}

function installStubStorage(): { [k: string]: string } {
  const store: { [k: string]: string } = {};
  installLocalStorage({
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  });
  return store;
}

describe('homeTab', () => {
  beforeEach(() => {
    jest.resetModules();
    delete (globalThis as any).localStorage;
  });

  it('defaults to tasks when nothing is stored', () => {
    installStubStorage();
    const { loadHomeTab } = require('../lib/homeTab');
    expect(loadHomeTab()).toBe('tasks');
  });

  it('defaults to tasks when localStorage is unavailable', () => {
    // Don't install localStorage — hitting the typeof-undefined branch.
    const { loadHomeTab } = require('../lib/homeTab');
    expect(loadHomeTab()).toBe('tasks');
  });

  it('returns the stored value for each valid tab', () => {
    const store = installStubStorage();
    const { loadHomeTab, saveHomeTab } = require('../lib/homeTab');

    saveHomeTab('workouts');
    expect(store['home.tab']).toBe('workouts');
    expect(loadHomeTab()).toBe('workouts');

    saveHomeTab('folders');
    expect(loadHomeTab()).toBe('folders');

    saveHomeTab('tasks');
    expect(loadHomeTab()).toBe('tasks');
  });

  it('falls back to default on an unknown value', () => {
    installStubStorage();
    (globalThis as any).localStorage.setItem('home.tab', 'bogus');
    const { loadHomeTab } = require('../lib/homeTab');
    expect(loadHomeTab()).toBe('tasks');
  });

  it('swallows storage errors (private-browsing Safari)', () => {
    installLocalStorage({
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    });
    const { loadHomeTab, saveHomeTab } = require('../lib/homeTab');
    expect(loadHomeTab()).toBe('tasks');
    // Doesn't throw on save either.
    expect(() => saveHomeTab('workouts')).not.toThrow();
  });
});
