/**
 * Tests for the option-list helpers used by MoveToSheet (PR-D1) and
 * — when it ships — the drag-and-drop drop-target enumeration in
 * PR-D2+. Keeping these in sync between drag and non-drag paths is
 * the whole point of having one source of truth.
 *
 * Pure-function tests, run in the node-libs jest project.
 */
import {
  folderOptions,
  priorityOptions,
  statusOptions,
  starredOptions,
  goalOptions,
} from '../lib/moveToOptions';

describe('folderOptions', () => {
  it('always emits a "No folder" sentinel as the first option with value=null', () => {
    const opts = folderOptions([{ id: 1, name: 'Inbox' }]);
    expect(opts[0]).toMatchObject({ value: null, label: 'No folder' });
  });

  it('preserves folder order from input', () => {
    const opts = folderOptions([
      { id: 3, name: 'Capture' },
      { id: 1, name: 'Inbox' },
      { id: 2, name: 'Someday' },
    ]);
    // Skip the sentinel at [0].
    expect(opts.slice(1).map((o) => o.label)).toEqual(['Capture', 'Inbox', 'Someday']);
  });

  it('handles an empty folder list — only the sentinel emits', () => {
    const opts = folderOptions([]);
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBeNull();
  });
});

describe('priorityOptions', () => {
  it('emits 0=None .. 4=Urgent in numeric order', () => {
    expect(priorityOptions().map((o) => o.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it('uses None / Low / Normal / High / Urgent labels', () => {
    expect(priorityOptions().map((o) => o.label)).toEqual([
      'None', 'Low', 'Normal', 'High', 'Urgent',
    ]);
  });
});

describe('statusOptions', () => {
  it('matches the server enum exactly', () => {
    // Lock the contract: any server-side change to the status enum
    // must move this list at the same time, otherwise the sheet
    // shows stale targets.
    expect(statusOptions().map((o) => o.value)).toEqual([
      'none', 'inbox', 'next_action', 'waiting_for', 'someday', 'done',
    ]);
  });
});

describe('starredOptions', () => {
  it('renders user-friendly Starred / Not starred labels, not true/false', () => {
    const opts = starredOptions();
    expect(opts.find((o) => o.value === true)?.label).toBe('Starred');
    expect(opts.find((o) => o.value === false)?.label).toBe('Not starred');
  });
});

describe('goalOptions', () => {
  it('does NOT include the "all" sentinel', () => {
    // "all" is a filter-bar concept, not a writable goal. If the
    // sheet listed it, tapping would PATCH `goal: 'all'` to the
    // server which doesn't accept that value.
    expect(goalOptions().map((o) => o.value)).not.toContain('all');
  });

  it('matches the server-accepted goal set', () => {
    expect(goalOptions().map((o) => o.value)).toEqual([
      'strength', 'rehab', 'mobility', 'cardio', 'general',
    ]);
  });
});
